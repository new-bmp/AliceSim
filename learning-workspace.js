(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AliceLearningWorkspace = api.create(root);
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const UI_TARGETS = [
    { id: "ui:circuit", kind: "ui", label: "电路画布", selector: "#schematicViewport" },
    { id: "ui:serial", kind: "ui", label: "虚拟串口", selector: "#simulationSerialMonitor", tool: "serial" },
    { id: "ui:build", kind: "ui", label: "构建与运行输出", selector: "#simulationBuildMonitor", tool: "build" },
    { id: "ui:logic", kind: "ui", label: "逻辑分析仪", selector: "#logicCanvas", tool: "logic" },
    { id: "ui:envelope", kind: "ui", label: "输入包络", selector: ".envelope-dock", tool: "envelope" }
  ];
  function clipRect(rect, clip) {
    if (!rect || !clip) return null;
    const left = Math.max(rect.left, clip.left), top = Math.max(rect.top, clip.top);
    const right = Math.min(rect.left + rect.width, clip.left + clip.width), bottom = Math.min(rect.top + rect.height, clip.top + clip.height);
    return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
  }
  function create(root) {
    const core = root.AliceLearningCore;
    const doc = root.document;
    const serial = [], messages = [], observations = [];
    doc?.addEventListener("alice:firmware-uart-tx", event => { serial.push(event.detail || {}); if (serial.length > 30) serial.shift(); });
    doc?.addEventListener("alice:build-message", event => { messages.push(event.detail || {}); if (messages.length > 30) messages.shift(); });
    for (const type of ["adc-read", "pwm", "dma-callback", "interrupt-callback", "peripheral"]) {
      doc?.addEventListener("alice:firmware-" + type, event => { observations.push({ type, data: event.detail }); if (observations.length > 20) observations.shift(); });
    }
    const clear = () => { serial.length = 0; messages.length = 0; observations.length = 0; };
    root.addEventListener?.("alice-project-opened", clear);
    doc?.addEventListener("alice:firmware-built", clear);
    doc?.addEventListener("alice:firmware-state", event => { if (event.detail?.status === "idle" && Number(event.detail?.timeMs) === 0) clear(); });
    function capture() {
      const workspace = root.AliceProjectWorkspace?.getState?.() || {};
      const files = workspace.files ? [...workspace.files.entries()].map(([path, record]) => ({ path, content: record.content })) : [];
      const activeFile = root.AliceEditorHost?.getCurrentFile?.() || {};
      const ioc = root.AliceIocViewer?.getRaw?.();
      if (ioc && !files.some(f => /\.ioc$/i.test(f.path))) files.push({ path: workspace.iocPath || "Imported.ioc", content: ioc });
      const editor = doc?.getElementById("codeEditor");
      const selection = editor && editor.selectionEnd > editor.selectionStart ? {
        path: activeFile.path, startLine: editor.value.slice(0, editor.selectionStart).split("\n").length,
        endLine: editor.value.slice(0, editor.selectionEnd).split("\n").length
      } : null;
      const evidence = root.AliceLearningEvidence?.getSnapshot?.() || {};
      const circuit = root.AliceSchematic?.getLearningSnapshot?.() || {};
      return core.buildContext({ project: { name: workspace.rootName || doc?.getElementById("projectMenu")?.textContent?.replace("●", "").trim() }, files, activeFile, selection,
        circuit, runtime: evidence.runtime,
        diagnostics: (evidence.diagnostics || []).concat(messages.filter(m => ["error", "warn"].includes(m.severity))),
        serial, observations, measurements: circuit.measurements || {}, controls: root.AliceSchematic?.getAutomationTargets?.() || [],
        peripherals: root.AliceHalSimulator?.getSummary?.() || {}, trace: root.AliceHalSimulator?.getTrace?.() || {}, uiTargets: UI_TARGETS });
    }
    const find = (selector, key, value) => [...(doc?.querySelectorAll(selector) || [])].find(el => el.dataset[key] === value);
    function targetElement(target) {
      if (!target) return null;
      if (target.kind === "component") return find(".schematic-component", "componentId", target.componentId);
      if (target.kind === "pin") return [...(doc?.querySelectorAll(".component-pin") || [])].find(el => el.dataset.componentId === target.componentId && el.dataset.pin === target.pin);
      if (target.kind === "wire") return find(".schematic-wire", "wireId", target.wireId);
      if (target.kind === "code") return doc?.getElementById("codeEditor");
      if (target.kind === "trace") return doc?.getElementById("logicCanvas");
      if (target.kind === "ui") { const descriptor = UI_TARGETS.find(t => t.id === target.id); return descriptor ? doc?.querySelector(descriptor.selector) : null; }
      return null;
    }
    function rectFor(target, annotation = {}) {
      const element = targetElement(target);
      if (!element?.getClientRects?.().length) return null;
      let rect = element.getBoundingClientRect();
      if (target.kind === "code") {
        if (root.AliceEditorHost?.getCurrentFile?.().path !== target.path) return null;
        const style = root.getComputedStyle(element);
        const scale = rect.height / element.offsetHeight || 1;
        const lineHeight = parseFloat(style.lineHeight) || 20;
        const top = rect.top + (parseFloat(style.paddingTop) + ((annotation.startLine || 1) - 1) * lineHeight - element.scrollTop) * scale;
        rect = clipRect({ left: rect.left, top, width: rect.width, height: ((annotation.endLine || annotation.startLine || 1) - (annotation.startLine || 1) + 1) * lineHeight * scale }, rect);
      } else if (target.kind === "trace") {
        const pins = root.AliceHalSimulator?.getSummary?.().tracePins || [];
        const lane = pins.indexOf(target.pin);
        if (lane < 0) return null;
        rect = { left: rect.left, top: rect.top + rect.height * lane / pins.length, width: rect.width, height: rect.height / pins.length };
      } else if (["component", "pin", "wire"].includes(target.kind)) {
        if (target.kind === "wire") rect = { left: rect.left - 3, top: rect.top - 3, width: Math.max(6, rect.width + 6), height: Math.max(6, rect.height + 6) };
        rect = clipRect(rect, doc.getElementById("schematicViewport")?.getBoundingClientRect());
      }
      return clipRect(rect, { left: 0, top: 0, width: root.innerWidth, height: root.innerHeight });
    }
    function focus(target, annotation = {}) {
      if (!target) return false;
      if (target.kind === "code") {
        if (root.AliceEditorHost?.getCurrentFile?.().path !== target.path) root.AliceProjectWorkspace?.openFile?.(target.path);
        root.AliceWorkspacePages?.set?.("code");
        root.AliceEditorHost?.openTab?.("code");
        const editor = doc?.getElementById("codeEditor");
        if (!editor || root.AliceEditorHost?.getCurrentFile?.().path !== target.path) return false;
        const lines = editor.value.split("\n");
        const start = lines.slice(0, (annotation.startLine || 1) - 1).reduce((sum, line) => sum + line.length + 1, 0);
        const end = lines.slice(0, annotation.endLine || annotation.startLine || 1).reduce((sum, line) => sum + line.length + 1, 0) - 1;
        editor.focus(); editor.setSelectionRange(start, Math.max(start, end));
        editor.scrollTop = Math.max(0, ((annotation.startLine || 1) - 3) * (parseFloat(root.getComputedStyle(editor).lineHeight) || 20));
        editor.dispatchEvent(new root.Event("scroll"));
      } else {
        root.AliceWorkspacePages?.set?.("simulation");
        if (["component", "pin", "wire"].includes(target.kind)) {
          if (!rectFor(target)) root.AliceSchematic?.fit?.();
        } else {
          const tool = target.kind === "trace" ? "logic" : UI_TARGETS.find(t => t.id === target.id)?.tool;
          if (tool) root.AliceSimulationWorkbench?.select?.(tool);
        }
      }
      return true;
    }
    return Object.freeze({ capture, rectFor, focus, clear, clearObservations: () => { serial.length = 0; observations.length = 0; }, targets: UI_TARGETS.map(({ id, kind, label }) => ({ id, kind, label })) });
  }
  return Object.freeze({ create, clipRect });
}));
