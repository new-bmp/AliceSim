(() => {
  "use strict";

  function initUiActions() {
    if (document.documentElement.dataset.aliceUiActions === "ready") return;
    document.documentElement.dataset.aliceUiActions = "ready";

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const editor = $("#codeEditor");
    if (!editor) return;

    const STORAGE_PROJECT = "alicesim.project.autosave.v1";
    const STORAGE_CIRCUIT = "alicesim.circuit.manual-save.v1";
    const STORAGE_LIBRARY = "alicesim.library.disabled.v1";
    let activeMenu = null;
    let actionModal = null;
    let splitEditor = null;
    let splitActive = false;
    let minimapVisible = true;
    let focusMode = false;
    let applyingHistory = false;
    let history = [];
    let historyIndex = -1;
    let lastHistoryInput = { at: 0, type: "" };
    let historyFilePath = "";
    const customFiles = new Map();

    injectStyles();

    function injectStyles() {
      if ($("#uiActionsStyles")) return;
      const style = document.createElement("style");
      style.id = "uiActionsStyles";
      style.textContent = `
        .ui-action-menu{position:fixed;z-index:600;min-width:210px;padding:5px;border:1px solid #c8c8c8;background:#fff;color:#242424;box-shadow:0 8px 24px rgba(0,0,0,.22);font:11px "Segoe UI",sans-serif}
        .toast.warning i{background:#ca5010!important;box-shadow:none!important}
        .ui-action-menu[hidden]{display:none}.ui-action-menu button{width:100%;min-height:30px;display:flex;align-items:center;gap:9px;padding:5px 9px;color:#242424;text-align:left;border:0;background:transparent}.ui-action-menu button:hover,.ui-action-menu button:focus{outline:0;background:#e8f3fb}.ui-action-menu button:disabled{color:#a19f9d;background:transparent;cursor:default}.ui-action-menu .ui-menu-icon{width:18px;color:#0f6cbd;text-align:center}.ui-action-menu kbd{margin-left:auto;color:#616161;background:transparent;font:10px Consolas,monospace}.ui-action-menu hr{height:1px;margin:4px;border:0;background:#e1e1e1}
        .ui-action-modal{width:min(470px,calc(100vw - 32px));padding:28px;text-align:left}.ui-action-modal .modal-eyebrow,.ui-action-modal h2,.ui-action-modal>p{text-align:left}.ui-action-modal h2{margin-bottom:7px}.ui-action-modal>p{max-width:none;margin:0 0 18px}.ui-action-form{display:grid;gap:12px}.ui-action-form label{display:grid;gap:5px;color:#323130;font-size:10px}.ui-action-form input[type=text],.ui-action-form input[type=search],.ui-action-form select,.ui-action-form textarea{width:100%;box-sizing:border-box;padding:0 9px;border:1px solid #8a8886;border-radius:2px;color:#242424;background:#fff;font:11px "Segoe UI",sans-serif;outline:0}.ui-action-form input[type=text],.ui-action-form input[type=search],.ui-action-form select{height:32px}.ui-action-form textarea{min-height:64px;padding-block:7px;resize:vertical;line-height:1.4}.ui-action-form input:focus,.ui-action-form select:focus,.ui-action-form textarea:focus{border-color:#0f6cbd;box-shadow:inset 0 0 0 1px #0f6cbd}.ui-action-check{display:flex!important;grid-template-columns:none!important;align-items:center;gap:7px!important}.ui-action-check input{accent-color:#0f6cbd}.ui-action-note{padding:9px;border-left:3px solid #0f6cbd;color:#616161;background:#f5faff;font-size:10px;line-height:1.5}.ui-action-buttons{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.ui-action-secondary{height:33px;min-width:88px;padding:0 14px;border:1px solid #8a8886;border-radius:2px;color:#242424;background:#fff;font-size:10px}.ui-action-secondary:hover{background:#f3f3f3}.ui-action-list{max-height:320px;overflow:auto;border:1px solid #d6d6d6}.ui-action-list label,.ui-search-result{min-height:34px;display:flex;align-items:center;gap:9px;padding:7px 9px;border-bottom:1px solid #ededed;color:#323130;background:#fff}.ui-action-list label:last-child,.ui-search-result:last-child{border-bottom:0}.ui-action-list label:hover,.ui-search-result:hover{background:#f5faff}.ui-action-list label.is-disabled{color:#a19f9d;background:#f7f7f7}.ui-action-list label.is-disabled:hover{background:#f7f7f7}.ui-action-list label span{display:flex;flex-direction:column;gap:2px}.ui-action-list label small,.ui-search-result small{color:#616161;font-size:9px}.ui-action-list .ui-driver-provenance{display:block;color:#0f6cbd;font-size:9px;line-height:1.35}.ui-action-list .ui-driver-provenance a{color:#0f6cbd;text-decoration:none}.ui-action-list .ui-driver-provenance a:hover{text-decoration:underline}.ui-action-list input{accent-color:#0f6cbd}.ui-search-results{min-height:42px;max-height:260px;overflow:auto;border:1px solid #d6d6d6}.ui-search-result{width:100%;text-align:left}.ui-search-result b{font-weight:600}.ui-search-result small{margin-left:auto}.ui-empty-result{padding:20px;color:#616161;text-align:center;font-size:10px}.ui-help-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ui-help-card{padding:11px;border:1px solid #d6d6d6;background:#fafafa}.ui-help-card h3{margin:0 0 7px;color:#242424;font-size:11px}.ui-help-card p{margin:0;color:#616161;font-size:10px;line-height:1.55}.ui-shortcuts{margin-top:12px;border-top:1px solid #e1e1e1}.ui-shortcuts div{display:flex;align-items:center;padding:6px 1px;border-bottom:1px solid #ededed;color:#616161;font-size:10px}.ui-shortcuts kbd{margin-left:auto;padding:2px 5px;border:1px solid #c8c8c8;background:#fafafa;color:#323130;font:9px Consolas,monospace}.ui-component-package-grid{display:grid;grid-template-columns:minmax(0,1fr) 92px 110px;gap:9px}.ui-component-description{grid-column:1/-1}.ui-component-ports{display:grid;gap:7px;padding:10px;border:1px solid #d6d6d6;background:#fafafa}.ui-component-ports-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.ui-component-ports-head strong{font-size:11px}.ui-component-ports-head small{color:#616161;font-size:9px}.ui-component-port-list{display:flex;flex-wrap:wrap;gap:6px;max-height:128px;overflow:auto}.ui-component-port{min-width:86px;display:grid;gap:2px;padding:6px 8px;border:1px solid #b7c9d6;border-left:3px solid #0f6cbd;background:#fff}.ui-component-port b{font:700 10px Consolas,monospace}.ui-component-port small{color:#616161;font-size:8px}.ui-component-port.role-power{border-left-color:#c43e1c}.ui-component-port.role-ground{border-left-color:#323130}.ui-component-port.role-analog{border-left-color:#8b5cf6}.ui-component-port-empty{width:100%;box-sizing:border-box}
        .ui-ribbon-glyph{width:15px;color:#0f6cbd;text-align:center;font-size:13px}.ribbon-group[data-ui-action-group]{display:none}
        .editor-wrap.ui-editor-split>#uiSplitEditor{display:block}.editor-wrap>#uiSplitEditor{display:none}.editor-wrap.ui-editor-split>#minimap{grid-column:4}.editor-wrap.ui-editor-split>#codeEditor,.editor-wrap.ui-editor-split>#codeHighlight,.editor-wrap.ui-editor-split>#diagnosticLayer{grid-column:2}
        #uiSplitEditor{grid-column:3;grid-row:1;z-index:5;width:100%;height:100%;min-width:0;min-height:0;resize:none;padding:9px 14px 60px;border:0;border-left:1px solid #d6d6d6;outline:0;overflow:auto;color:#242424;background:#fff;font:13px/20px Consolas,"Cascadia Mono",monospace;tab-size:2;white-space:pre}
        .ui-outline-content{padding:5px 15px 9px;color:#616161;background:#fafafa;font:9px/1.7 Consolas,monospace}.ui-outline-content button{display:block;width:100%;padding:2px 0;color:#323130;text-align:left;font-size:9px}.ui-outline-content button:hover{color:#0f6cbd}
        .schematic-viewport.ui-grid-hidden,.schematic-viewport.ui-grid-hidden .schematic-world{background-image:none!important}.schematic-viewport.ui-grid-hidden::before,.schematic-viewport.ui-grid-hidden::after,.schematic-viewport.ui-grid-hidden .schematic-world::before,.schematic-viewport.ui-grid-hidden .schematic-world::after{opacity:0!important}
        .simulator-panel:fullscreen{padding:0;background:#fff}.simulator-panel:fullscreen .schematic-viewport{min-height:55vh}
        body.ui-editor-focus{--side:0px;--sim:0px}body.ui-editor-focus .sidebar,body.ui-editor-focus .simulator-panel{display:none!important}body.ui-editor-focus .workspace{grid-template-rows:35px minmax(180px,1fr) 30px}body.ui-editor-focus .bottom-content{display:none!important}
        @media(max-width:560px){.ui-help-grid{grid-template-columns:1fr}}
        body.visio-theme .ui-action-menu{min-width:240px;font-size:13px}
        body.visio-theme .ui-action-menu button{min-height:36px;padding:7px 11px}
        body.visio-theme .ui-action-menu kbd{font-size:11px}
        body.visio-theme .ui-action-modal{width:min(620px,calc(100vw - 32px))}
        body.visio-theme .ui-action-modal>p{font-size:12px;line-height:1.55}
        body.visio-theme .ui-action-form label{font-size:12px}
        body.visio-theme .ui-action-form input[type=text],body.visio-theme .ui-action-form input[type=search],body.visio-theme .ui-action-form select,body.visio-theme .ui-action-form textarea{font-size:12px}
        body.visio-theme .ui-action-form input[type=text],body.visio-theme .ui-action-form input[type=search],body.visio-theme .ui-action-form select{height:36px}
        body.visio-theme .ui-action-note{font-size:11px}
        body.visio-theme .ui-action-list{max-height:390px}
        body.visio-theme .ui-action-list label{min-height:48px;padding:8px 11px}
        body.visio-theme .ui-action-list label[hidden]{display:none!important}
        body.visio-theme .ui-action-list label strong{font-size:12px}
        body.visio-theme .ui-action-list label small{font-size:10px;line-height:1.35}
        body.visio-theme .ui-action-list .ui-driver-provenance{font-size:10px}
        .ui-driver-filters{display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(150px,1fr) minmax(150px,1fr) auto;gap:8px;align-items:center}
        .ui-driver-count{color:#616161;font-size:11px;white-space:nowrap}
        @media(max-width:680px){.ui-driver-filters{grid-template-columns:1fr 1fr}.ui-driver-count{justify-self:end}.ui-component-package-grid{grid-template-columns:1fr 1fr}.ui-component-package-grid label:first-child{grid-column:1/-1}}
      `;
      document.head.appendChild(style);
    }

    function callGlobal(name, ...args) {
      const fn = window[name];
      if (typeof fn === "function") return fn(...args);
      return undefined;
    }

    function toast(message, type = "success") {
      if (typeof window.showToast === "function") {
        window.showToast(message, type);
        return;
      }
      const stack = $("#toastStack") || document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast-stack" }));
      const item = document.createElement("div");
      item.className = `toast ${type}`;
      const dot = document.createElement("i");
      const text = document.createElement("span");
      text.textContent = message;
      item.append(dot, text);
      stack.appendChild(item);
      setTimeout(() => item.classList.add("hide"), 2800);
      setTimeout(() => item.remove(), 3150);
    }

    function safeStorageGet(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
      } catch (_) {
        return fallback;
      }
    }

    function safeStorageSet(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (_) {
        return false;
      }
    }

    function safeName(value, fallback = "AliceSIM_Project") {
      const cleaned = String(value || "").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "_").slice(0, 64);
      return cleaned || fallback;
    }

    function currentProjectName() {
      const button = $("#projectMenu");
      if (button) {
        const clone = button.cloneNode(true);
        clone.querySelector("small")?.remove();
        const value = clone.textContent.trim();
        if (value) return value;
      }
      return $(".tree-row.root strong")?.textContent.trim() || "AliceSIM_Project";
    }

    function currentFileName() {
      const hostedPath = window.AliceEditorHost?.getCurrentFile?.().path;
      if (hostedPath) return hostedPath;
      return $(".work-tab[data-tab=code] .tab-file-name")?.textContent.trim()
        || $(".tree-row.file.selected")?.dataset.file
        || "main.c";
    }

    function setProjectName(name, mcu) {
      const cleanName = safeName(name, "Untitled_Project");
      const button = $("#projectMenu");
      if (button) {
        let status = button.querySelector("small");
        if (!status) status = document.createElement("small");
        status.textContent = "●";
        button.replaceChildren(document.createTextNode(`${cleanName} `), status);
      }
      const rootName = $(".tree-row.root strong");
      if (rootName) rootName.textContent = cleanName;
      const crumb = $(".editor-breadcrumb > span:first-child");
      if (crumb) crumb.textContent = cleanName;
      const terminalPath = $("#terminalOutput .path");
      if (terminalPath) terminalPath.textContent = `~/${cleanName}`;
      if (mcu) {
        const badge = $(".chip-badge");
        const deviceName = $(".device-summary strong");
        if (badge) badge.textContent = mcu;
        if (deviceName) deviceName.textContent = mcu;
      }
      document.title = `${cleanName} — AliceSIM`;
      return cleanName;
    }

    function markDirty(dirty = true) {
      const status = $("#projectMenu small");
      if (status) {
        status.textContent = dirty ? "●" : "✓";
        status.title = dirty ? "有未保存的更改" : "已保存";
      }
      const fileDot = $(".work-tab[data-tab=code] i");
      if (fileDot) fileDot.style.visibility = dirty ? "visible" : "hidden";
    }

    function downloadBlob(content, filename, mime = "text/plain;charset=utf-8") {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = safeName(filename.replace(/\.[^.]+$/, ""), "AliceSIM") + (filename.match(/\.[^.]+$/)?.[0] || "");
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function collectProject() {
      const activeFile = currentFileName();
      const files = {};
      let workspaceSnapshot = null;
      try { workspaceSnapshot = window.AliceProjectWorkspace?.getState?.() || null; } catch (_) { workspaceSnapshot = null; }
      if (workspaceSnapshot?.files instanceof Map && workspaceSnapshot.files.size) {
        workspaceSnapshot.files.forEach((record, path) => {
          if (typeof record?.content === "string") files[path] = record.content;
        });
      } else {
        try {
          if (typeof altFiles !== "undefined") Object.assign(files, altFiles);
          if (typeof defaultCode !== "undefined") files["main.c"] = defaultCode;
        } catch (_) {
          // The actions script also works when the demo data is not globally visible.
        }
        customFiles.forEach((value, key) => { files[key] = value; });
      }
      files[activeFile] = editor.value;
      const pinout = $$(".pin.configured[data-pin]").map(pin => ({
        pin: pin.dataset.pin,
        kind: [...pin.classList].find(name => ["gpio", "uart", "system", "power"].includes(name)) || "gpio"
      }));
      return {
        format: "AliceSIM Project",
        version: 2,
        savedAt: new Date().toISOString(),
        project: {
          name: currentProjectName(),
          mcu: $(".chip-badge")?.textContent.trim() || "STM32F103C8T6"
        },
        currentFile: activeFile,
        files,
        pinout,
        workspace: workspaceSnapshot ? {
          entryPath: workspaceSnapshot.entryPath,
          iocPath: workspaceSnapshot.iocPath,
          includeDirs: workspaceSnapshot.includeDirs,
          defines: workspaceSnapshot.defines
        } : null,
        ioc: window.AliceIocViewer?.getRaw?.() ? {
          path: workspaceSnapshot?.iocPath || "Imported.ioc",
          content: window.AliceIocViewer.getRaw()
        } : null
      };
    }

    function workspaceHasDirtyFiles() {
      try {
        const files = window.AliceProjectWorkspace?.getState?.().files;
        if (files instanceof Map) return [...files.values()].some(record => Boolean(record?.dirty));
        if (files && typeof files === "object") return Object.values(files).some(record => Boolean(record?.dirty));
      } catch (_) {
        // A standalone editor has only the active file dirty marker.
      }
      return false;
    }

    async function saveCurrentCode() {
      const fileName = currentFileName();
      try {
        let result = null;
        const saver = window.AliceProject?.saveActiveCode || window.AliceProjectWorkspace?.saveActiveCode;
        if (typeof saver === "function") result = await saver({ notify: false });
        if (!result) {
          downloadBlob(editor.value, fileName, /\.ioc$/i.test(fileName) ? "text/plain;charset=utf-8" : "text/x-c;charset=utf-8");
          result = { ok: true, action: "download", path: fileName };
        }
        if (result.ok === false) throw result.error || new Error(result.message || result.code || "保存失败");
        safeStorageSet(STORAGE_PROJECT, collectProject());
        const stillDirty = Boolean(result.dirty) || workspaceHasDirtyFiles();
        markDirty(stillDirty);
        const savedPath = result.path || fileName;
        toast(stillDirty
          ? `已保存代码 · ${savedPath} · 工程中仍有未保存修改`
          : result.action === "write-back"
            ? `代码已写回工程 · ${savedPath}`
            : `代码已单独保存 · ${savedPath}`,
        stillDirty ? "warning" : "success");
        return result;
      } catch (error) {
        toast(`保存代码失败：${error?.message || error}`, "error");
        return { ok: false, error };
      }
    }

    function exportProject() {
      const project = collectProject();
      downloadBlob(JSON.stringify(project, null, 2), `${safeName(project.project.name)}.alice.json`, "application/json;charset=utf-8");
      safeStorageSet(STORAGE_PROJECT, project);
      markDirty(false);
      toast("AliceSIM 工程包已导出");
    }

    function circuitFileName() {
      return `${safeName(currentProjectName(), "AliceSIM_Project")}.alice-sch.json`;
    }

    function schematicApi() {
      const api = window.AliceSchematic;
      if (!api || typeof api.exportCircuit !== "function" || typeof api.importCircuit !== "function") {
        toast("电路保存模块尚未就绪", "error");
        return null;
      }
      return api;
    }

    function saveCurrentCircuit() {
      const api = schematicApi();
      if (!api) return false;
      try {
        const payload = api.exportCircuit();
        const result = typeof api.downloadCircuit === "function" ? api.downloadCircuit(circuitFileName()) : null;
        if (!result || result.ok === false) {
          const serialized = result?.content || (typeof api.serializeCircuit === "function"
            ? api.serializeCircuit(payload)
            : JSON.stringify(payload, null, 2));
          downloadBlob(serialized, circuitFileName(), "application/json;charset=utf-8");
        }
        safeStorageSet(STORAGE_CIRCUIT, payload);
        toast(`电路已单独保存 · ${payload.components?.length || 0} 个元件 · ${payload.wires?.length || 0} 条导线`);
        return payload;
      } catch (error) {
        toast(`保存电路失败：${error?.message || error}`, "error");
        return false;
      }
    }

    function openSaveComponentDialog() {
      const api = schematicApi();
      if (!api || typeof api.exportComponentPackage !== "function") {
        toast("组件保存模块尚未就绪", "error");
        return false;
      }
      let preview;
      try {
        preview = api.exportComponentPackage({ name: `${currentProjectName()} Component` });
      } catch (error) {
        toast(`无法整理组件：${error?.message || error}`, "error");
        return false;
      }
      const form = document.createElement("form");
      form.className = "ui-action-form ui-component-package-form";
      const identity = document.createElement("div");
      identity.className = "ui-component-package-grid";

      const nameLabel = document.createElement("label");
      nameLabel.textContent = "组件名称";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = `${currentProjectName()} Component`;
      nameInput.maxLength = 96;
      nameInput.autocomplete = "off";
      nameInput.autofocus = true;
      nameLabel.appendChild(nameInput);

      const prefixLabel = document.createElement("label");
      prefixLabel.textContent = "位号前缀";
      const prefixInput = document.createElement("input");
      prefixInput.type = "text";
      prefixInput.value = "MOD";
      prefixInput.maxLength = 8;
      prefixInput.autocomplete = "off";
      prefixLabel.appendChild(prefixInput);

      const versionLabel = document.createElement("label");
      versionLabel.textContent = "版本";
      const versionInput = document.createElement("input");
      versionInput.type = "text";
      versionInput.value = "1.0.0";
      versionInput.maxLength = 32;
      versionInput.autocomplete = "off";
      versionLabel.appendChild(versionInput);

      const descriptionLabel = document.createElement("label");
      descriptionLabel.className = "ui-component-description";
      descriptionLabel.textContent = "说明";
      const descriptionInput = document.createElement("textarea");
      descriptionInput.rows = 3;
      descriptionInput.maxLength = 500;
      descriptionInput.placeholder = "说明这个组件的用途、供电和接口要求";
      descriptionLabel.appendChild(descriptionInput);

      identity.append(nameLabel, prefixLabel, versionLabel);
      const ports = document.createElement("div");
      ports.className = "ui-component-ports";
      const portsHead = document.createElement("div");
      portsHead.className = "ui-component-ports-head";
      const portsTitle = document.createElement("strong");
      portsTitle.textContent = `外部端口 ${preview.component.ports.length}`;
      const portsHint = document.createElement("small");
      portsHint.textContent = "由同名 EDA 网络端子自动生成";
      portsHead.append(portsTitle, portsHint);
      const portList = document.createElement("div");
      portList.className = "ui-component-port-list";
      const roleLabels = { power: "电源", ground: "地", analog: "模拟", signal: "信号" };
      const directionLabels = { input: "输入", output: "输出", bidirectional: "双向" };
      preview.component.ports.forEach(port => {
        const item = document.createElement("span");
        item.className = `ui-component-port role-${port.role}`;
        const portName = document.createElement("b");
        portName.textContent = port.name;
        const portMeta = document.createElement("small");
        portMeta.textContent = `${roleLabels[port.role] || port.role} · ${directionLabels[port.direction] || port.direction}`;
        item.append(portName, portMeta);
        portList.appendChild(item);
      });
      if (!preview.component.ports.length) {
        const empty = document.createElement("div");
        empty.className = "ui-action-note ui-component-port-empty";
        empty.textContent = "当前电路没有网络端子。仍可保存组件，但组件不会暴露外部接口；建议先放置并命名网络端子。";
        portList.appendChild(empty);
      }
      ports.append(portsHead, portList);
      const summary = document.createElement("div");
      summary.className = "ui-action-note";
      summary.textContent = `内部电路：${preview.component.componentCount} 个元件 · ${preview.component.wireCount} 条导线 · 独立 .alice-component.json 格式`;
      form.append(identity, descriptionLabel, ports, summary);

      openActionModal({
        eyebrow: "SAVE COMPONENT",
        title: "将完整电路保存为组件",
        description: "组件包保留内部电路，并把网络端子作为以后放置组件时的外部接口。",
        content: form,
        primaryLabel: "保存组件",
        onPrimary: () => {
          const name = nameInput.value.trim();
          const prefix = prefixInput.value.trim().toUpperCase();
          const version = versionInput.value.trim();
          if (!name) {
            toast("请输入组件名称", "error");
            nameInput.focus();
            return false;
          }
          if (!/^[A-Z][A-Z0-9_]{0,7}$/.test(prefix)) {
            toast("位号前缀需以字母开头，最多 8 位", "error");
            prefixInput.focus();
            return false;
          }
          if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
            toast("版本格式应类似 1.0.0", "error");
            versionInput.focus();
            return false;
          }
          try {
            const options = { name, prefix, version, description: descriptionInput.value.trim() };
            const filename = `${safeName(name, "AliceSIM_Component")}.alice-component.json`;
            const result = api.downloadComponentPackage(filename, options);
            if (!result || result.ok === false) {
              const content = result?.content || api.serializeComponentPackage(api.exportComponentPackage(options));
              downloadBlob(content, filename, "application/json;charset=utf-8");
            }
            const portCount = result?.component?.ports?.length ?? preview.component.ports.length;
            toast(`组件已保存 · ${portCount} 个外部端口 · ${preview.component.componentCount} 个内部元件`, portCount ? "success" : "warning");
            return true;
          } catch (error) {
            toast(`保存组件失败：${error?.message || error}`, "error");
            return false;
          }
        }
      });
      return true;
    }

    function importCircuitPayload(payload, sourceName) {
      const api = schematicApi();
      if (!api) return false;
      try {
        const result = api.importCircuit(payload);
        if (result?.ok === false) throw new Error(result.error || result.code || "电路格式无效");
        safeStorageSet(STORAGE_CIRCUIT, api.exportCircuit());
        const componentCount = result?.componentCount ?? result?.components ?? payload?.components?.length ?? 0;
        const wireCount = result?.wireCount ?? result?.wires ?? payload?.wires?.length ?? 0;
        const skipped = result?.skippedWireCount || 0;
        toast(`已打开电路 ${sourceName || ""} · ${componentCount} 个元件 · ${wireCount} 条导线${skipped ? ` · 跳过 ${skipped} 条不兼容导线` : ""}`.trim(), skipped ? "warning" : "success");
        return result || true;
      } catch (error) {
        toast(`无法打开电路：${error?.message || error}`, "error");
        return false;
      }
    }

    async function handleCircuitFile(file) {
      if (!file) return;
      if (Number(file.size || 0) > 8 * 1024 * 1024) {
        toast("电路文件超过 8 MB 安全上限", "error");
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch (error) {
        toast(`无法读取电路文件：${error?.message || "JSON 格式无效"}`, "error");
        return;
      }
      const isComponentPackage = payload?.kind === "AliceSIMComponent";
      const inspectedComponent = isComponentPackage && typeof window.AliceSchematic?.inspectComponentPackage === "function"
        ? window.AliceSchematic.inspectComponentPackage(payload)
        : null;
      if (isComponentPackage && inspectedComponent?.ok === false) {
        toast(`无法读取组件：${inspectedComponent.error || inspectedComponent.code}`, "error");
        return;
      }
      const circuitPayload = inspectedComponent?.ok ? inspectedComponent.circuit : payload;
      const content = document.createElement("div");
      content.className = "ui-action-note";
      content.textContent = inspectedComponent?.ok
        ? `${inspectedComponent.component.name} · v${inspectedComponent.component.version} · ${inspectedComponent.component.ports.length} 个外部端口 · ${inspectedComponent.component.componentCount} 个内部元件`
        : `${file.name} · ${payload?.components?.length || 0} 个元件 · ${payload?.wires?.length || 0} 条导线`;
      openActionModal({
        eyebrow: inspectedComponent?.ok ? "OPEN COMPONENT" : "OPEN CIRCUIT",
        title: inspectedComponent?.ok ? "打开组件内部电路？" : "打开保存的电路？",
        description: inspectedComponent?.ok
          ? "组件包将作为内部原理图打开，便于检查和继续编辑；组件身份与端口契约不会混入普通电路文件。"
          : "当前用户放置的元件与导线将被替换；IOC 决定的 MCU 模块和有效 IO 会继续保留。",
        content,
        primaryLabel: inspectedComponent?.ok ? "打开内部电路" : "打开电路",
        onPrimary: () => importCircuitPayload(circuitPayload, file.name)
      });
    }

    function peripheralDriverCatalog() {
      const provider = window.AlicePeripheralDrivers;
      if (!provider || typeof provider.list !== "function" || typeof provider.getFiles !== "function") return [];
      const entries = provider.list();
      return Array.isArray(entries) ? entries : [];
    }

    function usedSchematicPeripheralTypes() {
      try {
        const components = window.AliceSchematic?.getState?.().components || [];
        return new Set(components.map(component => component.type));
      } catch (_) {
        return new Set();
      }
    }

    function openPeripheralDriverManager() {
      const provider = window.AlicePeripheralDrivers;
      const catalog = peripheralDriverCatalog();
      const upstreamCatalog = typeof provider?.upstreamCandidates === "function" ? provider.upstreamCandidates() : [];
      const upstreamCategories = typeof provider?.upstreamCategories === "function" ? provider.upstreamCategories() : [];
      if (!provider || !catalog.length) {
        toast("AliceSIM 外设驱动目录尚未就绪", "error");
        return;
      }
      const fullCatalog = catalog.map(driver => ({ ...driver, sourceGroup: "alicesim" })).concat(upstreamCatalog);
      const usedTypes = usedSchematicPeripheralTypes();
      const hasRecommended = catalog.some(driver => driver.installable !== false && (driver.componentTypes || []).some(type => usedTypes.has(type)));
      const content = document.createElement("div");
      content.className = "ui-action-form";
      const filters = document.createElement("div");
      filters.className = "ui-driver-filters";
      const search = document.createElement("input");
      search.type = "search";
      search.placeholder = "搜索器件、仓库或类别";
      search.setAttribute("aria-label", "搜索驱动目录");
      const scope = document.createElement("select");
      scope.setAttribute("aria-label", "驱动目录范围");
      [
        ["alicesim", `AliceSIM 器件 · ${catalog.length}`],
        ["libdriver-upstream", `libdriver 上游候选 · ${upstreamCatalog.length}`],
        ["all", `全部目录 · ${fullCatalog.length}`]
      ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        scope.appendChild(option);
      });
      const category = document.createElement("select");
      category.setAttribute("aria-label", "libdriver 分类");
      const allCategories = document.createElement("option");
      allCategories.value = "all";
      allCategories.textContent = "全部类别";
      category.appendChild(allCategories);
      upstreamCategories.forEach(item => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.label} · ${item.count}`;
        category.appendChild(option);
      });
      category.disabled = true;
      const visibleCount = document.createElement("span");
      visibleCount.className = "ui-driver-count";
      filters.append(search, scope, category, visibleCount);
      const list = document.createElement("div");
      list.className = "ui-action-list";
      fullCatalog.forEach(driver => {
        const row = document.createElement("label");
        row.dataset.sourceGroup = driver.sourceGroup || "alicesim";
        row.dataset.category = driver.category || "";
        row.dataset.searchText = [driver.name, driver.description, driver.categoryLabel, driver.upstream?.repository].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = driver.id;
        checkbox.disabled = driver.installable === false;
        checkbox.checked = driver.installable !== false && (hasRecommended
          ? (driver.componentTypes || []).some(type => usedTypes.has(type))
          : true);
        if (checkbox.disabled) row.classList.add("is-disabled");
        const text = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = driver.name || driver.id;
        const small = document.createElement("small");
        const paths = Array.isArray(driver.files) ? driver.files : Object.keys(driver.files || {});
        const stateText = driver.status === "upstream" ? "上游候选" : "适配中";
        small.textContent = `${driver.description || "AliceSIM HAL 外设驱动"}${paths.length ? ` · ${paths.length} 个文件` : ` · ${stateText}`}`;
        const provenance = document.createElement("span");
        provenance.className = "ui-driver-provenance";
        provenance.textContent = driver.attribution || "AliceSIM 制作";
        if (driver.upstream?.license) provenance.textContent += ` · ${driver.upstream.license}`;
        if (driver.upstream?.url) {
          const upstream = document.createElement("a");
          upstream.href = driver.upstream.url;
          upstream.target = "_blank";
          upstream.rel = "noreferrer";
          upstream.textContent = "查看上游";
          upstream.addEventListener("click", event => event.stopPropagation());
          provenance.append(" · ", upstream);
        }
        text.append(strong, small, provenance);
        row.append(checkbox, text);
        list.appendChild(row);
      });
      const updateDriverRows = () => {
        const selectedScope = scope.value;
        category.disabled = selectedScope === "alicesim";
        if (category.disabled && category.value !== "all") category.value = "all";
        const selectedCategory = category.value;
        const term = search.value.trim().toLocaleLowerCase("zh-CN");
        let shown = 0;
        $$(':scope > label', list).forEach(row => {
          const scopeMatches = selectedScope === "all" || row.dataset.sourceGroup === selectedScope;
          const categoryMatches = selectedCategory === "all" || row.dataset.category === selectedCategory;
          const searchMatches = !term || row.dataset.searchText.includes(term);
          const visible = scopeMatches && categoryMatches && searchMatches;
          row.hidden = !visible;
          if (visible) shown += 1;
        });
        visibleCount.textContent = `显示 ${shown} 项`;
      };
      search.addEventListener("input", updateDriverRows);
      scope.addEventListener("change", updateDriverRows);
      category.addEventListener("change", updateDriverRows);
      updateDriverRows();
      const overwriteLabel = document.createElement("label");
      overwriteLabel.className = "ui-action-check";
      const overwrite = document.createElement("input");
      overwrite.type = "checkbox";
      overwriteLabel.append(overwrite, document.createTextNode("更新工程中同路径的 AliceSIM 驱动（可能覆盖手工修改）"));
      const note = document.createElement("div");
      note.className = "ui-action-note";
      note.textContent = "驱动会复制到当前工程的 Drivers/AliceSIM 目录；libdriver 条目保留上游署名与 MIT 许可证信息。灰色条目仍在适配，暂不可安装。";
      content.append(filters, list, overwriteLabel, note);
      openActionModal({
        eyebrow: "ALICESIM DRIVERS",
        title: "添加 AliceSIM 外设驱动",
        description: `选择可直接加入工程的 AliceSIM 驱动，或浏览已收集的 ${upstreamCatalog.length} 个 libdriver 上游候选。`,
        content,
        primaryLabel: "添加到工程",
        onPrimary: async () => {
          const ids = $$('input[type="checkbox"]:checked', list).map(input => input.value);
          if (!ids.length) {
            toast("请至少选择一个外设驱动", "error");
            return false;
          }
          const workspaceApi = window.AliceProjectWorkspace;
          const install = overwrite.checked ? workspaceApi?.upsertFiles : workspaceApi?.addFiles;
          if (typeof install !== "function") {
            toast("请先创建或打开一个工程", "error");
            return false;
          }
          try {
            const files = await provider.getFiles(ids);
            const result = install(files, { markDirty: true });
            const changed = (result?.added?.length || 0) + (result?.updated?.length || 0);
            const skipped = result?.skipped?.length || 0;
            if (changed) markDirty(true);
            toast(changed
              ? `AliceSIM 驱动已加入工程 · ${changed} 个文件${skipped ? ` · ${skipped} 个已保留` : ""}`
              : `驱动文件已存在 · ${skipped || Object.keys(files || {}).length} 个文件保持不变`);
            return true;
          } catch (error) {
            toast(`添加外设驱动失败：${error?.message || error}`, "error");
            return false;
          }
        }
      });
    }

    function closeMenu() {
      activeMenu?.remove();
      activeMenu = null;
    }

    function openMenu(anchor, items, options = {}) {
      closeMenu();
      const menu = document.createElement("div");
      menu.className = "ui-action-menu";
      menu.setAttribute("role", "menu");
      items.forEach(item => {
        if (item.separator) {
          menu.appendChild(document.createElement("hr"));
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.disabled = Boolean(item.disabled);
        const icon = document.createElement("span");
        icon.className = "ui-menu-icon";
        icon.textContent = item.icon || "";
        const label = document.createElement("span");
        label.textContent = item.label;
        button.append(icon, label);
        if (item.shortcut) {
          const shortcut = document.createElement("kbd");
          shortcut.textContent = item.shortcut;
          button.appendChild(shortcut);
        }
        button.addEventListener("click", () => {
          closeMenu();
          item.action?.();
        });
        menu.appendChild(button);
      });
      const menuPortal = document.fullscreenElement?.contains(anchor) ? document.fullscreenElement : document.body;
      menuPortal.appendChild(menu);
      activeMenu = menu;
      const rect = anchor.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      let left = options.align === "right" ? rect.right - width : rect.left;
      let top = rect.bottom + 4;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      requestAnimationFrame(() => menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true }));
    }

    function ensureActionModal() {
      if (actionModal?.isConnected) return actionModal;
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.id = "uiActionsModal";
      backdrop.innerHTML = `
        <div class="modal ui-action-modal" role="dialog" aria-modal="true" aria-labelledby="uiActionsTitle">
          <button class="modal-close" type="button" aria-label="关闭">×</button>
          <div class="modal-eyebrow"></div>
          <h2 id="uiActionsTitle"></h2>
          <p class="ui-action-description"></p>
          <div class="ui-action-body"></div>
          <div class="ui-action-buttons">
            <button class="ui-action-secondary" type="button"></button>
            <button class="modal-primary" type="button"></button>
          </div>
        </div>`;
      backdrop.addEventListener("click", event => {
        if (event.target === backdrop || event.target.closest(".modal-close")) closeActionModal();
      });
      document.body.appendChild(backdrop);
      actionModal = backdrop;
      return backdrop;
    }

    function closeActionModal() {
      if (!actionModal) return;
      const closingModal = actionModal;
      actionModal = null;
      closingModal.classList.remove("open");
      setTimeout(() => closingModal.remove(), 220);
    }

    function openActionModal(options) {
      closeMenu();
      if (actionModal) actionModal.remove();
      actionModal = null;
      const modal = ensureActionModal();
      $(".modal-eyebrow", modal).textContent = options.eyebrow || "ALICESIM";
      $("#uiActionsTitle", modal).textContent = options.title || "";
      const description = $(".ui-action-description", modal);
      description.textContent = options.description || "";
      description.hidden = !options.description;
      const body = $(".ui-action-body", modal);
      body.replaceChildren();
      if (options.content instanceof Node) body.appendChild(options.content);
      const secondary = $(".ui-action-secondary", modal);
      const primary = $(".modal-primary", modal);
      secondary.textContent = options.secondaryLabel || "取消";
      secondary.hidden = options.secondaryLabel === null;
      primary.textContent = options.primaryLabel || "确定";
      primary.hidden = options.primaryLabel === null;
      secondary.onclick = () => {
        options.onSecondary?.();
        closeActionModal();
      };
      primary.onclick = async () => {
        primary.disabled = true;
        try {
          const result = await options.onPrimary?.(modal);
          if (result !== false) closeActionModal();
        } finally {
          if (primary.isConnected) primary.disabled = false;
        }
      };
      $("form", body)?.addEventListener("submit", event => {
        event.preventDefault();
        primary.click();
      });
      requestAnimationFrame(() => {
        modal.classList.add("open");
        const focusTarget = $("[autofocus]", body) || $("input,select,button", body) || primary;
        setTimeout(() => focusTarget?.focus(), 60);
      });
      return modal;
    }

    function createProjectCode(name) {
      return `/* ${name} · AliceSIM generated project */\n#include "main.h"\n\nint main(void)\n{\n  HAL_Init();\n  SystemClock_Config();\n\n  while (1)\n  {\n    HAL_Delay(100);\n  }\n}\n`;
    }

    function openWorkspaceTab(name) {
      const tab = $(`.work-tab[data-tab="${name}"]`);
      if (!tab) return;
      tab.hidden = false;
      tab.style.display = "";
      tab.click();
    }

    function replaceEditorValue(value, fileName = "main.c") {
      applyingHistory = true;
      editor.value = String(value ?? "");
      editor.setSelectionRange(0, 0);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      applyingHistory = false;
      const tabName = $(".work-tab[data-tab=code] .tab-file-name");
      if (tabName) tabName.textContent = fileName;
      const crumbName = $(".editor-breadcrumb strong");
      if (crumbName) crumbName.textContent = fileName;
      syncSplitEditor();
      resetHistory();
      markDirty(true);
    }

    function activateMainFile(value) {
      const row = $('.tree-row.file[data-file="main.c"]');
      row?.click();
      replaceEditorValue(value, "main.c");
      openWorkspaceTab("code");
    }

    function openNewProjectDialog() {
      const form = document.createElement("form");
      form.className = "ui-action-form";
      const nameLabel = document.createElement("label");
      nameLabel.textContent = "项目名称";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = "Untitled_Project";
      nameInput.maxLength = 64;
      nameInput.autocomplete = "off";
      nameInput.autofocus = true;
      nameLabel.appendChild(nameInput);
      const mcuLabel = document.createElement("label");
      mcuLabel.textContent = "目标器件";
      const mcuSelect = document.createElement("select");
      ["STM32F103C8T6", "STM32F103CBT6", "STM32F103RBT6"].forEach(value => mcuSelect.add(new Option(value, value)));
      mcuLabel.appendChild(mcuSelect);
      const keepLabel = document.createElement("label");
      keepLabel.className = "ui-action-check";
      const keepInput = document.createElement("input");
      keepInput.type = "checkbox";
      keepLabel.append(keepInput, document.createTextNode("保留当前编辑器中的代码"));
      const note = document.createElement("div");
      note.className = "ui-action-note";
      note.textContent = "创建后将重置当前项目结构；如需保留完整工程，请先使用“导出工程”。";
      form.append(nameLabel, mcuLabel, keepLabel, note);
      const currentCode = editor.value;
      openActionModal({
        eyebrow: "NEW PROJECT",
        title: "创建 AliceSIM 项目",
        description: "确认项目名称与目标 MCU，然后创建一个新的本地工作区。",
        content: form,
        primaryLabel: "创建项目",
        onPrimary: () => {
          const name = safeName(nameInput.value, "");
          if (!nameInput.value.trim()) {
            toast("请输入项目名称", "error");
            nameInput.focus();
            return false;
          }
          if ($("#runButton.running")) $("#runButton").click();
          setProjectName(name, mcuSelect.value);
          activateMainFile(keepInput.checked ? currentCode : createProjectCode(name));
          safeStorageSet(STORAGE_PROJECT, collectProject());
          toast(`项目 ${name} 已创建`);
          return true;
        }
      });
    }

    const projectInput = document.createElement("input");
    projectInput.type = "file";
    projectInput.accept = ".ioc,.json,.alice,.alicesim";
    projectInput.hidden = true;
    document.body.appendChild(projectInput);

    const circuitInput = document.createElement("input");
    circuitInput.type = "file";
    circuitInput.accept = ".alice-sch.json,.alice-component.json,.alicesim-circuit,.json,application/json";
    circuitInput.hidden = true;
    document.body.appendChild(circuitInput);

    function openProjectPicker() {
      projectInput.value = "";
      projectInput.click();
    }

    function openCircuitPicker() {
      circuitInput.value = "";
      circuitInput.click();
    }

    function openProjectFolder() {
      if (window.AliceProjectWorkspace?.openFolder) {
        window.AliceProjectWorkspace.openFolder();
        return;
      }
      toast("工程文件夹导入器尚未就绪", "error");
    }

    async function handleProjectFile(file) {
      if (!file) return;
      if (/\.ioc$/i.test(file.name)) {
        if (window.AliceIocViewer?.loadFile) {
          await window.AliceIocViewer.loadFile(file);
          window.AliceIocViewer.open?.();
          return;
        }
        if (typeof window.handleIoc === "function") {
          window.handleIoc(file);
        } else {
          const iocInput = $("#iocInput");
          if (iocInput && typeof DataTransfer === "function") {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            iocInput.files = transfer.files;
            iocInput.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            toast("IOC 导入器尚未就绪", "error");
          }
        }
        return;
      }
      let project;
      try {
        project = JSON.parse(await file.text());
      } catch (_) {
        toast("无法读取工程文件：JSON 格式无效", "error");
        return;
      }
      const metadata = project.project || project;
      const files = project.files || {};
      const preferredPath = [project.currentFile, project.workspace?.entryPath, "main.c"].find(path => path && typeof files[path] === "string")
        || Object.keys(files).find(path => /(^|\/)main\.c$/i.test(path))
        || Object.keys(files).find(path => /\.c$/i.test(path));
      const code = preferredPath ? files[preferredPath] : project.code;
      if (!metadata.name || typeof code !== "string") {
        toast("该文件不是有效的 AliceSIM 工程包", "error");
        return;
      }
      const content = document.createElement("div");
      content.className = "ui-action-note";
      content.textContent = `${metadata.name} · ${metadata.mcu || "STM32F103C8T6"} · ${Object.keys(files).length || 1} 个文件`;
      openActionModal({
        eyebrow: "OPEN PROJECT",
        title: "打开本地工程？",
        description: "当前编辑内容将由所选工程替换。",
        content,
        primaryLabel: "打开工程",
        onPrimary: () => {
          if (window.AliceProjectWorkspace?.loadFiles) {
            const packageFiles = { ...files };
            if (!Object.values(packageFiles).some(value => typeof value === "string")) packageFiles[preferredPath || "main.c"] = code;
            if (project.ioc?.path && typeof project.ioc.content === "string" && packageFiles[project.ioc.path] == null) {
              packageFiles[project.ioc.path] = project.ioc.content;
            }
            const rootName = safeName(metadata.name, "STM32_Project");
            window.AliceProjectWorkspace.loadFiles(packageFiles, rootName)?.then(() => {
              if (project.currentFile) window.AliceProjectWorkspace.openFile(project.currentFile);
            });
            markDirty(false);
            return true;
          }
          setProjectName(metadata.name, metadata.mcu);
          customFiles.clear();
          Object.entries(files).forEach(([name, value]) => {
            if (typeof value === "string" && name !== "main.c") customFiles.set(name, value);
          });
          activateMainFile(code);
          if (Array.isArray(project.pinout)) applySavedPinout(project.pinout);
          safeStorageSet(STORAGE_PROJECT, project);
          markDirty(false);
          toast(`已打开 ${metadata.name}`);
          return true;
        }
      });
    }

    projectInput.addEventListener("change", event => handleProjectFile(event.target.files?.[0]));
    circuitInput.addEventListener("change", event => handleCircuitFile(event.target.files?.[0]));

    function applySavedPinout(pinout) {
      const map = new Map(pinout.map(item => [item.pin, item.kind]));
      $$(".pin[data-pin]").forEach(pin => {
        const kind = map.get(pin.dataset.pin);
        if (!kind) return;
        pin.classList.add("configured", kind);
      });
    }

    function currentHistoryFilePath() {
      return editor.dataset.aliceProjectPath || currentFileName() || "main.c";
    }

    function historySnapshot() {
      const value = editor.value;
      const max = value.length;
      const start = Math.max(0, Math.min(max, Number(editor.selectionStart) || 0));
      const end = Math.max(start, Math.min(max, Number(editor.selectionEnd) || start));
      return { value, start, end };
    }

    function resetHistory() {
      history = [historySnapshot()];
      historyIndex = 0;
      lastHistoryInput = { at: 0, type: "" };
      historyFilePath = currentHistoryFilePath();
      updateUndoButtons();
    }

    function handleEditorFileOpen(event) {
      const detail = event?.detail || {};
      // The host already placed the new text in #codeEditor.  Keep this
      // handler defensive for embedded hosts that only send the event data.
      if (typeof detail.content === "string" && editor.value !== detail.content) {
        applyingHistory = true;
        editor.value = detail.content;
        editor.setSelectionRange(0, 0);
        applyingHistory = false;
      }
      if (detail.path) editor.dataset.aliceProjectPath = String(detail.path);
      syncSplitEditor();
      resetHistory();
    }

    function recordHistory(event) {
      if (applyingHistory) return;
      const filePath = currentHistoryFilePath();
      // If an embedded editor changes files without emitting the normal open
      // event, do not append the new file to the old file's history.
      if (historyFilePath && filePath !== historyFilePath) resetHistory();
      const snapshot = historySnapshot();
      const now = Date.now();
      const inputType = event?.inputType || "programmatic";
      const canCoalesce = historyIndex === history.length - 1
        && now - lastHistoryInput.at < 650
        && inputType === lastHistoryInput.type
        && /^(insertText|deleteContentBackward|deleteContentForward)$/.test(inputType);
      if (canCoalesce) {
        history[historyIndex] = snapshot;
      } else {
        history.splice(historyIndex + 1);
        history.push(snapshot);
        if (history.length > 120) history.shift();
        historyIndex = history.length - 1;
      }
      lastHistoryInput = { at: now, type: inputType };
      updateUndoButtons();
      markDirty(true);
    }

    function applyHistory(index) {
      const snapshot = history[index];
      if (!snapshot) return false;
      applyingHistory = true;
      editor.value = snapshot.value;
      editor.setSelectionRange(snapshot.start, snapshot.end);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      applyingHistory = false;
      historyIndex = index;
      syncSplitEditor();
      const target = splitActive && document.activeElement === splitEditor ? splitEditor : editor;
      target?.focus();
      target?.setSelectionRange(snapshot.start, snapshot.end);
      updateUndoButtons();
      markDirty(true);
      return true;
    }

    function undoEditor() {
      if (historyIndex <= 0) {
        toast("没有可撤销的编辑", "error");
        return;
      }
      applyHistory(historyIndex - 1);
    }

    function redoEditor() {
      if (historyIndex >= history.length - 1) {
        toast("没有可重做的编辑", "error");
        return;
      }
      applyHistory(historyIndex + 1);
    }

    const quickSave = $('.quick-access button[title="保存代码"]');
    const quickUndo = $('.quick-access button[title="撤销"]');
    const quickRedo = $('.quick-access button[title="重做"]');

    function updateUndoButtons() {
      if (quickUndo) {
        quickUndo.disabled = historyIndex <= 0;
        quickUndo.setAttribute("aria-disabled", String(historyIndex <= 0));
      }
      if (quickRedo) {
        quickRedo.disabled = historyIndex >= history.length - 1;
        quickRedo.setAttribute("aria-disabled", String(historyIndex >= history.length - 1));
      }
    }

    quickSave?.addEventListener("click", saveCurrentCode);
    $("#saveCircuitButton")?.addEventListener("click", saveCurrentCircuit);
    $("#openCircuitButton")?.addEventListener("click", openCircuitPicker);
    $("#saveAsComponentButton")?.addEventListener("click", openSaveComponentDialog);
    quickUndo?.addEventListener("click", undoEditor);
    quickRedo?.addEventListener("click", redoEditor);
    editor.addEventListener("input", recordHistory);
    window.addEventListener("alice-editor-file-open", handleEditorFileOpen);
    // project-folder.js emits this event for hosts that provide their own
    // editor.  Supporting both events keeps the fallback and host paths in
    // sync without recording a synthetic edit.
    window.addEventListener("alice-project-file-open", handleEditorFileOpen);
    resetHistory();

    function syncSplitEditor() {
      if (!splitEditor) return;
      if (splitEditor.value !== editor.value) splitEditor.value = editor.value;
    }

    function updateEditorLayout() {
      const wrap = $(".editor-wrap");
      const minimap = $("#minimap");
      if (!wrap || !minimap) return;
      wrap.classList.toggle("ui-editor-split", splitActive);
      minimap.style.display = minimapVisible ? "" : "none";
      if (splitActive) wrap.style.gridTemplateColumns = minimapVisible
        ? "48px minmax(0,1fr) minmax(0,1fr) 66px"
        : "48px minmax(0,1fr) minmax(0,1fr)";
      else wrap.style.gridTemplateColumns = minimapVisible ? "48px minmax(0,1fr) 66px" : "48px minmax(0,1fr)";
      const splitButton = $('.editor-action[data-tooltip="拆分编辑器"]');
      splitButton?.setAttribute("aria-pressed", String(splitActive));
      if (splitButton) splitButton.title = splitActive ? "关闭拆分编辑器" : "拆分编辑器";
    }

    function toggleEditorSplit(force) {
      openWorkspaceTab("code");
      splitActive = typeof force === "boolean" ? force : !splitActive;
      if (!splitEditor) {
        splitEditor = document.createElement("textarea");
        splitEditor.id = "uiSplitEditor";
        splitEditor.spellcheck = false;
        splitEditor.setAttribute("aria-label", "拆分代码编辑器");
        $(".editor-wrap")?.appendChild(splitEditor);
        splitEditor.addEventListener("input", event => {
          editor.value = splitEditor.value;
          editor.setSelectionRange(splitEditor.selectionStart, splitEditor.selectionEnd);
          const inputType = event?.inputType || "insertText";
          let inputEvent;
          try {
            inputEvent = new InputEvent("input", { bubbles: true, inputType, data: event?.data ?? null });
          } catch (_) {
            inputEvent = new Event("input", { bubbles: true });
          }
          editor.dispatchEvent(inputEvent);
        });
        splitEditor.addEventListener("scroll", () => {
          if (Math.abs(editor.scrollTop - splitEditor.scrollTop) > 3) editor.scrollTop = splitEditor.scrollTop;
        });
      }
      syncSplitEditor();
      updateEditorLayout();
      if (splitActive) splitEditor.focus();
      toast(splitActive ? "编辑器已拆分，两个窗格同步编辑" : "编辑器拆分已关闭");
    }

    function tidyDocument() {
      const next = editor.value.split("\n").map(line => line.replace(/\t/g, "  ").replace(/[ \t]+$/g, "")).join("\n").replace(/\n*$/, "\n");
      if (next === editor.value) {
        toast("文档空白格式已经整洁");
        return;
      }
      editor.value = next;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatBackColor" }));
      syncSplitEditor();
      toast("已整理制表符、行尾空白和末尾换行");
    }

    function toggleMinimap() {
      minimapVisible = !minimapVisible;
      updateEditorLayout();
      toast(minimapVisible ? "代码小地图已显示" : "代码小地图已隐藏");
    }

    $('.editor-action[data-tooltip="拆分编辑器"]')?.addEventListener("click", () => toggleEditorSplit());
    $('.editor-action[data-tooltip="更多操作"]')?.addEventListener("click", event => {
      openMenu(event.currentTarget, [
        { icon: "⌁", label: "整理文档空白", action: tidyDocument },
        { icon: "⇄", label: splitActive ? "关闭拆分编辑器" : "拆分编辑器", action: () => toggleEditorSplit() },
        { icon: "▥", label: minimapVisible ? "隐藏代码小地图" : "显示代码小地图", action: toggleMinimap },
        { separator: true },
        { icon: "▣", label: "保存当前代码", shortcut: "Ctrl+S", action: saveCurrentCode },
        { icon: "▣", label: "导出 AliceSIM 工程", shortcut: "Ctrl+Shift+S", action: exportProject },
        { separator: true },
        { icon: "↺", label: "重置工作区布局", action: resetLayout }
      ], { align: "right" });
    });

    function restoreTab(name) {
      const tab = $(`.work-tab[data-tab="${name}"]`);
      if (!tab) return;
      tab.hidden = false;
      tab.style.display = "";
    }

    $(".workspace-tabs")?.addEventListener("click", event => {
      const close = event.target.closest(".work-tab small");
      if (!close) return;
      event.preventDefault();
      event.stopPropagation();
      const tab = close.closest(".work-tab");
      const name = tab.dataset.tab;
      const wasActive = tab.classList.contains("active");
      tab.hidden = true;
      tab.style.display = "none";
      tab.classList.remove("active");
      $(`.tab-view[data-view-tab="${name}"]`)?.classList.remove("active");
      if (name === "code" && splitActive) toggleEditorSplit(false);
      if (wasActive) {
        const next = $$(".work-tab").find(item => !item.hidden && item.style.display !== "none");
        next?.click();
      }
      toast(`${name === "code" ? currentFileName() : tab.textContent.replace("×", "").trim()} 已关闭，可从功能区重新打开`);
    });

    document.addEventListener("click", event => {
      const ribbonWorkspaceButton = event.target.closest("[data-ribbon-tab]");
      if (ribbonWorkspaceButton) restoreTab(ribbonWorkspaceButton.dataset.ribbonTab);
    }, true);

    function resetLayout() {
      document.body.classList.remove("hide-project-pane", "hide-simulator-pane", "hide-output-pane", "ui-editor-focus");
      $$('[data-pane-toggle]').forEach(input => { input.checked = true; });
      $("#bottomPanel")?.classList.remove("collapsed");
      focusMode = false;
      minimapVisible = true;
      if (splitActive) {
        splitActive = false;
        updateEditorLayout();
      } else updateEditorLayout();
      openWorkspaceTab("code");
      window.AliceWorkspacePages?.set?.("code");
      toast("工作区布局已恢复");
    }

    function toggleEditorFocus() {
      focusMode = !focusMode;
      document.body.classList.toggle("ui-editor-focus", focusMode);
      toast(focusMode ? "已进入专注编辑模式" : "已退出专注编辑模式");
    }

    function activateSidePanel(name) {
      document.body.classList.remove("hide-project-pane");
      const checkbox = $(`[data-pane-toggle="project"]`);
      if (checkbox) checkbox.checked = true;
      $(`.activity-item[data-view="${name}"]`)?.click();
    }

    function showSimulatorPane() {
      document.body.classList.remove("hide-simulator-pane");
      const checkbox = $('[data-pane-toggle="simulator"]');
      if (checkbox) checkbox.checked = true;
      window.AliceWorkspacePages?.set?.("simulation");
      toast("已切换到独立仿真页");
    }

    function addRibbonGroup(ribbon, key, caption, commands) {
      const group = document.createElement("div");
      group.className = "ribbon-group";
      group.dataset.uiActionGroup = key;
      const stack = document.createElement("div");
      stack.className = "ribbon-stack";
      commands.forEach(command => {
        const button = document.createElement("button");
        button.type = "button";
        if (command.id) button.id = command.id;
        if (command.title) button.title = command.title;
        const icon = document.createElement("span");
        icon.className = "ui-ribbon-glyph";
        icon.textContent = command.icon || "";
        button.append(icon, document.createTextNode(command.label));
        button.addEventListener("click", command.action);
        stack.appendChild(button);
      });
      const label = document.createElement("small");
      label.textContent = caption;
      group.append(stack, label);
      ribbon.appendChild(group);
      return group;
    }

    function setupRibbonTabs() {
      const ribbon = $(".ribbon");
      const tabButtons = $$(".ribbon-tabs button");
      if (!ribbon || !tabButtons.length) return;
      const componentLibrary = $(".component-library");
      if (componentLibrary && componentLibrary.parentElement !== ribbon) {
        componentLibrary.classList.add("ribbon-group", "ribbon-component-library");
        componentLibrary.dataset.uiOriginalGroup = "components";
        ribbon.appendChild(componentLibrary);
      }
      const originalGroups = $$(":scope > .ribbon-group", ribbon);
      originalGroups.forEach((group, index) => {
        const key = group.classList.contains("ribbon-component-library") ? "components"
          : group.querySelector("#ribbonImport") ? "project"
          : group.querySelector("#ribbonRun") ? "run"
          : group.querySelector('[data-ribbon-tab="pinout"]') ? "mcu"
          : group.querySelector("[data-pane-toggle]") ? "view"
          : `original-${index}`;
        group.dataset.uiOriginalGroup = key;
      });
      addRibbonGroup(ribbon, "file-project", "项目文件", [
        { icon: "＋", label: "新建项目", action: openNewProjectDialog },
        { icon: "▤", label: "打开工程文件夹", action: openProjectFolder },
        { icon: "◇", label: "打开 IOC / 工程包", action: openProjectPicker }
      ]);
      addRibbonGroup(ribbon, "project-drivers", "外设支持", [
        { icon: "▦", label: "添加 AliceSIM 驱动", action: openPeripheralDriverManager }
      ]);
      addRibbonGroup(ribbon, "component-import", "说明书与扩展", [
        {
          id: "datasheetImportButton",
          icon: "▤",
          label: "导入说明书",
          title: "从 PDF 数据手册生成可审查的器件草稿",
          action: () => window.AliceDatasheetImport?.open?.()
        }
      ]);
      addRibbonGroup(ribbon, "file-save", "保存与导出", [
        { icon: "▣", label: "保存当前代码", action: saveCurrentCode },
        { icon: "▣", label: "导出 AliceSIM 工程", action: exportProject }
      ]);
      addRibbonGroup(ribbon, "code-edit", "编辑", [
        { icon: "↶", label: "撤销", action: undoEditor },
        { icon: "↷", label: "重做", action: redoEditor }
      ]);
      addRibbonGroup(ribbon, "code-view", "编辑器视图", [
        { icon: "⇄", label: "拆分编辑器", action: () => toggleEditorSplit() },
        { icon: "⌁", label: "整理文档空白", action: tidyDocument }
      ]);
      addRibbonGroup(ribbon, "sim-view", "仿真视图", [
        { icon: "□", label: "适应原理图窗口", action: () => $("#fitSchematic")?.click() },
        { icon: "▣", label: "仿真页面全屏", action: toggleSimulatorFullscreen }
      ]);
      addRibbonGroup(ribbon, "sim-circuit", "电路文件", [
        { icon: "◇", label: "保存电路", action: saveCurrentCircuit },
        { icon: "▤", label: "打开电路", action: openCircuitPicker }
      ]);
      addRibbonGroup(ribbon, "layout", "窗口布局", [
        { icon: "◫", label: "专注编辑器", action: toggleEditorFocus },
        { icon: "↺", label: "重置布局", action: resetLayout }
      ]);
      const config = {
        "项目": { original: [], generated: ["file-project", "project-drivers", "file-save"], context: "工程与文件", action: () => activateSidePanel("project") },
        "MCU": { original: ["mcu"], generated: [], context: "器件与 IOC", action: () => { window.AliceWorkspacePages?.set?.("code"); openWorkspaceTab("pinout"); } },
        "元件": { original: ["components"], generated: ["component-import"], context: "原理图元件库与说明书导入", action: showSimulatorPane },
        "编辑": { original: [], generated: ["code-edit", "code-view"], context: "代码编辑工具", action: () => { window.AliceWorkspacePages?.set?.("code"); openWorkspaceTab("code"); } },
        "仿真": { original: ["run"], generated: ["sim-circuit", "sim-view"], context: "运行与电路", action: showSimulatorPane },
        "视图": { original: ["view"], generated: ["layout"], context: "工作区布局" }
      };

      function selectRibbon(button) {
        const label = button.textContent.trim();
        const selection = config[label] || config["项目"];
        tabButtons.forEach(item => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-selected", String(active));
          item.tabIndex = active ? 0 : -1;
        });
        originalGroups.forEach(group => {
          group.style.display = selection.original.includes(group.dataset.uiOriginalGroup) ? "" : "none";
        });
        $$('[data-ui-action-group]', ribbon).forEach(group => {
          group.style.display = selection.generated.includes(group.dataset.uiActionGroup) ? "flex" : "none";
        });
        ribbon.setAttribute("aria-label", `${label}功能区`);
        const contextLabel = $(".ribbon-context");
        if (contextLabel) contextLabel.textContent = selection.context || "AliceSIM 工具";
        selection.action?.();
      }

      tabButtons.forEach(button => button.addEventListener("click", () => selectRibbon(button)));
      const initial = tabButtons.find(button => button.classList.contains("active")) || tabButtons.find(button => button.textContent.trim() === "项目");
      if (initial) selectRibbon(initial);
    }

    setupRibbonTabs();

    function projectMenuItems() {
      return [
        { icon: "＋", label: "新建项目", action: openNewProjectDialog },
        { icon: "▤", label: "打开工程文件夹", action: openProjectFolder },
        { icon: "◇", label: "打开 IOC / 工程包", action: openProjectPicker },
        { icon: "▦", label: "添加 AliceSIM 外设驱动", action: openPeripheralDriverManager },
        { separator: true },
        { icon: "▣", label: "保存当前代码", shortcut: "Ctrl+S", action: saveCurrentCode },
        { icon: "◇", label: "保存电路", shortcut: "Ctrl+Alt+S", action: saveCurrentCircuit },
        { icon: "▤", label: "打开电路", shortcut: "Ctrl+Alt+O", action: openCircuitPicker },
        { icon: "▣", label: "导出工程包", shortcut: "Ctrl+Shift+S", action: exportProject },
        { separator: true },
        { icon: "◫", label: "显示项目资源", action: () => activateSidePanel("project") },
        { icon: "ⓘ", label: "项目与应用信息", action: openAbout }
      ];
    }

    $("#projectMenu")?.addEventListener("click", event => openMenu(event.currentTarget, projectMenuItems()));

    function openHelpCenter() {
      const content = document.createElement("div");
      content.innerHTML = `
        <div class="ui-help-grid">
          <div class="ui-help-card"><h3>1. 导入或创建</h3><p>选择完整 STM32 工程文件夹，Alice 会读取 Core、Drivers、CMSIS、源码、头文件和 IOC。</p></div>
          <div class="ui-help-card"><h3>2. 查看 IOC</h3><p>“MCU”功能区用于核对器件、引脚、时钟、外设和原始 IOC 参数。</p></div>
          <div class="ui-help-card"><h3>3. 构建与运行</h3><p>先构建工程，再启动 Alice Virtual MCU；输出、问题和串口位于底部窗格。</p></div>
          <div class="ui-help-card"><h3>4. 原理图</h3><p>右侧原理图工具由专用交互模块管理；“···”菜单提供视图和全屏操作。</p></div>
        </div>
        <div class="ui-shortcuts">
          <div>保存当前代码 <kbd>Ctrl+S</kbd></div>
          <div>保存电路文件 <kbd>Ctrl+Alt+S</kbd></div>
          <div>打开电路文件 <kbd>Ctrl+Alt+O</kbd></div>
          <div>导出完整工程 <kbd>Ctrl+Shift+S</kbd></div>
          <div>撤销 / 重做 <kbd>Ctrl+Z / Ctrl+Y</kbd></div>
          <div>全局搜索 <kbd>Ctrl+K</kbd></div>
          <div>构建 / 运行 <kbd>Ctrl+B / F5</kbd></div>
        </div>`;
      openActionModal({
        eyebrow: "HELP CENTER",
        title: "AliceSIM 使用指南",
        description: "从 IOC 到可运行虚拟固件的常用路径。",
        content,
        primaryLabel: "知道了",
        secondaryLabel: null
      });
    }

    function openAbout() {
      const project = collectProject();
      const content = document.createElement("div");
      content.className = "ui-action-note";
      content.textContent = `${project.project.name} · ${project.project.mcu}\nWeb-based STM32 workspace · 本地文件不会自动上传。`;
      content.style.whiteSpace = "pre-line";
      openActionModal({
        eyebrow: "ABOUT",
        title: "AliceSIM",
        description: "STM32 Web Simulator · UI Actions 1.0",
        content,
        primaryLabel: "关闭",
        secondaryLabel: null
      });
    }

    $('.activity-item[data-tooltip="帮助中心"]')?.addEventListener("click", openHelpCenter);

    function buildSearchItems() {
      const items = [];
      $$(".tree-row.file").forEach(button => items.push({
        label: button.dataset.file || button.textContent.trim(),
        kind: "文件",
        action: () => button.click()
      }));
      $$(".peripheral-list button").forEach(button => items.push({
        label: button.querySelector("span")?.textContent.trim() || button.textContent.trim(),
        kind: "外设",
        action: () => button.click()
      }));
      $$(".component-grid button").forEach(button => items.push({
        label: button.querySelector("strong")?.textContent.trim() || button.textContent.trim(),
        kind: "组件",
        action: () => {
          activateSidePanel("packages");
          button.focus();
        }
      }));
      [
        ["新建项目", openNewProjectDialog], ["打开 STM32 工程文件夹", openProjectFolder], ["打开 IOC 或工程包", openProjectPicker], ["保存当前代码", saveCurrentCode],
        ["保存电路", saveCurrentCircuit], ["打开电路", openCircuitPicker],
        ["添加 AliceSIM 外设驱动", openPeripheralDriverManager],
        ["导出工程", exportProject], ["重置工作区布局", resetLayout], ["帮助中心", openHelpCenter]
      ].forEach(([label, action]) => items.push({ label, kind: "命令", action }));
      return items;
    }

    function openGlobalSearch() {
      const form = document.createElement("form");
      form.className = "ui-action-form";
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = "搜索文件、外设、组件或命令";
      input.autocomplete = "off";
      input.autofocus = true;
      const results = document.createElement("div");
      results.className = "ui-search-results";
      form.append(input, results);
      const items = buildSearchItems();
      const render = () => {
        const term = input.value.trim().toLocaleLowerCase("zh-CN");
        const matches = items.filter(item => !term || `${item.label} ${item.kind}`.toLocaleLowerCase("zh-CN").includes(term)).slice(0, 12);
        results.replaceChildren();
        if (!matches.length) {
          const empty = document.createElement("div");
          empty.className = "ui-empty-result";
          empty.textContent = "没有匹配的文件或命令";
          results.appendChild(empty);
          return;
        }
        matches.forEach(item => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ui-search-result";
          const label = document.createElement("b");
          label.textContent = item.label;
          const kind = document.createElement("small");
          kind.textContent = item.kind;
          button.append(label, kind);
          button.addEventListener("click", () => {
            closeActionModal();
            item.action();
          });
          results.appendChild(button);
        });
      };
      input.addEventListener("input", render);
      form.addEventListener("submit", event => {
        event.preventDefault();
        results.querySelector("button")?.click();
      });
      render();
      openActionModal({
        eyebrow: "QUICK OPEN",
        title: "全局搜索",
        description: "输入名称并按 Enter 打开第一项。",
        content: form,
        primaryLabel: null,
        secondaryLabel: "关闭"
      });
    }

    $('.top-actions .icon-button[title="全局搜索"]')?.addEventListener("click", openGlobalSearch);

    function toggleSimulatorFullscreen() {
      const panel = $(".simulator-panel");
      if (!panel) return;
      if (document.fullscreenElement === panel) {
        document.exitFullscreen?.();
      } else if (document.fullscreenElement) {
        toast("请先退出当前全屏内容", "error");
      } else if (panel.requestFullscreen) {
        panel.requestFullscreen().catch(() => toast("当前浏览器不允许全屏显示", "error"));
      } else {
        toast("当前浏览器不支持面板全屏", "error");
      }
    }

    $("#simMore")?.addEventListener("click", event => {
      const viewport = $("#schematicViewport");
      const panelLayout = window.AlicePanelLayout;
      const currentLayout = panelLayout?.getMode?.() || "standard";
      openMenu(event.currentTarget, [
        { icon: "◇", label: "保存电路", shortcut: "Ctrl+Alt+S", action: saveCurrentCircuit },
        { icon: "▤", label: "打开电路", shortcut: "Ctrl+Alt+O", action: openCircuitPicker },
        { separator: true },
        { icon: "□", label: "适应窗口", action: () => $("#fitSchematic")?.click() },
        { icon: "#", label: viewport?.classList.contains("ui-grid-hidden") ? "显示画布网格" : "隐藏画布网格", action: () => {
          viewport?.classList.toggle("ui-grid-hidden");
          toast(viewport?.classList.contains("ui-grid-hidden") ? "原理图网格已隐藏" : "原理图网格已显示");
        } },
        { separator: true },
        { icon: currentLayout === "compact" ? "✓" : "▯", label: "紧凑布局", action: () => panelLayout?.setMode?.("compact") },
        { icon: currentLayout === "standard" ? "✓" : "▥", label: "标准布局", action: () => panelLayout?.setMode?.("standard") },
        { icon: currentLayout === "wide" ? "✓" : "▤", label: "宽屏布局", action: () => panelLayout?.setMode?.("wide") },
        { icon: currentLayout === "focus" ? "✓" : "□", label: "原理图专注模式", action: () => panelLayout?.toggleFocus?.() },
        { icon: "▣", label: document.fullscreenElement ? "退出全屏" : "仿真窗格全屏", action: toggleSimulatorFullscreen },
        { separator: true },
        { icon: "↺", label: "复位虚拟 MCU", action: () => $("#resetButton")?.click() },
        { icon: "＋", label: "管理元件库", action: openLibraryManager }
      ], { align: "right" });
    });

    function libraryEntries() {
      const entries = [];
      $$(".library-items [data-component-type]").forEach(button => entries.push({
        key: `schematic:${button.dataset.componentType}`,
        label: button.querySelector("b")?.textContent.trim() || button.dataset.componentType,
        group: "原理图基础元件",
        button
      }));
      $$(".component-grid button").forEach(button => {
        const label = button.querySelector("strong")?.textContent.trim() || button.textContent.trim();
        entries.push({ key: `catalog:${label.toLowerCase()}`, label, group: "虚拟器件目录", button });
      });
      return entries;
    }

    function applyLibraryPreferences() {
      const disabled = new Set(safeStorageGet(STORAGE_LIBRARY, []));
      const entries = libraryEntries();
      entries.forEach(entry => { entry.button.style.display = disabled.has(entry.key) ? "none" : ""; });
      return entries.filter(entry => !disabled.has(entry.key)).length;
    }

    function openLibraryManager() {
      const entries = libraryEntries();
      const disabled = new Set(safeStorageGet(STORAGE_LIBRARY, []));
      const content = document.createElement("div");
      content.className = "ui-action-form";
      const list = document.createElement("div");
      list.className = "ui-action-list";
      entries.forEach(entry => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !disabled.has(entry.key);
        checkbox.dataset.libraryKey = entry.key;
        const text = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = entry.label;
        const small = document.createElement("small");
        small.textContent = entry.group;
        text.append(strong, small);
        label.append(checkbox, text);
        list.appendChild(label);
      });
      const enableAll = document.createElement("button");
      enableAll.type = "button";
      enableAll.className = "ui-action-secondary";
      enableAll.textContent = "全部启用";
      enableAll.addEventListener("click", () => $$('input[type="checkbox"]', list).forEach(input => { input.checked = true; }));
      content.append(list, enableAll);
      openActionModal({
        eyebrow: "COMPONENT LIBRARY",
        title: "管理元件库",
        description: "选择要在目录中显示的内置元件；设置只保存在当前浏览器。",
        content,
        primaryLabel: "应用",
        onPrimary: () => {
          const nextDisabled = $$('input[type="checkbox"]', list).filter(input => !input.checked).map(input => input.dataset.libraryKey);
          safeStorageSet(STORAGE_LIBRARY, nextDisabled);
          const enabledCount = applyLibraryPreferences();
          toast(`元件库已更新 · ${enabledCount} 项可用`);
          return true;
        }
      });
    }

    $('.library-head button[title="管理元件库"]')?.addEventListener("click", openLibraryManager);
    $('.side-view[data-panel="packages"] .panel-title button')?.addEventListener("click", () => {
      const count = applyLibraryPreferences();
      toast(`组件索引已刷新 · ${count} 项可用`);
    });
    applyLibraryPreferences();

    const componentSearch = $('.side-view[data-panel="packages"] .component-search input');
    componentSearch?.addEventListener("input", () => {
      const term = componentSearch.value.trim().toLocaleLowerCase("zh-CN");
      $$(".component-grid button").forEach(button => {
        const enabledByPreference = !new Set(safeStorageGet(STORAGE_LIBRARY, [])).has(`catalog:${button.querySelector("strong")?.textContent.trim().toLowerCase()}`);
        button.style.display = enabledByPreference && (!term || button.textContent.toLocaleLowerCase("zh-CN").includes(term)) ? "" : "none";
      });
    });

    $$(".component-grid button").forEach(button => button.addEventListener("click", () => {
      const name = button.querySelector("strong")?.textContent.trim() || "组件";
      showSimulatorPane();
      const typeMap = { LED: "led", Button: "button" };
      const target = $(`.library-items [data-component-type="${typeMap[name] || ""}"]`);
      if (target) {
        target.focus();
        toast(`${name} 已在右侧原理图库中定位`);
      } else {
        toast(`${name} 属于扩展器件，可在元件库管理器中查看`);
      }
    }));

    function openNewFileDialog() {
      const form = document.createElement("form");
      form.className = "ui-action-form";
      const label = document.createElement("label");
      label.textContent = "文件名";
      const input = document.createElement("input");
      input.type = "text";
      input.value = "untitled.c";
      input.autofocus = true;
      label.appendChild(input);
      const note = document.createElement("div");
      note.className = "ui-action-note";
      note.textContent = "支持创建 .c 或 .h 文本文件；新文件会加入 Core/Src 列表。";
      form.append(label, note);
      openActionModal({
        eyebrow: "NEW FILE",
        title: "新建源文件",
        content: form,
        primaryLabel: "创建",
        onPrimary: () => {
          let fileName = safeName(input.value, "");
          if (!input.value.trim()) {
            toast("请输入文件名", "error");
            input.focus();
            return false;
          }
          if (!/\.(?:c|h)$/i.test(fileName)) fileName += ".c";
          if ($(`.tree-row.file[data-file="${CSS.escape(fileName)}"]`) || customFiles.has(fileName)) {
            toast("同名文件已经存在", "error");
            return false;
          }
          const value = /\.h$/i.test(fileName) ? `#pragma once\n` : `#include "main.h"\n\n`;
          customFiles.set(fileName, value);
          const row = document.createElement("button");
          row.className = "tree-row file";
          row.dataset.file = fileName;
          row.dataset.uiCustomFile = "true";
          const type = document.createElement("span");
          type.className = "file-type c";
          type.textContent = /\.h$/i.test(fileName) ? "H" : "C";
          row.append(type, document.createTextNode(fileName));
          $(".tree-children.nested.files")?.appendChild(row);
          row.click();
          toast(`${fileName} 已创建`);
          return true;
        }
      });
    }

    $('.side-view[data-panel="project"] .panel-title button')?.addEventListener("click", openNewFileDialog);

    $("#fileTree")?.addEventListener("click", event => {
      const row = event.target.closest(".tree-row");
      if (!row) return;
      if (row.dataset.uiCustomFile) {
        event.preventDefault();
        $$(".tree-row.file").forEach(item => item.classList.toggle("selected", item === row));
        const fileName = row.dataset.file;
        try {
          if (typeof state !== "undefined") state.currentFile = fileName;
        } catch (_) {
          // Optional integration with app.js state.
        }
        replaceEditorValue(customFiles.get(fileName) || "", fileName);
        openWorkspaceTab("code");
        return;
      }
      if (row.classList.contains("file")) return;
      const children = row.nextElementSibling?.classList.contains("tree-children") ? row.nextElementSibling : null;
      if (!children) {
        toast(`${row.textContent.trim()} 文件夹为空`);
        return;
      }
      children.hidden = !children.hidden;
      row.classList.toggle("open", !children.hidden);
      const icon = row.querySelector("svg");
      if (icon) icon.style.transform = children.hidden ? "rotate(-90deg)" : "";
    });

    $("#fileTree")?.addEventListener("click", event => {
      const row = event.target.closest(".tree-row.file");
      if (!row || row.dataset.uiCustomFile) return;
      const before = editor.value;
      setTimeout(() => {
        if (editor.value !== before) {
          syncSplitEditor();
          resetHistory();
        }
      });
    }, true);

    function setupOutlineSections() {
      $$(".outline-section > button").forEach(button => button.addEventListener("click", () => {
        let content = button.nextElementSibling;
        if (!content || !content.classList.contains("ui-outline-content")) {
          content = document.createElement("div");
          content.className = "ui-outline-content";
          if (button.textContent.includes("OUTLINE")) {
            ["main()", "SystemClock_Config()", "MX_GPIO_Init()"].forEach(symbol => {
              const item = document.createElement("button");
              item.type = "button";
              item.textContent = symbol;
              item.addEventListener("click", () => {
                openWorkspaceTab("code");
                const index = editor.value.indexOf(symbol.replace("()", ""));
                if (index >= 0) editor.setSelectionRange(index, index);
                editor.focus();
              });
              content.appendChild(item);
            });
          } else {
            content.textContent = "STM32F1xx HAL\nCMSIS Core\nAlice Virtual MCU Runtime";
            content.style.whiteSpace = "pre-line";
          }
          button.after(content);
        } else {
          content.hidden = !content.hidden;
        }
      }));
    }
    setupOutlineSections();

    const peripheralButtons = $$(".peripheral-list button");
    peripheralButtons.forEach(button => button.addEventListener("click", () => {
      const name = button.querySelector("span")?.textContent.trim();
      if (name === "RCC") openWorkspaceTab("clock");
      else if (name === "USART1") $("[data-bottom=serial]")?.click();
      else openWorkspaceTab("pinout");
      toast(`${name} 配置视图已打开`);
    }));

    $('.side-view[data-panel="device"] .panel-title button')?.addEventListener("click", event => openMenu(event.currentTarget, [
      { icon: "◫", label: "打开引脚配置", action: () => openWorkspaceTab("pinout") },
      { icon: "◷", label: "打开时钟树", action: () => openWorkspaceTab("clock") },
      { icon: "▣", label: "复制 MCU 型号", action: async () => {
        const value = $(".chip-badge")?.textContent.trim() || "STM32F103C8T6";
        try { await navigator.clipboard.writeText(value); toast(`已复制 ${value}`); }
        catch (_) { toast(value); }
      } }
    ], { align: "right" }));

    $('.side-view[data-panel="debug"] .panel-title button')?.addEventListener("click", event => openMenu(event.currentTarget, [
      { icon: "⌁", label: "构建工程", shortcut: "Ctrl+B", action: () => $("#buildButton")?.click() },
      { icon: "▶", label: $("#runButton.running") ? "停止仿真" : "启动调试", shortcut: "F5", action: () => $("#runButton")?.click() },
      { icon: "↺", label: "复位 MCU", action: () => $("#resetButton")?.click() },
      { separator: true },
      { icon: "×", label: "禁用全部断点", action: () => {
        $$('.side-view[data-panel="debug"] .debug-block input[type="checkbox"]').forEach(input => { input.checked = false; });
        toast("全部断点已禁用");
      } }
    ], { align: "right" }));

    $('.side-view[data-panel="analyzer"] .panel-title button')?.addEventListener("click", () => {
      const next = $$('.side-view[data-panel="analyzer"] .channel-checks input').find(input => !input.checked);
      if (next) {
        next.checked = true;
        toast("已启用一个逻辑分析通道");
      } else toast("所有可用分析通道均已启用");
    });

    document.addEventListener("pointerdown", event => {
      if (activeMenu && !activeMenu.contains(event.target) && !event.target.closest("#projectMenu,#simMore,.editor-action,.panel-title button")) closeMenu();
    });
    window.addEventListener("resize", closeMenu);
    window.addEventListener("blur", closeMenu);

    window.addEventListener("keydown", event => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.repeat && modifier && (key === "s" || (event.altKey && key === "o"))) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        if (activeMenu) {
          event.preventDefault();
          closeMenu();
        } else if (actionModal?.classList.contains("open")) {
          event.preventDefault();
          closeActionModal();
        }
        return;
      }
      if (modifier && key === "k") {
        event.preventDefault();
        event.stopPropagation();
        openGlobalSearch();
        return;
      }
      if (modifier && event.altKey && key === "s") {
        event.preventDefault();
        event.stopPropagation();
        saveCurrentCircuit();
        return;
      }
      if (modifier && event.altKey && key === "o") {
        event.preventDefault();
        event.stopPropagation();
        openCircuitPicker();
        return;
      }
      if (modifier && key === "s") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) exportProject();
        else saveCurrentCode();
        return;
      }
      const editorFocused = document.activeElement === editor || document.activeElement === splitEditor;
      if (!editorFocused || !modifier) return;
      if (key === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redoEditor();
        else undoEditor();
      } else if (key === "y") {
        event.preventDefault();
        event.stopPropagation();
        redoEditor();
      }
    }, true);

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUiActions, { once: true });
  } else {
    initUiActions();
  }
})();
