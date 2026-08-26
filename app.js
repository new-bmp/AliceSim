const defaultCode = `#include "main.h"

int main(void)
{
  HAL_Init();

  while (1)
  {
    /* Add application code here. */
    HAL_Delay(1U);
  }
}`;

const altFiles = {
  "stm32f1xx_it.c": `#include "main.h"\n#include "stm32f1xx_it.h"\n\nvoid NMI_Handler(void) {}\n\nvoid HardFault_Handler(void)\n{\n  while (1) {}\n}\n\nvoid SysTick_Handler(void)\n{\n  HAL_IncTick();\n}`,
  "system_stm32f1xx.c": `#include "stm32f1xx.h"\n\nuint32_t SystemCoreClock = 72000000U;\n\nvoid SystemInit(void)\n{\n  /* Reset the RCC clock configuration */\n  RCC->CR |= RCC_CR_HSION;\n}\n\nvoid SystemCoreClockUpdate(void)\n{\n  SystemCoreClock = 72000000U;\n}`,
  "STM32_Empty.ioc": `# AliceSIM empty STM32 project\nMcu.Name=STM32F103C8Tx\nMcu.Package=LQFP48\nMcu.CPN=STM32F103C8T6\nMcu.PinsNb=0\nProjectManager.ProjectName=STM32_Empty`
};

const state = {
  running: false,
  envelopeOnly: false,
  built: false,
  buildBusy: false,
  startTime: 0,
  elapsed: 0,
  led: false,
  ledTimer: null,
  simTimer: null,
  tickTimer: null,
  samples: [],
  sampleCounter: 0,
  tickCount: 0,
  tickSize: 1,
  simulationSpeed: 1,
  simulationBudgetMs: 0,
  circuitTime: 0,
  currentFile: "main.c",
  importedConfig: null,
  diagnostics: [],
  simulationDiagnostics: [],
  firmwareModel: null,
  clangAvailable: false,
  diagnosticRequest: 0,
  lastFrameTime: 0,
  lastOperationCount: 0,
  runtimeStatus: "idle",
  runtimeProblemKey: "",
  processingFrame: false,
  powerCalculationEnabled: true,
  virtualUartInstance: ""
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const APP_PAGE_STORAGE_KEY = "alice.workspace.page.v1";
const SIMULATION_SPEED_STORAGE_KEY = "alice.simulation.speed.v1";
const POWER_CALCULATION_STORAGE_KEY = "alice.simulation.power-calculation.v1";

function normalizeAppPage(page) {
  return page === "simulation" ? "simulation" : "code";
}

function setAppPage(page, options = {}) {
  const nextPage = normalizeAppPage(page);
  const simulationActive = nextPage === "simulation";
  document.body.classList.toggle("app-page-code", !simulationActive);
  document.body.classList.toggle("app-page-simulation", simulationActive);
  document.body.dataset.appPage = nextPage;
  if (simulationActive) document.body.classList.remove("hide-simulator-pane", "ui-editor-focus");
  $$('[data-app-page]').forEach(button => {
    const active = button.dataset.appPage === nextPage;
    if (button.getAttribute("role") === "tab") {
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    } else {
      button.setAttribute("aria-current", active ? "page" : "false");
    }
  });
  const simulatorToggle = $('[data-pane-toggle="simulator"]');
  if (simulatorToggle) simulatorToggle.checked = simulationActive;
  if (options.save !== false) {
    try { localStorage.setItem(APP_PAGE_STORAGE_KEY, nextPage); } catch (_) {}
  }
  requestAnimationFrame(() => {
    resizeCanvas();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new CustomEvent("alice:workspace-page-change", { detail: { page: nextPage } }));
  });
  return nextPage;
}

function formatSimulationSpeed(speed) {
  return `${Number(speed).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}×`;
}

function setSimulationSpeed(speed, options = {}) {
  const allowed = [0.25, 0.5, 1, 2, 5, 10];
  const requested = Number(speed);
  state.simulationSpeed = allowed.includes(requested) ? requested : 1;
  state.simulationBudgetMs = 0;
  const select = $("#simulationSpeedSelect");
  if (select) select.value = String(state.simulationSpeed);
  const label = formatSimulationSpeed(state.simulationSpeed);
  if ($("#simulationSpeedReadout")) $("#simulationSpeedReadout").textContent = label;
  if (options.save !== false) {
    try { localStorage.setItem(SIMULATION_SPEED_STORAGE_KEY, String(state.simulationSpeed)); } catch (_) {}
  }
  return label;
}

function setPowerCalculationEnabled(enabled, options = {}) {
  state.powerCalculationEnabled = enabled !== false;
  const toggle = $("#powerCalculationToggle");
  if (toggle) toggle.checked = state.powerCalculationEnabled;
  const readout = $("#powerCalculationState");
  if (readout) readout.textContent = state.powerCalculationEnabled ? "开" : "仅电压";
  document.body.classList.toggle("power-calculation-disabled", !state.powerCalculationEnabled);
  window.AliceSchematic?.setPowerCalculationEnabled?.(state.powerCalculationEnabled);
  if (options.save !== false) {
    try { localStorage.setItem(POWER_CALCULATION_STORAGE_KEY, state.powerCalculationEnabled ? "1" : "0"); } catch (_) {}
  }
  return state.powerCalculationEnabled;
}

function consumeSimulationFrame(realFrameMs) {
  state.simulationBudgetMs += Math.max(0, Number(realFrameMs) || 0) * state.simulationSpeed;
  const ticks = Math.floor((state.simulationBudgetMs + 1e-9) / state.tickSize);
  if (ticks < 1) return { ticks: 0, deltaMs: 0 };
  const deltaMs = ticks * state.tickSize;
  state.simulationBudgetMs = Math.max(0, state.simulationBudgetMs - deltaMs);
  return { ticks, deltaMs };
}

function updateSimulationClocks() {
  const text = `${state.circuitTime.toFixed(3)} ms`;
  if ($("#circuitTime")) $("#circuitTime").textContent = text;
  $$('[data-simulation-clock]').forEach(node => { node.textContent = text; });
}

window.AliceWorkspacePages = Object.freeze({
  set: setAppPage,
  get: () => normalizeAppPage(document.body.dataset.appPage)
});

const editor = $("#codeEditor");
const highlightCode = $("#highlightCode");
const codeHighlight = $("#codeHighlight");
const diagnosticLayer = $("#diagnosticLayer");
editor.value = defaultCode;

const cKeywords = new Set([
  "auto", "break", "case", "continue", "default", "do", "else", "for", "goto",
  "if", "register", "return", "sizeof", "switch", "while", "_Alignas", "_Alignof",
  "_Atomic", "_Generic", "_Noreturn", "_Static_assert", "_Thread_local"
]);
const cTypes = new Set([
  "char", "const", "double", "enum", "extern", "float", "inline", "int", "long",
  "restrict", "short", "signed", "static", "struct", "typedef", "union", "unsigned",
  "void", "volatile", "_Bool", "_Complex", "_Imaginary"
]);

function escapeCode(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tokenClass(token) {
  if (token.startsWith("/*") || token.startsWith("//")) return "tok-comment";
  if (token.startsWith("\"") || token.startsWith("'")) return "tok-string";
  if (/^\s*#/.test(token)) return "tok-preprocessor";
  if (cKeywords.has(token)) return "tok-keyword";
  if (cTypes.has(token) || /^(?:u?int\d+_t|size_t|GPIO_InitTypeDef|RCC_\w+TypeDef)$/.test(token)) return "tok-type";
  if (/^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:[uUlLfF]+)?)$/i.test(token)) return "tok-number";
  if (/^[A-Z][A-Z\d_]{2,}$/.test(token)) return "tok-constant";
  if (/^[A-Za-z_]\w*$/.test(token)) return "tok-function";
  return "tok-operator";
}

function highlightC(code) {
  const tokenPattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|^\s*#[^\n]*|\b(?:_Alignas|_Alignof|_Atomic|_Generic|_Noreturn|_Static_assert|_Thread_local|auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|_Bool|_Complex|_Imaginary)\b|\b(?:u?int\d+_t|size_t|GPIO_InitTypeDef|RCC_\w+TypeDef)\b|\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:[uUlLfF]+)?)\b|\b[A-Z][A-Z\d_]{2,}\b|\b[A-Za-z_]\w*(?=\s*\()/gim;
  let output = "";
  let lastIndex = 0;
  for (const match of code.matchAll(tokenPattern)) {
    output += escapeCode(code.slice(lastIndex, match.index));
    output += `<span class="${tokenClass(match[0])}">${escapeCode(match[0])}</span>`;
    lastIndex = match.index + match[0].length;
  }
  output += escapeCode(code.slice(lastIndex));
  return output;
}

function renderHighlight() {
  highlightCode.innerHTML = highlightC(editor.value) + (editor.value.endsWith("\n") ? " " : "");
  codeHighlight.scrollTop = editor.scrollTop;
  codeHighlight.scrollLeft = editor.scrollLeft;
}

function localAnalyze(code, options = {}) {
  const diagnostics = [];
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, match => " ".repeat(match.length));
  const stack = [];
  let line = 1;
  let column = 0;
  for (const character of clean) {
    if (character === "\n") { line++; column = 0; continue; }
    column++;
    if (character === "{") stack.push({ line, column });
    if (character === "}") {
      if (!stack.length) diagnostics.push({ severity: "error", line, column, message: "多余的右花括号 '}'", source: "Alice C Analyzer" });
      else stack.pop();
    }
  }
  stack.forEach(item => diagnostics.push({ severity: "error", line: item.line, column: item.column, message: "缺少匹配的右花括号 '}'", source: "Alice C Analyzer" }));
  const currentPath = String(options.currentFile || state.currentFile).replace(/\\/g, "/");
  const entryPath = String(options.entryPath || "").replace(/\\/g, "/");
  const shouldRequireMain = /(^|\/)main\.(?:c|cc|cpp|cxx)$/i.test(currentPath)
    && (!entryPath || entryPath.toLowerCase() === currentPath.toLowerCase());
  if (shouldRequireMain && !/\b(?:int|auto)\s+main\s*\(/.test(clean)) diagnostics.push({ severity: "error", line: 1, column: 1, message: "未找到程序入口 main()", source: "Alice C Analyzer" });
  code.split("\n").forEach((sourceLine, index) => {
    const trimmed = sourceLine.trim();
    if (/^(?:HAL_|MX_|SystemClock_Config|__HAL_)[A-Za-z0-9_]*\s*\([^;{}]*\)\s*$/.test(trimmed)) {
      diagnostics.push({ severity: "error", line: index + 1, column: Math.max(1, sourceLine.length), message: "函数调用后缺少分号 ';'", source: "Alice C Analyzer" });
    }
    const delay = trimmed.match(/HAL_Delay\s*\(\s*(\d+)\s*\)/);
    if (delay && Number(delay[1]) > 60000) diagnostics.push({ severity: "warning", line: index + 1, column: sourceLine.indexOf("HAL_Delay") + 1, message: "HAL_Delay 超过 60 秒，可能阻塞主循环", source: "Alice C Analyzer" });
  });
  return diagnostics;
}

function normalizeProjectPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function diagnosticMatchesCurrentFile(item) {
  const diagnosticFile = normalizeProjectPath(item?.file);
  const currentFile = normalizeProjectPath(state.currentFile);
  if (!diagnosticFile) return true;
  if (diagnosticFile === currentFile) return true;
  return !diagnosticFile.includes("/") && currentFile.endsWith(`/${diagnosticFile}`);
}

function mergeDiagnostics(primary, secondary) {
  const seen = new Set();
  return [...primary, ...secondary].filter(item => {
    const key = `${normalizeProjectPath(item.file)}:${item.severity}:${item.line}:${item.column}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => normalizeProjectPath(a.file).localeCompare(normalizeProjectPath(b.file)) || a.line - b.line || a.column - b.column);
}

function updateProblems(diagnostics) {
  state.diagnostics = diagnostics;
  const errors = diagnostics.filter(item => item.severity === "error").length;
  const warnings = diagnostics.filter(item => item.severity === "warning").length;
  $("#problemCount").textContent = diagnostics.length;
  $("#errorCount").textContent = errors;
  $("#warningCount").textContent = warnings;
  $("#problemsList").innerHTML = diagnostics.length ? diagnostics.map((item, index) => {
    const locationFile = normalizeProjectPath(item.file) || normalizeProjectPath(state.currentFile);
    return `
    <div class="problem-row ${item.severity}" data-problem-index="${index}" title="跳转到 ${escapeHtml(locationFile)} 第 ${item.line} 行">
      <span class="problem-icon">${item.severity === "error" ? "×" : "!"}</span>
      <span class="problem-message">${escapeHtml(item.message)}<small>${escapeHtml(item.source || "Clang")}</small></span>
      <span class="problem-location">${escapeHtml(locationFile)}:${item.line}:${item.column}</span>
    </div>`;
  }).join("") : '<div class="empty-state">✓ 当前工作区没有检测到问题</div>';
  updateLineNumbers();
  renderDiagnosticLayer();
}

function renderDiagnosticLayer() {
  const currentLine = editor.value.slice(0, editor.selectionStart).split("\n").length;
  const rowMap = new Map([[currentLine, "current"]]);
  state.diagnostics.filter(diagnosticMatchesCurrentFile).forEach(item => {
    const previous = rowMap.get(item.line);
    if (item.severity === "error" || !previous) rowMap.set(item.line, item.severity);
  });
  const rows = [...rowMap.entries()].map(([lineNumber, severity]) => `<div class="diagnostic-row ${severity}" style="top:${9 + (lineNumber - 1) * 20 - editor.scrollTop}px"></div>`);
  const squiggles = state.diagnostics.filter(diagnosticMatchesCurrentFile).map(item => {
    const width = Math.min(150, Math.max(30, item.message.length * 3));
    return `<div class="diagnostic-squiggle ${item.severity}" style="top:${26 + (item.line - 1) * 20 - editor.scrollTop}px;left:${12 + (Math.max(1, item.column) - 1) * 7.82 - editor.scrollLeft}px;width:${width}px"></div>`;
  });
  diagnosticLayer.innerHTML = rows.concat(squiggles).join("");
}

let diagnosticTimer;
async function runDiagnostics(force = false) {
  const requestId = ++state.diagnosticRequest;
  const indicator = $("#compilerIndicator");
  indicator.className = "compiler-indicator checking";
  indicator.innerHTML = "<i></i>Clang 正在检查";
  const workspaceState = window.AliceProjectWorkspace?.getState?.();
  const localDiagnostics = localAnalyze(editor.value, {
    currentFile: normalizeProjectPath(state.currentFile),
    entryPath: normalizeProjectPath(workspaceState?.entryPath)
  }).map(item => ({ ...item, file: normalizeProjectPath(state.currentFile) }));
  let clangDiagnostics = [];
  let engine = "Alice C Analyzer";
  let languageStandard = "c11";
  let clangTarget = "host";
  try {
    const workspacePayload = window.AliceProjectWorkspace?.createClangPayload?.({
      activePath: normalizeProjectPath(state.currentFile),
      activeCode: editor.value,
      all: force
    });
    const request = window.AlicePlatform?.fetch || fetch;
    const response = await request("/api/clang-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspacePayload || { code: editor.value, filename: state.currentFile })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    clangDiagnostics = result.diagnostics || [];
    state.clangAvailable = Boolean(result.clang);
    engine = result.engine || engine;
    languageStandard = result.languageStandard || languageStandard;
    clangTarget = result.target || clangTarget;
  } catch (error) {
    state.clangAvailable = false;
  }
  if (requestId !== state.diagnosticRequest && !force) return state.diagnostics;
  const supplementalDiagnostics = state.clangAvailable
    ? localDiagnostics.filter(item => item.severity === "warning")
    : localDiagnostics;
  const diagnostics = mergeDiagnostics(clangDiagnostics, supplementalDiagnostics);
  updateProblems(diagnostics);
  const errors = diagnostics.filter(item => item.severity === "error").length;
  indicator.className = `compiler-indicator ${errors ? "error" : "ready"}`;
  indicator.innerHTML = `<i></i>${state.clangAvailable ? engine : "本地 C 检查"} · ${errors ? `${errors} 个错误` : "无问题"}`;
  $("#clangStatus").textContent = state.clangAvailable
    ? `${engine} · ${languageStandard.toUpperCase()}${clangTarget === "arm-none-eabi" ? " · Cortex-M3" : ""}`
    : "C Analyzer · C11";
  return diagnostics;
}

function scheduleDiagnostics() {
  clearTimeout(diagnosticTimer);
  diagnosticTimer = setTimeout(() => runDiagnostics(), 420);
}

function updateLineNumbers() {
  const lines = editor.value.split("\n").length;
  const current = editor.value.slice(0, editor.selectionStart).split("\n").length;
  const severityByLine = new Map();
  state.diagnostics.filter(diagnosticMatchesCurrentFile).forEach(item => {
    if (item.severity === "error" || !severityByLine.has(item.line)) severityByLine.set(item.line, item.severity);
  });
  $("#lineNumbers").innerHTML = Array.from({ length: lines }, (_, i) => {
    const lineNumber = i + 1;
    const classes = [lineNumber === current ? "active" : "", severityByLine.get(lineNumber) ? `${severityByLine.get(lineNumber)}-line` : ""].filter(Boolean).join(" ");
    return `<span class="${classes}">${lineNumber}</span>`;
  }).join("");
  $("#cursorLine").textContent = current;
  const lastBreak = editor.value.lastIndexOf("\n", editor.selectionStart - 1);
  $("#cursorCol").textContent = editor.selectionStart - lastBreak;
  $("#minimap").style.setProperty("--lines", lines);
  renderDiagnosticLayer();
}

editor.addEventListener("input", () => {
  renderHighlight();
  updateLineNumbers();
  if (state.running) {
    stopSimulation();
    appendTerminal("Source changed · running HAL artifact was stopped and marked stale", "warn");
  }
  state.built = false;
  state.firmwareModel = null;
  scheduleDiagnostics();
});
editor.addEventListener("click", updateLineNumbers);
editor.addEventListener("keyup", updateLineNumbers);
editor.addEventListener("scroll", () => {
  $("#lineNumbers").scrollTop = editor.scrollTop;
  codeHighlight.scrollTop = editor.scrollTop;
  codeHighlight.scrollLeft = editor.scrollLeft;
  renderDiagnosticLayer();
});
editor.addEventListener("keydown", event => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText("  ", start, editor.selectionEnd, "end");
    renderHighlight();
    updateLineNumbers();
    scheduleDiagnostics();
  }
});
renderHighlight();
updateLineNumbers();
setTimeout(() => runDiagnostics(), 600);

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icon = document.createElement("i");
  const copy = document.createElement("span");
  copy.textContent = String(message ?? "");
  toast.append(icon, copy);
  $("#toastStack").appendChild(toast);
  setTimeout(() => toast.classList.add("hide"), 2800);
  setTimeout(() => toast.remove(), 3150);
}

function switchBottom(name) {
  $$("[data-bottom]").forEach(btn => btn.classList.toggle("active", btn.dataset.bottom === name));
  $$("[data-bottom-view]").forEach(view => view.classList.toggle("active", view.dataset.bottomView === name));
  $("#bottomPanel").classList.remove("collapsed");
}

$$("[data-bottom]").forEach(btn => btn.addEventListener("click", () => switchBottom(btn.dataset.bottom)));

const mobileSidebarMedia = typeof window.matchMedia === "function"
  ? window.matchMedia("(max-width: 720px)")
  : { matches: false, addEventListener() {} };

function setMobileSidebarOpen(open, options = {}) {
  const mobileLayout = mobileSidebarMedia.matches;
  const visible = mobileLayout && Boolean(open);
  document.body.classList.toggle("mobile-sidebar-open", visible);
  const sidebar = $("#sidebar");
  if (sidebar) sidebar.setAttribute("aria-hidden", String(mobileLayout && !visible));
  $$(".activity-item[data-view]").forEach(item => {
    item.setAttribute("aria-expanded", String(visible && item.classList.contains("active")));
  });
  if (!visible && options.restoreFocus) {
    $(".activity-item[data-view].active")?.focus({ preventScroll: true });
  }
}

function syncMobileSidebarLayout() {
  if (!mobileSidebarMedia.matches) document.body.classList.remove("mobile-sidebar-open");
  setMobileSidebarOpen(document.body.classList.contains("mobile-sidebar-open"));
}

$$(".activity-item[data-view]").forEach(btn => btn.addEventListener("click", () => {
  const repeatMobileSelection = mobileSidebarMedia.matches
    && btn.classList.contains("active")
    && document.body.classList.contains("mobile-sidebar-open");
  $$(".activity-item[data-view]").forEach(item => item.classList.remove("active"));
  btn.classList.add("active");
  $$(".side-view").forEach(view => view.classList.toggle("active", view.dataset.panel === btn.dataset.view));
  if (mobileSidebarMedia.matches) {
    document.body.classList.remove("hide-project-pane");
    const projectPaneToggle = $('[data-pane-toggle="project"]');
    if (projectPaneToggle) projectPaneToggle.checked = true;
    setMobileSidebarOpen(!repeatMobileSelection);
  }
}));

$("#mobileSidebarScrim")?.addEventListener("click", () => setMobileSidebarOpen(false, { restoreFocus: true }));
$("#mobileSidebarClose")?.addEventListener("click", () => setMobileSidebarOpen(false, { restoreFocus: true }));
mobileSidebarMedia.addEventListener?.("change", syncMobileSidebarLayout);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.body.classList.contains("mobile-sidebar-open")) {
    event.preventDefault();
    setMobileSidebarOpen(false, { restoreFocus: true });
  }
});
window.addEventListener("alice-editor-file-open", () => {
  if (mobileSidebarMedia.matches) setMobileSidebarOpen(false);
});
syncMobileSidebarLayout();

$$(".work-tab").forEach(btn => btn.addEventListener("click", event => {
  if (event.target.tagName === "SMALL") return;
  $$(".work-tab").forEach(tab => tab.classList.remove("active"));
  btn.classList.add("active");
  $$(".tab-view").forEach(view => view.classList.toggle("active", view.dataset.viewTab === btn.dataset.tab));
}));

function openTab(name) {
  const btn = $(`.work-tab[data-tab="${name}"]`);
  if (btn) btn.click();
}

function appendTerminal(text, className = "") {
  [$("#terminalOutput"), $("#simulationBuildOutput")].filter(Boolean).forEach(output => {
    const line = document.createElement("span");
    line.className = `terminal-line ${className}`;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  });
  const buildState = $("#simulationBuildState");
  if (buildState) {
    const nextState = className === "error" ? "FAILED" : className === "success" && /^✓ HAL simulation artifact/.test(text) ? "READY" : "BUILDING";
    buildState.textContent = nextState;
    buildState.className = nextState.toLowerCase();
  }
}

function setBuildOutput(text) { $("#buildOutput").textContent += `\n${text}`; }

async function buildProject() {
  if (state.buildBusy) return false;
  if (state.running) stopSimulation();
  state.buildBusy = true;
  switchBottom("terminal");
  appendTerminal("alice hal-build --target STM32F103C8T6", "command");
  $("#buildButton").classList.add("busy");
  const startedAt = performance.now();
  appendTerminal("[1/4] Parsing IOC, GPIO aliases and UART configuration", "info");
  appendTerminal("[2/4] Checking uploaded C/C++ sources (Clang 18 when the local backend is available)", "");
  const diagnostics = await runDiagnostics(true);
  const syntaxChecker = state.clangAvailable ? "Clang syntax check" : "Browser C structure check";
  const errors = diagnostics.filter(item => item.severity === "error");
  if (errors.length) {
    errors.slice(0, 6).forEach(item => appendTerminal(`${normalizeProjectPath(item.file) || state.currentFile}:${item.line}:${item.column}: error: ${item.message}`, "error"));
    appendTerminal(`Build failed with ${errors.length} error${errors.length === 1 ? "" : "s"}.`, "error");
    state.built = false;
    state.buildBusy = false;
    $("#buildButton").classList.remove("busy");
    switchBottom("problems");
    showToast(`${state.clangAvailable ? "Clang" : "基础检查"}检测到 ${errors.length} 个问题`, "error");
    return false;
  }
  appendTerminal(`${syntaxChecker}: passed (${diagnostics.filter(item => item.severity === "warning").length} warnings)`, state.clangAvailable ? "success" : "warn");
  const platform = window.AlicePlatform;
  if (platform?.kind === "tauri-mobile" && !platform.getBackendState?.().available) {
    const mobileMessage = platform.getBackendState?.().detail || "手机和平板版本不包含本地 Clang/HAL 编译服务";
    appendTerminal(`[3/4] ${mobileMessage}`, "error");
    appendTerminal("Build stopped: source editing, project files and circuit design remain available.", "warn");
    state.built = false;
    state.buildBusy = false;
    $("#buildButton").classList.remove("busy");
    showToast("移动端未提供本地固件编译，请使用桌面版", "error");
    return false;
  }
  appendTerminal("[3/4] Compiling supported HAL calls into deterministic IR", "");
  let simulationBuild;
  try {
    simulationBuild = await window.AliceHalSimulator.build();
  } catch (error) {
    const failure = {
      file: normalizeProjectPath(state.currentFile), severity: "error", line: 1, column: 1,
      message: error.message || "HAL 仿真模型构建失败", source: "Alice HAL VM"
    };
    state.simulationDiagnostics = [failure];
    updateProblems(mergeDiagnostics(diagnostics, state.simulationDiagnostics));
    appendTerminal(`HAL model error: ${failure.message}`, "error");
    appendTerminal("Build stopped: no fake PC13 fallback was generated.", "error");
    state.built = false;
    state.buildBusy = false;
    $("#buildButton").classList.remove("busy");
    switchBottom("problems");
    showToast("HAL 仿真模型构建失败", "error");
    return false;
  }

  const circuitReport = simulationBuild.circuit || {};
  const circuitIssues = circuitReport.issues || [
    ...(circuitReport.errors || []).map(message => ({ severity: "error", code: "CIRCUIT_MODEL", message })),
    ...(circuitReport.warnings || []).map(message => ({ severity: "warning", code: "CIRCUIT_MODEL", message }))
  ];
  const circuitDiagnostics = circuitIssues.map(item => ({
    file: "Main.sch",
    severity: item.severity === "error" ? "error" : "warning",
    line: 1,
    column: 1,
    message: item.message || String(item),
    source: "Alice Circuit Solver",
    code: item.code || "CIRCUIT"
  }));
  state.simulationDiagnostics = [...simulationBuild.diagnostics, ...circuitDiagnostics];
  const combinedDiagnostics = mergeDiagnostics(diagnostics, state.simulationDiagnostics);
  updateProblems(combinedDiagnostics);
  const modelErrors = state.simulationDiagnostics.filter(item => item.severity === "error");
  if (modelErrors.length) {
    modelErrors.slice(0, 6).forEach(item => appendTerminal(`${item.file || state.currentFile}:${item.line}:${item.column || 1}: error: ${item.message}`, "error"));
    appendTerminal("HAL simulation build failed; unsupported behavior will not be animated.", "error");
    state.built = false;
    state.buildBusy = false;
    $("#buildButton").classList.remove("busy");
    switchBottom("problems");
    showToast(`HAL 模型存在 ${modelErrors.length} 个阻止运行的问题`, "error");
    return false;
  }

  state.firmwareModel = simulationBuild.model;
  state.runtimeStatus = "idle";
  state.runtimeProblemKey = "";
  appendTerminal("[4/4] Compiling schematic nets and binding physical MCU pins", "");
  appendTerminal(`GPIO ${simulationBuild.outputs.length} · UART ${simulationBuild.uarts.length} · I²C ${simulationBuild.i2cs?.length || 0} · SPI ${simulationBuild.spis?.length || 0} · ADC ${simulationBuild.adcs?.length || 0} · PWM ${simulationBuild.timers?.length || 0}`, "info");
  const runtimeBackend = simulationBuild.runtimeBackend === "worker" ? "Firmware Worker" : "Main-thread fallback";
  const accelerationBackend = simulationBuild.acceleration?.wasm ? "Trace/Sensor WASM" : "Trace/Sensor JS fallback";
  appendTerminal(`${runtimeBackend} · ${accelerationBackend}`, simulationBuild.runtimeBackend === "worker" ? "success" : "warn");
  const freertosBuild = simulationBuild.middlewares?.freertos;
  if (freertosBuild?.detected) {
    appendTerminal(`${freertosBuild.api || "FreeRTOS"} middleware · ${freertosBuild.tasks?.length || 0} task(s) · ${freertosBuild.tickRateHz || "?"} Hz tick`, "info");
  }
  state.simulationDiagnostics.filter(item => item.severity === "warning").slice(0, 8).forEach(item => {
    appendTerminal(`warning: ${item.message}`, "warn");
  });
  appendTerminal(`✓ HAL simulation artifact ready in ${Math.max(1, Math.round(performance.now() - startedAt))} ms`, "success");
  state.built = true;
  state.buildBusy = false;
  $("#buildButton").classList.remove("busy");
  showToast("构建成功 · 代码、IOC 与电路已绑定");
  return true;
}

function updateRuntimeWatch(runtimeState) {
  const gpio = runtimeState?.gpio || runtimeState?.pins || {};
  const entries = Object.entries(gpio).filter(([pin]) => /^P[A-Z]\d+$/.test(pin));
  if (entries.length) {
    $("#gpioWatch").textContent = entries.slice(0, 4).map(([pin, value]) => `${pin}=${value ? 1 : 0}`).join("  ");
    return;
  }
  const adcEntries = Object.entries(runtimeState?.adc || {});
  $("#gpioWatch").textContent = adcEntries.length
    ? adcEntries.slice(0, 2).map(([instance, sample]) => `${instance}=${sample.value ?? 0}${sample.voltage == null ? "" : ` (${Number(sample.voltage).toFixed(2)}V)`}`).join("  ")
    : "—";
}

function handleRuntimeStatus(runtimeState) {
  const status = String(runtimeState?.status || "running");
  const previousStatus = state.runtimeStatus;
  state.runtimeStatus = status;

  if (status === "blocked") {
    const blocked = runtimeState?.blocked || {};
    const uart = blocked.instance || "UART";
    const available = Number(blocked.available) || 0;
    const required = Number(blocked.length) || 0;
    $("#engineState span").textContent = "WAITING UART";
    $("#mcuState").textContent = "WAIT RX";
    $("#cpuLoad").textContent = "0.0%";
    $("#simHint").textContent = `${uart} RX waiting for ${required} byte${required === 1 ? "" : "s"} · ${available}/${required} queued`;
    if (previousStatus !== "blocked") appendTerminal(`Firmware blocked on ${uart} RX · waiting for ${required} byte${required === 1 ? "" : "s"}`, "warn");
    // A blocking HAL_UART_Receive is a normal wait state. Keep the scheduler
    // alive so bytes submitted by the serial monitor can resume the firmware.
    return false;
  }

  if (status === "error" || status === "budget-exceeded") {
    const runtimeError = runtimeState?.error || {};
    const source = runtimeError.source || {};
    const code = runtimeError.code || (status === "budget-exceeded" ? "OPERATION_BUDGET_EXCEEDED" : "RUNTIME_ERROR");
    const message = runtimeError.message || `Firmware stopped with status ${status}`;
    const problemKey = `${status}:${code}:${source.file || ""}:${source.line || 0}:${message}`;
    if (state.runtimeProblemKey !== problemKey) {
      state.runtimeProblemKey = problemKey;
      updateProblems(mergeDiagnostics(state.diagnostics, [{
        file: normalizeProjectPath(source.file || state.firmwareModel?.program?.source || state.currentFile),
        severity: "error",
        line: Math.max(1, Number(source.line) || 1),
        column: Math.max(1, Number(source.column) || 1),
        message,
        source: "Alice HAL Runtime",
        code
      }]));
      appendTerminal(`HAL runtime stopped [${code}]: ${message}`, "error");
      showToast("HAL runtime stopped · see Problems", "error");
    }
    stopSimulation({ skipRuntimePause: true, silent: true });
    $("#engineState span").textContent = "RUNTIME ERROR";
    $("#mcuState").textContent = "FAULT";
    $("#simHint").textContent = message;
    switchBottom("problems");
    return true;
  }

  if (status === "completed") {
    if (previousStatus !== "completed") appendTerminal("Firmware main returned · simulation completed", "success");
    stopSimulation({ skipRuntimePause: true, silent: true });
    $("#engineState span").textContent = "COMPLETED";
    $("#mcuState").textContent = "HALTED";
    $("#simHint").textContent = "Firmware execution completed.";
    return true;
  }

  if (previousStatus === "blocked") {
    $("#engineState span").textContent = "SIMULATING";
    $("#mcuState").textContent = "RUNNING";
  }
  return false;
}

async function processCircuitTicks() {
  if (state.processingFrame) return;
  state.processingFrame = true;
  const frame = consumeSimulationFrame(16);
  if (!frame.ticks) { state.processingFrame = false; return; }
  const ticksThisFrame = frame.ticks;
  state.tickCount += ticksThisFrame;
  const deltaMs = frame.deltaMs;
  const startTime = state.circuitTime;
  let automationResult;
  let stepResult;
  let runtimeState = null;
  try {
    for (let index = 0; index < ticksThisFrame && state.running; index += 1) {
      const tickTime = startTime + index * state.tickSize;
      // Inputs and schematic-originated UART events at time t must be visible
      // before the firmware executes the interval [t, t + tickSize).
      automationResult = window.AliceEnvelopeAutomation?.advance?.(tickTime);
      window.AliceSchematic?.tick(tickTime, state.tickCount - ticksThisFrame + index, { render: false });
      stepResult = await window.AliceHalSimulator.step(state.tickSize);
      runtimeState = stepResult || runtimeState;
      const runtimeTime = Number(runtimeState.timeMs);
      state.circuitTime = Number.isFinite(runtimeTime) ? Math.max(state.circuitTime, runtimeTime) : tickTime + state.tickSize;
      if (runtimeState.status === "error" || runtimeState.status === "budget-exceeded" || runtimeState.status === "completed") break;
    }
    // Apply the exact frame boundary once more for rendering and for events
    // scheduled precisely at the boundary; firmware consumes them next tick.
    automationResult = window.AliceEnvelopeAutomation?.advance?.(state.circuitTime);
    window.AliceSchematic?.tick(state.circuitTime, state.tickCount);
  } catch (error) {
    appendTerminal(`Simulation stopped: ${error.message}`, "error");
    stopSimulation();
    showToast("仿真已停止 · 请查看终端", "error");
    state.processingFrame = false;
    return;
  }
  runtimeState = runtimeState || window.AliceHalSimulator.getRuntimeState() || {};
  const finalRuntimeTime = Number(runtimeState.timeMs);
  if (Number.isFinite(finalRuntimeTime)) state.circuitTime = Math.max(state.circuitTime, finalRuntimeTime);
  state.elapsed = state.circuitTime;
  state.sampleCounter = state.tickCount;
  const totalOperations = Number(stepResult?.operationsExecuted ?? runtimeState.operationsExecuted ?? 0);
  const executed = Math.max(0, totalOperations - state.lastOperationCount);
  state.lastOperationCount = totalOperations;
  const load = Math.min(100, Math.max(0.1, executed * 1.8 + 1.2)).toFixed(1);
  $("#tickWatch").textContent = Math.floor(state.circuitTime);
  $("#cpuLoad").textContent = `${load}%`;
  updateRuntimeWatch(runtimeState);
  $("#sampleCount").textContent = `${state.tickCount.toLocaleString()} ticks`;
  const tickCount = $("#tickCount");
  if (tickCount) tickCount.textContent = state.tickCount.toLocaleString();
  updateSimulationClocks();
  handleRuntimeStatus(runtimeState);
  if (automationResult?.complete && state.running) completeEnvelopeTest(automationResult);
  state.processingFrame = false;
}

function completeEnvelopeTest(result) {
  stopSimulation({ silent: true });
  $("#mcuState").textContent = "ENVELOPE DONE";
  $("#simHint").textContent = `包络测试完成 · 统一时间戳 ${(result.timeMs / 1000).toFixed(3)} s · 所有传感器已保持在末帧值`;
  appendTerminal(`Envelope test completed at ${(result.timeMs / 1000).toFixed(3)}s`, "success");
  showToast("传感器包络测试已完成");
}

function processEnvelopeOnlyTicks() {
  const frame = consumeSimulationFrame(16);
  if (!frame.ticks) return;
  const ticksThisFrame = frame.ticks;
  const deltaMs = frame.deltaMs;
  state.tickCount += ticksThisFrame;
  state.circuitTime += deltaMs;
  state.elapsed = state.circuitTime;
  state.sampleCounter = state.tickCount;
  const automationResult = window.AliceEnvelopeAutomation?.advance?.(state.circuitTime);
  $("#tickWatch").textContent = Math.floor(state.circuitTime);
  $("#cpuLoad").textContent = "0.0%";
  $("#sampleCount").textContent = `${state.tickCount.toLocaleString()} ticks`;
  if ($("#tickCount")) $("#tickCount").textContent = state.tickCount.toLocaleString();
  updateSimulationClocks();
  window.AliceSchematic?.tick(state.circuitTime, state.tickCount);
  // The schematic tick renderer uses RUNNING for firmware simulation. Restore
  // the more precise state for the firmware-free envelope preview.
  $("#mcuState").textContent = "SENSOR TEST";
  if (automationResult?.complete && state.running) completeEnvelopeTest(automationResult);
}

function startEnvelopePreview() {
  setAppPage("simulation");
  state.envelopeOnly = true;
  state.running = true;
  state.circuitTime = 0;
  state.elapsed = 0;
  state.tickCount = 0;
  state.sampleCounter = 0;
  state.simulationBudgetMs = 0;
  const envelopeState = window.AliceEnvelopeAutomation?.begin?.(0);
  if (!envelopeState?.active) {
    state.running = false;
    state.envelopeOnly = false;
    showToast("请先在包络编辑器中添加至少一条传感器轨道", "error");
    return false;
  }
  $("#runButton").classList.add("running");
  $("#runButton span").textContent = "STOP";
  $("#ribbonRun span").textContent = "停止";
  $("#ribbonRun").classList.add("running");
  $("#engineState").classList.add("running");
  $("#engineState span").textContent = "ENVELOPE TEST";
  $("#mcuState").textContent = "SENSOR TEST";
  $(".sim-console i").classList.add("active");
  $(".record-dot").classList.add("active");
  $("#simHint").textContent = `传感器独立包络测试 · ${envelopeState.values.length} 条轨道 · 原理图与输入值共用统一时间戳`;
  appendTerminal("alice envelope-test --sensor-only --timeline Main.sch", "command");
  appendTerminal("Firmware model unavailable · running deterministic sensor envelope preview", "warn");
  state.simTimer = setInterval(updateSimTime, 33);
  state.tickTimer = setInterval(processEnvelopeOnlyTicks, 16);
  showToast("已启动传感器独立包络测试");
  return true;
}

async function startSimulation() {
  setAppPage("simulation");
  let runtimeState;
  try {
    runtimeState = await window.AliceHalSimulator.start();
  } catch (error) {
    showToast(error.message || "HAL 仿真无法启动", "error");
    appendTerminal(`Run failed: ${error.message}`, "error");
    return false;
  }
  state.running = true;
  state.envelopeOnly = false;
  state.circuitTime = Number(runtimeState?.timeMs) || 0;
  state.elapsed = state.circuitTime;
  state.startTime = performance.now() - state.elapsed;
  state.lastFrameTime = performance.now();
  state.lastOperationCount = Number(runtimeState?.operationsExecuted) || 0;
  state.simulationBudgetMs = 0;
  const envelopeState = window.AliceEnvelopeAutomation?.begin?.(state.circuitTime);
  $("#runButton").classList.add("running");
  $("#runButton span").textContent = "STOP";
  $("#ribbonRun span").textContent = "停止";
  $("#ribbonRun").classList.add("running");
  $("#engineState").classList.add("running");
  $("#engineState span").textContent = "SIMULATING";
  $("#mcuState").textContent = "RUNNING";
  $(".sim-console i").classList.add("active");
  $(".record-dot").classList.add("active");
  $("#serialDot").classList.add("active");
  const summary = window.AliceHalSimulator.getSummary();
  $("#simHint").textContent = envelopeState?.active
    ? `包络测试运行中 · ${envelopeState.values.length} 条传感器轨道 · HAL 与原理图共用同一时间戳`
    : `HAL VM 正在执行 · GPIO ${summary.outputCount} · UART ${summary.uartCount} · I²C ${summary.i2cCount || 0} · SPI ${summary.spiCount || 0} · ADC ${summary.adcCount || 0} · 电路按实际网络求值`;
  appendTerminal(`alice hal-run ${summary.mcu} --netlist Main.sch`, "command");
  appendTerminal("HAL semantic runtime started · unsupported code will stop instead of faking output", "success");
  state.simTimer = setInterval(updateSimTime, 33);
  state.tickTimer = setInterval(processCircuitTicks, 16);
  updateRuntimeWatch(runtimeState);
  if (handleRuntimeStatus(runtimeState)) return false;
  showToast("HAL 代码与电路联合仿真已启动");
  return true;
}

function stopSimulation(options = {}) {
  const wasEnvelopeOnly = state.envelopeOnly;
  state.running = false;
  state.envelopeOnly = false;
  window.AliceEnvelopeAutomation?.pause?.();
  if (!wasEnvelopeOnly && !options.skipRuntimePause) {
    const pausedState = window.AliceHalSimulator?.pause();
    if (pausedState?.status) state.runtimeStatus = pausedState.status;
  }
  clearInterval(state.ledTimer); clearInterval(state.simTimer); clearInterval(state.tickTimer);
  $("#runButton").classList.remove("running");
  $("#runButton span").textContent = "RUN";
  $("#ribbonRun span").textContent = "运行";
  $("#ribbonRun").classList.remove("running");
  $("#engineState").classList.remove("running");
  $("#engineState span").textContent = "ENGINE READY";
  $("#mcuState").textContent = "PAUSED";
  $(".sim-console i").classList.remove("active");
  $(".record-dot").classList.remove("active");
  $("#simHint").textContent = "Simulation paused. State is preserved.";
  if (!options.silent) appendTerminal(`Simulation paused at ${(state.elapsed / 1000).toFixed(3)}s`, "warn");
}

function updateSimTime() {
  const total = Math.floor(state.circuitTime);
  const minutes = Math.floor(total / 60000).toString().padStart(2,"0");
  const seconds = Math.floor((total % 60000) / 1000).toString().padStart(2,"0");
  const ms = (total % 1000).toString().padStart(3,"0");
  $("#simTime").textContent = `${minutes}:${seconds}.${ms}`;
}

async function toggleRun() {
  if (state.running) { stopSimulation(); return; }
  if (!state.built && !(await buildProject())) {
    if (window.AliceEnvelopeAutomation?.getState?.().mode === "envelope") startEnvelopePreview();
    return;
  }
  startSimulation();
}

$("#buildButton").addEventListener("click", buildProject);
$("#runButton").addEventListener("click", toggleRun);
$("#sideLaunch").addEventListener("click", toggleRun);

window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") { event.preventDefault(); buildProject(); }
  if (event.key === "F5") { event.preventDefault(); toggleRun(); }
});

async function resetMcu(options = {}) {
  const restartFirmware = state.built && options.restart !== false;
  if (state.running) stopSimulation({ silent: true });
  state.elapsed = 0; state.sampleCounter = 0; state.tickCount = 0; state.circuitTime = 0; state.lastOperationCount = 0; state.simulationBudgetMs = 0;
  window.AliceEnvelopeAutomation?.reset?.();
  if (state.built) {
    try {
      const resetState = await window.AliceHalSimulator.reset();
      state.runtimeStatus = resetState?.status || "idle";
      state.runtimeProblemKey = "";
      updateRuntimeWatch(resetState);
      const retainedDiagnostics = state.diagnostics.filter(item => item.source !== "Alice HAL Runtime");
      if (retainedDiagnostics.length !== state.diagnostics.length) updateProblems(retainedDiagnostics);
    }
    catch (error) { appendTerminal(`Reset failed: ${error.message}`, "error"); }
  }
  $("#simTime").textContent = "00:00.000"; $("#tickWatch").textContent = "0"; $("#sampleCount").textContent = "0 ticks";
  if ($("#tickCount")) $("#tickCount").textContent = "0";
  updateSimulationClocks();
  if (!state.built) window.AliceSchematic?.reset();
  appendTerminal(restartFirmware ? "NRST asserted · restarting from Reset_Handler" : "NRST asserted · virtual MCU reset", "warn");
  if (restartFirmware) queueMicrotask(startSimulation);
  showToast(restartFirmware ? "MCU 已复位并重新执行外设初始化" : "MCU 已复位");
}

$("#resetButton").addEventListener("click", () => resetMcu());

$("#tickSizeSelect")?.addEventListener("change", event => {
  state.tickSize = Number(event.target.value) || 1;
  state.simulationBudgetMs = 0;
  showToast(`仿真时间刻已设为 ${event.target.options[event.target.selectedIndex].text}`);
});

$("#simulationSpeedSelect")?.addEventListener("change", event => {
  const label = setSimulationSpeed(event.target.value);
  showToast(`仿真倍速已设为 ${label}`);
});

$("#powerCalculationToggle")?.addEventListener("change", event => {
  const enabled = setPowerCalculationEnabled(event.target.checked);
  showToast(enabled ? "已启用电流、功率与过载计算" : "已切换为仅电压模式 · 电流与功率将被忽略");
});

document.addEventListener("alice:envelope-test-request", () => {
  if (state.running) stopSimulation({ silent: true });
  resetMcu({ restart: false });
  queueMicrotask(startEnvelopePreview);
});

document.addEventListener("alice:envelope-stop-request", () => {
  if (state.running) stopSimulation();
  else window.AliceEnvelopeAutomation?.pause?.();
});

function clearBuildTerminals() {
  const prompt = `<span class="prompt">alice@virtual-mcu</span><span class="muted">:</span><span class="path">~/STM32_Empty</span><span class="muted">$</span> <span class="cursor-block"></span>`;
  [$("#terminalOutput"), $("#simulationBuildOutput")].filter(Boolean).forEach(output => { output.innerHTML = prompt; });
  const buildState = $("#simulationBuildState");
  if (buildState) { buildState.textContent = "READY"; buildState.className = "ready"; }
}

$("#clearTerminal").addEventListener("click", clearBuildTerminals);
$("#clearSimulationBuild")?.addEventListener("click", clearBuildTerminals);
$("#collapsePanel").addEventListener("click", () => $("#bottomPanel").classList.toggle("collapsed"));

function setBuildPaneCollapsed(collapsed) {
  const pane = $("#simulationBuildMonitor");
  const toggle = $("#buildPaneToggle");
  if (!pane || !toggle) return;
  pane.classList.toggle("collapsed", Boolean(collapsed));
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("title", collapsed ? "展开编译输出" : "折叠编译输出");
  const symbol = toggle.querySelector('[aria-hidden="true"]');
  if (symbol) symbol.textContent = collapsed ? "⌃" : "⌄";
  const label = toggle.querySelector(".sr-only");
  if (label) label.textContent = collapsed ? "展开编译输出" : "折叠编译输出";
  window.dispatchEvent(new Event("resize"));
}

$("#buildPaneToggle")?.addEventListener("click", () => {
  setBuildPaneCollapsed(!$("#simulationBuildMonitor")?.classList.contains("collapsed"));
});

function serialTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString("zh-CN", { hour12:false }) + "." + String(now.getMilliseconds()).padStart(3,"0");
}

function appendSerialLine(content, className = "") {
  const timestamp = serialTimestamp();
  [$("#serialLines"), $("#simulationSerialLines")].filter(Boolean).forEach(lines => {
    lines.insertAdjacentHTML("beforeend", `<p${className ? ` class="${className}"` : ""}><span>${timestamp}</span>${content}</p>`);
    lines.scrollTop = lines.scrollHeight;
  });
}

function uartIdentity(uart) {
  return String(uart?.instance || uart?.handle || "").toUpperCase();
}

function selectedVirtualUart(summary = window.AliceHalSimulator?.getSummary?.() || { uarts: [] }) {
  const uarts = summary.uarts || [];
  const requested = String(state.virtualUartInstance || "").toUpperCase();
  return uarts.find(uart => uartIdentity(uart) === requested) || uarts[0] || null;
}

function renderVirtualUart(summary, options = {}) {
  const select = $("#virtualUartSelect");
  const uarts = summary?.uarts || [];
  if (select) {
    select.innerHTML = uarts.map(uart => {
      const name = uart.instance || uart.handle || "UART";
      const pins = [uart.txPin ? `TX ${uart.txPin}` : "", uart.rxPin ? `RX ${uart.rxPin}` : ""].filter(Boolean).join(" / ");
      return `<option value="${escapeHtml(name)}">${escapeHtml(name)}${pins ? ` · ${escapeHtml(pins)}` : ""}</option>`;
    }).join("") || '<option value="">当前工程没有 UART</option>';
  }

  const uart = selectedVirtualUart(summary);
  state.virtualUartInstance = uartIdentity(uart);
  if (select) {
    select.disabled = !uart;
    select.value = uart ? (uart.instance || uart.handle || "") : "";
  }

  if (!uart) {
    $("#debugUartName").textContent = "UART";
    $("#debugUartSummary").textContent = "代码未启用 UART";
    $("#logicTxChannel").textContent = "UART_TX";
    $("#logicRxChannel").textContent = "UART_RX";
    $("#serialInput").placeholder = "当前固件没有 UART";
    $("#simulationSerialInput").placeholder = "当前固件没有 UART";
    $("#simulationSerialPort").textContent = "未连接 UART";
    $("#simulationSerialStatus").textContent = "无可用端口";
    if (options.resetLog) {
      $("#serialLines").innerHTML = '<p><span>00:00:00.000</span> 当前 HAL 模型未发现 UART</p>';
      $("#simulationSerialLines").innerHTML = '<p><span>00:00:00.000</span> 当前 HAL 模型未发现 UART</p>';
    }
    return null;
  }

  const uartName = uart.instance || uart.handle || "UART";
  $("#debugUartName").textContent = uartName;
  $("#debugUartSummary").textContent = `${uart.baudRate || "?"} · ${uart.rxPin || "RX?"}/${uart.txPin || "TX?"}`;
  $("#logicTxChannel").textContent = `${uartName}_TX`;
  $("#logicRxChannel").textContent = `${uartName}_RX`;
  $("#serialInput").placeholder = `向 ${uartName} RX 发送数据…`;
  $("#simulationSerialInput").placeholder = `向 ${uartName} RX 发送数据…`;
  $("#simulationSerialPort").textContent = `${uart.baudRate || "?"} baud`;
  $("#simulationSerialStatus").textContent = `${uart.frame?.dataBits || 8}${String(uart.frame?.parity || "none").slice(0, 1).toUpperCase()}${uart.frame?.stopBits || 1}`;
  if (options.resetLog) {
    const connected = `<p><span>00:00:00.000</span> ${escapeHtml(uartName)} connected · ${escapeHtml(String(uart.baudRate || "unknown"))} baud · virtual port selected</p>`;
    $("#serialLines").innerHTML = connected;
    $("#simulationSerialLines").innerHTML = connected;
  }
  return uart;
}

$("#virtualUartSelect")?.addEventListener("change", event => {
  state.virtualUartInstance = String(event.target.value || "").toUpperCase();
  const uart = renderVirtualUart(window.AliceHalSimulator?.getSummary?.() || { uarts: [] });
  if (uart) appendSerialLine(`虚拟串口已切换到 ${escapeHtml(uart.instance || uart.handle || "UART")}`);
});

function serialBridgeApi() {
  return window.AliceSerialBridge || null;
}

function serialBridgeDeviceLabel(device) {
  if (!device) return "尚未授权设备";
  const hex = value => `0x${Number(value).toString(16).toUpperCase().padStart(4, "0")}`;
  if (device.usbVendorId != null || device.usbProductId != null) {
    return `USB VID ${hex(device.usbVendorId || 0)} · PID ${hex(device.usbProductId || 0)}`;
  }
  if (device.bluetoothServiceClassId) return `Bluetooth · ${device.bluetoothServiceClassId}`;
  return "已授权 PC 串口设备";
}

function serialBridgeFrameLabel(snapshot) {
  const options = snapshot?.serialOptions;
  if (!options) return "等待 MCU UART 配置";
  const parity = { none: "N", even: "E", odd: "O" }[options.parity] || "N";
  return `${options.baudRate} baud · ${options.dataBits}${parity}${options.stopBits} · 双向原始字节`;
}

function serialBridgePayload(detail) {
  const bytes = Array.isArray(detail?.bytes) ? detail.bytes : [];
  const text = String(detail?.text || "");
  const escaped = text.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  if (escaped && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(escaped)) return escaped;
  return bytes.map(byte => Number(byte).toString(16).toUpperCase().padStart(2, "0")).join(" ") || "(空数据)";
}

function renderSerialBridge(snapshot = serialBridgeApi()?.getState?.()) {
  if (!snapshot) return;
  const select = $("#serialBridgeUart");
  const connect = $("#connectSerialBridge");
  const disconnect = $("#disconnectSerialBridge");
  const stateLabel = $("#serialBridgeState");
  const device = $("#serialBridgeDevice");
  const config = $("#serialBridgeConfig strong");
  const hint = $("#serialBridgeHint");
  const openButton = $("#openSerialBridge");
  if (!select || !connect || !disconnect || !stateLabel || !device || !config || !hint) return;

  const selected = snapshot.targetInstance || "";
  const options = snapshot.uarts?.map(uart => {
    const name = uart.instance || uart.handle || "UART";
    const pins = [uart.txPin ? `TX ${uart.txPin}` : "", uart.rxPin ? `RX ${uart.rxPin}` : ""].filter(Boolean).join(" / ");
    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}${pins ? ` · ${escapeHtml(pins)}` : ""}</option>`;
  }).join("") || '<option value="">当前工程没有 UART</option>';
  if (select.innerHTML !== options) select.innerHTML = options;
  if (selected) select.value = selected;

  const busy = snapshot.connecting || snapshot.disconnecting;
  select.disabled = snapshot.connected || busy || !snapshot.uarts?.length;
  connect.disabled = snapshot.connected || busy || !snapshot.supported || !selected;
  disconnect.disabled = !snapshot.connected && !busy;
  connect.textContent = snapshot.connecting ? "等待设备授权…" : "选择 PC 设备并连接";
  stateLabel.textContent = snapshot.connected ? "已桥接" : snapshot.connecting ? "连接中" : snapshot.disconnecting ? "断开中" : snapshot.error ? "连接异常" : "未连接";
  stateLabel.className = snapshot.connected ? "connected" : snapshot.error ? "error" : "";
  device.textContent = serialBridgeDeviceLabel(snapshot.device);
  config.textContent = serialBridgeFrameLabel(snapshot);
  hint.textContent = !snapshot.supported
    ? "当前浏览器未提供 Web Serial。请使用支持串口设备授权的 Chromium 浏览器打开本地页面。"
    : snapshot.error || "连接时浏览器会显示 PC 串口授权窗口；MCU TX 与 PC RX、PC TX 与 MCU RX 将按原始字节双向转发。";
  hint.classList.toggle("error", Boolean(snapshot.error) || !snapshot.supported);
  openButton?.classList.toggle("connected", snapshot.connected);
  $("#serialBridgeDot")?.classList.toggle("active", snapshot.connected);
}

