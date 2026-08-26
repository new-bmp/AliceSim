const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "project-folder.js"), "utf8");

function createHarness(initial = {}) {
  const downloads = [];
  const revoked = [];
  const events = [];
  const harnessConsole = Object.create(console);
  if (initial.silentWarnings) harnessConsole.warn = function () {};
  const editor = {
    value: initial.content || "",
    readOnly: false,
    dataset: { aliceProjectPath: initial.path || "main.c" },
    addEventListener() {},
    dispatchEvent() {},
    setSelectionRange() {}
  };
  const body = {
    appendChild(node) {
      node.parentNode = body;
      if (node.tagName === "A") downloads.push(node);
    },
    append() {}
  };
  const document = {
    readyState: "loading",
    title: "",
    head: { appendChild() {} },
    body,
    addEventListener() {},
    querySelector(selector) { return selector === "#codeEditor" ? editor : null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      const node = {
        tagName: String(tag).toUpperCase(),
        dataset: {},
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        addEventListener() {},
        append() {},
        appendChild() {},
        replaceChildren() {},
        click() { node.clicked = true; },
        remove() { node.removed = true; }
      };
      return node;
    }
  };
  const window = {
    document,
    AliceIocViewer: initial.iocViewer,
    AliceSchematic: initial.schematic,
    showDirectoryPicker: initial.showDirectoryPicker,
    URL: {
      createObjectURL() { return "blob:alice-test"; },
      revokeObjectURL(value) { revoked.push(value); }
    },
    setTimeout(callback) { callback(); },
    addEventListener() {},
    dispatchEvent(event) { events.push(event); },
    AliceEditorHost: {
      openFile(descriptor) {
        editor.dataset.aliceProjectPath = descriptor.path;
        editor.value = descriptor.content;
        editor.readOnly = descriptor.readOnly;
      },
      getCurrentFile() {
        return {
          path: editor.dataset.aliceProjectPath,
          content: editor.value,
          readOnly: editor.readOnly
        };
      }
    }
  };
  const context = vm.createContext({
    window,
    document,
    Blob,
    TextEncoder,
    URL: window.URL,
    Map,
    Set,
    Promise,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    RegExp,
    Error,
    TypeError,
    console: harnessConsole,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    }
  });
  vm.runInContext(source, context, { filename: "project-folder.js" });
  return { window, editor, downloads, revoked, events };
}

test("saveActiveCode writes the current editor buffer back through its file handle", async () => {
  const harness = createHarness();
  const writes = [];
  let closed = false;
  const fileHandle = {
    async queryPermission() { return "granted"; },
    async createWritable() {
      return {
        async write(value) { writes.push(value); },
        async close() { closed = true; }
      };
    }
  };
  const content = "int main(void) { return 0; }\n";
  await harness.window.AliceProjectWorkspace.openFolder([{
    name: "main.c",
    relativePath: "Demo/Core/Src/main.c",
    size: content.length,
    lastModified: 1,
    fileHandle,
    async text() { return content; }
  }]);

  const edited = "int main(void) { return 1; }\n";
  harness.editor.value = edited;
  const result = await harness.window.AliceProject.saveActiveCode({ notify: false });

  assert.equal(result.ok, true);
  assert.equal(result.action, "write-back");
  assert.deepEqual(writes, [edited]);
  assert.equal(closed, true);
  const record = harness.window.AliceProjectWorkspace.getState().files.get("Core/Src/main.c");
  assert.equal(record.content, edited);
  assert.equal(record.dirty, false);
  assert.equal(record.canWriteBack, true);
});

