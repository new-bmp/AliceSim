(function () {
  "use strict";

  var STORAGE_KEY = "alice.simulator-panel.layout.v3";
  var TIME_OBSERVER_HEIGHT_KEY = "alice.time-observer.height.v1";
  var LOGIC_ANALYZER_COLLAPSED_KEY = "alice.logic-analyzer.collapsed.v1";
  var ENVELOPE_PANE_COLLAPSED_KEY = "alice.envelope.collapsed.v1";
  var RIBBON_COLLAPSED_KEY = "alice.ribbon.collapsed.v1";
  var SIDEBAR_WIDTH_KEY = "alice.sidebar.width.v1";
  var SIDEBAR_MIN_WIDTH = 180;
  var SIDEBAR_MAX_WIDTH = 520;
  var SIDEBAR_DEFAULT_WIDTH = 238;
  var MIN_WIDTH = 320;
  var MAX_WIDTH = 800;
  var DEFAULT_WIDTHS = {
    compact: 360,
    standard: 480,
    wide: 680
  };
  var VALID_MODES = ["compact", "standard", "wide", "focus"];

  var body = document.body;
  var shell = document.querySelector(".app-shell");
  var sidebar = document.querySelector(".sidebar");
  var workspace = document.querySelector(".workspace");
  var panel = document.querySelector(".simulator-panel");
  if (!body || !shell || !sidebar || !workspace || !panel) return;

  function numberInRange(value, fallback, min, max) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  function safeRead() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function safeWrite(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (_error) {
      // Layout remains usable when storage is unavailable.
    }
  }

  var saved = safeRead() || {};
  var savedWidths = saved.widths && typeof saved.widths === "object" ? saved.widths : {};
  var state = {
    mode: VALID_MODES.indexOf(saved.mode) >= 0 ? saved.mode : "standard",
    previousMode: ["compact", "standard", "wide"].indexOf(saved.previousMode) >= 0
      ? saved.previousMode
      : "standard",
    widths: {
      compact: numberInRange(savedWidths.compact, DEFAULT_WIDTHS.compact, MIN_WIDTH, 439),
      standard: numberInRange(savedWidths.standard, DEFAULT_WIDTHS.standard, 400, 619),
      wide: numberInRange(savedWidths.wide, DEFAULT_WIDTHS.wide, 560, MAX_WIDTH)
    },
    customized: Object.assign({ compact: false, standard: false, wide: false }, saved.customized || {}),
    effectiveWidth: DEFAULT_WIDTHS.standard
  };
  if (state.mode !== "focus") state.previousMode = state.mode;

  var style = document.createElement("style");
  style.id = "alice-panel-layout-styles";
  style.textContent = [
    "body.alice-panel-layout-active{--sim:var(--alice-sim-width,520px)!important}",
    "body.alice-panel-layout-active.hide-simulator-pane,body.alice-panel-layout-active.ui-editor-focus,body.alice-panel-focus{--sim:0px!important}",
    "body.alice-panel-layout-active:not(.app-page-code):not(.app-page-simulation):not(.hide-simulator-pane):not(.ui-editor-focus):not(.alice-panel-focus) .app-shell{grid-template-columns:var(--activity) var(--side) minmax(360px,1fr) var(--sim)!important}",
    "body.alice-panel-layout-active:not(.app-page-code):not(.app-page-simulation):not(.hide-simulator-pane):not(.ui-editor-focus) .simulator-panel{display:flex!important;grid-column:4;grid-row:2}",
    ".alice-panel-resizer{position:absolute;z-index:29;top:var(--top);right:calc(var(--sim) - 4px);bottom:var(--status);width:8px;cursor:col-resize;touch-action:none;user-select:none;outline:none}",
    ".alice-panel-resizer::before{content:\"\";position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background .12s,box-shadow .12s}",
    ".alice-panel-resizer:hover::before,.alice-panel-resizer:focus-visible::before,body.alice-panel-resizing .alice-panel-resizer::before{background:#0f6cbd;box-shadow:0 0 0 1px rgba(15,108,189,.12)}",
    ".alice-panel-resizer::after{content:attr(data-size);position:absolute;top:10px;right:11px;min-width:48px;padding:4px 7px;border:1px solid #a8a8a8;background:#fff;color:#242424;box-shadow:0 2px 8px rgba(0,0,0,.16);font:10px Consolas,monospace;text-align:center;opacity:0;pointer-events:none;transform:translateX(3px);transition:opacity .12s,transform .12s}",
    "body.alice-panel-resizing .alice-panel-resizer::after{opacity:1;transform:none}",
    "body.alice-panel-resizing,body.alice-panel-resizing *{cursor:col-resize!important;user-select:none!important}",
    "body.hide-simulator-pane .alice-panel-resizer,body.ui-editor-focus .alice-panel-resizer,body.alice-panel-focus .alice-panel-resizer,body.alice-panel-native-fullscreen .alice-panel-resizer,body.app-page-code .alice-panel-resizer,body.app-page-simulation .alice-panel-resizer{display:none!important}",
    ".alice-sidebar-resizer{position:absolute;z-index:31;top:var(--top);left:calc(var(--activity) + var(--side) - 4px);bottom:var(--status);width:8px;cursor:col-resize;touch-action:none;user-select:none;outline:none}",
    ".alice-sidebar-resizer::before{content:\"\";position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background .12s,box-shadow .12s}",
    ".alice-sidebar-resizer:hover::before,.alice-sidebar-resizer:focus-visible::before,body.alice-sidebar-resizing .alice-sidebar-resizer::before{background:#0f6cbd;box-shadow:0 0 0 1px rgba(15,108,189,.12)}",
    ".alice-sidebar-resizer::after{content:attr(data-size);position:absolute;top:10px;left:11px;min-width:48px;padding:4px 7px;border:1px solid #a8a8a8;background:#fff;color:#242424;box-shadow:0 2px 8px rgba(0,0,0,.16);font:10px Consolas,monospace;text-align:center;opacity:0;pointer-events:none;transform:translateX(-3px);transition:opacity .12s,transform .12s}",
    "body.alice-sidebar-resizing .alice-sidebar-resizer::after{opacity:1;transform:none}",
    "body.alice-sidebar-resizing,body.alice-sidebar-resizing *{cursor:col-resize!important;user-select:none!important}",
    "body.hide-project-pane .alice-sidebar-resizer,body.ui-editor-focus .alice-sidebar-resizer{display:none!important}",
    "body.alice-panel-focus:not(.app-page-simulation) .simulator-panel{position:fixed!important;z-index:24!important;top:var(--top)!important;right:0!important;bottom:var(--status)!important;left:calc(var(--activity) + var(--side))!important;width:auto!important;height:auto!important;min-width:0!important;padding-bottom:0!important;border-left:1px solid #a8a8a8!important;box-shadow:-10px 0 24px rgba(0,0,0,.13)}",
    "body.alice-panel-focus .schematic-head{position:relative}",
    "body.alice-panel-focus .schematic-head::after{content:\"专注原理图 · Esc 退出\";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:4px 9px;border:1px solid #c8c8c8;background:#fff;color:#424242;font:10px 'Segoe UI','Microsoft YaHei UI',sans-serif;pointer-events:none;white-space:nowrap}",
    ".simulator-panel:fullscreen{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;padding:0!important;z-index:2147483647!important}",
    ".alice-panel-layout-trigger{position:relative}",
    ".alice-panel-layout-trigger svg{width:14px!important;height:14px!important;stroke-width:1.6}",
    ".alice-panel-layout-trigger[aria-expanded=true]{color:#0f6cbd!important;background:#e5f1fb!important}",
    ".alice-panel-layout-menu{position:fixed;z-index:1000;width:244px;padding:5px;border:1px solid #b8b8b8;background:#fff;color:#242424;box-shadow:0 8px 24px rgba(0,0,0,.2);font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}",
    ".alice-panel-layout-menu[hidden]{display:none!important}",
    ".alice-panel-layout-menu>button{width:100%!important;height:44px!important;display:grid!important;grid-template-columns:30px 1fr 18px;align-items:center;gap:7px;padding:4px 7px!important;color:#242424!important;text-align:left!important;background:transparent!important}",
    ".alice-panel-layout-menu>button:hover,.alice-panel-layout-menu>button:focus-visible{background:#f0f6fc!important;outline:1px solid #0f6cbd!important;outline-offset:-1px}",
    ".alice-panel-layout-menu .alice-layout-icon{width:25px;height:25px;display:grid;place-items:center;border:1px solid #bdbdbd;background:#f7f7f7;color:#0f6cbd;font-size:14px}",
    ".alice-panel-layout-menu .alice-layout-copy{min-width:0;display:flex;flex-direction:column;gap:1px}",
    ".alice-panel-layout-menu strong{font-size:13px;font-weight:600}",
    ".alice-panel-layout-menu small{overflow:hidden;color:#686868;font-size:11px;text-overflow:ellipsis;white-space:nowrap}",
    ".alice-panel-layout-menu .alice-layout-check{color:#0f6cbd;font-size:14px;font-weight:700;text-align:center}",
    ".alice-panel-layout-menu>button:not(.active) .alice-layout-check{visibility:hidden}",
    ".alice-panel-layout-menu>button.active{background:#e5f1fb!important}",
    "@media(max-width:1050px){body.alice-panel-layout-active:not(.app-page-code):not(.app-page-simulation):not(.hide-simulator-pane):not(.ui-editor-focus):not(.alice-panel-focus) .app-shell{grid-template-columns:var(--activity) var(--side) minmax(280px,1fr) var(--sim)!important}}",
    "@media(max-width:820px){body.alice-panel-focus .simulator-panel{left:var(--activity)!important}body.alice-panel-focus .schematic-head::after{display:none}}",
    "@media(max-width:720px){.alice-sidebar-resizer{display:none!important}}"
  ].join("");
  document.head.appendChild(style);

  var divider = document.createElement("div");
  divider.className = "alice-panel-resizer";
  divider.tabIndex = 0;
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  divider.setAttribute("aria-label", "调整原理图面板宽度");
  divider.title = "拖动调整原理图宽度；双击切换标准/宽屏";
  panel.parentNode.insertBefore(divider, panel);

  var sidebarDivider = document.createElement("div");
  sidebarDivider.className = "alice-sidebar-resizer";
  sidebarDivider.tabIndex = 0;
  sidebarDivider.setAttribute("role", "separator");
  sidebarDivider.setAttribute("aria-orientation", "vertical");
  sidebarDivider.setAttribute("aria-label", "调整左侧栏宽度");
  sidebarDivider.title = "拖动调整左侧栏宽度；双击恢复默认";
  shell.appendChild(sidebarDivider);

  var headActions = panel.querySelector(".schematic-head-actions");
  var moreButton = document.getElementById("simMore");
  var layoutButton = document.createElement("button");
  layoutButton.type = "button";
  layoutButton.className = "alice-panel-layout-trigger";
  layoutButton.setAttribute("aria-label", "切换原理图布局");
  layoutButton.setAttribute("aria-haspopup", "menu");
  layoutButton.setAttribute("aria-expanded", "false");
  layoutButton.title = "原理图布局";
  layoutButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M14 5v14M10 9l-2 3 2 3M18 9l2 3-2 3"/></svg>';
  if (headActions) headActions.insertBefore(layoutButton, moreButton || null);

  var menu = document.createElement("div");
  menu.className = "alice-panel-layout-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  var modeMeta = [
    { mode: "compact", icon: "▯", label: "紧凑", detail: "约 380 px，给代码留出更多空间" },
    { mode: "standard", icon: "▥", label: "标准", detail: "约 520 px，原理图拥有更大工作区" },
    { mode: "wide", icon: "▤", label: "宽屏", detail: "约 700 px，适合复杂连线" },
    { mode: "focus", icon: "□", label: "专注原理图", detail: "覆盖主编辑区，按 Esc 退出" }
  ];
  modeMeta.forEach(function (item) {
    var button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = item.mode;
    button.setAttribute("role", "menuitemradio");
    button.innerHTML = '<span class="alice-layout-icon">' + item.icon + '</span>' +
      '<span class="alice-layout-copy"><strong>' + item.label + '</strong><small>' + item.detail + '</small></span>' +
      '<span class="alice-layout-check">✓</span>';
    button.addEventListener("click", function () {
      setMode(item.mode);
      closeMenu();
    });
    menu.appendChild(button);
  });
  panel.appendChild(menu);

  function cssPixels(name) {
    var value = parseFloat(getComputedStyle(body).getPropertyValue(name));
    return Number.isFinite(value) ? value : 0;
  }

  function measuredWidth(selector, variableName) {
    var element = document.querySelector(selector);
    var width = element ? element.getBoundingClientRect().width : 0;
    return width > 0 ? width : cssPixels(variableName);
  }

  function availableBounds() {
    var activity = measuredWidth(".activity-bar", "--activity");
    var side = measuredWidth(".sidebar", "--side");
    var editorFloor = window.innerWidth >= 1600 ? 640 : window.innerWidth >= 1200 ? 520 : window.innerWidth >= 960 ? 400 : 280;
    var room = Math.floor(window.innerWidth - activity - side - editorFloor);
    var minimum = room < MIN_WIDTH ? Math.max(220, room) : MIN_WIDTH;
    var maximum = Math.max(minimum, Math.min(MAX_WIDTH, room));
    return { min: minimum, max: maximum };
  }

  function responsiveWidth(mode) {
    var activity = measuredWidth(".activity-bar", "--activity");
    var side = measuredWidth(".sidebar", "--side");
    var contentWidth = Math.max(600, window.innerWidth - activity - side);
    if (mode === "compact") return numberInRange(contentWidth * 0.36, DEFAULT_WIDTHS.compact, MIN_WIDTH, 439);
    if (mode === "wide") return numberInRange(contentWidth * 0.58, DEFAULT_WIDTHS.wide, 560, MAX_WIDTH);
    return numberInRange(contentWidth * 0.47, DEFAULT_WIDTHS.standard, 420, 600);
  }

  function widthForMode(mode) {
    var resolvedMode = state.widths[mode] ? mode : state.previousMode;
    if (state.customized[resolvedMode]) return state.widths[resolvedMode];
    return responsiveWidth(resolvedMode);
  }

  function classifyWidth(width) {
    if (width <= 439) return "compact";
    if (width >= 620) return "wide";
    return "standard";
  }

  function persist() {
    safeWrite({
      mode: state.mode,
      previousMode: state.previousMode,
      widths: state.widths,
      customized: state.customized
    });
  }

  function publicState() {
    return {
      mode: state.mode,
      previousMode: state.previousMode,
      width: state.effectiveWidth,
      preferredWidth: widthForMode(state.mode === "focus" ? state.previousMode : state.mode),
      minWidth: MIN_WIDTH,
      maxWidth: MAX_WIDTH,
      focused: state.mode === "focus"
    };
  }

  function updateMenuState() {
    menu.querySelectorAll("[data-mode]").forEach(function (button) {
      var active = button.dataset.mode === state.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
    layoutButton.title = state.mode === "focus"
      ? "退出原理图专注模式"
      : "原理图布局：" + ({ compact: "紧凑", standard: "标准", wide: "宽屏" }[state.mode] || "标准");
  }

  function applyLayout(options) {
    options = options || {};
    var sizingMode = state.mode === "focus" ? state.previousMode : state.mode;
    var bounds = availableBounds();
    var preferred = widthForMode(sizingMode);
    state.effectiveWidth = Math.min(bounds.max, Math.max(bounds.min, preferred));

    body.classList.add("alice-panel-layout-active");
    body.classList.toggle("alice-panel-focus", state.mode === "focus");
    ["compact", "standard", "wide", "focus"].forEach(function (mode) {
      body.classList.toggle("alice-panel-mode-" + mode, state.mode === mode);
    });
    body.dataset.alicePanelMode = state.mode;
    body.style.setProperty("--alice-sim-width", state.effectiveWidth + "px");

    divider.dataset.size = state.effectiveWidth + " px";
    divider.setAttribute("aria-valuemin", String(MIN_WIDTH));
    divider.setAttribute("aria-valuemax", String(MAX_WIDTH));
    divider.setAttribute("aria-valuenow", String(state.effectiveWidth));
    updateMenuState();

    if (options.save !== false) persist();
    if (options.emit !== false) {
      window.dispatchEvent(new CustomEvent("alice:panel-layout-change", { detail: publicState() }));
    }
  }

  function signalGeometryChange() {
    window.dispatchEvent(new Event("resize"));
  }

  function revealPanel() {
    body.classList.remove("hide-simulator-pane");
    var checkbox = document.querySelector('[data-pane-toggle="simulator"]');
    if (checkbox) checkbox.checked = true;
  }

  function setMode(mode, options) {
    options = options || {};
    if (VALID_MODES.indexOf(mode) < 0) return false;
    if (mode === "focus") {
      body.classList.remove("ui-editor-focus");
      if (state.mode !== "focus") state.previousMode = state.mode;
    } else {
      state.previousMode = mode;
    }
    state.mode = mode;
    if (options.reveal !== false) revealPanel();
    applyLayout();
    if (options.signal !== false) signalGeometryChange();
    return true;
  }

  function setWidth(width, options) {
    options = options || {};
    var next = numberInRange(width, state.effectiveWidth, MIN_WIDTH, MAX_WIDTH);
    var mode = classifyWidth(next);
    state.widths[mode] = next;
    state.customized[mode] = true;
    state.mode = mode;
    state.previousMode = mode;
    if (options.reveal !== false) revealPanel();
    applyLayout({ save: options.save !== false, emit: options.emit !== false });
    if (options.signal !== false) signalGeometryChange();
    return state.effectiveWidth;
  }

  function toggleWide() {
    return setMode(state.mode === "wide" ? "standard" : "wide");
  }

  function toggleFocus(force) {
    var enter = typeof force === "boolean" ? force : state.mode !== "focus";
    return setMode(enter ? "focus" : state.previousMode);
  }

  function resetLayout() {
    state.widths = {
      compact: DEFAULT_WIDTHS.compact,
      standard: DEFAULT_WIDTHS.standard,
      wide: DEFAULT_WIDTHS.wide
    };
    state.customized = { compact: false, standard: false, wide: false };
    state.previousMode = "standard";
    return setMode("standard");
  }

  function positionMenu() {
    if (menu.hidden) return;
    var rect = layoutButton.getBoundingClientRect();
    var menuWidth = menu.offsetWidth || 244;
    var menuHeight = menu.offsetHeight || 196;
    var left = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.right - menuWidth));
    var top = rect.bottom + 5;
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 5);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function openMenu() {
    menu.hidden = false;
    layoutButton.setAttribute("aria-expanded", "true");
    updateMenuState();
    positionMenu();
    var active = menu.querySelector("button.active") || menu.querySelector("button");
    if (active) active.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    layoutButton.setAttribute("aria-expanded", "false");
  }

  layoutButton.addEventListener("click", function (event) {
    event.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener("keydown", function (event) {
    var buttons = Array.prototype.slice.call(menu.querySelectorAll("button"));
    var index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      var direction = event.key === "ArrowDown" ? 1 : -1;
      buttons[(index + direction + buttons.length) % buttons.length].focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      layoutButton.focus();
    }
  });

  document.addEventListener("pointerdown", function (event) {
    if (!menu.hidden && !menu.contains(event.target) && !layoutButton.contains(event.target)) closeMenu();
  }, true);

  var drag = null;
  divider.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || state.mode === "focus" || document.fullscreenElement) return;
    event.preventDefault();
    closeMenu();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panel.getBoundingClientRect().width || state.effectiveWidth,
      moved: false
    };
    body.classList.add("alice-panel-resizing");
    divider.setPointerCapture(event.pointerId);
  });

  divider.addEventListener("pointermove", function (event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    var bounds = availableBounds();
    var next = Math.min(bounds.max, Math.max(bounds.min, drag.startWidth + drag.startX - event.clientX));
    if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
    state.effectiveWidth = Math.round(next);
    body.style.setProperty("--alice-sim-width", state.effectiveWidth + "px");
    divider.dataset.size = state.effectiveWidth + " px";
    divider.setAttribute("aria-valuenow", String(state.effectiveWidth));
  });

  function finishDrag(event) {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    var completed = drag;
    drag = null;
    body.classList.remove("alice-panel-resizing");
    if (divider.hasPointerCapture && divider.hasPointerCapture(completed.pointerId)) {
      divider.releasePointerCapture(completed.pointerId);
    }
    if (completed.moved) {
      var mode = classifyWidth(state.effectiveWidth);
      state.mode = mode;
      state.previousMode = mode;
      state.widths[mode] = state.effectiveWidth;
      state.customized[mode] = true;
      applyLayout();
      signalGeometryChange();
    } else {
      applyLayout({ save: false, emit: false });
    }
  }

  divider.addEventListener("pointerup", finishDrag);
  divider.addEventListener("pointercancel", finishDrag);
  divider.addEventListener("lostpointercapture", function (event) {
    if (drag) finishDrag(event);
  });
  divider.addEventListener("dblclick", function (event) {
    event.preventDefault();
    toggleWide();
  });

  divider.addEventListener("keydown", function (event) {
    var handled = true;
    if (event.key === "ArrowLeft") setWidth(state.effectiveWidth + (event.shiftKey ? 50 : 20));
    else if (event.key === "ArrowRight") setWidth(state.effectiveWidth - (event.shiftKey ? 50 : 20));
    else if (event.key === "Home") setMode("compact");
    else if (event.key === "End") setMode("wide");
    else if (event.key === "Enter" || event.key === " ") toggleWide();
    else handled = false;
    if (handled) event.preventDefault();
  });

  function readSidebarWidth() {
    try {
      var value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      return Number.isFinite(value) && value > 0
        ? numberInRange(value, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
        : null;
    } catch (_error) {
      return null;
    }
  }

  function writeSidebarWidth(value) {
    try {
      if (value == null) localStorage.removeItem(SIDEBAR_WIDTH_KEY);
      else localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(value)));
    } catch (_error) {
      // The divider remains usable when storage is unavailable.
    }
  }

  function sidebarBounds() {
    var activity = measuredWidth(".activity-bar", "--activity");
    var separateSimulator = !body.classList.contains("app-page-code") &&
      !body.classList.contains("app-page-simulation") &&
      !body.classList.contains("hide-simulator-pane") &&
      !body.classList.contains("ui-editor-focus") &&
      !body.classList.contains("alice-panel-focus");
    var simulatorWidth = separateSimulator ? measuredWidth(".simulator-panel", "--sim") : 0;
    var contentFloor = window.innerWidth >= 1400 ? 520 : window.innerWidth >= 1000 ? 420 : 300;
    var room = Math.floor(window.innerWidth - activity - simulatorWidth - contentFloor);
    var minimum = Math.max(140, Math.min(SIDEBAR_MIN_WIDTH, room));
    var maximum = Math.max(minimum, Math.min(SIDEBAR_MAX_WIDTH, room));
    return { min: minimum, max: maximum };
  }

  var sidebarPreferredWidth = readSidebarWidth() || numberInRange(
    measuredWidth(".sidebar", "--side"),
    SIDEBAR_DEFAULT_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH
  );
  var sidebarEffectiveWidth = sidebarPreferredWidth;

  function sidebarPublicState() {
    var bounds = sidebarBounds();
    return {
      width: sidebarEffectiveWidth,
      preferredWidth: sidebarPreferredWidth,
      minWidth: bounds.min,
      maxWidth: bounds.max
    };
  }

  function applySidebarWidth(value, options) {
    options = options || {};
    var preferred = numberInRange(value, sidebarPreferredWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    if (options.remember !== false) sidebarPreferredWidth = preferred;
    var bounds = sidebarBounds();
    sidebarEffectiveWidth = Math.min(bounds.max, Math.max(bounds.min, preferred));
    body.style.setProperty("--side", sidebarEffectiveWidth + "px");
    sidebarDivider.dataset.size = sidebarEffectiveWidth + " px";
    sidebarDivider.setAttribute("aria-valuemin", String(bounds.min));
    sidebarDivider.setAttribute("aria-valuemax", String(bounds.max));
    sidebarDivider.setAttribute("aria-valuenow", String(sidebarEffectiveWidth));
    if (options.save !== false) writeSidebarWidth(sidebarPreferredWidth);
    if (options.emit !== false) {
      window.dispatchEvent(new CustomEvent("alice:sidebar-layout-change", { detail: sidebarPublicState() }));
    }
    if (options.signal !== false) signalGeometryChange();
    return sidebarEffectiveWidth;
  }

  function resetSidebarWidth() {
    sidebarPreferredWidth = SIDEBAR_DEFAULT_WIDTH;
    writeSidebarWidth(null);
    return applySidebarWidth(SIDEBAR_DEFAULT_WIDTH, { save: false });
  }

  var sidebarDrag = null;
  sidebarDivider.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebar.getBoundingClientRect().width || sidebarEffectiveWidth,
      moved: false
    };
    body.classList.add("alice-sidebar-resizing");
    sidebarDivider.setPointerCapture(event.pointerId);
  });

  sidebarDivider.addEventListener("pointermove", function (event) {
    if (!sidebarDrag || event.pointerId !== sidebarDrag.pointerId) return;
    var next = sidebarDrag.startWidth + event.clientX - sidebarDrag.startX;
    if (Math.abs(event.clientX - sidebarDrag.startX) > 2) sidebarDrag.moved = true;
    applySidebarWidth(next, { remember: false, save: false, emit: false, signal: false });
  });

  function finishSidebarDrag(event) {
    if (!sidebarDrag || (event.pointerId != null && event.pointerId !== sidebarDrag.pointerId)) return;
    var completed = sidebarDrag;
    sidebarDrag = null;
    body.classList.remove("alice-sidebar-resizing");
    if (sidebarDivider.hasPointerCapture && sidebarDivider.hasPointerCapture(completed.pointerId)) {
      sidebarDivider.releasePointerCapture(completed.pointerId);
    }
    if (completed.moved) {
      sidebarPreferredWidth = sidebarEffectiveWidth;
      applySidebarWidth(sidebarPreferredWidth);
    } else {
      applySidebarWidth(sidebarPreferredWidth, { save: false, emit: false });
    }
  }

  sidebarDivider.addEventListener("pointerup", finishSidebarDrag);
  sidebarDivider.addEventListener("pointercancel", finishSidebarDrag);
  sidebarDivider.addEventListener("lostpointercapture", function (event) {
    if (sidebarDrag) finishSidebarDrag(event);
  });
  sidebarDivider.addEventListener("dblclick", function (event) {
    event.preventDefault();
    resetSidebarWidth();
  });
  sidebarDivider.addEventListener("keydown", function (event) {
    var bounds = sidebarBounds();
    var handled = true;
    if (event.key === "ArrowLeft") applySidebarWidth(sidebarEffectiveWidth - (event.shiftKey ? 50 : 20));
    else if (event.key === "ArrowRight") applySidebarWidth(sidebarEffectiveWidth + (event.shiftKey ? 50 : 20));
    else if (event.key === "Home") applySidebarWidth(bounds.min);
    else if (event.key === "End") applySidebarWidth(bounds.max);
    else if (event.key === "Enter" || event.key === " ") resetSidebarWidth();
    else handled = false;
    if (handled) event.preventDefault();
  });

  window.AliceSidebarLayout = Object.freeze({
    setWidth: function (width) { return applySidebarWidth(width); },
    getState: sidebarPublicState,
    reset: resetSidebarWidth
  });
  applySidebarWidth(sidebarPreferredWidth, { save: false, emit: false, signal: false });

  var ribbonToggle = document.getElementById("ribbonCollapseToggle");
  function readRibbonCollapsed() {
    try {
      return localStorage.getItem(RIBBON_COLLAPSED_KEY) === "true";
    } catch (_error) {
      return false;
    }
  }

  function writeRibbonCollapsed(collapsed) {
    try {
      localStorage.setItem(RIBBON_COLLAPSED_KEY, String(Boolean(collapsed)));
    } catch (_error) {
      // The menu can still be folded when storage is unavailable.
    }
  }

  function setRibbonCollapsed(collapsed, options) {
    options = options || {};
    collapsed = Boolean(collapsed);
    body.classList.toggle("ribbon-collapsed", collapsed);
    if (ribbonToggle) {
      var action = collapsed ? "展开" : "折叠";
      ribbonToggle.setAttribute("aria-expanded", String(!collapsed));
      ribbonToggle.setAttribute("title", action + "上方菜单栏");
      var symbol = ribbonToggle.querySelector('[aria-hidden="true"]');
      if (symbol) symbol.textContent = collapsed ? "⌄" : "⌃";
      var label = ribbonToggle.querySelector(".sr-only");
      if (label) label.textContent = action + "上方菜单栏";
    }
    if (options.save !== false) writeRibbonCollapsed(collapsed);
    if (options.signal !== false) signalGeometryChange();
    return collapsed;
  }

  ribbonToggle && ribbonToggle.addEventListener("click", function () {
    setRibbonCollapsed(!body.classList.contains("ribbon-collapsed"));
  });
  setRibbonCollapsed(readRibbonCollapsed(), { save: false, signal: false });

  window.AliceRibbonLayout = Object.freeze({
    setCollapsed: setRibbonCollapsed,
    isCollapsed: function () { return body.classList.contains("ribbon-collapsed"); }
  });

  var timeObserver = panel.querySelector(".simulation-time-observer");
  var timeObserverDivider = document.getElementById("timeObserverResizer");
  if (timeObserver && timeObserverDivider) {
    var timeObserverDrag = null;
    var logicAnalyzerPane = timeObserver.querySelector(".schematic-timeline");
    var envelopePane = document.getElementById("envelopeDockHost");

    function readObserverPaneCollapsed(storageKey) {
      try {
        return localStorage.getItem(storageKey) === "true";
      } catch (_error) {
        return false;
      }
    }

    function writeObserverPaneCollapsed(storageKey, collapsed) {
      try {
        localStorage.setItem(storageKey, String(Boolean(collapsed)));
      } catch (_error) {
        // Folding remains available when storage is unavailable.
      }
    }

    function observerPaneParts(name) {
      var logic = name === "logic";
      return {
        pane: logic ? logicAnalyzerPane : envelopePane,
        toggle: document.getElementById(logic ? "logicAnalyzerPaneToggle" : "envelopePaneToggle"),
        storageKey: logic ? LOGIC_ANALYZER_COLLAPSED_KEY : ENVELOPE_PANE_COLLAPSED_KEY,
        title: logic ? "逻辑分析仪" : "包络编辑器"
      };
    }

    function syncObserverPaneToggle(name) {
      var parts = observerPaneParts(name);
      if (!parts.pane || !parts.toggle) return;
      var collapsed = parts.pane.classList.contains("collapsed");
      var action = collapsed ? "展开" : "折叠";
      parts.toggle.setAttribute("aria-expanded", String(!collapsed));
      parts.toggle.setAttribute("title", action + parts.title);
      var symbol = parts.toggle.querySelector('[aria-hidden="true"]');
      if (symbol) symbol.textContent = collapsed ? "⌄" : "⌃";
      var label = parts.toggle.querySelector(".sr-only");
      if (label) label.textContent = action + parts.title;
    }

    function syncObserverCompactState() {
      var logicCollapsed = Boolean(logicAnalyzerPane && logicAnalyzerPane.classList.contains("collapsed"));
      var envelopeExpanded = Boolean(envelopePane
        && envelopePane.classList.contains("open")
        && !envelopePane.classList.contains("collapsed"));
      timeObserver.classList.toggle("logic-pane-collapsed", logicCollapsed);
      timeObserver.classList.toggle("envelope-pane-collapsed", Boolean(envelopePane && envelopePane.classList.contains("collapsed")));
      timeObserver.classList.toggle("observer-panes-collapsed", logicCollapsed && !envelopeExpanded);
    }

    function setObserverPaneCollapsed(name, collapsed, options) {
      options = options || {};
      var parts = observerPaneParts(name);
      if (!parts.pane) return false;
      parts.pane.classList.toggle("collapsed", Boolean(collapsed));
      syncObserverPaneToggle(name);
      syncObserverCompactState();
      if (options.save !== false) writeObserverPaneCollapsed(parts.storageKey, collapsed);
      if (options.signal !== false) signalGeometryChange();
      return true;
    }

    setObserverPaneCollapsed("logic", readObserverPaneCollapsed(LOGIC_ANALYZER_COLLAPSED_KEY), { save: false, signal: false });
    setObserverPaneCollapsed("envelope", readObserverPaneCollapsed(ENVELOPE_PANE_COLLAPSED_KEY), { save: false, signal: false });

    timeObserver.addEventListener("click", function (event) {
      var toggle = event.target.closest && event.target.closest(".observer-pane-toggle");
      if (!toggle || !timeObserver.contains(toggle)) return;
      var name = toggle.id === "logicAnalyzerPaneToggle" ? "logic" : toggle.id === "envelopePaneToggle" ? "envelope" : "";
      if (!name) return;
      var parts = observerPaneParts(name);
      setObserverPaneCollapsed(name, !parts.pane.classList.contains("collapsed"));
    });

    if (envelopePane && window.MutationObserver) {
      new MutationObserver(function () {
        syncObserverPaneToggle("envelope");
        syncObserverCompactState();
        signalGeometryChange();
      }).observe(envelopePane, { attributes: true, attributeFilter: ["class"], childList: true, subtree: false });
    }

    function readTimeObserverHeight() {
      try {
        var value = Number(localStorage.getItem(TIME_OBSERVER_HEIGHT_KEY));
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch (_error) {
        return null;
      }
    }

    function writeTimeObserverHeight(value) {
      try {
        if (value == null) localStorage.removeItem(TIME_OBSERVER_HEIGHT_KEY);
        else localStorage.setItem(TIME_OBSERVER_HEIGHT_KEY, String(Math.round(value)));
      } catch (_error) {
        // Resizing remains available when storage is unavailable.
      }
    }

    function timeObserverBounds() {
      var panelHeight = panel.getBoundingClientRect().height;
      if (!(panelHeight > 0)) panelHeight = Math.max(420, window.innerHeight - cssPixels("--top") - cssPixels("--status"));
      var minimum = window.innerWidth <= 760 ? 250 : 190;
      var maximum = Math.max(minimum, Math.floor(panelHeight - 130));
      return { min: minimum, max: maximum };
    }

    function applyTimeObserverHeight(value, options) {
      options = options || {};
      var bounds = timeObserverBounds();
      var current = timeObserver.getBoundingClientRect().height || 292;
      var next = numberInRange(value, current, bounds.min, bounds.max);
      timeObserver.style.flex = "0 0 " + next + "px";
      timeObserverDivider.dataset.size = next + " px";
      timeObserverDivider.setAttribute("aria-valuemin", String(bounds.min));
      timeObserverDivider.setAttribute("aria-valuemax", String(bounds.max));
      timeObserverDivider.setAttribute("aria-valuenow", String(next));
      if (options.save !== false) writeTimeObserverHeight(next);
      if (options.signal !== false) signalGeometryChange();
      return next;
    }

    function resetTimeObserverHeight() {
      timeObserver.style.removeProperty("flex");
      timeObserverDivider.dataset.size = "默认";
      timeObserverDivider.removeAttribute("aria-valuenow");
      writeTimeObserverHeight(null);
      signalGeometryChange();
    }

    var savedTimeObserverHeight = readTimeObserverHeight();
    if (savedTimeObserverHeight != null) applyTimeObserverHeight(savedTimeObserverHeight, { save: false, signal: false });
    else timeObserverDivider.dataset.size = "默认";

    timeObserverDivider.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      var rectangle = timeObserver.getBoundingClientRect();
      timeObserverDrag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: rectangle.height || 292,
        moved: false
      };
      body.classList.add("alice-time-observer-resizing");
      timeObserverDivider.setPointerCapture(event.pointerId);
    });

    timeObserverDivider.addEventListener("pointermove", function (event) {
      if (!timeObserverDrag || event.pointerId !== timeObserverDrag.pointerId) return;
      var next = timeObserverDrag.startHeight + timeObserverDrag.startY - event.clientY;
      if (Math.abs(event.clientY - timeObserverDrag.startY) > 2) timeObserverDrag.moved = true;
      applyTimeObserverHeight(next, { save: false, signal: false });
    });

    function finishTimeObserverDrag(event) {
      if (!timeObserverDrag || (event.pointerId != null && event.pointerId !== timeObserverDrag.pointerId)) return;
      var completed = timeObserverDrag;
      timeObserverDrag = null;
      body.classList.remove("alice-time-observer-resizing");
      if (timeObserverDivider.hasPointerCapture && timeObserverDivider.hasPointerCapture(completed.pointerId)) {
        timeObserverDivider.releasePointerCapture(completed.pointerId);
      }
      if (completed.moved) applyTimeObserverHeight(timeObserver.getBoundingClientRect().height);
      else if (savedTimeObserverHeight != null) applyTimeObserverHeight(timeObserver.getBoundingClientRect().height, { save: false });
    }

    timeObserverDivider.addEventListener("pointerup", finishTimeObserverDrag);
    timeObserverDivider.addEventListener("pointercancel", finishTimeObserverDrag);
    timeObserverDivider.addEventListener("lostpointercapture", function (event) {
      if (timeObserverDrag) finishTimeObserverDrag(event);
    });
    timeObserverDivider.addEventListener("dblclick", function (event) {
      event.preventDefault();
      resetTimeObserverHeight();
    });
    timeObserverDivider.addEventListener("keydown", function (event) {
      var bounds = timeObserverBounds();
      var current = timeObserver.getBoundingClientRect().height || 292;
      var handled = true;
      if (event.key === "ArrowUp") applyTimeObserverHeight(current + (event.shiftKey ? 50 : 20));
      else if (event.key === "ArrowDown") applyTimeObserverHeight(current - (event.shiftKey ? 50 : 20));
      else if (event.key === "Home") applyTimeObserverHeight(bounds.min);
      else if (event.key === "End") applyTimeObserverHeight(bounds.max);
      else if (event.key === "Enter" || event.key === " ") resetTimeObserverHeight();
      else handled = false;
      if (handled) event.preventDefault();
    });

    document.addEventListener("alice:workspace-page-change", function (event) {
      if (event.detail && event.detail.page === "simulation") {
        var savedHeight = readTimeObserverHeight();
        if (savedHeight != null) applyTimeObserverHeight(savedHeight, { save: false });
      }
    });
    window.addEventListener("resize", function () {
      var savedHeight = readTimeObserverHeight();
      if (savedHeight != null) applyTimeObserverHeight(savedHeight, { save: false, signal: false });
    });

    window.AliceObserverLayout = Object.freeze({
      getState: function () {
        return {
          height: timeObserver.getBoundingClientRect().height || 292,
          logicCollapsed: Boolean(logicAnalyzerPane && logicAnalyzerPane.classList.contains("collapsed")),
          envelopeCollapsed: Boolean(envelopePane && envelopePane.classList.contains("collapsed"))
        };
      },
      setState: function (savedState) {
        if (!savedState || typeof savedState !== "object") return false;
        if (savedState.height != null) applyTimeObserverHeight(savedState.height);
        if (typeof savedState.logicCollapsed === "boolean") setObserverPaneCollapsed("logic", savedState.logicCollapsed);
        if (typeof savedState.envelopeCollapsed === "boolean") setObserverPaneCollapsed("envelope", savedState.envelopeCollapsed);
        return true;
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (!menu.hidden) return;
    if (state.mode === "focus" && !document.fullscreenElement) {
      event.preventDefault();
      setMode(state.previousMode);
    }
  });

  document.addEventListener("fullscreenchange", function () {
    var panelFullscreen = document.fullscreenElement === panel;
    body.classList.toggle("alice-panel-native-fullscreen", panelFullscreen);
    closeMenu();
    if (!panelFullscreen) signalGeometryChange();
  });

  window.addEventListener("resize", function () {
    applySidebarWidth(sidebarPreferredWidth, { remember: false, save: false, emit: false, signal: false });
    applyLayout({ save: false, emit: false });
    positionMenu();
  });

  window.AlicePanelLayout = Object.freeze({
    modes: Object.freeze(VALID_MODES.slice()),
    setMode: setMode,
    setWidth: setWidth,
    getMode: function () { return state.mode; },
    getState: publicState,
    toggleWide: toggleWide,
    toggleFocus: toggleFocus,
    reset: resetLayout,
    openMenu: openMenu,
    closeMenu: closeMenu
  });

  applyLayout({ save: false });
}());