$("#openSerialBridge")?.addEventListener("click", () => {
  const bridge = serialBridgeApi();
  if (!bridge) {
    showToast("实体串口桥接模块尚未加载", "error");
    return;
  }
  const summary = window.AliceHalSimulator?.getSummary?.() || { uarts: [] };
  renderSerialBridge(bridge.configure(summary.uarts || []));
  $("#serialBridgeModal")?.classList.add("open");
});

$("#serialBridgeUart")?.addEventListener("change", event => {
  try { renderSerialBridge(serialBridgeApi()?.setTarget?.(event.target.value)); }
  catch (error) { showToast(error.message, "error"); renderSerialBridge(); }
});

$("#connectSerialBridge")?.addEventListener("click", async () => {
  const bridge = serialBridgeApi();
  if (!bridge) return;
  try {
    renderSerialBridge({ ...bridge.getState(), connecting: true });
    const snapshot = await bridge.connect($("#serialBridgeUart")?.value || "");
    renderSerialBridge(snapshot);
    appendSerialLine(`实体串口已连接 · ${escapeHtml(snapshot.targetInstance)} ↔ ${escapeHtml(serialBridgeDeviceLabel(snapshot.device))}`);
    showToast(`${snapshot.targetInstance} 已映射到 PC 串口`);
  } catch (error) {
    renderSerialBridge(bridge.getState());
    if (error?.name !== "NotFoundError") showToast(error.message, "error");
  }
});