test("opening a project recognizes and loads its matching AliceSIM circuit", async () => {
  const importedCircuits = [];
  const loadedIocs = [];
  const harness = createHarness({
    schematic: {
      importCircuit(content) {
        importedCircuits.push(JSON.parse(content));
        return { ok: true, componentCount: 1, wireCount: 0 };
      }
    },
    iocViewer: {
      load(content, filename) {
        loadedIocs.push({ content, filename });
        return { mcu: "STM32F103C8T6" };
      },
      open() {}
    }
  });
  const files = {
    "Core/Src/main.c": "int main(void) { for (;;) {} }\n",
    "Demo.ioc": "Mcu.CPN=STM32F103C8T6\n",
    "Demo.alice-sch.json": JSON.stringify({
      schemaVersion: 1,
      kind: "AliceSIMCircuit",
      mcu: "STM32F103C8T6",
      components: [{ id: "mcu-1", type: "mcu" }],
      wires: [],
      view: { zoom: 1, panX: 0, panY: 0 }
    })
  };

  const state = await harness.window.AliceProjectWorkspace.loadFiles(files, "Demo");

  assert.equal(loadedIocs.length, 1);
  assert.equal(importedCircuits.length, 1);
  assert.equal(importedCircuits[0].kind, "AliceSIMCircuit");
  assert.equal(state.circuitPath, "Demo.alice-sch.json");
  assert.equal(state.files.get("Demo.alice-sch.json").kind, "circuit");
});

test("folder import recognizes an IOC stored at the selected root", async () => {
  const loadedIocs = [];
  const harness = createHarness({
    iocViewer: {
      load(content, filename) {
        loadedIocs.push({ content, filename });
        return { mcu: "STM32F103C8T6" };
      },
      open() {}
    }
  });
  const state = await harness.window.AliceProjectWorkspace.openFolder([
    {
      name: "Demo.ioc",
      relativePath: "Demo/Demo.ioc",
      size: 27,
      lastModified: 1,
      async text() { return "Mcu.CPN=STM32F103C8T6\n"; }
    },
    {
      name: "main.c",
      relativePath: "Demo/Core/Src/main.c",
      size: 33,
      lastModified: 1,
      async text() { return "int main(void) { for (;;) {} }\n"; }
    }
  ]);

  assert.equal(state.rootName, "Demo");
  assert.equal(state.iocPath, "Demo.ioc");
  assert.equal(state.entryPath, "Core/Src/main.c");
  assert.deepEqual(Array.from(state.files.keys()).sort(), ["Core/Src/main.c", "Demo.ioc"]);
  assert.deepEqual(loadedIocs, [{ content: "Mcu.CPN=STM32F103C8T6\n", filename: "Demo.ioc" }]);
});

test("directory picker imports a root IOC together with nested source files", async () => {
  const pickerCalls = [];
  const fileEntry = (name, content) => ({
    kind: "file",
    name,
    async getFile() {
      return {
        name,
        size: content.length,
        lastModified: 1,
        type: "text/plain",
        async text() { return content; }
      };
    },
    async queryPermission() { return "prompt"; },
    async requestPermission() { return "granted"; },
    async createWritable() { throw new Error("not used during import"); }
  });
  const mainEntry = fileEntry("main.c", "int main(void) { for (;;) {} }\n");
  const srcDirectory = {
    kind: "directory",
    name: "Src",
    async *values() { yield mainEntry; }
  };
  const coreDirectory = {
    kind: "directory",
    name: "Core",
    async *values() { yield srcDirectory; }
  };
  const rootHandle = {
    kind: "directory",
    name: "Demo",
    async *values() {
      yield fileEntry("Demo.ioc", "Mcu.CPN=STM32F103C8T6\n");
      yield coreDirectory;
    }
  };
  const harness = createHarness({
    showDirectoryPicker(options) {
      pickerCalls.push(options);
      return Promise.resolve(rootHandle);
    },
    iocViewer: { load() { return {}; }, open() {} }
  });

  const state = await harness.window.AliceProjectWorkspace.openWritableFolder();

  assert.equal(pickerCalls.length, 1);
  assert.equal(pickerCalls[0].mode, "read");
  assert.equal(state.rootName, "Demo");
  assert.equal(state.iocPath, "Demo.ioc");
  assert.equal(state.entryPath, "Core/Src/main.c");
  assert.deepEqual(Array.from(state.files.keys()).sort(), ["Core/Src/main.c", "Demo.ioc"]);
});

