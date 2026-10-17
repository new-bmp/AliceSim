"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const firmware = require("../firmware-runtime.js");
const devices = require("../peripheral-devices.js");
const literal = value => ({ kind: "literal", value });
const init = { op: "aliceWs2812Init", context: "strip", timer: "htim2", channel: 1, zeroHighTicks: literal(28), oneHighTicks: literal(56), resetSlots: literal(48), result: "initStatus" };

function run(operations, connected = true, overrides = {}) {
  const strip = devices.createWS2812({ properties: { count: 2 }, connection: { powered: true, bindingValid: true, dataConnected: connected, dataPin: "PA0", vccLevel: 5, gndLevel: 0 } });
  const events = [];
  const runtime = firmware.create({
    variables: { rgb: [255, 0, 0, 0, 255, 0], pulses: Array(96).fill(0), count: 0 },
    variableTypes: { rgb: "uint8_t", pulses: "uint16_t", count: "uint32_t" },
    timers: { htim2: { handle: "htim2", instance: "TIM2", period: 89, frequencyHz: 800000, channels: [{ channelNumber: 1, pin: "PA0" }] } },
    ...overrides,
    program: { operations }
  }, { onPeripheral: event => {
    events.push(event);
    const accepted = event.dataPin === strip.connection.dataPin && strip.transmitPwm(event.pulses, event.period, event.frequencyHz) > 0;
    return { accepted, result: {} };
  } });
  runtime.start();
  return { state: runtime.step(0), events, strip };
}

test("bundled WS2812 encoding writes GRB uint16 pulses and Show updates the connected LED colors", () => {
  const { state, events, strip } = run([
    init,
    { op: "aliceWs2812RequiredPulseCount", ledCount: literal(2), resetSlots: literal(48), result: "required" },
    { op: "aliceWs2812Encode", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(96), pulseCountTarget: "count", result: "encodeStatus" },
    { op: "aliceWs2812Show", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(96), result: "showStatus" }
  ]);
  assert.equal(state.error, null);
  assert.equal(state.variables.required, 96);
  assert.equal(state.variables.count, 96);
  assert.deepEqual(state.variables.pulses.slice(0, 24), [28, 28, 28, 28, 28, 28, 28, 28, 56, 56, 56, 56, 56, 56, 56, 56, 28, 28, 28, 28, 28, 28, 28, 28]);
  assert.equal(events.length, 1, "Encode prepares memory without transmitting it");
  assert.equal(events[0].dataPin, "PA0");
  assert.equal(events[0].period, 89);
  assert.equal(events[0].frequencyHz, 800000);
  assert.deepEqual(strip.getState().colors, [0xff0000, 0x00ff00]);
  assert.equal(state.variables.showStatus, 0);
});

test("WS2812 Show fails for disconnected output and invalid pulse buffer capacity", () => {
  const shown = run([init, { op: "aliceWs2812Show", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(96), result: "status" }], false);
  assert.equal(shown.state.error, null);
  assert.equal(shown.state.variables.status, 1);
  assert.deepEqual(shown.strip.getState().colors, [0, 0]);
  const undersized = run([init, { op: "aliceWs2812Show", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(95), result: "status" }]);
  assert.equal(undersized.state.error, null);
  assert.equal(undersized.state.variables.status, 1);
  assert.equal(undersized.events.length, 0);
});

test("raw HAL PWM DMA reads uint16 pulse samples and routes them through the concrete timer channel", () => {
  const pulses = [28, 28, 28, 28, 28, 28, 28, 28, 56, 56, 56, 56, 56, 56, 56, 56, 28, 28, 28, 28, 28, 28, 28, 28].concat(Array(48).fill(0));
  const { state, strip } = run([
    { op: "pwmStartDma", timer: "htim2", channel: 1, buffer: "pulses", length: literal(72), result: "status" }
  ], true, { variables: { pulses } });
  assert.equal(state.error, null);
  assert.equal(state.variables.status, 0);
  assert.deepEqual(strip.getState().colors, [0xff0000, 0]);
});

test("WS2812 cannot claim output when the timer has no pin or timing configuration", () => {
  const { state, events } = run([init, { op: "aliceWs2812Show", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(96), result: "status" }], true, { timers: {} });
  assert.equal(state.error, null);
  assert.equal(state.variables.status, 1);
  assert.equal(events.length, 0);
});

test("WS2812 Encode rejects a null pulse count pointer without partially writing output memory", () => {
  const { state, events } = run([
    init,
    { op: "aliceWs2812Encode", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(96), pulseCountTarget: literal(0), result: "status" }
  ]);
  assert.equal(state.error, null);
  assert.equal(state.variables.status, 1);
  assert.deepEqual(state.variables.pulses, Array(96).fill(0));
  assert.equal(events.length, 0);
});

test("WS2812 Encode writes a malloc pulse destination without reading uninitialized memory", () => {
  const { state } = run([
    init,
    { op: "assign", target: "pulses", cType: "uint16_t*", value: literal(0) },
    { op: "heapAllocate", function: "malloc", size: literal(192), resultTarget: "pulses" },
    { op: "aliceWs2812Encode", context: "strip", buffer: "rgb", ledCount: literal(2), pulseBuffer: "pulses", capacity: literal(96), pulseCountTarget: "count", result: "status" }
  ]);
  assert.equal(state.error, null);
  assert.equal(state.variables.status, 0);
  assert.equal(state.variables.count, 96);
});