$("#disconnectSerialBridge")?.addEventListener("click", async () => {
  const bridge = serialBridgeApi();
  if (!bridge) return;
  const instance = bridge.getState().targetInstance || "UART";
  renderSerialBridge(await bridge.disconnect());
  appendSerialLine(`实体串口已断开 · ${escapeHtml(instance)}`);
});

document.addEventListener("alice:serial-bridge-state", event => renderSerialBridge(event.detail?.bridge));
document.addEventListener("alice:serial-bridge-rx", event => {
  const detail = event.detail || {};
  appendSerialLine(`PC 串口 → ${escapeHtml(detail.instance || "UART")} RX: ${escapeHtml(serialBridgePayload(detail))}`);
});
document.addEventListener("alice:serial-bridge-tx", event => {
  const detail = event.detail || {};
  appendSerialLine(`${escapeHtml(detail.instance || "UART")} TX → PC 串口: ${escapeHtml(serialBridgePayload(detail))}`);
});
document.addEventListener("alice:serial-bridge-error", event => {
  const error = event.detail?.error || "实体串口桥接失败";
  appendSerialLine(`实体串口：${escapeHtml(error)}`, "error");
  renderSerialBridge(event.detail?.bridge);
});

async function sendSerialInput(input, ending = "none") {
  if (!input) return;
  const raw = input.value;
  if (!raw.length) return;
  const suffix = ending === "crlf" ? "\r\n" : ending === "lf" ? "\n" : ending === "cr" ? "\r" : "";
  const value = raw + suffix;
  try {
    const summary = window.AliceHalSimulator.getSummary();
    const uart = selectedVirtualUart(summary);
    if (!uart) throw new Error("当前工程没有可用 UART");
    const uartName = uart.instance || uart.handle || "UART";
    const queuedState = await window.AliceHalSimulator.enqueueSerial(value, uartName);
    if (state.running) handleRuntimeStatus(queuedState);
    appendSerialLine(`HOST → ${escapeHtml(uartName)} RX: ${escapeHtml(raw)}${suffix ? ` <small>${escapeHtml(ending.toUpperCase())}</small>` : ""}`);
  } catch (error) {
    appendSerialLine(escapeHtml(error.message), "error");
    showToast(error.message, "error");
  }
  input.value = "";
}