test("an IOC viewer error does not abort the containing folder import", async () => {
  const harness = createHarness({
    silentWarnings: true,
    iocViewer: {
      load() { throw new Error("unsupported IOC field"); },
      open() {}
    }
  });
  const state = await harness.window.AliceProjectWorkspace.openFolder([
    {
      name: "Demo.ioc",
      relativePath: "Demo/Demo.ioc",
      size: 27,
      lastModified: 1,
      async text() { return "Mcu.CPN=STM32F103C8T6\n"; }
    },
    {
      name: "main.c",
      relativePath: "Demo/Core/Src/main.c",
      size: 33,
      lastModified: 1,
      async text() { return "int main(void) { for (;;) {} }\n"; }
    }
  ]);

  assert.equal(state.importing, false);
  assert.equal(state.iocPath, "Demo.ioc");
  assert.equal(state.files.has("Core/Src/main.c"), true);
  assert.match(state.warnings.join("\n"), /IOC 配置解析失败：Demo\.ioc/);
});

test("folder picker requests read access and defers write permission until save", () => {
  assert.match(source, /AlicePlatform && window\.AlicePlatform\.files/);
  assert.match(source, /pickDirectory\(\{ mode: "read" \}\)/);
  assert.match(source, /requestPermission\(\{ mode: "readwrite" \}\)/);
});

test("an empty directory scan always clears the importing state", async () => {
  const harness = createHarness();
  const result = await harness.window.AliceProjectWorkspace.openFolder([]);

  assert.equal(result, null);
  assert.equal(harness.window.AliceProjectWorkspace.getState().importing, false);
});

test("a 96 MB CubeMX driver tree can be imported", async () => {
  const harness = createHarness({
    iocViewer: { load() { return {}; }, open() {} }
  });
  const projectFiles = [
    {
      name: "Demo.ioc",
      relativePath: "Demo/Demo.ioc",
      size: 27,
      lastModified: 1,
      async text() { return "Mcu.CPN=STM32F103C8T6\n"; }
    },
    {
      name: "main.c",
      relativePath: "Demo/Core/Src/main.c",
      size: 33,
      lastModified: 1,
      async text() { return "int main(void) { for (;;) {} }\n"; }
    }
  ];
  for (let index = 0; index < 96; index += 1) {
    projectFiles.push({
      name: `driver_${index}.h`,
      relativePath: `Demo/Drivers/CMSIS/Include/driver_${index}.h`,
      size: 1024 * 1024,
      lastModified: 1,
      async text() { return "#pragma once\n"; }
    });
  }

  const state = await harness.window.AliceProjectWorkspace.openFolder(projectFiles);

  assert.equal(state.rootName, "Demo");
  assert.equal(state.files.has("Drivers/CMSIS/Include/driver_95.h"), true);
  assert.equal(state.importing, false);
});

test("saveActiveCode downloads the active file when no writable handle exists", async () => {
  const harness = createHarness({ path: "Scratch/main.c", content: "void app(void) {}\n" });
  const result = await harness.window.AliceProject.saveActiveCode({ notify: false });

  assert.equal(result.ok, true);
  assert.equal(result.action, "download");
  assert.equal(result.filename, "main.c");
  assert.equal(harness.downloads.length, 1);
  assert.equal(harness.downloads[0].download, "main.c");
  assert.equal(harness.downloads[0].clicked, true);
  assert.deepEqual(harness.revoked, ["blob:alice-test"]);
});

