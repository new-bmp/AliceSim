"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {loadCircuit, root} = require("../examples/Learning06_Components/circuit-tools.cjs");

function firmware() {
  return {mcu: "STM32F103C8T6", pins: {PA4: {physicalPin: "PA4", mode: "GPIO_Output"}}, outputs: {},
    variables: {early: 999, raw: 999, status: -1}, program: {operations: [
      {op: "aliceDs18b20Init", context: "probe", dataPin: "PA4", bindingValid: true},
      {op: "aliceDs18b20StartConversion", context: "probe", result: "status"},
      {op: "aliceDs18b20ReadRaw", context: "probe", target: "early", result: "status"},
      {op: "delay", duration: 750},
      {op: "aliceDs18b20ReadRaw", context: "probe", target: "raw", result: "status"}
    ]}};
}

function circuit(options = {}) {
  const model = firmware(), api = loadCircuit(model);
  const component = (id, type) => ({id, type, ref: id, value: type, x: 0, y: 0, rotation: 0});
  const design = {kind: "AliceSIMCircuit", schemaVersion: 1, mcu: "STM32F103C8T6",
    components: [component("mcu", "mcu"), {...component("vcc", "vcc"), value: "+3.3V"}, component("gnd", "ground"),
      {...component("probe", "ds18b20"), peripheralProperties: {temperatureC: -12.375}}], wires: []};
  function wireSensor(id) {
    for (const [from, pin, toPin] of [["vcc", "VCC", "VCC"], ["gnd", "GND", "GND"], ["mcu", options.dataPin || "PA4", "DQ"]]) {
      if (pin !== options.omitPin) design.wires.push({id: "w" + design.wires.length, from: {componentId: from, pin},
        to: {componentId: id, pin: toPin}, route: [{x: 0, y: 0}, {x: 100, y: 0}]});
    }
  }
  wireSensor("probe");
  if (options.duplicate) {
    design.components.push({...component("probe2", "ds18b20"), peripheralProperties: {temperatureC: 30}});
    wireSensor("probe2");
  }
  assert.equal(api.importCircuit(design).ok, true);
  return {api, model};
}

function workerFor(model, api) {
  const messages = [], context = vm.createContext({console, postMessage(message) {messages.push(message);}});
  context.self = context;
  context.importScripts = source => vm.runInContext(fs.readFileSync(path.join(root, String(source).split("?")[0]), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "firmware-worker.js"), "utf8"), context);
  let id = 0;
  function send(command) {
    const requestId = ++id;
    context.onmessage({data: {...command, id: requestId}});
    const response = messages.find(message => message.type === "result" && message.id === requestId);
    assert.equal(response.error, "");
    for (const event of messages.splice(0)) if (event.kind === "peripheral") api.handlePeripheralOperation(event.detail);
    return response.value;
  }
  send({command: "init", model});
  send({command: "call", method: "start"});
  return deltaMs => send({command: "step", deltaMs, inputs: api.getFirmwareInputSnapshot()});
}

test("DS18B20 real circuit and Worker preserve conversion across snapshot batches", () => {
  const {api, model} = circuit(), step = workerFor(model, api);
  const target = api.getFirmwareInputSnapshot().peripherals.find(target => target.type === "ds18b20");
  assert.equal(target.connection.dataPin, "PA4");
  assert.equal(target.ready, true);
  assert.equal(target.state.properties.temperatureC, -12.375);
  let state = step(0);
  assert.equal(state.error, null);
  assert.equal(state.variables.early, 1360, "early scratchpad read is the power-on 85°C");
  assert.equal(state.variables.raw, 999);
  state = step(749);
  assert.equal(state.variables.raw, 999);
  state = step(1);
  assert.equal(state.error, null);
  assert.equal(state.variables.status, 0);
  assert.equal(state.variables.raw, -198);
  assert.equal(api.getState().components.find(component => component.id === "probe").deviceState.raw, -198);
});

test("DS18B20 rejects disconnected, wrong DQ and colliding Skip-ROM devices without overwriting output", () => {
  for (const options of [{omitPin: "VCC"}, {omitPin: "PA4"}, {dataPin: "PA5"}, {duplicate: true}]) {
    const {api, model} = circuit(options), step = workerFor(model, api);
    const direct = api.handlePeripheralOperation({peripheralType: "ds18b20", action: "read-raw", dataPin: "PA4", timeMs: 0});
    assert.equal(direct.accepted, false, JSON.stringify(options));
    step(0);
    const state = step(750);
    assert.equal(state.error, null);
    assert.equal(state.variables.status, 1, JSON.stringify(options));
    assert.equal(state.variables.raw, 999);
    assert.equal(state.variables.early, 999);
  }
});

test("DS18B20 never guesses a DQ pin when operation binding is absent", () => {
  const {api} = circuit();
  assert.equal(api.handlePeripheralOperation({peripheralType: "ds18b20", action: "read-raw"}).accepted, false);
});