$("#serialForm").addEventListener("submit", event => {
  event.preventDefault();
  sendSerialInput($("#serialInput"));
});

$("#simulationSerialForm")?.addEventListener("submit", event => {
  event.preventDefault();
  sendSerialInput($("#simulationSerialInput"), $("#simulationSerialEnding")?.value || "none");
});

$("#clearSimulationSerial")?.addEventListener("click", () => {
  const lines = $("#simulationSerialLines");
  if (lines) lines.innerHTML = '<p><span>00:00:00.000</span> 串口记录已清空</p>';
});

function setRuntimeDockCollapsed(collapsed) {
  const dock = $("#simulationRuntimeDock");
  if (!dock) return;
  dock.classList.toggle("collapsed", Boolean(collapsed));
  ["freertos", "serial"].forEach(name => setRuntimePaneCollapsed(name, Boolean(collapsed), { resize: false }));
  window.dispatchEvent(new Event("resize"));
}

function setRuntimePaneCollapsed(name, collapsed, options = {}) {
  const dock = $("#simulationRuntimeDock");
  const pane = name === "freertos" ? $("#freertosMonitor") : $("#simulationSerialMonitor");
  const toggle = name === "freertos" ? $("#freertosPaneToggle") : $("#serialPaneToggle");
  if (!dock || !pane || !toggle) return;
  pane.classList.toggle("collapsed", Boolean(collapsed));
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("title", `${collapsed ? "展开" : "折叠"}${name === "freertos" ? " FreeRTOS" : "串口"}面板`);
  const symbol = toggle.querySelector('[aria-hidden="true"]');
  if (symbol) symbol.textContent = collapsed ? "⌄" : "⌃";
  const label = toggle.querySelector(".sr-only");
  if (label) label.textContent = `${collapsed ? "展开" : "折叠"}${name === "freertos" ? " FreeRTOS" : "串口"}面板`;
  const bothCollapsed = $("#freertosMonitor")?.classList.contains("collapsed")
    && $("#simulationSerialMonitor")?.classList.contains("collapsed");
  dock.classList.toggle("collapsed", Boolean(bothCollapsed));
  if (options.resize !== false) window.dispatchEvent(new Event("resize"));
}