test("saving a writable CubeMX folder creates a complete AliceSIM project directory", async () => {
  const writes = new Map();
  let aliceDirectory = null;
  const projectDirectory = {
    kind: "directory",
    name: "AliceSIM",
    async getDirectoryHandle(name, options) {
      assert.equal(name, "workspace");
      assert.equal(options?.create, true);
      return projectDirectory;
    },
    async getFileHandle(name, options) {
      assert.equal(options?.create, true);
      return {
        async createWritable() {
          return {
            async write(content) { writes.set(name, content); },
            async close() {}
          };
        }
      };
    }
  };
  const rootDirectory = {
    kind: "directory",
    name: "Demo",
    async queryPermission() { return "prompt"; },
    async requestPermission() { return "granted"; },
    async getDirectoryHandle(name, options) {
      assert.equal(name, "AliceSIM");
      if (options?.create) {
        aliceDirectory = projectDirectory;
        return projectDirectory;
      }
      const error = new Error("not found");
      error.name = "NotFoundError";
      throw error;
    },
    async *values() {
      yield {
        kind: "file",
        name: "main.c",
        async getFile() {
          return { name: "main.c", size: 23, lastModified: 1, type: "text/plain", async text() { return "int main(void) {return 0;}\n"; } };
        }
      };
    }
  };
  const circuit = { schemaVersion: 1, kind: "AliceSIMCircuit", mcu: "STM32F103C8T6", components: [], wires: [], view: {} };
  const harness = createHarness({
    showDirectoryPicker: async () => rootDirectory,
    schematic: { exportCircuit() { return circuit; } }
  });
  await harness.window.AliceProjectWorkspace.openWritableFolder();

  const payload = {
    format: "AliceSIM Project",
    version: 3,
    project: { name: "Demo", mcu: "STM32F103C8T6" },
    currentFile: "main.c",
    files: { "main.c": "int main(void) {return 1;}\n" },
    circuit
  };
  const result = await harness.window.AliceProjectWorkspace.saveProject(payload, { notify: false });

  assert.equal(result.ok, true);
  assert.equal(result.action, "project-folder");
  assert.equal(aliceDirectory, projectDirectory);
  assert.equal(JSON.parse(writes.get("project.alice.json")).files["main.c"], payload.files["main.c"]);
  assert.deepEqual(JSON.parse(writes.get("circuit.alice-sch.json")), circuit);
  assert.equal(writes.get("main.c"), payload.files["main.c"]);
  assert.equal(result.changedFileCount, 1);
  assert.equal(JSON.parse(writes.get("project.alice.json")).storage.workspaceSync.complete, true);
  const progressStages = harness.events.filter(event => event.type === "alice-project-save-progress").map(event => event.detail.stage);
  assert.ok(progressStages.indexOf("circuit") < progressStages.indexOf("manifest"));
  assert.ok(progressStages.indexOf("manifest") < progressStages.indexOf("workspace"));
  assert.equal(progressStages.at(-1), "complete");
  assert.equal(harness.window.AliceProjectWorkspace.getState().managedProjectDirectory, "AliceSIM");
  assert.equal(harness.window.AliceProjectWorkspace.getState().managedWorkspaceDirectory, "AliceSIM/workspace");
});

