"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {execFileSync} = require("node:child_process");
const {root} = require("./_tutorial-environment.cjs");
const runtimeApi = require(path.join(root, "firmware-runtime.js"));
const python = process.env.ALICESIM_PYTHON || require("./_tutorial-environment.cjs").python;
const model = JSON.parse(execFileSync(python, [path.join(__dirname, "verify.py"), "--model"], {encoding:"utf8", cwd:root}));
function loadCircuit() {
  const window = {addEventListener() {},
    AliceOledDevice: require(path.join(root, "oled-device.js")),
    AliceSpiDisplayDevice: require(path.join(root, "spi-display-device.js")),
    AliceLightSensorDevice: require(path.join(root, "light-sensor-device.js")),
    AlicePeripheralCatalog: require(path.join(root, "peripheral-catalog.js")),
    AlicePeripheralDevices: require(path.join(root, "peripheral-devices.js"))};
  const context = vm.createContext({window, document:{readyState:"loading", addEventListener() {}, body:null},
    Blob, console, queueMicrotask, setTimeout, clearTimeout,
    CustomEvent:function(type, options) {this.type=type; this.detail=options && options.detail;}});
  vm.runInContext(fs.readFileSync(path.join(root,"schematic.js"),"utf8"),context,{filename:"schematic.js"});
  const circuit = window.AliceSchematic;
  circuit.applyProjectModel(model);
  const imported = circuit.importCircuit(JSON.parse(fs.readFileSync(path.join(__dirname,"Learning10_ButtonEXTI.alice-sch.json"),"utf8")));
  assert.equal(imported.ok,true,JSON.stringify(imported));
  return circuit;
}
const circuit = loadCircuit();
const transmissions = [];
const runtime = runtimeApi.create(model, {
  onGpioRead: e => ({value:circuit.sampleMcuPin(e.pin)}),
  onGpio: e => circuit.driveMcuPin(e.pin,e.value),
  onUartTx: e => transmissions.push(e.text)
});
let state;
let lastClosed=false;
function advance(ms) {
  state = runtime.step(ms);
  while (state.pendingAdvanceMs > 0) state=runtime.step(0);
  assert.notEqual(state.status,"error",JSON.stringify(state.error));
  return state;
}
function button(closed) {
  circuit.setButtonClosed("button",closed);
  assert.equal(circuit.sampleMcuPin("PA1"),closed ? 0 : 1,"actual wired active-low input");
  state=runtime.syncGpioInputs({PA1:circuit.sampleMcuPin("PA1")});
  if (closed!==lastClosed) assert.equal(state.variables.edge_pending,1,"EXTI callback must notify main");
  lastClosed=closed;
}
assert.equal(model.pins.PA1.interruptEdge,"both");
assert.ok(model.callbacks.HAL_GPIO_EXTI_Callback);
runtime.start();
advance(0);
button(false); // establish initial input level; no phantom edge
advance(50);
assert.equal(state.variables.press_count,0);
assert.equal(state.gpio.PB12,0);
assert.equal(state.gpio.PB13,0);
// Controlled contact bounce; AliceSIM's button does not generate bounce itself.
button(true); advance(5); button(false); advance(5);
button(true); advance(5); button(false); advance(5);
button(true); advance(29);
assert.equal(state.variables.pressed,0,"must reject a level not yet stable for 30 ms");
advance(2);
assert.equal(state.variables.pressed,1);
assert.equal(state.gpio.PB12,1);
assert.equal(circuit.compileNetlist().leds.find(l=>l.componentId==="press-led").on,true);
assert.equal(state.variables.press_count,0,"short action waits for release");
button(false); advance(5); button(true); advance(5); button(false); advance(29);
assert.equal(state.variables.press_count,0);
advance(2);
assert.equal(state.variables.press_count,1,"one short count despite both press/release bounce");
assert.equal(state.gpio.PB12,0);
assert.equal(state.gpio.PB13,1);
advance(100);
assert.equal(state.variables.press_count,1,"stable release never repeats");
button(true); advance(35); button(false); advance(35);
assert.equal(state.variables.press_count,2);
assert.equal(state.gpio.PB13,0,"even count LED is off");
button(true); advance(35); advance(980);
assert.equal(state.variables.press_count,2,"long threshold measured after debounced press");
advance(20);
assert.equal(state.variables.press_count,0);
assert.equal(state.variables.long_handled,1);
advance(1200);
assert.equal(transmissions.filter(t=>t.includes("LONG RESET")).length,1,"long reset happens only once");
button(false); advance(5); button(true); advance(5); button(false); advance(35);
assert.equal(state.variables.press_count,0,"release after long does not become a short press");
assert.equal(state.gpio.PB12,0);
button(true); advance(10); button(false); advance(40);
assert.equal(state.variables.press_count,0,"a 10 ms spike is rejected");
button(true); advance(35); button(false); advance(35);
assert.equal(state.variables.press_count,1,"next short press still works after long reset");
assert.equal(state.gpio.PB13,1);
assert.equal(transmissions.filter(t=>t.includes("SHORT")).length,3);
assert.ok(transmissions.includes("SHORT count=1\r\n"));
assert.equal(state.interrupts.history.filter(e=>e.type==="gpioExti").length,18,"every injected edge reaches actual EXTI callback");
assert.ok(state.variables.loop_count>2000,"main keeps working during holds");
assert.equal(circuit.getState().mcuDrives.PB13,1,"runtime drives real circuit output");
assert.equal(circuit.compileNetlist().leds.find(l=>l.componentId==="count-led").on,true);
// Power-on with the switch already closed must use the same stability window.
const bootCircuit=loadCircuit();
bootCircuit.setButtonClosed("button",true);
const bootRuntime=runtimeApi.create(model,{
  onGpioRead:e=>({value:bootCircuit.sampleMcuPin(e.pin)}),
  onGpio:e=>bootCircuit.driveMcuPin(e.pin,e.value)
});
bootRuntime.start();
let bootState=bootRuntime.step(29);
assert.equal(bootState.variables.pressed,0,"boot-held input still needs 30ms");
bootState=bootRuntime.step(2);
assert.equal(bootState.variables.pressed,1);
assert.equal(bootState.variables.press_count,0,"no phantom release at startup");
console.log("PASS Learning10_ButtonEXTI: wired active-low input; injected press/release bounce; short counts 1,2; one long reset; no release double-count; next press; <30ms rejection; real EXTI and LEDs/UART.");