$("#freertosPaneToggle")?.addEventListener("click", () => {
  setRuntimePaneCollapsed("freertos", !$("#freertosMonitor")?.classList.contains("collapsed"));
});

$("#serialPaneToggle")?.addEventListener("click", () => {
  setRuntimePaneCollapsed("serial", !$("#simulationSerialMonitor")?.classList.contains("collapsed"));
});

if (window.matchMedia?.("(max-height: 780px)").matches) setRuntimeDockCollapsed(true);

document.addEventListener("alice:firmware-uart-tx", event => {
  const detail = event.detail || {};
  const bytes = Array.isArray(detail.bytes) ? detail.bytes : null;
  const text = detail.text != null
    ? String(detail.text)
    : bytes ? String.fromCharCode(...bytes) : String(detail.data || "");
  const uartName = detail.instance || detail.uart || "UART";
  if (state.virtualUartInstance && uartIdentity(detail) !== state.virtualUartInstance) return;
  appendSerialLine(`${escapeHtml(uartName)} TX → HOST: ${escapeHtml(text)}`);
});

document.addEventListener("alice:uart-source-send", event => {
  const detail = event.detail || {};
  const uartName = detail.instance || "UART";
  if (state.virtualUartInstance && uartIdentity(detail) !== state.virtualUartInstance) return;
  const source = detail.ref || "TX SOURCE";
  appendSerialLine(`${escapeHtml(source)} → ${escapeHtml(uartName)} RX: ${escapeHtml(String(detail.text || ""))}`);
});

function updateFreeRtosMonitor(runtimeState = null, model = state.firmwareModel) {
  const descriptor = model?.middlewares?.freertos;
  const runtimeRtos = runtimeState?.rtos;
  const detected = Boolean(runtimeRtos?.detected || descriptor?.detected);
  const scheduler = $("#freertosSchedulerState");
  const body = $("#freertosTaskBody");
  if (!scheduler || !body) return;
  if (!detected) {
    scheduler.textContent = "BARE METAL";
    scheduler.classList.remove("running");
    $("#freertosTick").textContent = "0";
    $("#freertosHeap").textContent = "—";
    body.innerHTML = '<tr class="freertos-empty" id="freertosEmpty"><td colspan="7">Bare Metal · 未检测到 FreeRTOS</td></tr>';
    return;
  }
  const schedulerState = String(runtimeRtos?.schedulerState || descriptor?.scheduler || "ready");
  scheduler.textContent = `${runtimeRtos?.api || descriptor?.api || "FreeRTOS"} · ${schedulerState.toUpperCase()}`;
  scheduler.classList.toggle("running", schedulerState === "running");
  $("#freertosTick").textContent = Number(runtimeRtos?.tickCount || 0).toLocaleString();
  const heapTotal = Number(runtimeRtos?.heapTotalBytes ?? descriptor?.heapBytes ?? 0);
  const heapUsed = Number(runtimeRtos?.heapUsedBytes || 0);
  $("#freertosHeap").textContent = heapTotal ? `${Math.round(heapUsed / 1024 * 10) / 10}/${Math.round(heapTotal / 1024 * 10) / 10} KB` : "未配置";
  const tasks = runtimeRtos?.tasks || (descriptor?.tasks || []).map(task => ({ ...task, state: "Ready", stackHighWaterMarkWords: task.stackWords, cpuPercent: 0, runTimeMs: 0, waitObject: "—" }));
  if (!tasks.length) {
    body.innerHTML = '<tr class="freertos-empty" id="freertosEmpty"><td colspan="7">已检测到 FreeRTOS · 尚未识别任务创建调用</td></tr>';
    return;
  }
  body.innerHTML = tasks.map(task => {
    const stackWords = Math.max(1, Number(task.stackWords) || 1);
    const freeWords = Math.max(0, Number(task.stackHighWaterMarkWords ?? stackWords));
    const stackPercent = freeWords / stackWords * 100;
    const taskState = String(task.state || "Ready");
    const stateClass = taskState.toLowerCase();
    const current = runtimeRtos?.currentTaskId === task.id || taskState === "Running";
    return `<tr class="${current ? "current " : ""}${stackPercent < 15 ? "stack-warning" : ""}" title="${escapeHtml(task.entry || task.name || "Task")}">
      <td class="task-name"><strong>${escapeHtml(task.name || task.id || "Task")}</strong><small>${escapeHtml(task.entry || "")}</small></td>
      <td><span class="task-state ${escapeHtml(stateClass)}">${escapeHtml(taskState)}</span></td>
      <td>${escapeHtml(task.priorityLabel || String(task.priority ?? "—"))}</td>
      <td>${freeWords}/${stackWords} · ${stackPercent.toFixed(0)}%</td>
      <td>${Number(task.cpuPercent || 0).toFixed(1)}%</td>
      <td>${Number(task.runTimeMs || 0).toFixed(3)} ms</td>
      <td>${escapeHtml(task.waitObject || "—")}</td>
    </tr>`;
  }).join("");
}

