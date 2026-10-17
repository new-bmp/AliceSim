"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function boot(type) {
  const busPath = path.join(__dirname, "..", "peripheral-bus-devices.js");
  const window = { addEventListener() {}, AlicePeripheralCatalog: require("../peripheral-catalog.js"), AlicePeripheralDevices: require("../peripheral-devices.js"), AlicePeripheralBusDevices: fs.existsSync(busPath) ? require(busPath) : null };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "schematic.js"), "utf8"), { window, document: { readyState: "loading", addEventListener() {}, body: null }, Blob, CustomEvent: function () {}, console, queueMicrotask, setTimeout, clearTimeout });
  const api = window.AliceSchematic;
  const pins = Object.fromEntries(["PB6", "PB7", "PA0", "PA1", "PA2", "PA3"].map(pin => [pin, { physicalPin: pin, configured: true, mode: "input" }]));
  api.applyProjectModel({ mcu: "STM32F103C8T6", pins, outputs: {}, i2cs: { hi2c1: { instance: "I2C1", handle: "hi2c1", sclPin: "PB6", sdaPin: "PB7" } } });
  const component = (id, componentType, value) => ({ id, type: componentType, value, ref: id, rotation: 0, x: 0, y: 0 });
  const circuit = { schemaVersion: 1, kind: "AliceSIMCircuit", mcu: "STM32F103C8T6", components: [component("mcu", "mcu", "STM32F103C8T6"), component("vcc", "vcc", "+5V"), component("gnd", "ground", "0V"), component("dut", type, type)], wires: [] };
  const wire = (from, pin, to, toPin) => { circuit.wires.push({ id: "wire" + circuit.wires.length, from: { componentId: from, pin }, to: { componentId: to, pin: toPin }, route: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }); };
  wire("vcc", "VCC", "dut", "VCC"); wire("gnd", "GND", "dut", "GND"); wire("mcu", "PB6", "dut", "SCL"); wire("mcu", "PB7", "dut", "SDA");
  return { api, circuit, component, wire, load() { const result = api.importCircuit(circuit); assert.equal(result.ok, true, result.error); } };
}

