"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const accelSource = fs.readFileSync(path.join(root, "simulation-accel.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const simulator = fs.readFileSync(path.join(root, "hal-simulator.js"), "utf8");

function loadAcceleration() {
  const context = { WebAssembly, Uint8Array, Number, Math, Object, Array, Promise };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(accelSource, context, { filename: "simulation-accel.js" });
  return context.AliceSimulationAccel;
}

test("trace compression and sensor clamping use the embedded WASM kernel", async () => {
  const accel = loadAcceleration();
  assert.equal(await accel.initialize(), true);
  assert.deepEqual({ ...accel.getState() }, { backend: "wasm", wasm: true, traceKernel: true, maxTracePoints: 720 });
  assert.deepEqual(Array.from(accel.compressTrace([
    { timeMs: 0, value: 0 },
    { timeMs: 1, value: 0 },
    { timeMs: 2, value: 1 },
    { timeMs: 3, value: 1 }
  ]), item => ({ ...item })), [
    { timeMs: 0, value: false },
    { timeMs: 2, value: true }
  ]);
  const batch = accel.sensorBatch([{ minimum: 0, maximum: 100, value: 140 }]);
  assert.equal(batch[0].value, 100);
  assert.equal(batch[0].ratio, 1);
});

test("firmware worker is loaded only by the simulator and not as a page script", () => {
  assert.doesNotMatch(html, /<script[^>]+firmware-worker\.js/);
  assert.match(simulator, /new root\.Worker\(url\.href\)/);
  assert.match(simulator, /workerBridge\.step\(workerInputs\(\),/);
});