document.addEventListener("alice:firmware-state", event => updateFreeRtosMonitor(event.detail || null));

document.addEventListener("alice:firmware-built", event => {
  const model = event.detail?.model || {};
  applyFirmwarePinModel(model);
  const summary = window.AliceHalSimulator.getSummary();
  const bridge = serialBridgeApi();
  if (bridge) renderSerialBridge(bridge.configure(summary.uarts || []));
  const outputLabels = summary.outputs.map(output => {
    const alias = output.aliases?.[0];
    return alias ? `${alias}=${output.physicalPin}` : output.physicalPin;
  });
  const firstI2c = summary.i2cs?.[0];
  const firstAdc = summary.adcs?.[0];
  const firstAdcChannel = firstAdc?.channels?.[0];
  $("#debugGpioSummary").textContent = outputLabels.length
    ? outputLabels.join(" · ")
    : [firstI2c ? `${firstI2c.instance || firstI2c.handle} ${firstI2c.sclPin || "SCL"}/${firstI2c.sdaPin || "SDA"}` : "", firstAdc ? `${firstAdc.instance || firstAdc.handle} ${firstAdcChannel?.pin || "ADC"}` : ""].filter(Boolean).join(" · ") || "代码未驱动 GPIO";
  $("#traceSignalName").textContent = summary.tracePin || "无 GPIO 波形";
  $("#logicPrimaryChannel").textContent = summary.tracePin ? `${summary.tracePin} / GPIO` : "GPIO output";
  renderTraceChannelOptions(summary.traceChannels || [], summary.tracePins || (summary.tracePin ? [summary.tracePin] : []));
  $("#gpioWatchLabel").textContent = outputLabels.length ? "GPIO pin state" : (firstAdc ? `${firstAdc.instance || firstAdc.handle} / ${firstAdcChannel?.pin || "analog"}` : "GPIO outputs");
  renderVirtualUart(summary, { resetLog: true });
  state.firmwareModel = model;
  updateFreeRtosMonitor(null, model);
});

function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

function applyClockTree(clockTree, sourceName = "IOC") {
  const clockApi = window.AliceClockTree;
  if (!clockTree || !clockApi) return null;
  const format = clockApi.formatFrequency;
  const sourceClockName = clockTree.source === "PLLCLK" ? clockTree.pllSource : clockTree.source;
  const sourceClockValue = sourceClockName === "HSE" ? clockTree.hse : clockTree.hsi;
  const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
  setText("#clockRibbonValue", clockTree.sysclk ? String(Math.round(clockTree.sysclk / 1000000)) : "—");
  setText("#clockTreeSubtitle", `${sourceName} · ${clockTree.confidence === "ioc-direct" ? "IOC 直接频率" : clockTree.confidence === "reset-default" ? "MCU 复位时钟" : "由 RCC 分频推导"}`);
  setText("#clockSourceName", sourceClockName || "CLOCK");
  setText("#clockSourceValue", format(sourceClockValue));
  setText("#clockSourceDetail", sourceClockName === "HSE" ? "External oscillator" : "Internal RC");
  setText("#clockPllSource", clockTree.pllSource || "—");
  setText("#clockPllPredivider", `÷ ${clockTree.pllPredivider || 1}`);
  setText("#clockPllMultiplier", clockTree.pllMultiplier ? `× ${clockTree.pllMultiplier}` : "BYPASS");
  setText("#clockPllValue", format(clockTree.pll));
  setText("#clockSysclkValue", format(clockTree.sysclk));
  setText("#clockSysclkSource", clockTree.source || "—");
  setText("#clockHclkValue", format(clockTree.hclk));
  setText("#clockHclkDivider", `AHB ÷ ${clockTree.ahbDivider}`);
  setText("#clockPclk1Value", format(clockTree.pclk1));
  setText("#clockPclk1Detail", `APB1 ÷ ${clockTree.apb1Divider} · TIM ${format(clockTree.timerPclk1)}`);
  setText("#clockPclk2Value", format(clockTree.pclk2));
  setText("#clockPclk2Detail", `APB2 ÷ ${clockTree.apb2Divider} · TIM ${format(clockTree.timerPclk2)}`);
  const status = $("#clockTreeStatus");
  if (status) {
    status.classList.toggle("warning", !clockTree.valid || clockTree.confidence === "reset-default");
    const label = status.querySelector("span");
    if (label) label.textContent = clockTree.valid
      ? (clockTree.confidence === "reset-default" ? "IOC 未配置 · 使用复位时钟" : "时钟有效")
      : (clockTree.issues?.[0] || "时钟配置不完整");
    status.title = (clockTree.issues || []).join("；");
  }
  return clockTree;
}

