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
    console,
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
