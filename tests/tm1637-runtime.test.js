"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const firmware = require("../firmware-runtime.js");
const literal = value => ({ kind: "literal", value });

function run(operations, accepted = true) {
  const events = [];
  const runtime = firmware.create({
    variables: { segments: [0x76, 0x79, 0x38, 0x38] },
    variableTypes: { segments: "uint8_t" },
    program: { operations }
  }, { onPeripheral: event => { events.push(event); return { accepted, result: {} }; } });
  runtime.start();
  return { state: runtime.step(0), events };
}

const init = { op: "aliceTm1637Init", context: "display", clkPin: "PB0", dioPin: "PB1" };

test("TM1637 raw and partial writes emit actual segment bytes and preserve context pin binding", () => {
  const { state, events } = run([
    init,
    { op: "aliceTm1637DisplayRaw", context: "display", buffer: "segments", colon: literal(1), result: "rawStatus" },
    { op: "aliceTm1637WriteSegments", context: "display", buffer: { kind: "addressOf", value: { kind: "arrayIndex", name: "segments", index: literal(2) } }, startPosition: literal(2), count: literal(2), result: "partialStatus" },
    { op: "aliceTm1637SetColon", context: "display", enabled: literal(0), result: "colonStatus" }
  ]);
  assert.equal(state.error, null);
  assert.deepEqual(events[1].segments, [0x76, 0xf9, 0x38, 0x38]);
  assert.equal(events[1].action, "write-segments");
  assert.equal(events[1].startPosition, 0);
  assert.equal(events[1].clkPin, "PB0");
  assert.deepEqual(events[2].segments, [0x38, 0x38]);
  assert.equal(events[2].startPosition, 2);
  assert.equal(events[3].action, "set-colon");
  assert.equal(events[3].colon, false);
  assert.equal(state.variables.rawStatus, 0);
  assert.equal(state.variables.partialStatus, 0);
  assert.equal(state.variables.colonStatus, 0);
});

test("TM1637 rejects writes outside four digits and short or null buffers without emitting output", () => {
  const { state, events } = run([
    init,
    { op: "aliceTm1637WriteSegments", context: "display", buffer: "segments", startPosition: literal(3), count: literal(2), result: "boundsStatus" },
    { op: "aliceTm1637DisplayRaw", context: "display", buffer: literal(0), colon: literal(1), result: "nullStatus" },
    { op: "aliceTm1637WriteSegments", context: "display", buffer: "segments", startPosition: literal(0), count: literal(0), result: "emptyStatus" }
  ]);
  assert.equal(state.error, null);
  assert.equal(events.length, 1);
  assert.equal(state.variables.boundsStatus, 1);
  assert.equal(state.variables.nullStatus, 1);
  assert.equal(state.variables.emptyStatus, 1);
});

test("TM1637 segment output reports HAL_ERROR when the circuit rejects the peripheral", () => {
  const { state } = run([
    init,
    { op: "aliceTm1637DisplayRaw", context: "display", buffer: "segments", colon: literal(0), result: "status" }
  ], false);
  assert.equal(state.error, null);
  assert.equal(state.variables.status, 1);
});
