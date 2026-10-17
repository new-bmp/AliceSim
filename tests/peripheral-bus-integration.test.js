"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadCircuit} = require("../examples/Learning06_Components/circuit-tools.cjs");

function sensorCircuit(type = "bmp280", properties = {}) {
  const api = loadCircuit({mcu: "STM32F103C8T6", pins: {}, outputs: {},
    i2cs: {hi2c1: {handle: "hi2c1", instance: "I2C1", sclPin: "PB6", sdaPin: "PB7"}}});
  const component = (id, kind) => ({id, type: kind, ref: id, value: kind, x: 0, y: 0, rotation: 0});
  const circuit = {kind: "AliceSIMCircuit", schemaVersion: 1, mcu: "STM32F103C8T6",
    components: [component("mcu", "mcu"), {...component("vcc", "vcc"), value: "+3.3V"}, component("gnd", "ground"), {...component("sensor", type), peripheralProperties: properties}], wires: []};
  for (const [from, pin, toPin] of [["vcc", "VCC", "VCC"], ["gnd", "GND", "GND"], ["mcu", "PB6", "SCL"], ["mcu", "PB7", "SDA"]]) {
    circuit.wires.push({id: "w" + circuit.wires.length, from: {componentId: from, pin}, to: {componentId: "sensor", pin: toPin}, route: [{x: 0, y: 0}, {x: 100, y: 0}]});
  }
  assert.equal(api.importCircuit(circuit).ok, true);
  return {api, circuit};
}

test("wired BMP280 provides registers and a compact stateful Worker target", () => {
  const {api} = sensorCircuit();
  const read = api.handleI2cReception({instance: "I2C1", deviceAddress: 0xec, memoryAddress: 0xd0, length: 1});
  assert.equal(read.accepted, true);
  assert.deepEqual(Array.from(read.bytes), [0x58]);
  const target = api.getFirmwareInputSnapshot().i2c.find(t => t.componentId === "sensor");
  assert.equal(target.type, "bmp280");
  assert.equal(target.ready, true);
  assert.ok(target.connection.powered);
  assert.equal(target.registers, undefined);
});

test("I2C rejects wrong address, wrong wires, lost power, and duplicate addresses", () => {
  const {api, circuit} = sensorCircuit();
  const read = () => api.handleI2cReception({instance: "I2C1", deviceAddress: 0xec, memoryAddress: 0xd0, length: 1});
  assert.equal(api.handleI2cReception({instance: "I2C1", deviceAddress: 0xee, memoryAddress: 0xd0, length: 1}).accepted, false);
  for (const pin of ["PB6", "VCC"]) {
    const broken = structuredClone(circuit);
    broken.wires = broken.wires.filter(w => w.from.pin !== pin);
    assert.equal(api.importCircuit(broken).ok, true);
    assert.equal(read().accepted, false);
  }
  const collision = structuredClone(circuit);
  collision.components.push({...collision.components[3], id: "sensor2", ref: "sensor2"});
  collision.wires.push(...circuit.wires.map(w => ({...structuredClone(w), id: w.id + "dup", to: {...w.to, componentId: "sensor2"}})));
  assert.equal(api.importCircuit(collision).ok, true);
  assert.equal(read().accepted, false);
  assert.equal(read().reason, "i2c-address-collision");
});

test("HAL shifted low I2C addresses reach BH1750 without changing explicit seven-bit addresses", () => {
  const {api} = sensorCircuit("bh1750");
  assert.equal(api.handleI2cTransmission({instance: "I2C1", deviceAddress: 0x46, bytes: [0x10]}).accepted, true);
  assert.equal(api.handleI2cReception({instance: "I2C1", address7Bit: 0x23, length: 2, timeMs: 200}).accepted, true);
});
