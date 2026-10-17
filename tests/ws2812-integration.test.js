"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {loadCircuit, root} = require("../examples/Learning06_Components/circuit-tools.cjs");
const literal = value => ({kind: "literal", value});

function firmwareModel() {
  return {mcu: "STM32F103C8T6", pins: {PA0: {physicalPin: "PA0", signal: "TIM2_CH1", mode: "TIM2_CH1"}}, outputs: {},
    variables: {rgb: [255, 0, 0, 0, 255, 0], pulses: Array(96).fill(0), status: -1},
    variableTypes: {rgb: "uint8_t", pulses: "uint16_t"},
    timers: {htim2: {handle: "htim2", instance: "TIM2", period: 89, frequencyHz: 800000, channels: [{channelNumber: 1, pin: "PA0"}]}},
    program: {operations: [
      {op: "aliceWs2812Init", context: "strip", timer: "htim2", channel: 1, zeroHighTicks: literal(28), oneHighTicks: literal(56), resetSlots: literal(48)},
      {op: "aliceWs2812Show", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(96), result: "status"}
    ]}};
}

function stripCircuit(model, omitPin) {
  const api = loadCircuit(model);
  const component = (id, type) => ({id, type, ref: id, value: type, x: 0, y: 0, rotation: 0});
  const circuit = {kind: "AliceSIMCircuit", schemaVersion: 1, mcu: "STM32F103C8T6",
    components: [component("mcu", "mcu"), {...component("vcc", "vcc"), value: "+5V"}, component("gnd", "ground"),
      {...component("strip", "ws2812"), peripheralProperties: {count: 2}}], wires: []};
  for (const [from, pin, toPin] of [["vcc", "VCC", "VCC"], ["gnd", "GND", "GND"], ["mcu", "PA0", "DIN"]]) {
    if (pin !== omitPin) circuit.wires.push({id: "w" + circuit.wires.length, from: {componentId: from, pin},
      to: {componentId: "strip", pin: toPin}, route: [{x: 0, y: 0}, {x: 100, y: 0}]});
  }
  assert.equal(api.importCircuit(circuit).ok, true);
  return api;
}

function runWorker(model, api) {
  const messages = [];
  const context = vm.createContext({console, postMessage(message) {messages.push(message);}});
  context.self = context;
  context.importScripts = source => {
    const filename = path.join(root, String(source).split("?")[0]);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, {filename});
  };
  vm.runInContext(fs.readFileSync(path.join(root, "firmware-worker.js"), "utf8"), context);
  let requestId = 0;
  const send = command => {
    const id = ++requestId;
    context.self.onmessage({data: {...command, id}});
    const response = messages.find(message => message.type === "result" && message.id === id);
    assert.ok(response);
    assert.equal(response.error, "");
    return response.value;
  };
  send({command: "init", model});
  send({command: "call", method: "start"});
  const inputs = api.getFirmwareInputSnapshot();
  const state = send({command: "step", deltaMs: 0, inputs});
  const events = messages.filter(message => message.type === "event" && message.kind === "peripheral");
  const responses = events.map(message => api.handlePeripheralOperation(message.detail));
  return {state, inputs, events, responses};
}

function colors(api) {
  return Array.from(api.getState().components.find(component => component.id === "strip").deviceState.colors);
}

test("real WS2812 timer wiring crosses the Worker and updates schematic colors", () => {
  const model = firmwareModel();
  const api = stripCircuit(model);
  const {state, inputs, events, responses} = runWorker(model, api);
  assert.equal(inputs.spi.length, 0);
  const target = inputs.peripherals.find(target => target.componentId === "strip");
  assert.equal(target.ready, true);
  assert.equal(target.connection.dataPin, "PA0");
  assert.equal(state.error, null);
  assert.equal(state.variables.status, 0);
  assert.equal(events.length, 1);
  assert.equal(responses[0].accepted, true);
  assert.deepEqual(colors(api), [0xff0000, 0x00ff00]);
});

test("WS2812 Worker and schematic reject missing data, lost power, and a different timer pin", () => {
  for (const missing of ["PA0", "VCC", "GND"]) {
    const model = firmwareModel();
    const api = stripCircuit(model, missing);
    const {state, responses} = runWorker(model, api);
    assert.equal(state.variables.status, 1, missing);
    assert.ok(responses.every(response => !response.accepted), missing);
    assert.deepEqual(colors(api), [0, 0], missing);
  }
  const circuitModel = firmwareModel();
  const api = stripCircuit(circuitModel);
  const wrongPin = firmwareModel();
  wrongPin.timers.htim2.channels[0].pin = "PA1";
  const {state, responses} = runWorker(wrongPin, api);
  assert.equal(state.variables.status, 1);
  assert.ok(responses.every(response => !response.accepted));
  assert.deepEqual(colors(api), [0, 0]);
});

test("raw HAL PWM DMA uses the same real circuit and Worker route", () => {
  const model = firmwareModel();
  model.variables.pulses = [28, 28, 28, 28, 28, 28, 28, 28, 56, 56, 56, 56, 56, 56, 56, 56, 28, 28, 28, 28, 28, 28, 28, 28].concat(Array(48).fill(0));
  model.program.operations = [{op: "pwmStartDma", timer: "htim2", channel: 1, buffer: "pulses", length: literal(72), result: "status"}];
  const api = stripCircuit(model);
  const {state, responses} = runWorker(model, api);
  assert.equal(state.variables.status, 0);
  assert.equal(responses[0].accepted, true);
  assert.deepEqual(colors(api), [0xff0000, 0]);
});