test("a workspace copy failure cannot discard the saved circuit and complete project snapshot", async () => {
  const writes = new Map();
  const failingWorkspace = {
    async getFileHandle() {
      return {
        async createWritable() {
          return {
            async write() { throw new Error("simulated workspace failure"); },
            async close() {},
            async abort() {}
          };
        }
      };
    }
  };
  const projectDirectory = {
    kind: "directory",
    name: "AliceSIM",
    async getDirectoryHandle(name, options) {
      assert.equal(name, "workspace");
      assert.equal(options?.create, true);
      return failingWorkspace;
    },
    async getFileHandle(name, options) {
      assert.equal(options?.create, true);
      return {
        async createWritable() {
          return {
            async write(content) { writes.set(name, content); },
            async close() {}
          };
        }
      };
    }
  };
  const rootDirectory = {
    kind: "directory",
    name: "Demo",
    async queryPermission() { return "granted"; },
    async getDirectoryHandle(name, options) {
      if (options?.create) return projectDirectory;
      const error = new Error("not found");
      error.name = "NotFoundError";
      throw error;
    },
    async *values() {
      yield {
        kind: "file",
        name: "main.c",
        async getFile() {
          return { name: "main.c", size: 23, lastModified: 1, type: "text/plain", async text() { return "int main(void) {return 0;}\n"; } };
        }
      };
    }
  };
  const circuit = { schemaVersion: 1, kind: "AliceSIMCircuit", mcu: "STM32F103C8T6", components: [], wires: [], view: {} };
  const harness = createHarness({
    silentWarnings: true,
    showDirectoryPicker: async () => rootDirectory,
    schematic: { exportCircuit() { return circuit; } }
  });
  await harness.window.AliceProjectWorkspace.openWritableFolder();

  const result = await harness.window.AliceProjectWorkspace.saveProject({
    format: "AliceSIM Project",
    version: 3,
    project: { name: "Demo", mcu: "STM32F103C8T6" },
    files: { "main.c": "int main(void) {return 1;}\n" },
    circuit
  }, { notify: false });

  assert.equal(result.ok, true);
  assert.match(result.warning, /电路和完整项目快照已保存/);
  assert.match(result.workspaceSyncError, /main\.c/);
  assert.deepEqual(JSON.parse(writes.get("circuit.alice-sch.json")), circuit);
  assert.equal(JSON.parse(writes.get("project.alice.json")).files["main.c"], "int main(void) {return 1;}\n");
  assert.equal(JSON.parse(writes.get("project.alice.json")).storage.workspaceSync.complete, false);
});

test("opening a CubeMX folder restores its saved AliceSIM snapshot before scanning originals", async () => {
  let originalScans = 0;
  const importedCircuits = [];
  const circuit = { schemaVersion: 1, kind: "AliceSIMCircuit", mcu: "STM32F103C8T6", components: [], wires: [], view: {} };
  const snapshot = {
    format: "AliceSIM Project",
    version: 3,
    project: { name: "Remembered", mcu: "STM32F103C8T6" },
    currentFile: "Core/Src/main.c",
    files: {
      "Core/Src/main.c": "int main(void) {return 7;}\n",
      "Remembered.ioc": "Mcu.CPN=STM32F103C8T6\n"
    },
    circuitPath: "Remembered.alice-sch.json",
    circuit
  };
  const projectDirectory = {
    kind: "directory",
    name: "AliceSIM",
    async getFileHandle(name) {
      assert.equal(name, "project.alice.json");
      const content = JSON.stringify(snapshot);
      return { async getFile() { return { size: content.length, async text() { return content; } }; } };
    }
  };
  const rootDirectory = {
    kind: "directory",
    name: "Demo",
    async getFileHandle() { throw new Error("root files are not read directly"); },
    async getDirectoryHandle(name) { assert.equal(name, "AliceSIM"); return projectDirectory; },
    async *values() { originalScans += 1; }
  };
  const harness = createHarness({
    showDirectoryPicker: async () => rootDirectory,
    iocViewer: { load() { return {}; }, open() {} },
    schematic: {
      importCircuit(content) { importedCircuits.push(JSON.parse(content)); return { ok: true }; }
    }
  });

  const state = await harness.window.AliceProjectWorkspace.openWritableFolder();

  assert.equal(originalScans, 0);
  assert.equal(state.rootName, "Remembered");
  assert.equal(state.openMode, "alicesim-project");
  assert.equal(harness.editor.value, snapshot.files["Core/Src/main.c"]);
  assert.deepEqual(importedCircuits, [circuit]);
  assert.equal(harness.events.some(event => event.type === "alice-project-snapshot-restored"), true);
});

