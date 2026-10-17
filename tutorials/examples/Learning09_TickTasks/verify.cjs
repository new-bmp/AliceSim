"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {execFileSync} = require("node:child_process");
const {root} = require("./_tutorial-environment.cjs");
const runtimeApi = require(path.join(root, "firmware-runtime.js"));
const python = process.env.ALICESIM_PYTHON || require("./_tutorial-environment.cjs").python;
const model = JSON.parse(execFileSync(python, [path.join(__dirname, "verify.py"), "--model"], {encoding: "utf8", cwd: root}));
function setup() {
  const window = {
    addEventListener() {},
    AliceOledDevice: require(path.join(root, "oled-device.js")),
    AliceSpiDisplayDevice: require(path.join(root, "spi-display-device.js")),
    AliceLightSensorDevice: require(path.join(root, "light-sensor-device.js")),
    AlicePeripheralCatalog: require(path.join(root, "peripheral-catalog.js")),
    AlicePeripheralDevices: require(path.join(root, "peripheral-devices.js"))
  };
  const document = {readyState: "loading", addEventListener() {}, body: null};
  const context = vm.createContext({window, document, Blob, console, queueMicrotask, setTimeout, clearTimeout,
    CustomEvent: function(type, options) {this.type = type; this.detail = options && options.detail;}});
  vm.runInContext(fs.readFileSync(path.join(root, "schematic.js"), "utf8"), context, {filename: "schematic.js"});
  const circuit = window.AliceSchematic;
  circuit.applyProjectModel(model);
  const imported = circuit.importCircuit(JSON.parse(fs.readFileSync(path.join(__dirname, path.basename(__dirname) + ".alice-sch.json"), "utf8")));
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const runtime = runtimeApi.create(model, {
    onGpioRead: event => ({value: circuit.sampleMcuPin(event.pin)}),
    onGpio: event => circuit.driveMcuPin(event.pin, event.value)
  });
  return {circuit, runtime};
}
function step(runtime, milliseconds) {
  const state = runtime.step(milliseconds);
  assert.ok(!state.error, JSON.stringify(state.error));
  assert.ok(!["error", "budget-exceeded", "completed"].includes(state.status), state.status);
  return state;
}
function leds(circuit) {
  return Object.fromEntries(circuit.compileNetlist().leds.map(led => [led.componentId, led.on]));
}
const {circuit, runtime} = setup();
runtime.start();
let state = step(runtime, 0);
assert.deepEqual(leds(circuit), {green: false, red: false});
step(runtime, 249);
assert.deepEqual(leds(circuit), {green: false, red: false});
step(runtime, 1);
assert.deepEqual(leds(circuit), {green: true, red: false});
circuit.setButtonClosed("switch", true);
state = step(runtime, 1);
assert.deepEqual(leds(circuit), {green: true, red: true}, "switch starts red task within one 1ms polling slot");
assert.equal(state.variables.run_state, 1);
step(runtime, 699);
assert.deepEqual(leds(circuit), {green: true, red: true});
step(runtime, 1);
assert.deepEqual(leds(circuit), {green: true, red: false}, "red uses its independent 700ms timer");
circuit.setButtonClosed("switch", false);
state = step(runtime, 1);
assert.equal(state.variables.run_state, 0);
assert.equal(leds(circuit).red, false);
circuit.setButtonClosed("switch", true);
step(runtime, 1);
assert.equal(leds(circuit).red, true);
step(runtime, 10);
circuit.setButtonClosed("switch", false);
step(runtime, 1);
assert.equal(leds(circuit).red, false, "OFF stops a lit red LED without waiting for its 700ms deadline");
const rollover = setup();
rollover.runtime.advanceTimeTo(4294967200);
rollover.circuit.setButtonClosed("switch", true);
rollover.runtime.start();
state = step(rollover.runtime, 0);
assert.equal(state.variables.now, 4294967200);
assert.equal(leds(rollover.circuit).red, true);
step(rollover.runtime, 249);
assert.equal(leds(rollover.circuit).green, false, "rollover must not trigger the 250ms task early");
state = step(rollover.runtime, 1);
assert.equal(state.variables.now, 154, "uint32_t HAL tick wraps at 2^32");
assert.equal(leds(rollover.circuit).green, true, "elapsed subtraction still triggers after rollover");
step(rollover.runtime, 449);
assert.equal(leds(rollover.circuit).red, true);
step(rollover.runtime, 1);
assert.equal(leds(rollover.circuit).red, false);
rollover.circuit.setButtonClosed("switch", false);
step(rollover.runtime, 1);
assert.equal(leds(rollover.circuit).red, false);
console.log("PASS Learning09_TickTasks: wired 250/700ms tasks, responsive switch state machine, uint32 tick rollover.");
