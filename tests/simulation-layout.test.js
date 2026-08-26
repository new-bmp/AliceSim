"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const automation = fs.readFileSync(path.join(root, "envelope-automation.js"), "utf8");
const schematic = fs.readFileSync(path.join(root, "schematic.js"), "utf8");
const panelResize = fs.readFileSync(path.join(root, "panel-resize.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serialBridge = fs.readFileSync(path.join(root, "serial-device-bridge.js"), "utf8");
const clockTree = fs.readFileSync(path.join(root, "clock-tree.js"), "utf8");
const halSimulator = fs.readFileSync(path.join(root, "hal-simulator.js"), "utf8");

test("simulation controls are integrated into the unified time observer", () => {
  const observer = html.indexOf('<div class="simulation-time-observer">');
  const controls = html.indexOf('<div class="sim-console schematic-console">', observer);
  const timeline = html.indexOf('<div class="signal-panel schematic-timeline">', observer);
  const envelope = html.indexOf('<div class="envelope-dock"', observer);
  const panelEnd = html.indexOf("</aside>", observer);

  assert.ok(observer >= 0);
  assert.ok(observer < controls && controls < timeline && timeline < envelope && envelope < panelEnd);
  assert.equal(html.indexOf('<div class="sim-console schematic-console">', controls + 1), -1);
  assert.match(styles, /simulation-time-observer > \.schematic-console/);
  assert.match(styles, /grid-template-rows: 38px 34px minmax\(0, 1fr\)/);
});

test("simulation page contains the FreeRTOS debugger and the real UART terminal", () => {
  const simulator = html.indexOf('<aside class="simulator-panel" data-page-surface="simulation">');
  const runtimeDock = html.indexOf('id="simulationRuntimeDock"', simulator);
  const rtos = html.indexOf('id="freertosMonitor"', runtimeDock);
  const serial = html.indexOf('id="simulationSerialForm"', runtimeDock);
  const observer = html.indexOf('<div class="simulation-time-observer">', runtimeDock);

  assert.ok(simulator >= 0 && simulator < runtimeDock && runtimeDock < rtos && rtos < serial && serial < observer);
  assert.match(html, /<th>任务<\/th><th>状态<\/th><th>优先级<\/th><th>栈余量<\/th><th>CPU<\/th><th>运行时间<\/th><th>等待对象<\/th>/);
  assert.match(app, /function updateFreeRtosMonitor/);
  assert.match(app, /AliceHalSimulator\.enqueueSerial\(value, uartName\)/);
  assert.match(html, /id="virtualUartSelect"[^>]*aria-label="虚拟 UART 端口"/);
  assert.match(app, /function renderVirtualUart/);
  assert.match(app, /state\.virtualUartInstance/);
  assert.match(halSimulator, /findUart\(currentModel, instance, false\)/);
  assert.match(app, /simulationSerialLines/);
  assert.match(styles, /\.simulation-runtime-dock[\s\S]*?grid-template-columns/);
});

test("FreeRTOS and serial panes can be folded independently", () => {
  assert.match(html, /id="freertosPaneToggle"[^>]*aria-controls="freertosMonitor"[^>]*aria-expanded="true"/);
  assert.match(html, /id="serialPaneToggle"[^>]*aria-controls="simulationSerialMonitor"[^>]*aria-expanded="true"/);
  assert.match(app, /function setRuntimePaneCollapsed\(name, collapsed/);
  assert.match(app, /setRuntimePaneCollapsed\("freertos"/);
  assert.match(app, /setRuntimePaneCollapsed\("serial"/);
  assert.match(styles, /\.freertos-monitor\.collapsed \.freertos-table-wrap/);
  assert.match(styles, /\.simulation-serial-monitor\.collapsed \.simulation-serial-lines/);
});

test("simulation page mirrors build output in an independently foldable terminal", () => {
  assert.match(html, /id="simulationBuildMonitor"[^>]*aria-label="仿真编译输出"/);
  assert.match(html, /id="simulationBuildOutput"/);
  assert.match(html, /id="buildPaneToggle"[^>]*aria-controls="simulationBuildMonitor"[^>]*aria-expanded="true"/);
  assert.match(app, /\[\$\("#terminalOutput"\), \$\("#simulationBuildOutput"\)\]/);
  assert.match(app, /function setBuildPaneCollapsed/);
  assert.match(styles, /\.simulation-build-monitor\.collapsed \.simulation-build-output/);
});

test("right mouse drag pans the schematic and suppresses the context menu", () => {
  assert.match(schematic, /event\.button === 1 \|\| event\.button === 2/);
  assert.match(schematic, /addEventListener\("contextmenu"[\s\S]*?event\.preventDefault\(\)/);
  assert.match(schematic, /function beginPan\(event\)/);
});

test("browser navigation gestures are bounded without disabling touch input globally", () => {
  const rootInputRules = styles.match(/html, body \{([^}]*)\}/)?.[1] || "";
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
  assert.match(rootInputRules, /overscroll-behavior: none;/);
  assert.doesNotMatch(rootInputRules, /touch-action:/);
  assert.match(styles, /\.visio-theme \.schematic-viewport \{[\s\S]*?touch-action: none;/);
  assert.doesNotMatch(app, /preventBrowserGesture/);
});

test("successful Clang checks are not overridden by the local main regex", () => {
  assert.match(app, /state\.clangAvailable[\s\S]*?localDiagnostics\.filter\(item => item\.severity === "warning"\)/);
  assert.doesNotMatch(app, /state\.clangAvailable[\s\S]{0,160}item\.message\.includes\("程序入口"\)/);
});

test("MCU reset replays firmware initialization without a delayed schematic reset", () => {
  assert.match(app, /function resetMcu\(options = \{\}\)[\s\S]*?stopSimulation\(\{ silent: true \}\)[\s\S]*?AliceHalSimulator\.reset\(\)[\s\S]*?queueMicrotask\(startSimulation\)/);
  assert.match(schematic, /if \(!window\.AliceHalSimulator\) queueMicrotask\(resetSimulation\)/);
  assert.doesNotMatch(schematic, /queueMicrotask\(resetSimulation\); \}\);/);
});

test("MCU UART can be mapped bidirectionally to a user-authorized PC serial device", () => {
  assert.match(html, /id="openSerialBridge"/);
  assert.match(html, /id="serialBridgeUart"/);
  assert.match(html, /id="connectSerialBridge"/);
  assert.match(html, /serial-device-bridge\.js/);
  assert.match(serialBridge, /serial\.requestPort\(\)/);
  assert.match(serialBridge, /writer\.write\(new Uint8Array\(bytes\)\)/);
  assert.match(serialBridge, /hal\.enqueueSerialBytes\(bytes, uart\.instance \|\| uart\.handle\)/);
  assert.match(app, /bridge\.configure\(summary\.uarts \|\| \[\]\)/);
  assert.match(styles, /\.serial-bridge-modal/);
});

test("clock configuration is data-driven and PWM duty is visible on connected devices", () => {
  assert.match(html, /id="clockSysclkValue"/);
  assert.match(html, /id="clockPclk1Detail"/);
  assert.match(html, /clock-tree\.js/);
  assert.match(clockTree, /timerPclk1/);
  assert.match(clockTree, /confidence: !hasRcc \? "reset-default"/);
  assert.match(app, /function applyClockTree/);
  assert.match(app, /applyClockTree\(window\.AliceClockTree\?\.fromText\?\.\(altFiles\["STM32_Empty\.ioc"\]\)/);
  assert.match(schematic, /function driveMcuPwm/);
  assert.match(schematic, /component-pwm-badge/);
  assert.match(styles, /\.component-pwm-badge/);
});

test("power calculation can be disabled while retaining voltage-only simulation", () => {
  assert.match(html, /id="powerCalculationToggle"[^>]*type="checkbox"[^>]*checked/);
  assert.match(html, /id="powerCalculationState">开</);
  assert.match(app, /POWER_CALCULATION_STORAGE_KEY/);
  assert.match(app, /setPowerCalculationEnabled\(event\.target\.checked\)/);
  assert.match(schematic, /mode: "voltage-only"/);
  assert.match(schematic, /currentProbeState[\s\S]*?code: "disabled"/);
  assert.match(styles, /power-calculation-disabled[\s\S]*?power-calculation-toggle/);
});

test("the envelope editor opens by default when the simulation page is shown", () => {
  assert.match(automation, /alice:workspace-page-change/);
  assert.match(automation, /event\.detail\.page === "simulation"[\s\S]*?open\(\)/);
  assert.match(automation, /body\.classList\.contains\("app-page-simulation"\)[\s\S]*?requestAnimationFrame\(open\)/);
});

test("placing an automatable component refreshes the envelope target list", () => {
  assert.match(schematic, /function addLibraryComponent[\s\S]*?emitSchematicChange\("add-component", component\)/);
  assert.match(schematic, /function deleteSelection[\s\S]*?emitSchematicChange\("delete-component", removedComponent\)/);
  assert.match(automation, /alice:schematic-change[\s\S]*?refreshTargets\(\)/);
});

test("ADC source, SPI display and conditional UART sender are exposed as real simulation components", () => {
  assert.match(html, /data-component-type="adcSource"/);
  assert.match(html, /data-component-type="spiDisplay"/);
  assert.match(html, /data-component-type="uartSender"/);
  assert.match(html, /spi-display-device\.js/);
  assert.match(schematic, /component\.type === "adcSource"[\s\S]*?addAnalogDriver/);
  assert.match(schematic, /handleSpiTransmission/);
  assert.match(schematic, /processUartSenders/);
  assert.match(schematic, /ADC 采集电压/);
});

test("the workspace has a non-blocking bottom edge", () => {
  assert.match(styles, /body\.visio-theme::after/);
  assert.match(styles, /bottom: 0;[\s\S]*?height: 2px;[\s\S]*?pointer-events: none;/);
});

test("the logic and envelope observer supports persistent vertical resizing", () => {
  assert.match(html, /id="timeObserverResizer"[\s\S]*?role="separator"[\s\S]*?aria-orientation="horizontal"/);
  assert.match(styles, /\.time-observer-resizer[\s\S]*?cursor: row-resize/);
  assert.match(panelResize, /TIME_OBSERVER_HEIGHT_KEY/);
  assert.match(panelResize, /startHeight \+ timeObserverDrag\.startY - event\.clientY/);
  assert.match(panelResize, /ArrowUp[\s\S]*?ArrowDown[\s\S]*?resetTimeObserverHeight/);
  assert.match(panelResize, /window\.AliceObserverLayout = Object\.freeze/);
  assert.match(panelResize, /setState:[\s\S]*?setObserverPaneCollapsed\("logic"[\s\S]*?setObserverPaneCollapsed\("envelope"/);
});

test("the logic analyzer and envelope editor fold independently and persist their state", () => {
  assert.match(html, /id="logicAnalyzerPaneToggle"[^>]*aria-controls="logicCanvas"[^>]*aria-expanded="true"/);
  assert.match(automation, /id="envelopePaneToggle"[^>]*aria-controls="envelopeDockHost"[^>]*aria-expanded=\\?"true\\?"/);
  assert.match(panelResize, /LOGIC_ANALYZER_COLLAPSED_KEY = "alice\.logic-analyzer\.collapsed\.v1"/);
  assert.match(panelResize, /ENVELOPE_PANE_COLLAPSED_KEY = "alice\.envelope\.collapsed\.v1"/);
  assert.match(panelResize, /function setObserverPaneCollapsed\(name, collapsed/);
  assert.match(panelResize, /observer-panes-collapsed/);
  assert.match(styles, /schematic-timeline\.collapsed #logicCanvas/);
  assert.match(styles, /envelope-dock\.collapsed \.envelope-workspace/);
});

test("the envelope editor receives a larger workspace when it is open", () => {
  assert.match(styles, /simulation-time-observer:has\(\.envelope-dock\.open\)[\s\S]*?flex-basis: clamp\(340px, 48vh, 460px\)/);
  assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*?flex-basis: min\(500px, 64vh\)/);
  assert.match(styles, /grid-template-rows: 38px 34px 92px minmax\(0, 1fr\)/);
  assert.match(styles, /grid-template-columns: clamp\(150px, 32%, 190px\) minmax\(0, 1fr\)/);
});

test("the left project sidebar supports persistent horizontal resizing", () => {
  assert.match(panelResize, /SIDEBAR_WIDTH_KEY = "alice\.sidebar\.width\.v1"/);
  assert.match(panelResize, /alice-sidebar-resizer[\s\S]*?role", "separator"[\s\S]*?aria-orientation", "vertical"/);
  assert.match(panelResize, /startWidth \+ event\.clientX - sidebarDrag\.startX/);
  assert.match(panelResize, /body\.style\.setProperty\("--side", sidebarEffectiveWidth \+ "px"\)/);
  assert.match(panelResize, /ArrowLeft[\s\S]*?ArrowRight[\s\S]*?resetSidebarWidth/);
  assert.match(panelResize, /window\.AliceSidebarLayout = Object\.freeze/);
});

test("small screens keep the activity bar and expose the sidebar as a dismissible drawer", () => {
  assert.match(html, /id="mobileSidebarScrim"[^>]*aria-label="关闭侧栏"/);
  assert.match(html, /id="mobileSidebarClose"[^>]*aria-label="关闭侧栏"/);
  assert.match(html, /data-view="project"[^>]*aria-controls="sidebar"/);
  assert.match(app, /function setMobileSidebarOpen/);
  assert.match(app, /repeatMobileSelection/);
  assert.match(app, /event\.key === "Escape"[\s\S]*?mobile-sidebar-open/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?grid-template-columns: var\(--activity\) minmax\(0, 1fr\) !important/);
  assert.match(styles, /mobile-sidebar-open \.sidebar[\s\S]*?transform: translateX\(0\)/);
  assert.match(styles, /mobile-sidebar-open \.mobile-sidebar-scrim/);
});

test("the application uses a compensated 90 percent scale and a non-overlapping status grid", () => {
  assert.match(styles, /AliceSIM global 90% UI scale/);
  assert.match(styles, /body \{ zoom: var\(--alice-ui-scale\); \}/);
  assert.match(styles, /width: 111\.111111vw;[\s\S]*?height: 111\.111111vh;/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.status-center \{[\s\S]*?position: static;[\s\S]*?transform: none;/);
  assert.match(styles, /\.status-right,[\s\S]*?\.visio-theme \.status-right \{[\s\S]*?display: flex;/);
  assert.match(styles, /@container \(max-width: 760px\)[\s\S]*?span:nth-child\(-n \+ 4\)[\s\S]*?span:nth-child\(n \+ 5\) \{ display: flex; \}/);
  assert.match(styles, /@container \(max-width: 420px\)[\s\S]*?\.visio-theme \.status-right \{ display: none; \}/);
});

test("envelope tests use the independent sensor timeline", () => {
  const request = app.match(/document\.addEventListener\("alice:envelope-test-request"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(request, /queueMicrotask\(startEnvelopePreview\)/);
  assert.doesNotMatch(request, /buildProject\(\)|startSimulation\(\)/);
});

test("the default workspace is not the BluePill blinky example", () => {
  assert.doesNotMatch(html, /BluePill_Blinky/);
  assert.doesNotMatch(app, /HAL_GPIO_TogglePin\(GPIOC/);
  const starter = app.match(/const defaultCode = `[\s\S]*?`;\n/)?.[0] || "";
  assert.match(starter, /while \(1\)[\s\S]*HAL_Delay\(1U\)/);
  const seed = schematic.match(/function seedInitialCircuit[\s\S]*?\n  }/)?.[0] || "";
  assert.doesNotMatch(seed, /demo-pc13|createComponentModel\("led"|createComponentModel\("resistor"/);
});