function parseIoc(text, fileName) {
  const values = {};
  text.split(/\r?\n/).forEach(line => {
    const idx = line.indexOf("=");
    if (idx > 0) values[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  const mcu = values["Mcu.CPN"] || values["Mcu.Name"] || values["ProjectManager.DeviceId"] || "STM32F103C8T6";
  const configuredPins = Object.entries(values).filter(([key, value]) => /^P[A-E]\d+(?:-[^.]+)?\.Signal$/.test(key) && value && value !== "GPIO_Analog");
  const clockTree = window.AliceClockTree?.fromValues?.(values) || null;
  const clock = clockTree?.sysclk ? clockTree.sysclk / 1000000 : null;
  return { name: fileName.replace(/\.ioc$/i,""), mcu, pins: configuredPins, clock, clockTree, raw: values };
}

function handleIoc(file) {
  if (!file || !file.name.toLowerCase().endsWith(".ioc")) { showToast("请选择有效的 STM32CubeMX .ioc 文件", "error"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const config = parseIoc(reader.result, file.name); state.importedConfig = config;
    const projectName = $(".project-name");
    projectName.textContent = `${config.name} `;
    const projectState = document.createElement("small");
    projectState.textContent = "●";
    projectName.appendChild(projectState);
    $(".tree-row.root strong").textContent = config.name;
    $("#importMcu").textContent = config.mcu;
    $("#importPins").textContent = `${config.pins.length} configured`;
    $("#importClock").textContent = config.clock ? `${Number(config.clock.toFixed(3))} MHz` : "未声明";
    $("#iocSummary").textContent = `已识别 ${config.mcu} 和 ${config.pins.length} 项引脚/外设配置。`;
    applyClockTree(config.clockTree, file.name);
    $("#iocModal").classList.add("open");
    applyImportedPins(config);
  };
  reader.readAsText(file);
}

document.addEventListener("alice:ioc-viewer-loaded", event => {
  if (event.detail?.clockTree) applyClockTree(event.detail.clockTree, event.detail.fileName || "IOC");
});

applyClockTree(window.AliceClockTree?.fromText?.(altFiles["STM32_Empty.ioc"]), "STM32_Empty.ioc");

$("#importButton").addEventListener("click", () => $("#iocInput").click());
$("#iocInput").addEventListener("change", event => handleIoc(event.target.files[0]));
let dragDepth = 0;
window.addEventListener("dragenter", event => { event.preventDefault(); dragDepth++; $("#dropOverlay").classList.add("show"); });
window.addEventListener("dragleave", event => { event.preventDefault(); dragDepth--; if (dragDepth <= 0) $("#dropOverlay").classList.remove("show"); });
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => { event.preventDefault(); dragDepth = 0; $("#dropOverlay").classList.remove("show"); handleIoc(event.dataTransfer.files[0]); });

$$('[data-close-modal]').forEach(btn => btn.addEventListener("click", () => btn.closest(".modal-backdrop").classList.remove("open")));
$$(".modal-backdrop").forEach(modal => modal.addEventListener("click", event => { if (event.target === modal) modal.classList.remove("open"); }));
$("#settingsButton").addEventListener("click", () => $("#settingsModal").classList.add("open"));
$("#fontSizeRange").addEventListener("input", event => {
  editor.style.fontSize = `${event.target.value}px`;
  codeHighlight.style.fontSize = `${event.target.value}px`;
});

$("#problemsList").addEventListener("click", event => {
  const row = event.target.closest("[data-problem-index]");
  if (!row) return;
  const diagnostic = state.diagnostics[Number(row.dataset.problemIndex)];
  if (!diagnostic) return;
  if (!diagnosticMatchesCurrentFile(diagnostic) && diagnostic.file) {
    window.AliceProjectWorkspace?.openFile?.(normalizeProjectPath(diagnostic.file));
  }
  openTab("code");
  const lines = editor.value.split("\n");
  const offset = lines.slice(0, diagnostic.line - 1).reduce((total, value) => total + value.length + 1, 0) + Math.max(0, diagnostic.column - 1);
  editor.focus();
  editor.setSelectionRange(offset, offset);
  editor.scrollTop = Math.max(0, (diagnostic.line - 5) * 20);
  updateLineNumbers();
});

$$(".tree-row.file").forEach(row => row.addEventListener("click", () => {
  $$(".tree-row.file").forEach(item => item.classList.remove("selected")); row.classList.add("selected");
  const file = row.dataset.file; state.currentFile = file;
  const content = file === "main.c" ? defaultCode : (altFiles[file] || "// Empty file");
  // Route static starter-project files through the same editor host used by
  // imported projects. This emits the file-open notification that resets
  // undo/redo and keeps the split editor in sync.
  if (window.AliceEditorHost?.openFile) {
    window.AliceEditorHost.openFile(file, content, { readOnly: false });
  } else {
    editor.value = content;
    renderHighlight(); updateLineNumbers(); openTab("code");
    scheduleDiagnostics();
    $(".work-tab[data-tab=code] .tab-file-name").textContent = file;
  }
}));

const allPins = ["VBAT","PC13","PC14","PC15","PD0","PD1","NRST","VSSA","VDDA","PA0","PA1","PA2","PA3","VSS","VDD","PA4","PA5","PA6","PA7","PB0","PB1","PB2","PB10","PB11","VSS","VDD","PB12","PB13","PB14","PB15","PA8","PA9","PA10","PA11","PA12","PA13","VSS","VDD","PA14","PA15","PB3","PB4","PB5","PB6","PB7","BOOT0","PB8","PB9"];
const configTypes = { PC13:"gpio", PA9:"uart", PA10:"uart", PA13:"system", PA14:"system", VDD:"power", VSS:"power", VDDA:"power", VSSA:"power", VBAT:"power", NRST:"system" };

function pinHtml(name, index) { const type = configTypes[name]; return `<span class="pin ${type ? `configured ${type}` : ""}" data-pin="${name}" title="${name}" aria-label="${name}"><span>${name}</span></span>`; }
function renderPins() {
  $("#pinsLeft").innerHTML = allPins.slice(0,12).map(pinHtml).join("");
  $("#pinsBottom").innerHTML = allPins.slice(12,24).map(pinHtml).join("");
  $("#pinsRight").innerHTML = allPins.slice(24,36).map(pinHtml).join("");
  $("#pinsTop").innerHTML = allPins.slice(36,48).map(pinHtml).join("");
}
renderPins();

function applyImportedPins(config) {
  $$(".pin[data-pin]").forEach(pin => { pin.className = "pin"; });
  config.pins.forEach(([key,value]) => {
    const name = key.match(/^P[A-E]\d+/)?.[0]; const pins = name ? $$(`.pin[data-pin="${name}"]`) : []; if (!pins.length) return;
    const type = /USART|UART/i.test(value) ? "uart" : /SWD|SYS|RCC|OSC/i.test(value) ? "system" : "gpio";
    pins.forEach(pin => { pin.className = `pin configured ${type}`; });
  });
}

function applyFirmwarePinModel(model) {
  const pins = model?.pins && typeof model.pins === "object" ? Object.entries(model.pins) : [];
  if (!pins.length) return;
  $$(".pin[data-pin]").forEach(pin => { pin.className = "pin"; });
  pins.forEach(([key, descriptor]) => {
    const name = String(descriptor?.physicalPin || descriptor?.pin || key || "").toUpperCase();
    if (!/^P[A-E]\d+$/.test(name)) return;
    const signal = String(descriptor?.iocSignal || descriptor?.signal || descriptor?.mode || "");
    const type = /USART|UART/i.test(signal) ? "uart" : /SWD|SYS|RCC|OSC/i.test(signal) ? "system" : "gpio";
    $$(`.pin[data-pin="${name}"]`).forEach(pin => { pin.className = `pin configured ${type}`; });
  });
}

const traceChannelButton = $("#traceChannelButton");
const traceChannelMenu = $("#traceChannelMenu");
const traceChannelOptions = $("#traceChannelOptions");
const traceChannelCount = $("#traceChannelCount");
const TRACE_COLORS = ["#107c10", "#0f6cbd", "#8764a5", "#ca5010"];

function traceChannelLabel(channel) {
  return `${channel.label || channel.pin}${channel.source && channel.source !== "GPIO" ? ` · ${channel.source}` : ""}`;
}

function selectedTracePins() {
  return $$("input[data-trace-pin]:checked", traceChannelOptions).map(input => input.dataset.tracePin);
}

function updateTraceChannelSummary(pins, channels) {
  const selected = Array.isArray(pins) ? pins : [];
  const descriptors = Array.isArray(channels) ? channels : [];
  const names = selected.map(pin => descriptors.find(channel => channel.pin === pin)?.label || pin);
  traceChannelCount.textContent = String(selected.length);
  $("#traceSignalName").textContent = names.length ? names.slice(0, 2).join(" · ") + (names.length > 2 ? ` +${names.length - 2}` : "") : "无 GPIO 波形";
}

function applyTraceChannelSelection(channels) {
  const selected = selectedTracePins();
  if (!selected.length) {
    const first = $("input[data-trace-pin]", traceChannelOptions);
    if (first) first.checked = true;
  }
  const next = selectedTracePins();
  window.AliceHalSimulator?.setTracePins?.(next);
  updateTraceChannelSummary(next, channels);
}

function renderTraceChannelOptions(channels, selectedPins) {
  if (!traceChannelOptions) return;
  const available = Array.isArray(channels) ? channels : [];
  const selected = new Set(Array.isArray(selectedPins) ? selectedPins : []);
  traceChannelOptions.innerHTML = "";
  if (!available.length) {
    traceChannelOptions.innerHTML = "<span class=\"trace-channel-empty\">构建后显示可用引脚</span>";
    updateTraceChannelSummary([], available);
    return;
  }
  available.forEach((channel, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.tracePin = channel.pin;
    input.checked = selected.has(channel.pin) || (!selected.size && index === 0);
    const swatch = document.createElement("i");
    swatch.style.backgroundColor = TRACE_COLORS[index % TRACE_COLORS.length];
    const text = document.createElement("span");
    text.textContent = traceChannelLabel(channel);
    label.append(input, swatch, text);
    input.addEventListener("change", () => {
      const checked = selectedTracePins();
      if (checked.length > 4) {
        input.checked = false;
        showToast("逻辑分析仪最多同时显示 4 路", "error");
        return;
      }
      applyTraceChannelSelection(available);
    });
    traceChannelOptions.appendChild(label);
  });
  applyTraceChannelSelection(available);
}

traceChannelButton?.addEventListener("click", event => {
  event.stopPropagation();
  const isHidden = traceChannelMenu.hidden;
  traceChannelMenu.hidden = !isHidden;
  traceChannelButton.setAttribute("aria-expanded", String(isHidden));
});
document.addEventListener("pointerdown", event => {
  if (traceChannelMenu && !traceChannelMenu.hidden && !traceChannelMenu.contains(event.target) && event.target !== traceChannelButton) {
    traceChannelMenu.hidden = true;
    traceChannelButton?.setAttribute("aria-expanded", "false");
  }
});

const canvas = $("#logicCanvas"); const ctx = canvas.getContext("2d");
function resizeCanvas() { const rect = canvas.getBoundingClientRect(); canvas.width = Math.max(1, rect.width * devicePixelRatio); canvas.height = Math.max(1, rect.height * devicePixelRatio); ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
function drawLogic() {
  const w = canvas.clientWidth, h = canvas.clientHeight; ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = "rgba(79,88,105,.14)"; ctx.lineWidth = 1;
  for(let x=0;x<w;x+=22){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()} for(let y=0;y<h;y+=18){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  const trace = window.AliceHalSimulator?.getTrace?.() || { samples: [], uartActive: false };
  const channels = Array.isArray(trace.channels) && trace.channels.length
    ? trace.channels
    : [{ pin: trace.pin || "GPIO", label: trace.pin || "GPIO", samples: trace.samples || [] }];
  const laneHeight = h / Math.max(1, channels.length);
  channels.forEach((channel, index) => {
    const samples = channel.samples || [];
    const top = index * laneHeight;
    const high = top + Math.max(5, laneHeight * .28);
    const low = top + Math.min(laneHeight - 4, laneHeight * .72);
    const color = TRACE_COLORS[index % TRACE_COLORS.length];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 2;
    ctx.beginPath();
    if (samples.length) {
      const firstTime = samples[0].timeMs;
      const lastTime = samples[samples.length - 1].timeMs;
      const span = Math.max(1, lastTime - firstTime);
      let sampleIndex = 0;
      let previousY = samples[0].value ? high : low;
      ctx.moveTo(0, previousY);
      for (let x = 1; x <= w; x++) {
        const targetTime = firstTime + span * x / w;
        while (sampleIndex + 1 < samples.length && samples[sampleIndex + 1].timeMs <= targetTime) sampleIndex++;
        const y = samples[sampleIndex].value ? high : low;
        if (y !== previousY) ctx.lineTo(x, previousY);
        ctx.lineTo(x, y);
        previousY = y;
      }
    } else {
      ctx.moveTo(0, low); ctx.lineTo(w, low);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.fillText(channel.label || channel.pin, 5, top + 11);
    ctx.restore();
  });
  requestAnimationFrame(drawLogic);
}
window.addEventListener("resize", resizeCanvas); setTimeout(resizeCanvas,50); drawLogic();

$("#ribbonImport")?.addEventListener("click", () => $("#iocInput")?.click());
$("#ribbonBuild").addEventListener("click", buildProject);
$("#ribbonRun").addEventListener("click", toggleRun);
$("#ribbonReset").addEventListener("click", () => $("#resetButton").click());
$$('[data-ribbon-tab]').forEach(button => button.addEventListener("click", () => openTab(button.dataset.ribbonTab)));
$$('[data-activity]').forEach(button => button.addEventListener("click", () => {
  const target = $(`.activity-item[data-view="${button.dataset.activity}"]`);
  if (target) target.click();
}));
$$('[data-bottom-open]').forEach(button => button.addEventListener("click", () => switchBottom(button.dataset.bottomOpen)));
$$('[data-app-page]').forEach(button => button.addEventListener("click", () => setAppPage(button.dataset.appPage)));
document.addEventListener("alice:app-page-request", event => setAppPage(event.detail?.page));
$$('[data-pane-toggle]').forEach(toggle => toggle.addEventListener("change", () => {
  if (toggle.dataset.paneToggle === "simulator") {
    setAppPage(toggle.checked ? "simulation" : "code");
    return;
  }
  const bodyClass = {
    project: "hide-project-pane",
    output: "hide-output-pane"
  }[toggle.dataset.paneToggle];
  if (toggle.dataset.paneToggle === "project" && mobileSidebarMedia.matches) {
    setMobileSidebarOpen(toggle.checked);
    return;
  }
  document.body.classList.toggle(bodyClass, !toggle.checked);
  setTimeout(resizeCanvas, 50);
}));
$$('.ribbon-tabs button:not(.file-tab)').forEach(button => button.addEventListener("click", () => {
  $$('.ribbon-tabs button:not(.file-tab)').forEach(item => item.classList.remove("active"));
  button.classList.add("active");
}));

let initialAppPage = "code";
let initialSimulationSpeed = 1;
let initialPowerCalculation = true;
try {
  initialAppPage = normalizeAppPage(localStorage.getItem(APP_PAGE_STORAGE_KEY));
  initialSimulationSpeed = Number(localStorage.getItem(SIMULATION_SPEED_STORAGE_KEY)) || 1;
  initialPowerCalculation = localStorage.getItem(POWER_CALCULATION_STORAGE_KEY) !== "0";
} catch (_) {}
setSimulationSpeed(initialSimulationSpeed, { save: false });
setPowerCalculationEnabled(initialPowerCalculation, { save: false });
setAppPage(initialAppPage, { save: false });

window.AliceEditorHost = Object.freeze({
  openFile(path, content, options = {}) {
    if (path && typeof path === "object") {
      const descriptor = path;
      path = descriptor.path;
      content = descriptor.content;
      options = descriptor;
    }
    const normalizedPath = normalizeProjectPath(path) || "main.c";
    state.currentFile = normalizedPath;
    editor.value = String(content ?? "");
    editor.readOnly = Boolean(options.readOnly);
    editor.dataset.aliceProjectPath = normalizedPath;
    editor.setAttribute("aria-readonly", String(editor.readOnly));
    renderHighlight();
    updateLineNumbers();
    state.built = false;
    openTab("code");
    const tabName = $(".work-tab[data-tab=code] .tab-file-name");
    if (tabName) tabName.textContent = normalizedPath.split("/").pop();
    const breadcrumbName = $(".editor-breadcrumb strong");
    if (breadcrumbName) breadcrumbName.textContent = normalizedPath;
    scheduleDiagnostics();
    // Notify the UI history manager after a programmatic file switch.  A file
    // switch must start a fresh undo stack; otherwise Ctrl+Z can restore text
    // from the previously open file.
    window.dispatchEvent(new CustomEvent("alice-editor-file-open", {
      detail: {
        path: normalizedPath,
        content: editor.value,
        readOnly: editor.readOnly
      }
    }));
    return true;
  },
  getCurrentFile() {
    return { path: normalizeProjectPath(state.currentFile), content: editor.value, readOnly: editor.readOnly };
  },
  refresh() {
    renderHighlight();
    updateLineNumbers();
    scheduleDiagnostics();
  },
  openTab,
  notify: showToast,
  runDiagnostics
});

setTimeout(() => $("#bootScreen").classList.add("hide"), 1150);
setTimeout(() => showToast("Alice Engine 就绪 · STM32F103C8T6"), 1550);