test("PCA9685 independent channel outputs drive a servo and LED through real wires", () => {
  const h = boot("pca9685");
  h.circuit.components.push(h.component("servo", "sg90", "90°"), h.component("led", "led", "RED"));
  h.wire("vcc", "VCC", "servo", "VCC"); h.wire("gnd", "GND", "servo", "GND");
  h.wire("dut", "PWM0", "servo", "PWM"); h.wire("dut", "PWM7", "led", "A"); h.wire("gnd", "GND", "led", "K");
  h.load();
  const tx = (memoryAddress, bytes) => h.api.handleI2cTransmission({ instance: "I2C1", address: 0x40, memoryAddress, bytes });
  assert.equal(tx(0, [0x20]).accepted, true);
  tx(0xfe, [121]);
  tx(0x06, [0, 0, 0x33, 1]); // 307 / 4096 at approximately 50 Hz is approximately 1.5 ms.
  tx(0x22, [0, 0, 0, 8]); // Channel 7, 50%.
  const n = h.api.compileNetlist();
  const angle = h.api.getState().components.find(c => c.id === "servo").deviceState.angle;
  assert.ok(angle > 89 && angle < 91, "PWM0 must reach the servo rather than just change controller artwork");
  assert.equal(n.leds.find(led => led.componentId === "led").pwm.dutyCycle, .5);
  h.api.driveMcuPin("PA3", 1, { render: false });
  const withOe = JSON.parse(h.api.serializeCircuit());
  withOe.wires.push({ id: "oe", from: { componentId: "mcu", pin: "PA3" }, to: { componentId: "dut", pin: "OE" }, route: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
  assert.equal(h.api.importCircuit(withOe).ok, true);
  h.api.driveMcuPin("PA3", 1, { render: false });
  assert.equal(h.api.compileNetlist().leds.find(led => led.componentId === "led").pwm.active, false);
});

test("PCF8574 independently drives port pins and releases them for physical inputs", () => {
  const h = boot("pcf8574");
  h.wire("dut", "P0", "mcu", "PA0"); h.wire("dut", "P1", "mcu", "PA1"); h.wire("dut", "INT", "mcu", "PA2");
  h.load();
  assert.equal(h.api.handleI2cTransmission({ instance: "I2C1", address: 0x20, bytes: [0xfe] }).accepted, true);
  assert.equal(h.api.sampleMcuPin("PA0"), 0);
  assert.equal(h.api.sampleMcuPin("PA1"), 1);
  h.api.driveMcuPin("PA1", 0, { render: false });
  const n = h.api.compileNetlist();
  assert.equal(n.netById.get(n.endpointToNet["dut:P1"]).conflict, false, "released port is a weak high, not a conflicting push-pull output");
  assert.equal(h.api.sampleMcuPin("PA1"), 0);
  const state = h.api.getState().components.find(c => c.id === "dut").deviceState;
  assert.equal(state.pinMask & 3, 0);
  assert.equal(state.interruptActive, true);
  assert.equal(h.api.sampleMcuPin("PA2"), 0, "physical change asserts the open-drain interrupt");
  const read = h.api.handleI2cReception({ instance: "I2C1", address: 0x20, length: 1 });
  assert.equal(read.accepted, true);
  assert.deepEqual(Array.from(read.bytes), [0xfc]);
  assert.equal(h.api.getState().components.find(c => c.id === "dut").deviceState.interruptActive, false);
  assert.equal(h.api.sampleMcuPin("PA2"), null, "successful read releases the open-drain interrupt");
});

test("PCA9685 loses its physical output when supply power is disconnected", () => {
  const h = boot("pca9685");
  h.wire("dut", "PWM15", "mcu", "PA0");
  h.load();
  h.api.handleI2cTransmission({ instance: "I2C1", address: 0x40, memoryAddress: 0, bytes: [0x20] });
  h.api.handleI2cTransmission({ instance: "I2C1", address: 0x40, memoryAddress: 0x42, bytes: [0, 0, 0, 8] });
  const disconnected = JSON.parse(h.api.serializeCircuit());
  disconnected.wires = disconnected.wires.filter(w => w.from.componentId !== "vcc");
  assert.equal(h.api.importCircuit(disconnected).ok, true);
  assert.equal(h.api.sampleMcuPin("PA0"), null);
  assert.equal(h.api.getState().components.find(c => c.id === "dut").deviceState.power.powered, false);
});

test("EC11 position jumps produce adjacent quadrature phases on successive simulation ticks", () => {
  const h = boot("rotaryEncoder");
  h.circuit.wires = [];
  h.wire("gnd", "GND", "dut", "GND"); h.wire("dut", "A", "mcu", "PA0"); h.wire("dut", "B", "mcu", "PA1");
  h.load();
  const phase = () => [h.api.sampleMcuPin("PA0"), h.api.sampleMcuPin("PA1")];
  assert.deepEqual(phase(), [0, 0]);
  h.api.setPeripheralProperties("dut", { position: 4, pressed: 0 });
  const phases = [];
  for (let tick = 1; tick <= 4; tick++) {
    h.api.tick(tick * 20, tick, { render: false });
    phases.push(phase());
    assert.deepEqual(phase(), phases[phases.length - 1], "multiple pin reads in the same tick cannot consume queued phases");
  }
  assert.deepEqual(phases, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  h.api.setPeripheralProperties("dut", { position: 2, pressed: 0 });
  h.api.tick(100, 5, { render: false });
  assert.deepEqual(phase(), [1, 0]);
  h.api.tick(120, 6, { render: false });
  assert.deepEqual(phase(), [1, 1]);
});

test("a MOSFET passes gate PWM to a low-side LED load with the correct duty", () => {
  const h = boot("mosfet");
  h.circuit.wires = [];
  h.circuit.components.push(h.component("led", "led", "RED"));
  h.wire("mcu", "PA0", "dut", "G"); h.wire("gnd", "GND", "dut", "S");
  h.wire("vcc", "VCC", "led", "A"); h.wire("led", "K", "dut", "D");
  h.load();
  h.api.driveMcuPwm({ pin: "PA0", active: true, dutyCycle: .25, frequencyHz: 1000, render: false });
  const load = h.api.compileNetlist().leds.find(led => led.componentId === "led");
  assert.ok(load.pwm, "the switched load must receive PWM metadata");
  assert.equal(1 - load.pwm.dutyCycle, .25, "low-side switching inverts drain voltage, not LED brightness");
  h.api.tick(.5, 1, { render: false });
  assert.equal(h.api.getState().components.find(c => c.id === "dut").mosfetOn, false, "25% gate PWM must be off halfway through a period");
  assert.equal(1 - h.api.compileNetlist().leds.find(led => led.componentId === "led").pwm.dutyCycle, .25);
  h.api.driveMcuPwm({ pin: "PA0", active: false, dutyCycle: 0, frequencyHz: 1000, render: false });
  assert.equal(h.api.compileNetlist().leds.find(led => led.componentId === "led").pwm.active, false);
});

test("PCA9685 PWM reaches a MOSFET regardless of component insertion order", () => {
  const h = boot("pca9685");
  h.circuit.components.unshift(h.component("switch", "mosfet", "N-MOS"));
  h.circuit.components.push(h.component("led", "led", "RED"));
  h.wire("dut", "PWM3", "switch", "G"); h.wire("gnd", "GND", "switch", "S");
  h.wire("vcc", "VCC", "led", "A"); h.wire("led", "K", "switch", "D");
  h.load();
  h.api.handleI2cTransmission({ instance: "I2C1", address: 0x40, memoryAddress: 0, bytes: [0x20] });
  h.api.handleI2cTransmission({ instance: "I2C1", address: 0x40, memoryAddress: 0x12, bytes: [0, 0, 0, 4] });
  const load = h.api.compileNetlist().leds.find(led => led.componentId === "led");
  assert.ok(load.pwm);
  assert.equal(1 - load.pwm.dutyCycle, .25);
});

test("SG90 retains its physical supply limits through schematic construction", () => {
  const h = boot("sg90");
  h.circuit.wires = [];
  h.circuit.components.find(c => c.id === "vcc").value = "+3V3";
  h.wire("vcc", "VCC", "dut", "VCC"); h.wire("gnd", "GND", "dut", "GND"); h.wire("mcu", "PA0", "dut", "PWM");
  h.load();
  h.api.driveMcuPwm({ pin: "PA0", active: true, dutyCycle: .025, frequencyHz: 50, render: false });
  h.api.compileNetlist();
  const state = h.api.getState().components.find(c => c.id === "dut").deviceState;
  assert.equal(state.power.reason, "undervoltage");
  assert.equal(state.ready, false);
  assert.equal(state.angle, 90, "invalid supply must not move the servo");
});

test("main-thread W25Q flash latches writes on CS rising before the next render", () => {
  const h = boot("w25qxx");
  h.api.applyProjectModel({ mcu: "STM32F103C8T6", outputs: {},
    pins: Object.fromEntries(["PA5", "PA6", "PA7", "PB0"].map(pin => [pin, {physicalPin: pin, configured: true, mode: "input"}])),
    spis: { hspi1: { instance: "SPI1", handle: "hspi1", sckPin: "PA5", misoPin: "PA6", mosiPin: "PA7" } } });
  h.circuit.components.find(c => c.id === "vcc").value = "+3V3";
  h.circuit.wires = [];
  h.wire("vcc", "VCC", "dut", "VCC"); h.wire("gnd", "GND", "dut", "GND");
  h.wire("mcu", "PA5", "dut", "SCK"); h.wire("mcu", "PA6", "dut", "MISO"); h.wire("mcu", "PA7", "dut", "MOSI"); h.wire("mcu", "PB0", "dut", "CS");
  h.load();
  const cs = level => h.api.driveMcuPin("PB0", level, {render: false});
  const tx = bytes => h.api.handleSpiTransmission({instance: "SPI1", bytes});
  cs(1);
  assert.equal(tx([6]).accepted, false);
  cs(0); assert.equal(tx([6]).accepted, true); cs(1);
  assert.equal(h.api.getState().components.find(c => c.id === "dut").deviceState.writeEnabled, true);
  cs(0); assert.equal(tx([2, 0, 0, 16]).accepted, true); assert.equal(tx([0xa5, 0x5a]).accepted, true); cs(1);
  assert.equal(h.api.getState().components.find(c => c.id === "dut").deviceState.storedBytes, 2);
  cs(0); assert.equal(tx([3, 0, 0, 16]).accepted, true);
  const read = h.api.handleSpiReception({instance: "SPI1", length: 2});
  assert.equal(read.accepted, true);
  assert.deepEqual(Array.from(read.bytes), [0xa5, 0x5a]);
  cs(1);
  assert.equal(h.api.handleSpiReception({instance: "SPI1", length: 2}).accepted, false);
});

function workerHarness(onEvent) {
  const directory = path.resolve(__dirname, "..");
  const messages = [];
  const context = vm.createContext({console, postMessage(message) { messages.push(message); if (onEvent && message.type === "event") onEvent(message); }});
  context.self = context;
  context.importScripts = source => {
    const filename = path.join(directory, String(source).split("?")[0]);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, {filename});
  };
  vm.runInContext(fs.readFileSync(path.join(directory, "firmware-worker.js"), "utf8"), context);
  let id = 0;
  return command => {
    context.onmessage({data: {id: ++id, ...command}});
    const response = messages.find(message => message.type === "result" && message.id === id);
    assert.equal(response.error, "");
    return response.value;
  };
}

test("Worker observes PCF8574 output changes through GPIO in the same firmware batch", () => {
  const h = boot("pcf8574");
  h.wire("dut", "P0", "mcu", "PA0"); h.load();
  const send = workerHarness();
  send({command: "init", model: {variables: {low: [0xfe], high: [0xff], pinLow: -1, pinHigh: -1},
    i2cs: {hi2c1: {instance: "I2C1", handle: "hi2c1"}}, program: {operations: [
      {op: "i2cTransmit", instance: "I2C1", deviceAddress: 0x40, buffer: "low", length: 1},
      {op: "gpioRead", pin: "PA0", resultTarget: "pinLow"},
      {op: "i2cTransmit", instance: "I2C1", deviceAddress: 0x40, buffer: "high", length: 1},
      {op: "gpioRead", pin: "PA0", resultTarget: "pinHigh"}
    ]}}});
  send({command: "call", method: "start"});
  const state = send({command: "step", deltaMs: 0, inputs: {gpio: {PA0: 1}, adc: {}, peripherals: [], spi: [], i2c: h.api.getFirmwareInputSnapshot().i2c}});
  assert.equal(state.variables.pinLow, 0);
  assert.equal(state.variables.pinHigh, 1);
});

test("Worker releases a PCF8574 input when the connected MCU output changes in the same batch", () => {
  const h = boot("pcf8574");
  h.wire("dut", "P0", "mcu", "PA0"); h.load();
  h.api.driveMcuPin("PA0", 0, {render: false});
  const send = workerHarness();
  send({command: "init", model: {variables: {read: [0], status: -1, pin: -1}, outputs: {PA0: {physicalPin: "PA0", initial: 0}},
    i2cs: {hi2c1: {instance: "I2C1", handle: "hi2c1"}}, program: {operations: [
      {op: "gpioWrite", pin: "PA0", value: 1},
      {op: "i2cMasterReceive", instance: "I2C1", deviceAddress: 0x40, buffer: "read", length: 1, resultTarget: "status"},
      {op: "gpioRead", pin: "PA0", resultTarget: "pin"}
    ]}}});
  send({command: "call", method: "start"});
  const state = send({command: "step", deltaMs: 0, inputs: {gpio: {PA0: 0}, adc: {}, peripherals: [], spi: [], i2c: h.api.getFirmwareInputSnapshot().i2c}});
  assert.equal(state.variables.status, 0);
  assert.deepEqual(Array.from(state.variables.read), [0xff]);
  assert.equal(state.variables.pin, 1);
});

for (const [wiring, releasedLevel] of [["pullup", 1], ["floating", null], ["ground", 0]]) {
  test(`PCF8574 Worker releases INT to the physical ${wiring} level immediately after a read`, () => {
    const h = boot("pcf8574");
    h.wire("gnd", "GND", "dut", "P0"); h.wire("dut", "INT", "mcu", "PA2");
    if (wiring === "pullup") {
      h.circuit.components.push(h.component("pullup", "resistor", "10 kΩ"));
      h.wire("vcc", "VCC", "pullup", "1"); h.wire("pullup", "2", "dut", "INT");
    }
    if (wiring === "ground") h.wire("gnd", "GND", "dut", "INT");
    h.load();
    const initial = h.api.sampleMcuPin("PA2");
    assert.equal(initial, 0, "the external port change must assert INT before the read");
    const reads = [];
    const send = workerHarness(message => {
      if (message.kind === "i2c-rx") h.api.handleI2cReception(message.detail);
      if (message.kind === "gpio-read") reads.push({value: message.detail.value, connected: message.detail.connected});
    });
    send({command: "init", model: {variables: {read: [0], status: -1, before: -1, after: -1},
      i2cs: {hi2c1: {instance: "I2C1", handle: "hi2c1"}}, program: {operations: [
        {op: "gpioRead", pin: "PA2", resultTarget: "before"},
        {op: "i2cMasterReceive", instance: "I2C1", deviceAddress: 0x40, buffer: "read", length: 1, resultTarget: "status"},
        {op: "gpioRead", pin: "PA2", resultTarget: "after"}
      ]}}});
    send({command: "call", method: "start"});
    const state = send({command: "step", deltaMs: 0, inputs: {...h.api.getFirmwareInputSnapshot(), gpio: {PA2: initial}, adc: {}}});
    assert.equal(state.variables.status, 0);
    assert.deepEqual(Array.from(state.variables.read), [0xfe]);
    assert.equal(h.api.getState().components.find(c => c.id === "dut").deviceState.interruptActive, false);
    assert.equal(h.api.sampleMcuPin("PA2"), releasedLevel);
    assert.deepEqual(reads, [{value: 0, connected: true}, {value: releasedLevel, connected: releasedLevel != null}]);
  });
}

function pcaWorkerCircuit() {
  const h = boot("pca9685");
  h.wire("dut", "PWM0", "mcu", "PA0"); h.wire("dut", "PWM7", "mcu", "PA1"); h.wire("mcu", "PA3", "dut", "OE");
  h.load(); h.api.driveMcuPin("PA3", 0, {render: false});
  const send = workerHarness(message => {
    if (message.kind === "i2c-tx") h.api.handleI2cTransmission(message.detail);
    if (message.kind === "gpio") h.api.driveMcuPin(message.detail.pin, message.detail.value, {render: false});
  });
  const inputs = () => ({...h.api.getFirmwareInputSnapshot(), gpio: {PA0: h.api.sampleMcuPin("PA0"), PA1: h.api.sampleMcuPin("PA1")}, adc: {}});
  return {h, send, inputs};
}

test("PCA9685 writes and MCU OE changes reach GPIO reads inside the same Worker batch", () => {
  const {h, send, inputs} = pcaWorkerCircuit();
  const before = inputs();
  send({command: "init", model: {variables: {mode: [0x20], fullOn: [0, 0x10, 0, 0], first: -1, other: -1, disabled: -1, enabled: -1},
    outputs: {PA3: {physicalPin: "PA3", initial: 0}}, i2cs: {hi2c1: {instance: "I2C1", handle: "hi2c1"}}, program: {operations: [
      {op: "i2cMemWrite", instance: "I2C1", deviceAddress: 0x80, memoryAddress: 0, buffer: "mode", length: 1},
      {op: "i2cMemWrite", instance: "I2C1", deviceAddress: 0x80, memoryAddress: 6, buffer: "fullOn", length: 4},
      {op: "gpioRead", pin: "PA0", resultTarget: "first"}, {op: "gpioRead", pin: "PA1", resultTarget: "other"},
      {op: "gpioWrite", pin: "PA3", value: 1}, {op: "gpioRead", pin: "PA0", resultTarget: "disabled"},
      {op: "gpioWrite", pin: "PA3", value: 0}, {op: "gpioRead", pin: "PA0", resultTarget: "enabled"}
    ]}}});
  send({command: "call", method: "start"});
  const state = send({command: "step", deltaMs: 0, inputs: before});
  assert.equal(state.error, null);
  assert.deepEqual([state.variables.first, state.variables.other, state.variables.disabled, state.variables.enabled], [1, 0, 0, 1]);
  assert.equal(h.api.sampleMcuPin("PA0"), 1);
});

test("PCA9685 Worker GPIO follows PWM phase after firmware delays without a bus transfer", () => {
  const {send, inputs} = pcaWorkerCircuit();
  send({command: "init", model: {variables: {mode: [0x20], half: [0, 0, 0, 8], first: -1, low: -1, high: -1},
    i2cs: {hi2c1: {instance: "I2C1", handle: "hi2c1"}}, program: {operations: [
      {op: "i2cMemWrite", instance: "I2C1", deviceAddress: 0x80, memoryAddress: 0, buffer: "mode", length: 1},
      {op: "i2cMemWrite", instance: "I2C1", deviceAddress: 0x80, memoryAddress: 6, buffer: "half", length: 4},
      {op: "gpioRead", pin: "PA0", resultTarget: "first"}, {op: "delay", ms: 11},
      {op: "gpioRead", pin: "PA0", resultTarget: "low"}, {op: "delay", ms: 10},
      {op: "gpioRead", pin: "PA0", resultTarget: "high"}
    ]}}});
  send({command: "call", method: "start"});
  send({command: "step", deltaMs: 0, inputs: inputs()});
  send({command: "step", deltaMs: 11, inputs: inputs()});
  const state = send({command: "step", deltaMs: 10, inputs: inputs()});
  assert.equal(state.error, null);
  assert.deepEqual([state.variables.first, state.variables.low, state.variables.high], [1, 0, 1]);
});

test("an I2C device cannot operate through a conflicting supply net", () => {
  const h = boot("pcf8574");
  h.circuit.components.push(h.component("other-vcc", "vcc", "+3V3"));
  h.wire("other-vcc", "VCC", "dut", "VCC");
  h.load();
  assert.equal(h.api.getState().components.find(c => c.id === "dut").deviceState.power.powered, false);
  assert.equal(h.api.handleI2cReception({instance: "I2C1", address: 0x20, length: 1}).accepted, false);
});
