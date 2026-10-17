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
assert.deepEqual(leds(circuit), {green: true, red: false, blue: false});
assert.equal(state.variables.loop_count, 255, "uint8_t counter increments from 254");
state = step(runtime, 200);
assert.deepEqual(leds(circuit), {green: false, red: true, blue: false}, "array step + pointer outputs select red");
assert.equal(state.variables.loop_count, 0, "uint8_t assignment wraps 255 + 1 to 0");
state = step(runtime, 200);
assert.deepEqual(leds(circuit), {green: false, red: false, blue: true});
state = step(runtime, 399);
assert.deepEqual(leds(circuit), {green: false, red: false, blue: true}, "struct hold_ms gives blue a 400ms slot");
step(runtime, 1);
assert.deepEqual(leds(circuit), {green: true, red: false, blue: false}, "static index persists and wraps to step 0");
console.log("PASS Learning08_CData: wired RGB chase, struct durations, pointer outputs, static index and uint8_t wrap.");
