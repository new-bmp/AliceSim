"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {execFileSync} = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const runtimeApi = require(path.join(root, "firmware-runtime.js"));
const python = process.env.ALICESIM_PYTHON || path.join(root, ".venv", "Scripts", "python.exe");
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
assert.deepEqual(ledsAfter(0), {green: true}, "PB12 must light the wired LED on first loop");
assert.deepEqual(ledsAfter(499), {green: true}, "LED stays on before the half-period");
assert.deepEqual(ledsAfter(1), {green: false}, "LED turns off at 500 ms");
assert.deepEqual(ledsAfter(500), {green: true}, "LED repeats after 1 second");
function ledsAfter(ms) { step(runtime, ms); return leds(circuit); }
console.log("PASS Learning07_Blink: actual wired LED ON -> OFF -> ON, 500 ms boundaries.");
