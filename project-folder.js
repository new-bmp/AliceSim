(function () {
  "use strict";

  if (window.AliceProjectWorkspace) return;

  var MAX_FILES = 8000;
  var MAX_TEXT_MEGABYTES = 128;
  var MAX_TEXT_BYTES = MAX_TEXT_MEGABYTES * 1024 * 1024;
  var READ_CONCURRENCY = 8;
  var WRITE_CONCURRENCY = 4;
  var ALICE_PROJECT_DIRECTORY = "AliceSIM";
  var ALICE_PROJECT_FILENAME = "project.alice.json";
  var ALICE_CIRCUIT_FILENAME = "circuit.alice-sch.json";
  var ALICE_WORKSPACE_DIRECTORY = "workspace";
  var RECENT_PROJECT_DATABASE = "alicesim-projects-v1";
  var RECENT_PROJECT_STORE = "projects";
  var RECENT_PROJECT_KEY = "recent";
  var STYLE_ID = "aliceProjectFolderStyles";
  var FOLDER_INPUT_ID = "aliceProjectFolderInput";
  var IOC_INPUT_ID = "aliceIocOnlyInput";

  var workspace = {
    rootName: "",
    files: new Map(),
    activePath: "",
    entryPath: "",
    iocPath: "",
    circuitPath: "",
    sourcePaths: [],
    includeDirs: [],
    defines: [],
    warnings: [],
    importing: false,
    importSequence: 0,
    directoryHandle: null,
    projectDirectoryHandle: null,
    managedFilesInitialized: false,
    openMode: "empty"
  };

  var folderInput = null;
  var iocOnlyInput = null;
  var suppressEditorInput = false;
  var saveActiveCodeQueue = Promise.resolve();
  var saveProjectQueue = Promise.resolve();

  function directoryPicker() {
    var platformPicker = window.AlicePlatform && window.AlicePlatform.files && window.AlicePlatform.files.pickDirectory;
    if (window.AlicePlatform && window.AlicePlatform.capabilities && window.AlicePlatform.capabilities.directoryPicker && typeof platformPicker === "function") {
      return platformPicker;
    }
    if (typeof window.showDirectoryPicker === "function") return window.showDirectoryPicker.bind(window);
    return null;
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function toast(message, type) {
    if (typeof window.showToast === "function") {
      window.showToast(message, type || "success");
      return;
    }
    var stack = $("#toastStack");
    if (!stack) return;
    var item = document.createElement("div");
    item.className = "toast " + (type || "success");
    var dot = document.createElement("i");
    var label = document.createElement("span");
    label.textContent = message;
    item.append(dot, label);
    stack.appendChild(item);
    window.setTimeout(function () { item.classList.add("hide"); }, 2800);
    window.setTimeout(function () { item.remove(); }, 3150);
  }

  function addStyles() {
    if ($("#" + STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".alice-ioc-only{width:calc(100% - 22px);height:27px;margin:-5px 11px 10px;border:1px solid #c8c8c8;color:#0f6cbd;background:#fff;font:10px 'Segoe UI',sans-serif;text-align:center}",
      ".alice-ioc-only:hover{border-color:#0f6cbd;background:#f5faff}",
      "#fileTree.alice-project-tree{padding-bottom:10px;overflow-x:hidden}",
      "#fileTree .alice-project-row{--alice-depth:0;min-width:0;padding-left:calc(9px + var(--alice-depth) * 15px);padding-right:7px}",
      "#fileTree .alice-project-row .alice-tree-arrow{width:11px;flex:0 0 11px;color:#616161;font-size:9px;text-align:center;transition:transform .12s}",
      "#fileTree .alice-project-row.open .alice-tree-arrow{transform:rotate(90deg)}",
      "#fileTree .alice-project-row .alice-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "#fileTree .alice-project-file .file-type{position:relative}",
      "#fileTree .alice-project-file[data-readonly=true]{color:#616161}",
      "#fileTree .alice-project-file .alice-file-dirty{display:none;width:6px;height:6px;margin-left:auto;border-radius:50%;background:#ca5010}",
      "#fileTree .alice-project-file.is-dirty .alice-file-dirty{display:block}",
      "#fileTree .alice-project-children[hidden]{display:none}",
      ".alice-folder-choice{position:fixed;z-index:1400;inset:0;display:grid;place-items:center;background:rgba(32,31,30,.42)}",
      ".alice-folder-choice-panel{width:min(470px,calc(100vw - 32px));padding:22px;border:1px solid #c8c8c8;background:#fff;color:#242424;box-shadow:0 16px 40px rgba(0,0,0,.24);font:11px 'Segoe UI',sans-serif}",
      ".alice-folder-choice-panel h2{margin:0 0 7px;font-size:17px;font-weight:600}",
      ".alice-folder-choice-panel p{margin:0 0 14px;color:#616161;line-height:1.5}",
      ".alice-folder-choice-panel select{width:100%;height:34px;padding:0 8px;border:1px solid #8a8886;background:#fff;color:#242424}",
      ".alice-folder-choice-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}",
      ".alice-folder-choice-actions button{height:32px;min-width:94px;padding:0 13px;border:1px solid #8a8886;background:#fff;color:#242424}",
      ".alice-folder-choice-actions button.primary{border-color:#0f6cbd;background:#0f6cbd;color:#fff}",
      "body:not(.visio-theme) .alice-ioc-only{border-color:#2b3240;color:#b7a3e8;background:#10141d}",
      "body:not(.visio-theme) .alice-folder-choice-panel{border-color:#383044;background:#171923;color:#e7eaf1}",
      "body:not(.visio-theme) .alice-folder-choice-panel p{color:#a1a8b7}"
    ].join("");
    document.head.appendChild(style);
  }

  function normalizePath(value) {
    var raw = String(value || "").replace(/\\/g, "/").replace(/\0/g, "");
    raw = raw.replace(/^\.\/+/, "").replace(/^\/+/, "");
    var output = [];
    raw.split("/").forEach(function (part) {
      if (!part || part === ".") return;
      if (part === "..") throw new Error("工程路径不能包含 '..'");
      if (/^[A-Za-z]:$/.test(part)) throw new Error("工程路径不能包含盘符");
      output.push(part);
    });
    return output.join("/");
  }

  function dirname(path) {
    var index = path.lastIndexOf("/");
    return index < 0 ? "." : path.slice(0, index) || ".";
  }

  function basename(path) {
    return path.slice(path.lastIndexOf("/") + 1);
  }

  function safeDownloadName(path) {
    var name = basename(String(path || "main.c"))
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim();
    return name || "main.c";
  }

  function extension(path) {
    var name = basename(path);
    var index = name.lastIndexOf(".");
    return index < 0 ? "" : name.slice(index).toLowerCase();
  }

  function rawFilePath(file) {
    return file.webkitRelativePath || file.relativePath || file.name || "";
  }

  function detectRootName(files) {
    var firstSegments = files.map(function (file) {
      var path = normalizePath(rawFilePath(file));
      return path.includes("/") ? path.split("/")[0] : "";
    });
    if (firstSegments.length && firstSegments[0] && firstSegments.every(function (value) { return value === firstSegments[0]; })) {
      return firstSegments[0];
    }
    return "";
  }

  function relativeFilePath(file, rootName) {
    var path = normalizePath(rawFilePath(file));
    if (rootName && (path === rootName || path.indexOf(rootName + "/") === 0)) {
      path = path.slice(rootName.length).replace(/^\/+/, "");
    }
    return path || normalizePath(file.name);
  }

  function isIgnoredPath(path) {
    var lower = ("/" + path.toLowerCase() + "/");
    if (/\/(?:\.git|\.svn|\.hg|\.idea|\.vscode|node_modules)\//.test(lower)) return true;
    if (/\/(?:debug|release|build|out|dist|cmake-build-[^/]+)\//.test(lower)) return true;
    return /\.(?:o|obj|a|lib|elf|axf|out|bin|hex|map|d|su|lst|crf|dep|pch|gch|log|tmp|bak|zip|7z|rar)$/i.test(path);
  }

  function isAliceManagedPath(path) {
    return normalizePath(path).split("/")[0].toLowerCase() === ALICE_PROJECT_DIRECTORY.toLowerCase();
  }

  function classifyPath(path) {
    var lower = path.toLowerCase();
    var name = basename(lower);
    var ext = extension(lower);
    if (lower.endsWith(".alice-sch.json")) return { kind: "circuit", language: "json", editable: false };
    if (ext === ".c") return { kind: "source", language: "c", editable: true };
    if ([".cc", ".cpp", ".cxx"].includes(ext)) return { kind: "source", language: "cpp", editable: true };
    if ([".h", ".hh", ".hpp", ".hxx", ".inc"].includes(ext)) return { kind: "header", language: "c", editable: true };
    if ([".s", ".asm"].includes(ext)) return { kind: "assembly", language: "asm", editable: true };
    if (ext === ".ld") return { kind: "linker", language: "linker", editable: true };
    if (ext === ".ioc") return { kind: "ioc", language: "ini", editable: false };
    if (["makefile", "gnumakefile", "cmakelists.txt"].includes(name)) return { kind: "build", language: "makefile", editable: false };
    if ([".mk", ".mak", ".make", ".cmake", ".project", ".cproject", ".mxproject"].includes(ext)) {
      return { kind: "build", language: ext.slice(1) || "text", editable: false };
    }
    if ([".json", ".yaml", ".yml"].includes(ext) && /(?:compile_commands|cmakepresets|settings|project)/i.test(name)) {
      return { kind: "build", language: ext.slice(1), editable: false };
    }
    return null;
  }

  function isSourcePath(path) {
    return /\.(?:c|cc|cpp|cxx)$/i.test(path);
  }

  function isMainSourcePath(path) {
    return /(^|\/)main\.(?:c|cc|cpp|cxx)$/i.test(path);
  }

  function stripBom(text) {
    return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  async function mapLimit(items, limit, iteratee) {
    var results = new Array(items.length);
    var cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        var index = cursor++;
        results[index] = await iteratee(items[index], index);
      }
    }
    var workers = [];
    for (var index = 0; index < Math.min(limit, items.length); index += 1) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  function scoreIocPath(path) {
    var score = path.split("/").length === 1 ? 100 : 0;
    var expected = workspace.rootName.toLowerCase() + ".ioc";
    if (basename(path).toLowerCase() === expected) score += 50;
    if (/backup|copy|old|archive/i.test(path)) score -= 30;
    return score;
  }

  function chooseIocPath(paths) {
    if (!paths.length) return Promise.resolve("");
    var ordered = paths.slice().sort(function (left, right) {
      return scoreIocPath(right) - scoreIocPath(left) || left.localeCompare(right, undefined, { numeric: true });
    });
    if (ordered.length === 1) return Promise.resolve(ordered[0]);

    return new Promise(function (resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "alice-folder-choice";
      var panel = document.createElement("div");
      panel.className = "alice-folder-choice-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      var title = document.createElement("h2");
      title.textContent = "选择 STM32CubeMX IOC";
      var description = document.createElement("p");
      description.textContent = "该文件夹包含多个 .ioc 文件。请选择本次工作区使用的配置源。";
      var select = document.createElement("select");
      ordered.forEach(function (path) { select.add(new Option(path, path)); });
      var actions = document.createElement("div");
      actions.className = "alice-folder-choice-actions";
      var skip = document.createElement("button");
      skip.type = "button";
      skip.textContent = "暂不载入";
      var confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "primary";
      confirm.textContent = "使用此 IOC";
      actions.append(skip, confirm);
      panel.append(title, description, select, actions);
      backdrop.appendChild(panel);
      document.body.appendChild(backdrop);
      function finish(value) {
        backdrop.remove();
        resolve(value);
      }
      skip.addEventListener("click", function () { finish(""); });
      confirm.addEventListener("click", function () { finish(select.value); });
      backdrop.addEventListener("click", function (event) { if (event.target === backdrop) finish(""); });
      select.addEventListener("keydown", function (event) {
        if (event.key === "Enter") finish(select.value);
        if (event.key === "Escape") finish("");
      });
      window.setTimeout(function () { select.focus(); }, 20);
    });
  }

  function parseDefines(records, iocPath) {
    var defines = new Set(["USE_HAL_DRIVER"]);
    records.forEach(function (record) {
      if (record.kind !== "build") return;
      var matcher = /(?:^|\s)-D([A-Za-z_]\w*(?:=[^\s\"'<>]+)?)/g;
      var match;
      while ((match = matcher.exec(record.content))) defines.add(match[1]);
      var xmlMatcher = /(?:definedSymbols|preprocessorDefinitions)[^>]*value=[\"']([A-Za-z_]\w*(?:=[^\"']+)?)['\"]/gi;
      while ((match = xmlMatcher.exec(record.content))) defines.add(match[1]);
    });
    var ioc = iocPath ? workspace.files.get(iocPath) : null;
    if (ioc && /Mcu\.(?:Name|CPN)=STM32F103/i.test(ioc.content)) defines.add("STM32F103xB");
    return Array.from(defines).sort();
  }

  function deriveProjectMetadata() {
    var records = Array.from(workspace.files.values());
    workspace.sourcePaths = records.filter(function (record) { return isSourcePath(record.path); }).map(function (record) { return record.path; }).sort();

    var mainCandidates = workspace.sourcePaths.filter(isMainSourcePath);
    mainCandidates.sort(function (left, right) {
      function score(path) {
        var lower = path.toLowerCase();
        if (/^core\/src\/main\.(?:c|cc|cpp|cxx)$/.test(lower)) return 100;
        if (/^src\/main\.(?:c|cc|cpp|cxx)$/.test(lower)) return 90;
        if (/^main\.(?:c|cc|cpp|cxx)$/.test(lower)) return 80;
        return 10 - path.split("/").length;
      }
      return score(right) - score(left) || left.localeCompare(right);
    });
    workspace.entryPath = mainCandidates[0] || workspace.sourcePaths[0] || "";

    var includeDirs = new Set();
    records.forEach(function (record) {
      if (record.kind === "header" || record.kind === "source") includeDirs.add(dirname(record.path));
    });
    workspace.includeDirs = Array.from(includeDirs).sort(function (left, right) {
      var leftCore = /(^|\/)core\/inc$/i.test(left) ? -1 : 0;
      var rightCore = /(^|\/)core\/inc$/i.test(right) ? -1 : 0;
      return leftCore - rightCore || left.localeCompare(right);
    });
    workspace.defines = parseDefines(records, workspace.iocPath);
  }

  function fileIcon(record) {
    if (record.kind === "source") return "C";
    if (record.kind === "header") return "H";
    if (record.kind === "ioc") return "◇";
    if (record.kind === "circuit") return "◆";
    if (record.kind === "assembly") return "S";
    if (record.kind === "linker") return "LD";
    return "≡";
  }

  function folderPriority(name) {
    var priorities = { core: 0, drivers: 1, middlewares: 2, startup: 3 };
    return Object.prototype.hasOwnProperty.call(priorities, name.toLowerCase()) ? priorities[name.toLowerCase()] : 10;
  }

  function makeTreeModel() {
    var root = { name: workspace.rootName, path: "", dirs: new Map(), files: [] };
    workspace.files.forEach(function (record) {
      var parts = record.path.split("/");
      var node = root;
      for (var index = 0; index < parts.length - 1; index += 1) {
        var part = parts[index];
        if (!node.dirs.has(part)) {
          var path = node.path ? node.path + "/" + part : part;
          node.dirs.set(part, { name: part, path: path, dirs: new Map(), files: [] });
        }
        node = node.dirs.get(part);
      }
      node.files.push(record);
    });
    return root;
  }

  function createFolderRow(node, depth, expanded) {
    var row = document.createElement("button");
    row.type = "button";
    row.className = "tree-row alice-project-row alice-project-folder" + (expanded ? " open" : "");
    row.dataset.aliceFolder = node.path;
    row.style.setProperty("--alice-depth", String(depth));
    row.title = node.path || workspace.rootName;
    var arrow = document.createElement("span");
    arrow.className = "alice-tree-arrow";
    arrow.textContent = "▶";
    var folder = document.createElement("span");
    folder.className = "folder-dot" + (depth === 0 ? " blue" : "");
    var name = document.createElement(depth === 0 ? "strong" : "span");
    name.className = "alice-tree-name";
    name.textContent = node.name || "STM32_Project";
    row.append(arrow, folder, name);
    return row;
  }

  function createFileRow(record, depth) {
    var row = document.createElement("button");
    row.type = "button";
    row.className = "tree-row file alice-project-row alice-project-file";
    row.dataset.file = record.path;
    row.dataset.path = record.path;
    row.dataset.readonly = String(!record.editable);
    row.style.setProperty("--alice-depth", String(depth));
    row.title = record.path;
    if (record.path === workspace.activePath) row.classList.add("selected");
    if (record.dirty) row.classList.add("is-dirty");
    var type = document.createElement("span");
    type.className = "file-type " + (record.kind === "ioc" ? "cube" : "c");
    type.textContent = fileIcon(record);
    var name = document.createElement("span");
    name.className = "alice-tree-name";
    name.textContent = record.name;
    var dirty = document.createElement("i");
    dirty.className = "alice-file-dirty";
    row.append(type, name, dirty);
    return row;
  }

  function appendTreeNode(node, parent, depth, forceExpanded) {
    var isRoot = depth === 0;
    var expanded = isRoot || forceExpanded || /^core(?:\/|$)/i.test(node.path);
    var row = createFolderRow(node, depth, expanded);
    var children = document.createElement("div");
    children.className = "tree-children alice-project-children";
    children.hidden = !expanded;
    parent.append(row, children);

    var dirs = Array.from(node.dirs.values()).sort(function (left, right) {
      return folderPriority(left.name) - folderPriority(right.name) || left.name.localeCompare(right.name, undefined, { numeric: true });
    });
    dirs.forEach(function (child) { appendTreeNode(child, children, depth + 1, false); });
    node.files.slice().sort(function (left, right) { return left.name.localeCompare(right.name, undefined, { numeric: true }); }).forEach(function (record) {
      children.appendChild(createFileRow(record, depth + 1));
    });
  }

  function renderTree() {
    var tree = $("#fileTree");
    if (!tree) return;
    tree.classList.add("alice-project-tree");
    tree.replaceChildren();
    appendTreeNode(makeTreeModel(), tree, 0, true);
  }

  function refreshTreeSelection() {
    $$("#fileTree .alice-project-file").forEach(function (row) {
      var record = workspace.files.get(row.dataset.path);
      row.classList.toggle("selected", row.dataset.path === workspace.activePath);
      row.classList.toggle("is-dirty", Boolean(record && record.dirty));
    });
  }

  function updateProjectChrome() {
    var name = workspace.rootName || "STM32_Project";
    var projectButton = $("#projectMenu");
    if (projectButton) {
      var status = document.createElement("small");
      status.textContent = "✓";
      status.title = "已从本地文件夹导入";
      projectButton.replaceChildren(document.createTextNode(name + " "), status);
    }
    var crumb = $(".editor-breadcrumb > span:first-child");
    if (crumb) crumb.textContent = name;
    document.title = name + " — AliceSIM";
  }

  function setImportBusy(busy, detail) {
    workspace.importing = busy;
    var card = $("#importButton");
    if (card) card.disabled = busy;
    var small = card && card.querySelector("small");
    if (small) small.textContent = detail || (busy ? "正在读取工程文件..." : "选择包含 .ioc / Core / Drivers 的目录");
  }

  function setGlobalCurrentFile(path) {
    try {
      if (typeof state !== "undefined" && state) state.currentFile = path;
    } catch (_) {
      // app.js may not expose its state in every host.
    }
  }

  function commitActiveBuffer() {
    if (!workspace.activePath) return;
    var record = workspace.files.get(workspace.activePath);
    if (!record || !record.editable) return;
    var value;
    var host = window.AliceEditorHost;
    try {
      if (host && typeof host.getValue === "function") value = host.getValue(workspace.activePath);
      else if (host && typeof host.getContent === "function") value = host.getContent(workspace.activePath);
    } catch (_) {
      value = undefined;
    }
    if (typeof value !== "string") {
      var editor = $("#codeEditor");
      if (editor && editor.dataset.aliceProjectPath === workspace.activePath) value = editor.value;
    }
    if (typeof value === "string" && value !== record.content) {
      record.content = value;
      record.dirty = true;
      refreshTreeSelection();
    }
  }

  function updateBuffer(path, value) {
    var normalized;
    try { normalized = normalizePath(path); } catch (_) { return false; }
    var record = workspace.files.get(normalized);
    if (!record || !record.editable || typeof value !== "string") return false;
    if (record.content !== value) {
      record.content = value;
      record.dirty = true;
      refreshTreeSelection();
    }
    return true;
  }

  function openCodeTab() {
    var tab = $('.work-tab[data-tab="code"]');
    if (!tab) return;
    tab.hidden = false;
    tab.style.display = "";
    tab.click();
  }

  function fallbackOpenEditor(record) {
    var editor = $("#codeEditor");
    if (!editor) return false;
    openCodeTab();
    suppressEditorInput = true;
    editor.readOnly = !record.editable;
    editor.dataset.aliceProjectPath = record.path;
    editor.value = record.content;
    editor.setSelectionRange(0, 0);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    suppressEditorInput = false;
    var tabName = $(".work-tab[data-tab=code] .tab-file-name");
    if (tabName) tabName.textContent = record.name;
    var crumbName = $(".editor-breadcrumb strong");
    if (crumbName) crumbName.textContent = record.path;
    return true;
  }

  function openInEditorHost(record) {
    openCodeTab();
    var descriptor = {
      path: record.path,
      name: record.name,
      content: record.content,
      language: record.language,
      readOnly: !record.editable,
      onChange: function (value) { updateBuffer(record.path, value); }
    };
    var host = window.AliceEditorHost;
    if (host && typeof host.openFile === "function") {
      try {
        host.openFile(descriptor);
        window.dispatchEvent(new CustomEvent("alice-project-file-open", { detail: descriptor }));
        return true;
      } catch (error) {
        console.warn("AliceEditorHost.openFile failed; using the DOM editor fallback.", error);
      }
    }
    return fallbackOpenEditor(record);
  }

  function loadIocText(text, fileName) {
    try {
      var viewer = window.AliceIocViewer;
      if (viewer && typeof viewer.load === "function") {
        var result = viewer.load(text, fileName);
        Promise.resolve(result)
          .then(function () { viewer.open?.(); })
          .catch(function (error) {
            console.warn("Unable to finish loading IOC " + fileName + ".", error);
            toast("IOC 配置视图加载失败，但工程文件已保留", "error");
          });
        return true;
      }
      window.dispatchEvent(new CustomEvent("alice-ioc-open", { detail: { text: text, fileName: fileName } }));
      if (typeof window.handleIoc === "function" && typeof File === "function") {
        window.handleIoc(new File([text], basename(fileName), { type: "text/plain" }));
        return true;
      }
      toast("IOC 查看器尚未就绪", "error");
      return false;
    } catch (error) {
      console.warn("Unable to load IOC " + fileName + ".", error);
      toast("IOC 文件读取成功，但配置解析失败；工程其余文件仍可使用", "error");
      return false;
    }
  }

  function chooseProjectCircuitRecord() {
    var records = Array.from(workspace.files.values()).filter(function (record) { return record.kind === "circuit"; });
    if (!records.length) return null;
    var expectedNames = new Set([
      (workspace.rootName + ".alice-sch.json").toLowerCase(),
      workspace.iocPath ? basename(workspace.iocPath).replace(/\.ioc$/i, ".alice-sch.json").toLowerCase() : ""
    ].filter(Boolean));
    var preferred = records.filter(function (record) {
      return expectedNames.has(basename(record.path).toLowerCase());
    }).sort(function (left, right) {
      return left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path);
    });
    if (preferred.length) return preferred[0];
    return records.length === 1 ? records[0] : null;
  }

  function loadCircuitRecord(record, notify) {
    if (!record) return null;
    var schematic = window.AliceSchematic;
    if (!schematic || typeof schematic.importCircuit !== "function") {
      var unavailable = { ok: false, code: "SCHEMATIC_UNAVAILABLE", error: "电路编辑器尚未加载" };
      if (notify !== false) toast("无法加载配套电路：" + unavailable.error, "error");
      return unavailable;
    }
    var result = schematic.importCircuit(record.content);
    if (!result || result.ok !== true) {
      var message = result && result.error ? result.error : "电路文件格式无效";
      if (notify !== false) toast("无法加载配套电路：" + message, "error");
      return result || { ok: false, code: "CIRCUIT_IMPORT_FAILED", error: message };
    }
    workspace.circuitPath = record.path;
    if (notify !== false) toast("已加载配套电路 · " + record.name);
    return result;
  }

  function openFile(path) {
    var normalized;
    try { normalized = normalizePath(path); } catch (error) { toast(error.message, "error"); return false; }
    var record = workspace.files.get(normalized);
    if (!record) {
      toast("工程中未找到 " + normalized, "error");
      return false;
    }
    commitActiveBuffer();
    workspace.activePath = normalized;
    setGlobalCurrentFile(normalized);
    refreshTreeSelection();
    if (record.kind === "ioc") {
      workspace.iocPath = normalized;
      workspace.defines = parseDefines(Array.from(workspace.files.values()), normalized);
      return loadIocText(record.content, normalized);
    }
    if (record.kind === "circuit") {
      workspace.circuitPath = normalized;
      loadCircuitRecord(record, true);
      return true;
    }
    return openInEditorHost(record);
  }

  async function importFileList(fileList, options) {
    options = options || {};
    var sequence = ++workspace.importSequence;
    var sourceFiles = Array.from(fileList || []);
    if (!sourceFiles.length) {
      setImportBusy(false);
      toast("所选目录中没有可读取的 STM32 源码或 IOC 文件", "error");
      return null;
    }
    if (sourceFiles.length > MAX_FILES) {
      toast("工程文件过多，当前上限为 " + MAX_FILES + " 个文件", "error");
      return null;
    }

    setImportBusy(true, "正在扫描 " + sourceFiles.length + " 个文件...");
    var warnings = Array.isArray(options.warnings) ? options.warnings.slice() : [];
    var rootName;
    try { rootName = detectRootName(sourceFiles); } catch (error) {
      setImportBusy(false);
      toast(error.message, "error");
      return null;
    }

    var accepted = [];
    var casePaths = new Map();
    var totalBytes = 0;
    sourceFiles.forEach(function (file) {
      var path;
      try { path = relativeFilePath(file, rootName); } catch (error) { warnings.push(error.message); return; }
      if (!path || isIgnoredPath(path) || (options.openMode !== "alicesim-project" && isAliceManagedPath(path))) return;
      var type = classifyPath(path);
      if (!type) return;
      var folded = path.toLocaleLowerCase("en-US");
      if (casePaths.has(folded)) {
        warnings.push("忽略大小写冲突：" + path + " / " + casePaths.get(folded));
        return;
      }
      casePaths.set(folded, path);
      totalBytes += Number(file.size || 0);
      accepted.push({ file: file, path: path, type: type });
    });

    if (!accepted.length) {
      setImportBusy(false);
      toast("所选目录中没有可读取的 STM32 源码或 IOC 文件", "error");
      return null;
    }
    if (totalBytes > MAX_TEXT_BYTES) {
      setImportBusy(false);
      toast("可读取文本文件超过 " + MAX_TEXT_MEGABYTES + " MB，请移除大型生成目录后重试", "error");
      return null;
    }

    setImportBusy(true, "正在读取 " + accepted.length + " 个文本文件...");
    var records = await mapLimit(accepted, READ_CONCURRENCY, async function (item) {
      try {
        var content = stripBom(await item.file.text());
        return {
          path: item.path,
          name: basename(item.path),
          kind: item.type.kind,
          language: item.type.language,
          editable: item.type.editable,
          content: content,
          size: item.file.size || content.length,
          lastModified: item.file.lastModified || 0,
          dirty: false,
          fileHandle: item.file.fileHandle || item.file.handle || null
        };
      } catch (error) {
        warnings.push("无法读取 " + item.path + "：" + error.message);
        return null;
      }
    });
    if (sequence !== workspace.importSequence) return null;

    commitActiveBuffer();
    workspace.rootName = rootName || basename(records.find(function (record) { return record && record.kind === "ioc"; })?.path || "STM32_Project").replace(/\.ioc$/i, "") || "STM32_Project";
    workspace.files = new Map();
    records.filter(Boolean).forEach(function (record) { workspace.files.set(record.path, record); });
    workspace.activePath = "";
    workspace.iocPath = "";
    workspace.circuitPath = "";
    workspace.warnings = warnings;
    workspace.directoryHandle = options.directoryHandle || null;
    workspace.projectDirectoryHandle = options.projectDirectoryHandle || null;
    workspace.managedFilesInitialized = Boolean(options.managedFilesInitialized);
    workspace.openMode = options.openMode || "folder-upload";
    deriveProjectMetadata();
    renderTree();
    updateProjectChrome();

    var iocPaths = Array.from(workspace.files.values()).filter(function (record) { return record.kind === "ioc"; }).map(function (record) { return record.path; });
    var selectedIoc = await chooseIocPath(iocPaths);
    if (sequence !== workspace.importSequence) return null;
    if (selectedIoc) {
      workspace.iocPath = selectedIoc;
      workspace.defines = parseDefines(Array.from(workspace.files.values()), selectedIoc);
      var iocRecord = workspace.files.get(selectedIoc);
      if (!loadIocText(iocRecord.content, selectedIoc)) {
        warnings.push("IOC 配置解析失败：" + selectedIoc);
      }
    }

    var circuitRecord = chooseProjectCircuitRecord();
    if (circuitRecord) {
      var circuitResult = loadCircuitRecord(circuitRecord, false);
      if (!circuitResult || circuitResult.ok !== true) {
        warnings.push("无法加载配套电路 " + circuitRecord.path + "：" + (circuitResult && circuitResult.error || "未知错误"));
      }
    }

    var initialPath = workspace.entryPath || workspace.sourcePaths[0] || Array.from(workspace.files.keys()).find(function (path) {
      var record = workspace.files.get(path);
      return record && (record.kind === "header" || record.kind === "source");
    });
    if (initialPath) openFile(initialPath);
    setImportBusy(false);
    toast("已导入 " + workspace.rootName + " · " + workspace.files.size + " 个文本文件" + (warnings.length ? " · " + warnings.length + " 项已忽略" : ""));
    window.dispatchEvent(new CustomEvent("alice-project-opened", { detail: getState() }));
    return getState();
  }

  async function collectDirectoryFiles(directoryHandle, warnings) {
    warnings = warnings || [];
    var rootName;
    try { rootName = normalizePath(directoryHandle.name || "STM32_Project").split("/").pop(); }
    catch (_) { rootName = "STM32_Project"; }
    rootName = rootName || "STM32_Project";
    var files = [];

    async function visit(handle, parentPath) {
      for await (var entry of handle.values()) {
        var path = parentPath ? parentPath + "/" + entry.name : entry.name;
        if (!parentPath && entry.kind === "directory" && entry.name.toLowerCase() === ALICE_PROJECT_DIRECTORY.toLowerCase()) continue;
        if (isIgnoredPath(path)) continue;
        if (entry.kind === "directory") {
          await visit(entry, path);
          continue;
        }
        if (entry.kind !== "file" || !classifyPath(path)) continue;
        if (files.length >= MAX_FILES) throw new Error("工程文件过多，当前上限为 " + MAX_FILES + " 个文件");
        try {
          var file = await entry.getFile();
          files.push({
            name: file.name,
            relativePath: rootName + "/" + path,
            size: file.size,
            lastModified: file.lastModified,
            type: file.type,
            fileHandle: entry,
            text: file.text.bind(file)
          });
        } catch (error) {
          warnings.push("无法读取 " + path + "：" + (error && error.message ? error.message : String(error)));
        }
      }
    }

    await visit(directoryHandle, "");
    return files;
  }

  async function openWritableFolder() {
    var pickDirectory = directoryPicker();
    if (!pickDirectory) {
      if (folderInput) {
        folderInput.value = "";
        folderInput.click();
      }
      return null;
    }
    try {
      var directoryHandle = await pickDirectory({ mode: "read" });
      if (!directoryHandle) return null;
      setImportBusy(true, "正在读取工程文件夹...");
      var scanWarnings = [];
      var savedProject = await readAliceProjectSnapshot(directoryHandle);
      if (savedProject && savedProject.payload) {
        return await loadProjectSnapshot(savedProject.payload, {
          directoryHandle: savedProject.rootDirectoryHandle || directoryHandle,
          projectDirectoryHandle: savedProject.projectDirectoryHandle
        });
      }
      if (savedProject && savedProject.error) scanWarnings.push(savedProject.error);
      var files = await collectDirectoryFiles(directoryHandle, scanWarnings);
      return await importFileList(files, {
        directoryHandle: directoryHandle,
        openMode: "file-system-access",
        warnings: scanWarnings
      });
    } catch (error) {
      setImportBusy(false);
      if (error && error.name === "AbortError") return null;
      toast("无法打开工程文件夹：" + (error && error.message ? error.message : String(error)), "error");
      return null;
    }
  }

  function loadFiles(entries, rootName, options) {
    var pairs = Array.isArray(entries)
      ? entries.map(function (entry) { return [entry.path || entry.name, entry.content]; })
      : Object.entries(entries || {});
    var safeRoot;
    try { safeRoot = normalizePath(rootName || "STM32_Project").split("/").pop() || "STM32_Project"; }
    catch (_) { safeRoot = "STM32_Project"; }
    var virtualFiles = pairs.filter(function (pair) {
      return pair[0] && typeof pair[1] === "string";
    }).map(function (pair) {
      var path = normalizePath(pair[0]);
      var content = pair[1];
      return {
        name: basename(path),
        relativePath: safeRoot + "/" + path,
        size: content.length,
        lastModified: Date.now(),
        text: function () { return Promise.resolve(content); }
      };
    });
    return importFileList(virtualFiles, Object.assign({ openMode: "virtual" }, options || {}));
  }

  function openFolder(files, options) {
    if (files && typeof files.length === "number") return importFileList(files, { openMode: "folder-upload" });
    options = options || {};
    if (!options.useFileInput && directoryPicker()) return openWritableFolder();
    if (!folderInput) return null;
    folderInput.value = "";
    folderInput.click();
    return null;
  }

  function createClangPayload(options) {
    options = options || {};
    commitActiveBuffer();
    if (!workspace.files.size) return null;
    var requestedActive = options.activePath ? normalizePath(options.activePath) : workspace.activePath;
    if (requestedActive && typeof options.activeCode === "string" && workspace.files.has(requestedActive)) {
      var activeRecord = workspace.files.get(requestedActive);
      activeRecord.content = options.activeCode;
    }
    var activePath = requestedActive || workspace.activePath || workspace.entryPath || workspace.sourcePaths[0] || "";
    var all = Boolean(options.all);
    var targets;
    if (all) targets = workspace.sourcePaths.length ? workspace.sourcePaths.slice() : (isSourcePath(activePath) ? [activePath] : []);
    else if (activePath && isSourcePath(activePath)) targets = [activePath];
    else targets = workspace.entryPath ? [workspace.entryPath] : workspace.sourcePaths.slice(0, 1);

    var files = {};
    workspace.files.forEach(function (record, path) { files[path] = record.content; });
    if (activePath && typeof options.activeCode === "string") files[activePath] = options.activeCode;
    var primaryPath = targets[0] || activePath;
    return {
      files: files,
      activePath: activePath,
      targets: targets,
      includeDirs: workspace.includeDirs.slice(),
      defines: workspace.defines.slice(),
      all: all,
      filename: primaryPath || "main.c",
      code: primaryPath && files[primaryPath] != null ? files[primaryPath] : (typeof options.activeCode === "string" ? options.activeCode : "")
    };
  }

  function getActiveCodeSnapshot() {
    var current = null;
    var host = window.AliceEditorHost;
    try {
      if (host && typeof host.getCurrentFile === "function") current = host.getCurrentFile();
    } catch (_) {
      current = null;
    }

    var editor = $("#codeEditor");
    var rawPath = current && current.path;
    if (!rawPath && editor) rawPath = editor.dataset.aliceProjectPath;
    if (!rawPath) rawPath = workspace.activePath || workspace.entryPath || "main.c";
    var path;
    try { path = normalizePath(rawPath) || "main.c"; }
    catch (_) { path = "main.c"; }

    var content = current && typeof current.content === "string" ? current.content : null;
    if (content === null && editor && (!editor.dataset.aliceProjectPath || editor.dataset.aliceProjectPath === path)) content = editor.value;
    var record = workspace.files.get(path) || null;
    if (content === null && record) content = record.content;
    if (typeof content !== "string") content = "";
    if (record && record.editable && record.content !== content) updateBuffer(path, content);

    return {
      path: path,
      filename: safeDownloadName(path),
      content: content,
      readOnly: Boolean((current && current.readOnly) || (editor && editor.readOnly) || (record && !record.editable)),
      record: record
    };
  }

  function codeMimeType(path) {
    var ext = extension(path);
    if ([".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"].includes(ext)) return "text/x-c;charset=utf-8";
    if ([".s", ".asm"].includes(ext)) return "text/x-asm;charset=utf-8";
    return "text/plain;charset=utf-8";
  }

  function byteLength(text) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
    return new Blob([text]).size;
  }

  function downloadCode(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var urlApi = window.URL || URL;
    if (!urlApi || typeof urlApi.createObjectURL !== "function") throw new Error("当前浏览器不支持文件下载");
    var url = urlApi.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = safeDownloadName(filename);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { urlApi.revokeObjectURL(url); }, 1000);
    return blob.size;
  }

  async function ensureWritePermission(fileHandle) {
    var permission = "prompt";
    if (typeof fileHandle.queryPermission === "function") {
      permission = await fileHandle.queryPermission({ mode: "readwrite" });
      if (permission === "granted") return true;
    }
    if (typeof fileHandle.requestPermission === "function") {
      permission = await fileHandle.requestPermission({ mode: "readwrite" });
      if (permission === "granted") return true;
      throw new Error("未获得原文件的写入权限");
    }
    return true;
  }

  async function readJsonFile(directoryHandle, filename) {
    var fileHandle = await directoryHandle.getFileHandle(filename);
    var file = await fileHandle.getFile();
    if (Number(file.size || 0) > MAX_TEXT_BYTES) throw new Error(filename + " 超过 " + MAX_TEXT_MEGABYTES + " MB");
    return JSON.parse(stripBom(await file.text()));
  }

  function validateProjectSnapshot(payload) {
    if (!payload || typeof payload !== "object" || payload.format !== "AliceSIM Project") {
      throw new Error("AliceSIM/project.alice.json 格式无效");
    }
    if (!payload.files || typeof payload.files !== "object" || Array.isArray(payload.files)) {
      throw new Error("AliceSIM 工程中没有可恢复的文件");
    }
    var paths = Object.keys(payload.files);
    if (!paths.length) throw new Error("AliceSIM 工程文件列表为空");
    if (paths.length > MAX_FILES) throw new Error("AliceSIM 工程文件超过 " + MAX_FILES + " 个");
    var totalBytes = 0;
    paths.forEach(function (path) {
      normalizePath(path);
      if (typeof payload.files[path] !== "string") throw new Error("AliceSIM 工程文件内容无效：" + path);
      totalBytes += byteLength(payload.files[path]);
    });
    if (totalBytes > MAX_TEXT_BYTES) throw new Error("AliceSIM 工程文本超过 " + MAX_TEXT_MEGABYTES + " MB");
    return payload;
  }

  async function readAliceProjectSnapshot(directoryHandle) {
    if (!directoryHandle || typeof directoryHandle.getFileHandle !== "function") return null;
    var projectDirectoryHandle = directoryHandle;
    var selectedAliceDirectory = String(directoryHandle.name || "").toLowerCase() === ALICE_PROJECT_DIRECTORY.toLowerCase();
    try {
      if (!selectedAliceDirectory) {
        if (typeof directoryHandle.getDirectoryHandle !== "function") return null;
        projectDirectoryHandle = await directoryHandle.getDirectoryHandle(ALICE_PROJECT_DIRECTORY);
      }
      var payload = validateProjectSnapshot(await readJsonFile(projectDirectoryHandle, ALICE_PROJECT_FILENAME));
      return {
        payload: payload,
        rootDirectoryHandle: selectedAliceDirectory ? null : directoryHandle,
        projectDirectoryHandle: projectDirectoryHandle
      };
    } catch (error) {
      if (error && (error.name === "NotFoundError" || error.code === 8)) return null;
      return { error: "无法恢复 AliceSIM 工程，将读取原始 CubeMX 文件：" + (error && error.message ? error.message : String(error)) };
    }
  }

  function loadProjectSnapshot(payload, options) {
    options = options || {};
    var snapshot;
    try {
      snapshot = validateProjectSnapshot(payload);
    } catch (error) {
      setImportBusy(false);
      toast("无法恢复 AliceSIM 工程：" + error.message, "error");
      return Promise.resolve(null);
    }
    var files = Object.assign({}, snapshot.files);
    var projectName = snapshot.project && snapshot.project.name || "STM32_Project";
    var circuit = snapshot.circuit;
    var circuitPath = snapshot.circuitPath || projectName + ".alice-sch.json";
    if (circuit && typeof circuit === "object") files[circuitPath] = JSON.stringify(circuit, null, 2);
    return loadFiles(files, projectName, {
      openMode: "alicesim-project",
      directoryHandle: options.directoryHandle || options.projectDirectoryHandle || null,
      projectDirectoryHandle: options.projectDirectoryHandle || null,
      managedFilesInitialized: Boolean(snapshot.storage && snapshot.storage.workspaceSync && snapshot.storage.workspaceSync.complete)
    }).then(function (state) {
      if (!state) return null;
      if (snapshot.currentFile && workspace.files.has(snapshot.currentFile)) openFile(snapshot.currentFile);
      window.dispatchEvent(new CustomEvent("alice-project-snapshot-restored", {
        detail: { snapshot: snapshot, state: getState() }
      }));
      toast("已恢复 AliceSIM 工程 · " + workspace.rootName);
      return getState();
    });
  }

  async function writeTextFile(directoryHandle, filename, content) {
    var fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    var writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (error) {
      try { if (writable && typeof writable.abort === "function") await writable.abort(); } catch (_) { /* best effort */ }
      throw error;
    }
    return byteLength(content);
  }

  async function writeManagedWorkspaceFile(workspaceDirectoryHandle, path, content) {
    var parts = normalizePath(path).split("/");
    var filename = parts.pop();
    var parent = workspaceDirectoryHandle;
    for (var index = 0; index < parts.length; index += 1) {
      parent = await parent.getDirectoryHandle(parts[index], { create: true });
    }
    return writeTextFile(parent, filename, content);
  }

  async function writeManagedWorkspace(projectDirectoryHandle, snapshot) {
    if (typeof projectDirectoryHandle.getDirectoryHandle !== "function") throw new Error("当前浏览器无法创建 AliceSIM 工作副本");
    var workspaceDirectoryHandle = await projectDirectoryHandle.getDirectoryHandle(ALICE_WORKSPACE_DIRECTORY, { create: true });
    var circuitPath = snapshot.circuitPath ? normalizePath(snapshot.circuitPath) : "";
    var paths = Object.keys(snapshot.files || {}).filter(function (path) {
      var normalized = normalizePath(path);
      return normalized !== circuitPath && !normalized.toLowerCase().endsWith(".alice-sch.json");
    });
    if (workspace.managedFilesInitialized) {
      paths = paths.filter(function (path) {
        var record = workspace.files.get(path);
        return !record || record.dirty;
      });
    }
    var bytes = 0;
    var completed = 0;
    emitSaveEvent("alice-project-save-progress", {
      stage: "workspace",
      current: 0,
      total: paths.length,
      message: paths.length ? "正在同步代码工作副本 · 0/" + paths.length : "代码工作副本无需更新"
    });
    await mapLimit(paths, WRITE_CONCURRENCY, async function (path) {
      try {
        bytes += await writeManagedWorkspaceFile(workspaceDirectoryHandle, path, snapshot.files[path]);
      } catch (error) {
        var failure = new Error("同步 " + path + " 失败：" + (error && error.message ? error.message : String(error)));
        failure.path = path;
        failure.completed = completed;
        failure.total = paths.length;
        throw failure;
      }
      completed += 1;
      if (completed === paths.length || completed % 10 === 0) {
        emitSaveEvent("alice-project-save-progress", {
          stage: "workspace",
          current: completed,
          total: paths.length,
          path: path,
          message: "正在同步代码工作副本 · " + completed + "/" + paths.length
        });
      }
    });
    return { bytes: bytes, fileCount: paths.length };
  }

  function openRecentProjectDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      var request = window.indexedDB.open(RECENT_PROJECT_DATABASE, 1);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(RECENT_PROJECT_STORE)) database.createObjectStore(RECENT_PROJECT_STORE, { keyPath: "id" });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("无法打开浏览器项目存储")); };
    });
  }

  async function rememberRecentProject(snapshot, rootDirectoryHandle, projectDirectoryHandle) {
    var database;
    try { database = await openRecentProjectDatabase(); }
    catch (_) { return false; }
    if (!database) return false;
    function put(record) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(RECENT_PROJECT_STORE, "readwrite");
        transaction.objectStore(RECENT_PROJECT_STORE).put(record);
        transaction.oncomplete = function () { resolve(true); };
        transaction.onerror = function () { reject(transaction.error || new Error("无法保存浏览器项目快照")); };
        transaction.onabort = function () { reject(transaction.error || new Error("浏览器项目快照写入已取消")); };
      });
    }
    var record = {
      id: RECENT_PROJECT_KEY,
      savedAt: snapshot.savedAt,
      snapshot: snapshot,
      rootDirectoryHandle: rootDirectoryHandle || null,
      projectDirectoryHandle: projectDirectoryHandle || null
    };
    try {
      await put(record);
    } catch (error) {
      // Some embedded Chromium builds cannot clone file-system handles. The
      // full snapshot is still sufficient to restore the page after restart.
      await put({ id: RECENT_PROJECT_KEY, savedAt: snapshot.savedAt, snapshot: snapshot });
    } finally {
      database.close();
    }
    return true;
  }

  async function readRecentProject() {
    function localFallback() {
      try {
        var snapshot = JSON.parse(window.localStorage && window.localStorage.getItem("alicesim.project.autosave.v1") || "null");
        return snapshot ? { id: RECENT_PROJECT_KEY, savedAt: snapshot.savedAt || "", snapshot: snapshot } : null;
      } catch (_) {
        return null;
      }
    }
    var database;
    try { database = await openRecentProjectDatabase(); }
    catch (_) { return localFallback(); }
    if (!database) return localFallback();
    try {
      var record = await new Promise(function (resolve, reject) {
        var transaction = database.transaction(RECENT_PROJECT_STORE, "readonly");
        var request = transaction.objectStore(RECENT_PROJECT_STORE).get(RECENT_PROJECT_KEY);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error || new Error("无法读取浏览器项目快照")); };
      });
      return record || localFallback();
    } finally {
      database.close();
    }
  }

  async function restoreRecentProject() {
    if (workspace.files.size || workspace.importing) return null;
    try {
      var recent = await readRecentProject();
      if (!recent || !recent.snapshot || workspace.files.size || workspace.importing) return null;
      setImportBusy(true, "正在恢复上次保存的 AliceSIM 工程...");
      return await loadProjectSnapshot(recent.snapshot, {
        directoryHandle: recent.rootDirectoryHandle || recent.projectDirectoryHandle || null,
        projectDirectoryHandle: recent.projectDirectoryHandle || null
      });
    } catch (error) {
      setImportBusy(false);
      console.warn("Unable to restore the recent AliceSIM project.", error);
      return null;
    }
  }

  async function saveProjectSnapshotNow(payload, options) {
    options = options || {};
    commitActiveBuffer();
    emitSaveEvent("alice-project-save-progress", { stage: "prepare", current: 0, total: 1, message: "正在整理代码、电路和页面状态..." });
    var rootHandle = workspace.directoryHandle;
    var projectDirectoryHandle = workspace.projectDirectoryHandle;
    if (!rootHandle && !projectDirectoryHandle) {
      var browserSnapshot = Object.assign({}, payload || {}, {
        format: "AliceSIM Project",
        version: Math.max(3, Number(payload && payload.version) || 0),
        savedAt: new Date().toISOString(),
        storage: { mode: "browser" }
      });
      validateProjectSnapshot(browserSnapshot);
      var remembered = await rememberRecentProject(browserSnapshot, null, null);
      workspace.files.forEach(function (record) { record.dirty = false; });
      refreshTreeSelection();
      updateProjectChrome();
      var browserResult = {
        ok: true,
        action: "browser-storage",
        browserBackup: remembered,
        fileCount: Object.keys(browserSnapshot.files).length,
        message: "项目已保存在浏览器中"
      };
      emitSaveEvent("alice-project-save-progress", { stage: "complete", current: 1, total: 1, message: browserResult.message });
      emitSaveEvent("alice-project-saved", browserResult);
      return browserResult;
    }

    try {
      var permissionHandle = rootHandle || projectDirectoryHandle;
      emitSaveEvent("alice-project-save-progress", { stage: "permission", current: 0, total: 1, message: "正在确认 AliceSIM 文件夹写入权限..." });
      await ensureWritePermission(permissionHandle);
      if (!projectDirectoryHandle) {
        if (String(rootHandle.name || "").toLowerCase() === ALICE_PROJECT_DIRECTORY.toLowerCase()) {
          projectDirectoryHandle = rootHandle;
        } else {
          if (typeof rootHandle.getDirectoryHandle !== "function") throw new Error("当前浏览器无法创建 AliceSIM 项目文件夹");
          projectDirectoryHandle = await rootHandle.getDirectoryHandle(ALICE_PROJECT_DIRECTORY, { create: true });
        }
      }

      var snapshot = Object.assign({}, payload || {});
      snapshot.format = "AliceSIM Project";
      snapshot.version = Math.max(3, Number(snapshot.version) || 0);
      snapshot.savedAt = new Date().toISOString();
      snapshot.storage = {
        mode: "managed-folder",
        directory: ALICE_PROJECT_DIRECTORY,
        workspaceDirectory: ALICE_WORKSPACE_DIRECTORY,
        workspaceSync: { complete: false, fileCount: 0 }
      };
      if (!snapshot.files || typeof snapshot.files !== "object") {
        snapshot.files = {};
        workspace.files.forEach(function (record, path) { snapshot.files[path] = record.content; });
      }
      validateProjectSnapshot(snapshot);

      var circuit = snapshot.circuit;
      if ((!circuit || typeof circuit !== "object") && window.AliceSchematic && typeof window.AliceSchematic.exportCircuit === "function") {
        circuit = window.AliceSchematic.exportCircuit();
        snapshot.circuit = circuit;
      }
      var circuitContent = circuit && typeof circuit === "object" ? JSON.stringify(circuit, null, 2) : "";
      var projectContent = JSON.stringify(snapshot, null, 2);
      if (byteLength(projectContent) > MAX_TEXT_BYTES) throw new Error("AliceSIM 项目快照超过 " + MAX_TEXT_MEGABYTES + " MB");

      emitSaveEvent("alice-project-save-progress", { stage: "circuit", current: 0, total: 1, message: "正在保存电路..." });
      var circuitBytes = circuitContent ? await writeTextFile(projectDirectoryHandle, ALICE_CIRCUIT_FILENAME, circuitContent) : 0;
      emitSaveEvent("alice-project-save-progress", { stage: "manifest", current: 0, total: 1, message: "正在保存项目清单..." });
      var projectBytes = await writeTextFile(projectDirectoryHandle, ALICE_PROJECT_FILENAME, projectContent);
      var browserBackup = false;
      try { browserBackup = await rememberRecentProject(snapshot, rootHandle, projectDirectoryHandle); }
      catch (storageError) { console.warn("Unable to keep the recent AliceSIM project in browser storage.", storageError); }
      var managedWorkspace = { bytes: 0, fileCount: 0 };
      var workspaceSyncError = "";
      try {
        managedWorkspace = await writeManagedWorkspace(projectDirectoryHandle, snapshot);
        snapshot.storage.workspaceSync = { complete: true, fileCount: managedWorkspace.fileCount };
        projectContent = JSON.stringify(snapshot, null, 2);
        projectBytes = await writeTextFile(projectDirectoryHandle, ALICE_PROJECT_FILENAME, projectContent);
        try { browserBackup = await rememberRecentProject(snapshot, rootHandle, projectDirectoryHandle); }
        catch (storageError) { console.warn("Unable to refresh the completed AliceSIM project snapshot in browser storage.", storageError); }
      } catch (workspaceError) {
        workspaceSyncError = workspaceError && workspaceError.message ? workspaceError.message : String(workspaceError);
        console.warn("AliceSIM workspace copy is incomplete; the complete project snapshot remains usable.", workspaceError);
      }
      workspace.projectDirectoryHandle = projectDirectoryHandle;
      workspace.managedFilesInitialized = !workspaceSyncError;
      workspace.openMode = "alicesim-project";
      workspace.files.forEach(function (record) { record.dirty = false; });
      refreshTreeSelection();
      updateProjectChrome();
      var result = {
        ok: true,
        action: "project-folder",
        directory: ALICE_PROJECT_DIRECTORY,
        projectFile: ALICE_PROJECT_DIRECTORY + "/" + ALICE_PROJECT_FILENAME,
        circuitFile: circuitBytes ? ALICE_PROJECT_DIRECTORY + "/" + ALICE_CIRCUIT_FILENAME : "",
        bytes: projectBytes + circuitBytes + managedWorkspace.bytes,
        fileCount: Object.keys(snapshot.files).length,
        changedFileCount: managedWorkspace.fileCount,
        browserBackup: browserBackup,
        workspaceSyncError: workspaceSyncError,
        warning: workspaceSyncError ? "代码工作副本未完全同步，但电路和完整项目快照已保存" : "",
        message: workspaceSyncError
          ? "电路和项目已保存，代码工作副本稍后可重试"
          : "项目已保存到 " + ALICE_PROJECT_DIRECTORY + " 文件夹"
      };
      emitSaveEvent("alice-project-save-progress", {
        stage: workspaceSyncError ? "warning" : "complete",
        current: result.fileCount,
        total: result.fileCount,
        message: result.message
      });
      if (options.notify !== false) toast(result.message);
      emitSaveEvent("alice-project-saved", result);
      return result;
    } catch (error) {
      var failure = {
        ok: false,
        action: "project-folder",
        code: error && error.name ? error.name : "PROJECT_SAVE_FAILED",
        error: error && error.message ? error.message : String(error)
      };
      if (options.notify !== false) toast("项目保存失败：" + failure.error, "error");
      emitSaveEvent("alice-project-save-error", failure);
      return failure;
    }
  }

  function saveProjectSnapshot(payload, options) {
    var run = function () { return saveProjectSnapshotNow(payload, options); };
    var queued = saveProjectQueue.then(run, run);
    saveProjectQueue = queued.then(function () { return undefined; }, function () { return undefined; });
    return queued;
  }

  function emitSaveEvent(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); }
    catch (_) { /* Events are optional in embedded hosts. */ }
  }

  async function saveActiveCodeNow(options, snapshot) {
    options = options || {};
    snapshot = snapshot || getActiveCodeSnapshot();
    var result;
    if (snapshot.readOnly) {
      result = {
        ok: false,
        action: "none",
        path: snapshot.path,
        filename: snapshot.filename,
        code: "READ_ONLY",
        error: "当前文件为只读，无法保存代码"
      };
      if (options.notify !== false) toast(result.error, "error");
      emitSaveEvent("alice-project-code-save-error", result);
      return result;
    }

    try {
      var record = snapshot.record;
      var fileHandle = record && record.fileHandle;
      var action = fileHandle && typeof fileHandle.createWritable === "function" ? "write-back" : "download";
      var size;
      if (action === "write-back") {
        await ensureWritePermission(fileHandle);
        var writable = await fileHandle.createWritable();
        try {
          await writable.write(snapshot.content);
          await writable.close();
        } catch (writeError) {
          try { if (writable && typeof writable.abort === "function") await writable.abort(); } catch (_) { /* best effort */ }
          throw writeError;
        }
        size = byteLength(snapshot.content);
      } else {
        size = downloadCode(snapshot.content, snapshot.filename, codeMimeType(snapshot.path));
      }

      var stillCurrent = !record || record.content === snapshot.content;
      if (record && stillCurrent) {
        record.dirty = false;
        record.size = size;
        record.lastModified = Date.now();
        refreshTreeSelection();
      }
      result = {
        ok: true,
        action: action,
        path: snapshot.path,
        filename: snapshot.filename,
        bytes: size,
        dirty: Boolean(record && !stillCurrent),
        message: action === "write-back" ? "代码已写回 " + snapshot.path : "代码已下载为 " + snapshot.filename
      };
      if (options.notify !== false) toast(result.message);
      emitSaveEvent("alice-project-code-saved", result);
      return result;
    } catch (error) {
      result = {
        ok: false,
        action: snapshot.record && snapshot.record.fileHandle ? "write-back" : "download",
        path: snapshot.path,
        filename: snapshot.filename,
        code: error && error.name ? error.name : "SAVE_FAILED",
        error: error && error.message ? error.message : String(error)
      };
      if (options.notify !== false) toast("代码保存失败：" + result.error, "error");
      emitSaveEvent("alice-project-code-save-error", result);
      return result;
    }
  }

  function saveActiveCode(options) {
    var snapshot = getActiveCodeSnapshot();
    var run = function () { return saveActiveCodeNow(options, snapshot); };
    var queued = saveActiveCodeQueue.then(run, run);
    saveActiveCodeQueue = queued.then(function () { return undefined; }, function () { return undefined; });
    return queued;
  }

  function upsertFiles(entries, options) {
    options = options || {};
    commitActiveBuffer();
    var pairs = Array.isArray(entries)
      ? entries.map(function (entry) { return [entry.path || entry.name, entry.content, entry]; })
      : Object.entries(entries || {}).map(function (entry) { return [entry[0], entry[1], null]; });
    var added = [];
    var updated = [];
    var skipped = [];
    var overwrite = options.overwrite !== false;

    pairs.forEach(function (pair) {
      var path;
      try { path = normalizePath(pair[0]); }
      catch (error) { skipped.push({ path: String(pair[0] || ""), reason: error.message }); return; }
      var content = pair[1];
      var descriptor = pair[2] || {};
      var type = classifyPath(path);
      if (!path || typeof content !== "string" || !type) {
        skipped.push({ path: path || String(pair[0] || ""), reason: "不支持的工程文件" });
        return;
      }
      var existing = workspace.files.get(path);
      if (existing && !overwrite) {
        skipped.push({ path: path, reason: "文件已存在" });
        return;
      }
      if (existing && existing.content === content) return;
      var record = {
        path: path,
        name: basename(path),
        kind: type.kind,
        language: type.language,
        editable: type.editable,
        content: content,
        size: byteLength(content),
        lastModified: Date.now(),
        dirty: options.markDirty !== false,
        fileHandle: descriptor.fileHandle || descriptor.handle || (existing && existing.fileHandle) || null
      };
      workspace.files.set(path, record);
      (existing ? updated : added).push(path);
    });

    if (!workspace.rootName && (added.length || updated.length)) workspace.rootName = options.rootName || "STM32_Project";
    if (added.length || updated.length) {
      deriveProjectMetadata();
      renderTree();
      refreshTreeSelection();
      updateProjectChrome();
    }
    var result = { ok: true, added: added, updated: updated, skipped: skipped };
    try { window.dispatchEvent(new CustomEvent("alice-project-files-upserted", { detail: result })); } catch (_) { /* optional */ }
    return result;
  }

  function getState() {
    commitActiveBuffer();
    var files = new Map();
    workspace.files.forEach(function (record, path) {
      files.set(path, {
        path: record.path,
        name: record.name,
        kind: record.kind,
        language: record.language,
        editable: record.editable,
        content: record.content,
        size: record.size,
        lastModified: record.lastModified,
        dirty: record.dirty,
        canWriteBack: Boolean(record.fileHandle && typeof record.fileHandle.createWritable === "function")
      });
    });
    return {
      rootName: workspace.rootName,
      files: files,
      activePath: workspace.activePath,
      entryPath: workspace.entryPath,
      iocPath: workspace.iocPath,
      circuitPath: workspace.circuitPath || "",
      sourcePaths: workspace.sourcePaths.slice(),
      targets: workspace.sourcePaths.slice(),
      includeDirs: workspace.includeDirs.slice(),
      defines: workspace.defines.slice(),
      warnings: workspace.warnings.slice(),
      importing: workspace.importing,
      openMode: workspace.openMode,
      canWriteBack: Array.from(workspace.files.values()).some(function (record) {
        return Boolean(record.fileHandle && typeof record.fileHandle.createWritable === "function");
      }),
      canSaveProject: Boolean(workspace.directoryHandle || workspace.projectDirectoryHandle),
      managedProjectDirectory: workspace.projectDirectoryHandle ? ALICE_PROJECT_DIRECTORY : "",
      managedWorkspaceDirectory: workspace.managedFilesInitialized ? ALICE_PROJECT_DIRECTORY + "/" + ALICE_WORKSPACE_DIRECTORY : ""
    };
  }

  function createInputs() {
    folderInput = document.createElement("input");
    folderInput.id = FOLDER_INPUT_ID;
    folderInput.type = "file";
    folderInput.multiple = true;
    folderInput.hidden = true;
    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
    folderInput.addEventListener("change", function () {
      importFileList(folderInput.files).finally(function () { folderInput.value = ""; });
    });

    iocOnlyInput = document.createElement("input");
    iocOnlyInput.id = IOC_INPUT_ID;
    iocOnlyInput.type = "file";
    iocOnlyInput.accept = ".ioc";
    iocOnlyInput.hidden = true;
    iocOnlyInput.addEventListener("change", async function () {
      var file = iocOnlyInput.files && iocOnlyInput.files[0];
      if (file) {
        try { loadIocText(stripBom(await file.text()), file.name); }
        catch (error) { toast("无法读取 IOC：" + error.message, "error"); }
      }
      iocOnlyInput.value = "";
    });

    document.body.append(folderInput, iocOnlyInput);
  }

  function takeOverImportButton(button) {
    if (!button || button.dataset.aliceFolderImport === "true") return;
    button.dataset.aliceFolderImport = "true";
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openFolder();
    }, true);
  }

  function setupEntrances() {
    var card = $("#importButton");
    takeOverImportButton(card);
    takeOverImportButton($("#ribbonImport"));

    if (card) {
      var strong = card.querySelector("strong");
      var small = card.querySelector("small");
      if (strong) strong.textContent = "导入 STM32 工程文件夹";
      if (small) small.textContent = "选择包含 .ioc / Core / Drivers 的目录";
      if (!$("#aliceOpenIocOnly")) {
        var iocButton = document.createElement("button");
        iocButton.id = "aliceOpenIocOnly";
        iocButton.type = "button";
        iocButton.className = "alice-ioc-only";
        iocButton.textContent = "仅打开单个 IOC";
        iocButton.addEventListener("click", function () {
          iocOnlyInput.value = "";
          iocOnlyInput.click();
        });
        card.insertAdjacentElement("afterend", iocButton);
      }
    }

    var ribbonLabel = $("#ribbonImport span");
    if (ribbonLabel) ribbonLabel.textContent = "打开工程";
  }

  function setupTreeEvents() {
    var tree = $("#fileTree");
    if (!tree || tree.dataset.aliceProjectEvents === "ready") return;
    tree.dataset.aliceProjectEvents = "ready";
    tree.addEventListener("click", function (event) {
      var fileRow = event.target.closest(".alice-project-file[data-path]");
      if (fileRow) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openFile(fileRow.dataset.path);
        return;
      }
      var folderRow = event.target.closest(".alice-project-folder[data-alice-folder]");
      if (!folderRow) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      var children = folderRow.nextElementSibling;
      if (!children || !children.classList.contains("alice-project-children")) return;
      children.hidden = !children.hidden;
      folderRow.classList.toggle("open", !children.hidden);
    }, true);
  }

  function setupBufferEvents() {
    var editor = $("#codeEditor");
    if (editor && editor.dataset.aliceProjectBuffer !== "ready") {
      editor.dataset.aliceProjectBuffer = "ready";
      editor.addEventListener("input", function () {
        if (suppressEditorInput || !workspace.activePath) return;
        if (editor.dataset.aliceProjectPath && editor.dataset.aliceProjectPath !== workspace.activePath) return;
        updateBuffer(workspace.activePath, editor.value);
      });
    }
    window.addEventListener("alice-editor-change", function (event) {
      var detail = event.detail || {};
      updateBuffer(detail.path || workspace.activePath, detail.content);
    });
  }

  function init() {
    addStyles();
    createInputs();
    setupEntrances();
    setupTreeEvents();
    setupBufferEvents();
  }

  function addFiles(entries, options) {
    return upsertFiles(entries, Object.assign({}, options || {}, { overwrite: false }));
  }

  window.AliceProjectWorkspace = Object.freeze({
    openFolder: openFolder,
    openWritableFolder: openWritableFolder,
    loadFiles: loadFiles,
    addFiles: addFiles,
    upsertFiles: upsertFiles,
    openFile: openFile,
    saveActiveCode: saveActiveCode,
    saveProject: saveProjectSnapshot,
    restoreRecentProject: restoreRecentProject,
    createClangPayload: createClangPayload,
    getState: getState
  });

  var projectApi = window.AliceProject && typeof window.AliceProject === "object" ? window.AliceProject : {};
  try {
    projectApi.saveActiveCode = saveActiveCode;
    projectApi.saveProject = saveProjectSnapshot;
    projectApi.getActiveCode = getActiveCodeSnapshot;
    window.AliceProject = projectApi;
  } catch (_) {
    window.AliceProject = {
      saveActiveCode: saveActiveCode,
      saveProject: saveProjectSnapshot,
      getActiveCode: getActiveCodeSnapshot
    };
  }

  window.addEventListener("alice-project-import", function (event) {
    try {
      var payload = typeof event.detail === "string" ? JSON.parse(event.detail) : (event.detail || {});
      loadFiles(payload.files || {}, payload.rootName || "STM32_Project");
    } catch (error) {
      toast("无法导入工程数据：" + error.message, "error");
    }
  });

  window.dispatchEvent(new CustomEvent("alice-project-workspace-ready", { detail: window.AliceProjectWorkspace }));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { restoreRecentProject(); }, { once: true });
  else window.setTimeout(restoreRecentProject, 0);
}());
