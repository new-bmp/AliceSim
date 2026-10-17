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
const pwmEvents = [];
const runtime = runtimeApi.create(model, {
  onAdcRead: event => circuit.sampleAdc(event.instance || event.adc, event),
  onPwm: event => {pwmEvents.push(event); circuit.driveMcuPwm(event);},
  onUartTx: event => transmissions.push(event.text)
});
assert.equal(model.timers.htim1.frequencyHz, 50);
assert.equal(model.timers.htim1.prescaler, 71);
assert.equal(model.timers.htim1.period, 19999);
circuit.setAdcSourceVoltage("adc", 0);
runtime.start();
let state = runtime.step(1);
assert.notEqual(state.status, "error", JSON.stringify(state.error));
assert.equal(state.variables.adc_raw, 0);
assert.equal(state.variables.pulse_us, 500);
assert.equal(state.variables.angle_x10, 0);
assert.equal(state.pwm["TIM1:CH1"].frequencyHz, 50);
assert.match(transmissions.at(-1), /ANGLE=0.0 DEG PULSE=500 US/);
circuit.compileNetlist();
let servo = circuit.getState().components.find(component => component.id === "servo").deviceState;
assert.equal(servo.ready, true);
assert.equal(servo.angle, 0);
circuit.setAdcSourceVoltage("adc", 3.3);
state = runtime.step(150);
assert.notEqual(state.status, "error", JSON.stringify(state.error));
assert.equal(state.variables.adc_raw, 4095);
assert.equal(state.variables.pulse_us, 2500);
assert.equal(state.variables.angle_x10, 1800);
assert.match(transmissions.at(-1), /ANGLE=180.0 DEG PULSE=2500 US/);
circuit.compileNetlist();
servo = circuit.getState().components.find(component => component.id === "servo").deviceState;
assert.equal(servo.angle, 180);
assert.equal(servo.power.railVoltage, 5, "SG90 uses its independent 5 V supply");
assert.ok(pwmEvents.some(event => event.pin === "PA8" && event.compare === 2500));
console.log("PASS Learning02_Servo: real circuit 0/3.3 V -> ADC 0/4095 -> 500/2500 us @50 Hz -> SG90 0/180 degrees, exact UART.");
