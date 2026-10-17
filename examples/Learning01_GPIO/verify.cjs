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
function loadCircuit() {
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
  return circuit;
}

const circuit = loadCircuit();
const transmissions = [];
const runtime = runtimeApi.create(model, {
  onGpioRead: event => ({value: circuit.sampleMcuPin(event.pin)}),
  onGpio: event => circuit.driveMcuPin(event.pin, event.value),
  onUartTx: event => transmissions.push(event.text)
});
runtime.start();
let state = runtime.step(0);
assert.notEqual(state.status, "error", JSON.stringify(state.error));
assert.equal(state.gpio.PB12, 0);
assert.equal(state.gpio.PB13, 1);
assert.match(transmissions[0], /SW=OFF GREEN=OFF RED=ON/);
circuit.setButtonClosed("switch", true);
state = runtime.step(40);
assert.notEqual(state.status, "error", JSON.stringify(state.error));
assert.equal(state.gpio.PB12, 1);
assert.equal(state.gpio.PB13, 0);
assert.match(transmissions[1], /SW=ON  GREEN=ON  RED=OFF/);
assert.equal(transmissions.length, 2, "a stable state must not flood the UART");
circuit.setButtonClosed("switch", false);
state = runtime.step(80);
assert.equal(state.gpio.PB12, 0);
assert.equal(state.gpio.PB13, 1);
assert.equal(transmissions.length, 3);
assert.notEqual(state.status, "error", JSON.stringify(state.error));
console.log("PASS Learning01_GPIO: real circuit OFF -> ON -> OFF, PB12/PB13 independent, UART state changes.");
