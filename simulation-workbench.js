(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) {
    root.AliceSimulationWorkbench = api;
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", api.mount, { once: true });
    else api.mount();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const STORAGE_KEY = "alice.simulation-workbench.v1";
  const TOOLS = ["build", "serial", "logic", "envelope"];
  const LABELS = ["编译日志", "串口", "逻辑分析", "传感器包络"];

  function normalizeState(value = {}) {
    value = value && typeof value === "object" ? value : {};
    const height = Number(value.height);
    return {
      active: TOOLS.includes(value.active) ? value.active : "build",
      collapsed: typeof value.collapsed === "boolean" ? value.collapsed : true,
      compare: value.compare === true,
      height: Number.isFinite(height) && height > 0 ? Math.max(160, Math.min(640, Math.round(height))) : 280
    };
  }

  function reduceState(current, action) {
    const next = normalizeState(current);
    if (action.type === "select" && TOOLS.includes(action.tool)) {
      next.active = action.tool;
      next.collapsed = false;
    } else if (action.type === "collapse") next.collapsed = action.value !== false;
    else if (action.type === "compare") next.compare = action.value === true;
    else if (action.type === "height") return normalizeState({ ...next, height: action.value });
    return next;
  }

  function readState() {
    try { return normalizeState(JSON.parse(root.localStorage.getItem(STORAGE_KEY))); }
    catch (_) { return normalizeState(); }
  }

  let state = readState();
  let nodes = null;
  let errorSeen = false;
  let drag = null;

  function persist() {
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function signalGeometry() {
    root.requestAnimationFrame(() => root.dispatchEvent(new Event("resize")));
  }

  function updateHeight() {
    if (!nodes) return;
    const fixed = nodes.controls.offsetHeight + nodes.nav.offsetHeight + 8
      + nodes.panel.querySelector(".schematic-head").offsetHeight
      + nodes.panel.querySelector(".schematic-toolbar").offsetHeight;
    const available = nodes.panel.clientHeight || root.innerHeight;
    const maximum = Math.max(120, Math.min(640, available - fixed - 180));
    const requested = state.compare && ["logic", "envelope"].includes(state.active) ? Math.max(400, state.height) : state.height;
    const height = Math.min(requested, maximum);
    nodes.dock.style.setProperty("--sim-tool-height", height + "px");
    nodes.resizer.setAttribute("aria-valuemin", "120");
    nodes.resizer.setAttribute("aria-valuemax", String(Math.round(maximum)));
    nodes.resizer.setAttribute("aria-valuenow", String(Math.round(height)));
  }

  function applyView() {
    if (!nodes) return;
    const comparing = state.compare && ["logic", "envelope"].includes(state.active);
    const visible = tool => !state.collapsed && (tool === state.active || (comparing && ["logic", "envelope"].includes(tool)));
    nodes.dock.classList.toggle("collapsed", state.collapsed);
    nodes.dock.classList.toggle("comparing", comparing);
    nodes.collapse.setAttribute("aria-expanded", String(!state.collapsed));
    nodes.collapse.textContent = state.collapsed ? "展开工具" : "收起工具";
    nodes.collapse.title = state.collapsed ? "展开所选调试工具" : "收起工具区，扩大电路画布";
    nodes.compare.hidden = !["logic", "envelope"].includes(state.active);
    nodes.compare.setAttribute("aria-pressed", String(state.compare));
    nodes.content.hidden = state.collapsed;
    nodes.runtime.hidden = !visible("serial");
    nodes.observer.hidden = !visible("logic") && !visible("envelope");
    TOOLS.forEach((tool, index) => {
      nodes.panes[tool].hidden = !visible(tool);
      nodes.tabs[index].setAttribute("aria-selected", String(state.active === tool));
      nodes.tabs[index].tabIndex = state.active === tool ? 0 : -1;
      if (!visible(tool) || !nodes.panes[tool].classList.contains("collapsed")) return;
      const toggles = { build: "buildPaneToggle", serial: "serialPaneToggle" };
      if (toggles[tool]) root.document.getElementById(toggles[tool])?.click();
      else root.AliceObserverLayout?.setState?.({ [tool === "logic" ? "logicCollapsed" : "envelopeCollapsed"]: false });
    });
    const envelope = nodes.panes.envelope;
    if (visible("envelope") && !envelope.classList.contains("open")) root.AliceEnvelopeAutomation?.open({ fromWorkbench: true, focus: false });
    if (!visible("envelope") && envelope.classList.contains("open")) root.AliceEnvelopeAutomation?.close({ fromWorkbench: true, focus: false });
    if (visible("build")) nodes.tabs[0].classList.remove("has-error");
    updateHeight();
    signalGeometry();
  }

  function dispatch(action, options = {}) {
    state = reduceState(state, action);
    if (options.save !== false) persist();
    applyView();
    return true;
  }

  function mount() {
    const document = root?.document;
    if (nodes || !document) return false;
    const panel = document.querySelector(".simulator-panel");
    const runtime = document.getElementById("simulationRuntimeDock");
    const observer = document.querySelector(".simulation-time-observer");
    const controls = observer?.querySelector(".schematic-console");
    const panes = {
      build: document.getElementById("simulationBuildMonitor"),
      serial: document.getElementById("simulationSerialMonitor"),
      logic: observer?.querySelector(".schematic-timeline"),
      envelope: document.getElementById("envelopeDockHost")
    };
    if (!panel || !runtime || !controls || Object.values(panes).some(pane => !pane)) return false;
    const create = (tag, className, text) => {
      const element = document.createElement(tag);
      element.className = className;
      if (text != null) element.textContent = text;
      if (tag === "button") element.type = "button";
      return element;
    };

    // Move live controls, never clone them: IDs, listeners and runtime state
    // keep their existing owners, including the UART form and envelope SVG.
    const transport = create("div", "sim-transport");
    const run = create("button", "sim-run-button", "▶ 运行");
    run.id = "simulationRunAction";
    const build = create("button", "sim-build-button", "构建");
    build.id = "simulationBuildAction";
    const reset = create("button", "sim-reset-button", "复位");
    reset.title = "复位 MCU";
    run.addEventListener("click", () => document.getElementById("ribbonRun").click());
    build.addEventListener("click", () => document.getElementById("ribbonBuild").click());
    reset.addEventListener("click", () => document.getElementById("ribbonReset").click());
    transport.append(run, build, reset);
    const status = create("div", "sim-compact-status");
    const mcuState = document.getElementById("mcuState");
    mcuState.title = "固件运行状态";
    status.append(controls.querySelector(".tick-controls > i"), mcuState, document.getElementById("circuitTime"));
    const speed = document.getElementById("simulationSpeedSelect").closest("label");
    speed.classList.add("sim-speed-control");
    const settings = create("details", "sim-settings");
    const summary = create("summary", "", "仿真设置");
    const popover = create("div", "sim-settings-popover");
    popover.append(
      document.getElementById("simulationTimeMode").closest("label"),
      document.getElementById("tickSizeSelect").closest("label"),
      document.getElementById("powerCalculationToggle").closest("label"),
      controls.querySelector(".tick-readout"),
      document.getElementById("simHint")
    );
    settings.append(summary, popover);
    settings.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !settings.open) return;
      settings.open = false;
      summary.focus();
      event.stopPropagation();
    });
    document.addEventListener("pointerdown", event => {
      if (settings.open && !settings.contains(event.target)) settings.open = false;
    });
    controls.replaceChildren(transport, status, speed, settings);
    controls.classList.add("sim-controlbar");
    panel.insertBefore(controls, runtime);

    const dock = create("section", "sim-tool-dock");
    dock.setAttribute("aria-label", "仿真调试工具区");
    const resizer = create("div", "sim-tools-resizer");
    resizer.tabIndex = 0;
    resizer.setAttribute("role", "separator");
    resizer.setAttribute("aria-orientation", "horizontal");
    resizer.setAttribute("aria-label", "调整调试工具区高度");
    resizer.title = "拖动调整工具区高度，双击恢复默认";
    const nav = create("div", "sim-tools-nav");
    const tablist = create("div", "sim-tool-tabs");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "仿真调试工具");
    const tabs = TOOLS.map((tool, index) => {
      const tab = create("button", "sim-tool-tab", LABELS[index]);
      tab.id = "simToolTab-" + tool;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panes[tool].id || (panes[tool].id = "simToolPanel-" + tool));
      panes[tool].classList.add("sim-tool-pane");
      panes[tool].setAttribute("role", "tabpanel");
      panes[tool].setAttribute("aria-labelledby", tab.id);
      tab.addEventListener("click", () => dispatch({ type: "select", tool }));
      tab.addEventListener("keydown", event => {
        let target;
        if (event.key === "ArrowRight") target = (index + 1) % TOOLS.length;
        if (event.key === "ArrowLeft") target = (index + TOOLS.length - 1) % TOOLS.length;
        if (event.key === "Home") target = 0;
        if (event.key === "End") target = TOOLS.length - 1;
        if (target == null) return;
        event.preventDefault();
        dispatch({ type: "select", tool: TOOLS[target] });
        tabs[target].focus();
        tabs[target].scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      tablist.appendChild(tab);
      return tab;
    });
    const compare = create("button", "sim-tools-compare", "并排对照");
    compare.title = "同时查看逻辑分析与传感器包络";
    compare.addEventListener("click", () => dispatch({ type: "compare", value: !state.compare }));
    const collapse = create("button", "sim-tools-collapse");
    collapse.setAttribute("aria-controls", "simulationToolContent");
    collapse.addEventListener("click", () => dispatch({ type: "collapse", value: !state.collapsed }));
    const content = create("div", "sim-tool-content");
    content.id = "simulationToolContent";
    nav.append(tablist, compare, collapse);
    dock.append(resizer, nav, content);
    panel.insertBefore(dock, runtime);
    content.append(runtime, panes.build, observer);
    nodes = { panel, controls, dock, nav, tabs, resizer, compare, collapse, content, runtime, observer, panes };
    document.body.classList.add("sim-workbench-ready");

    const syncRunState = () => {
      const running = document.getElementById("ribbonRun").classList.contains("running");
      const busy = document.getElementById("buildButton").classList.contains("busy");
      run.textContent = running ? "■ 停止" : busy ? "构建中…" : "▶ 运行";
      run.classList.toggle("running", running);
      run.disabled = busy && !running;
      build.disabled = busy;
      reset.disabled = busy;
      build.textContent = busy ? "构建中…" : "构建";
    };
    const observerState = new root.MutationObserver(syncRunState);
    observerState.observe(document.getElementById("ribbonRun"), { attributes: true, attributeFilter: ["class"] });
    observerState.observe(document.getElementById("buildButton"), { attributes: true, attributeFilter: ["class"] });
    syncRunState();

    resizer.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const scale = panel.getBoundingClientRect().height / panel.clientHeight || 1;
      drag = { pointerId: event.pointerId, y: event.clientY, height: content.clientHeight, scale };
      resizer.setPointerCapture(event.pointerId);
    });
    resizer.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      state = reduceState(state, { type: "height", value: drag.height + (drag.y - event.clientY) / drag.scale });
      updateHeight();
    });
    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
      persist();
      signalGeometry();
    };
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => resizer.addEventListener(type, finishDrag));
    resizer.addEventListener("dblclick", () => dispatch({ type: "height", value: 280 }));
    resizer.addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const height = event.key === "Home" ? 160 : event.key === "End" ? 640 : content.clientHeight + (event.key === "ArrowUp" ? 20 : -20);
      dispatch({ type: "height", value: height });
    });
    document.addEventListener("alice:build-message", event => {
      const detail = event.detail || {};
      if (detail.severity === "command" && String(detail.text).startsWith("alice hal-build ")) {
        errorSeen = false;
        tabs[0].classList.remove("has-error");
      }
      if (detail.severity !== "error") return;
      tabs[0].classList.add("has-error");
      if (!errorSeen && document.body.classList.contains("app-page-simulation")) dispatch({ type: "select", tool: "build" }, { save: false });
      errorSeen = true;
    });
    root.addEventListener("resize", updateHeight);
    document.addEventListener("alice:workspace-page-change", updateHeight);
    if (root.ResizeObserver) new root.ResizeObserver(updateHeight).observe(panel);
    applyView();
    return true;
  }

  return Object.freeze({
    mount, normalizeState, reduceState,
    select: tool => dispatch({ type: "select", tool }),
    collapse: () => dispatch({ type: "collapse", value: true }),
    getState: () => ({ ...state }),
    setState: value => { state = normalizeState(value); persist(); applyView(); return true; }
  });
}));
