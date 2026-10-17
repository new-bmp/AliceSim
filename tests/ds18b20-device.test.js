"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = path.join(__dirname, "../ds18b20-device.js");
const deviceApi = fs.existsSync(source) ? require(source) : { create: () => ({}) };
const runtimeApi = require("../firmware-runtime.js");
const connection = { powered: true, vccConnected: true, gndConnected: true, vccLevel: 3.3, gndLevel: 0, bindingValid: true, dataConnected: true, dataPin: "PA4" };
function sensor(temperatureC = 25) {
  const d = deviceApi.create({ properties: { temperatureC }, connection });
  assert.equal(typeof d.apply, "function", "DS18B20 must process conversion/read operations");
  return d;
}
test("DS18B20 keeps its power-on scratchpad until a 750ms conversion completes", () => {
  const d = sensor(-12.375);
  assert.equal(d.apply("read-raw", { timeMs: 0 }).result.raw, 1360);
  assert.equal(d.apply("start-conversion", { timeMs: 0 }).accepted, true);
  assert.equal(d.apply("read-raw", { timeMs: 749 }).result.raw, 1360);
  assert.equal(d.getState().conversionPending, true);
  assert.equal(d.apply("read-raw", { timeMs: 750 }).result.raw, -198);
  assert.equal(d.getState().conversionPending, false);
  d.setProperties({ temperatureC: 125 });
  assert.equal(d.apply("read-raw", { timeMs: 1000 }).result.raw, -198);
  d.apply("start-conversion", { timeMs: 1000 });
  assert.equal(d.apply("read-raw", { timeMs: 1750 }).result.raw, 2000);
});
test("DS18B20 refuses missing DQ, wrong pin, missing supply and invalid voltage", () => {
  const d = sensor();
  assert.equal(d.apply("read-raw", { dataPin: "PB0" }).accepted, false);
  for (const bad of [{ ...connection, dataConnected: false }, { ...connection, dataPin: "" }, { ...connection, powered: false }, { ...connection, vccLevel: 2.9 }, { ...connection, vccLevel: null }, { ...connection, gndLevel: null }]) {
    d.setConnection(bad);
    assert.equal(d.getState().ready, false);
    assert.equal(d.apply("start-conversion", {}).accepted, false);
    assert.equal(d.apply("read-raw", {}).accepted, false);
  }
  d.setConnection(connection);
  assert.equal(d.apply("read-raw", {}).result.raw, 1360);
});
test("DS18B20 snapshots expose isolated connection and environment values", () => {
  const d = sensor(42.5), state = d.getState();
  assert.equal(state.connection.dataPin, "PA4");
  assert.equal(state.properties.temperatureC, 42.5);
  state.connection.dataPin = "PB0"; state.properties.temperatureC = 0;
  assert.equal(d.getState().connection.dataPin, "PA4");
  assert.equal(d.getState().properties.temperatureC, 42.5);
});
test("DS18B20 conversion state is independent and an interrupted supply clears the scratchpad", () => {
  const a = sensor(0), b = sensor(100);
  a.apply("start-conversion", { timeMs: 0 }); b.apply("start-conversion", { timeMs: 0 });
  a.setConnection({ ...connection, powered: false }); a.setConnection(connection);
  assert.equal(a.apply("read-raw", { timeMs: 750 }).result.raw, 1360);
  assert.equal(b.apply("read-raw", { timeMs: 750 }).result.raw, 1600);
});

test("DS18B20 render-time advancement does not erase conversion during chronological event replay", () => {
  const d = sensor(-12.375);
  d.setTime(1000);
  d.apply("start-conversion", { timeMs: 0 });
  d.setTime(1000);
  assert.equal(d.getState().raw, -198);
  assert.equal(d.apply("read-raw", { timeMs: 749 }).result.raw, 1360);
  assert.equal(d.apply("read-raw", { timeMs: 750 }).result.raw, -198);
});
test("DS18B20 semantic runtime binds the actual DQ pin and writes signed raw output after delay", () => {
  const d = sensor(-12.375), events = [];
  const runtime = runtimeApi.create({ variables: { raw: 999, initStatus: -1, early: 0, status: -1, celsius: 0 }, program: { operations: [
    { op: "aliceDs18b20Init", context: "probe", dataPin: "PA4", bindingValid: true, callbacks: ["reset", "write", "read"], busContext: "wire", resultTarget: "initStatus" },
    { op: "aliceDs18b20StartConversion", context: "probe" },
    { op: "aliceDs18b20ReadRaw", context: "probe", target: "early" },
    { op: "delay", ms: 750 },
    { op: "aliceDs18b20ReadRaw", context: "probe", target: "raw", resultTarget: "status" },
    { op: "aliceDs18b20RawToCelsiusX100", raw: { kind: "variable", name: "raw" }, resultTarget: "celsius" }
  ] } }, { onPeripheral(event) { events.push(event); return event.dataPin === "PA4" ? d.apply(event.action, event) : { accepted: false }; } });
  runtime.start(); runtime.step(0); const state = runtime.step(750);
  assert.equal(state.variables.initStatus, 0);
  assert.equal(state.variables.early, 1360);
  assert.equal(state.variables.status, 0);
  assert.equal(state.variables.raw, -198);
  assert.equal(state.variables.celsius, -1237);
  assert.deepEqual(events.map(event => [event.peripheralType, event.action, event.dataPin, event.timeMs]), [["ds18b20", "start-conversion", "PA4", 0], ["ds18b20", "read-raw", "PA4", 0], ["ds18b20", "read-raw", "PA4", 750]]);
});
test("DS18B20 runtime never reads an unbound sensor or overwrites output on failed transport", () => {
  let calls = 0;
  const runtime = runtimeApi.create({ variables: { raw: 321, initStatus: -1, readStatus: -1, noInitStatus: -1 }, program: { operations: [
    { op: "aliceDs18b20ReadRaw", context: "noInit", target: "raw", resultTarget: "noInitStatus" },
    { op: "aliceDs18b20Init", context: "probe", dataPin: "", bindingValid: false, resultTarget: "initStatus" },
    { op: "aliceDs18b20ReadRaw", context: "probe", target: "raw", resultTarget: "readStatus" },
    { op: "aliceDs18b20Init", context: "connected", dataPin: "PA4", bindingValid: true },
    { op: "aliceDs18b20ReadRaw", context: "connected", target: "raw", resultTarget: "readStatus" }
  ] } }, { onPeripheral() { calls += 1; return { accepted: false, reason: "power-disconnected" }; } });
  runtime.start(); const state = runtime.step(0);
  assert.equal(state.variables.raw, 321);
  assert.equal(state.variables.initStatus, 1);
  assert.equal(state.variables.noInitStatus, 1);
  assert.equal(state.variables.readStatus, 1);
  assert.equal(calls, 1);
});

test("DS18B20 failed reinitialization preserves the previous valid callbacks", () => {
  const events = [];
  const runtime = runtimeApi.create({ variables: { raw: 0, status: -1 }, program: { operations: [
    { op: "aliceDs18b20Init", context: "probe", dataPin: "PA4", bindingValid: true },
    { op: "aliceDs18b20Init", context: "probe", dataPin: "", bindingValid: false, resultTarget: "status" },
    { op: "aliceDs18b20ReadRaw", context: "probe", target: "raw" }
  ] } }, { onPeripheral(event) { events.push(event); return { accepted: true, result: { raw: 1360 } }; } });
  runtime.start(); const state = runtime.step(0);
  assert.equal(state.variables.status, 1);
  assert.equal(state.variables.raw, 1360);
  assert.deepEqual(events.map(event => event.dataPin), ["PA4"]);
});