test("concurrent code saves are serialized and the later save captures the latest buffer", async () => {
  const harness = createHarness();
  const writes = [];
  let writableCount = 0;
  let releaseFirst;
  let signalFirstStarted;
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
  const firstCanClose = new Promise((resolve) => { releaseFirst = resolve; });
  const fileHandle = {
    async queryPermission() { return "granted"; },
    async createWritable() {
      const index = writableCount++;
      if (index === 0) signalFirstStarted();
      return {
        async write(value) { writes.push(value); },
        async close() { if (index === 0) await firstCanClose; }
      };
    }
  };
  const original = "int main(void) { return 0; }\n";
  await harness.window.AliceProjectWorkspace.openFolder([{
    name: "main.c",
    relativePath: "Demo/Core/Src/main.c",
    size: original.length,
    lastModified: 1,
    fileHandle,
    async text() { return original; }
  }]);

  const firstText = "int main(void) { return 1; }\n";
  const secondText = "int main(void) { return 2; }\n";
  harness.editor.value = firstText;
  const firstSave = harness.window.AliceProject.saveActiveCode({ notify: false });
  await firstStarted;
  harness.editor.value = secondText;
  harness.window.AliceProjectWorkspace.upsertFiles({ "Core/Src/main.c": secondText });
  const secondSave = harness.window.AliceProject.saveActiveCode({ notify: false });
  await Promise.resolve();
  assert.equal(writableCount, 1);
  releaseFirst();
  const results = await Promise.all([firstSave, secondSave]);

  assert.deepEqual(writes, [firstText, secondText]);
  assert.equal(writableCount, 2);
  assert.equal(results[0].dirty, true);
  assert.equal(results[1].dirty, false);
});

test("a queued save keeps the file that was active when the shortcut was pressed", async () => {
  const harness = createHarness();
  const writes = { a: [], b: [] };
  let releaseFirst;
  let signalFirstStarted;
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
  const firstCanClose = new Promise((resolve) => { releaseFirst = resolve; });
  let aWritableCount = 0;
  const handleA = {
    async queryPermission() { return "granted"; },
    async createWritable() {
      const index = aWritableCount++;
      if (index === 0) signalFirstStarted();
      return {
        async write(value) { writes.a.push(value); },
        async close() { if (index === 0) await firstCanClose; }
      };
    }
  };
  const handleB = {
    async queryPermission() { return "granted"; },
    async createWritable() {
      return { async write(value) { writes.b.push(value); }, async close() {} };
    }
  };
  await harness.window.AliceProjectWorkspace.openFolder([
    { name: "a.c", relativePath: "Demo/Core/Src/a.c", size: 1, lastModified: 1, fileHandle: handleA, async text() { return "A0\n"; } },
    { name: "b.c", relativePath: "Demo/Core/Src/b.c", size: 1, lastModified: 1, fileHandle: handleB, async text() { return "B0\n"; } }
  ]);

  harness.editor.value = "A1\n";
  const firstSave = harness.window.AliceProject.saveActiveCode({ notify: false });
  await firstStarted;
  harness.editor.value = "A2\n";
  const secondSave = harness.window.AliceProject.saveActiveCode({ notify: false });
  harness.window.AliceProjectWorkspace.openFile("Core/Src/b.c");
  harness.editor.value = "B1\n";
  releaseFirst();
  await Promise.all([firstSave, secondSave]);

  assert.deepEqual(writes.a, ["A1\n", "A2\n"]);
  assert.deepEqual(writes.b, []);
});

test("addFiles preserves existing files while upsertFiles can refresh selected paths", () => {
  const harness = createHarness();
  const workspace = harness.window.AliceProjectWorkspace;
  const first = workspace.addFiles({ "Drivers/AliceSIM/device.h": "#pragma once\n" });
  const skipped = workspace.addFiles({ "Drivers/AliceSIM/device.h": "changed\n" });
  const updated = workspace.upsertFiles({ "Drivers/AliceSIM/device.h": "changed\n" });

  assert.deepEqual(Array.from(first.added), ["Drivers/AliceSIM/device.h"]);
  assert.equal(skipped.skipped.length, 1);
  assert.deepEqual(Array.from(updated.updated), ["Drivers/AliceSIM/device.h"]);
  assert.equal(workspace.getState().files.get("Drivers/AliceSIM/device.h").content, "changed\n");
});
