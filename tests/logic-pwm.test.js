"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const AliceFirmwareRuntime = require("../firmware-runtime.js");
const root = path.resolve(__dirname, "..");

// Exercise the production Worker bridge and real Worker runtime, including its
// structured-clone boundary, without relying on browser repaint timing.
class FirmwareWorker {
  constructor() {
    const context = vm.createContext({ console, postMessage: message => {
      const data = structuredClone(message);
      queueMicrotask(() => this.onmessage?.({ data }));
    } });
    context.self = context;
    context.importScripts = source => vm.runInContext(
      fs.readFileSync(path.join(root, source.split("?")[0]), "utf8"), context);
    vm.runInContext(fs.readFileSync(path.join(root, "firmware-worker.js"), "utf8"), context);
    this.context = context;
  }
  postMessage(message) { this.context.onmessage({ data: structuredClone(message) }); }
  terminate() {}
}

function pwmModel(frequencyHz = 50, duty = .075, operations) {
  return {
    schemaVersion: 1, mcu: "STM32F103C8T6", diagnostics: [], outputs: {},
    pins: { PC13: { iocSignal: "GPIO_Input" }, PA8: { iocSignal: "TIM1_CH1" }, PA9: { iocSignal: "TIM1_CH2" } },
    timers: { htim1: {
      handle: "htim1", instance: "TIM1", frequencyHz, period: 19999,
      channels: [{ channelNumber: 1, pin: "PA8", pulse: 20000 * duty }, { channelNumber: 2, pin: "PA9", pulse: 10000 }]
    } },
    program: { operations: operations || [
      { op: "pwmStart", timer: "htim1", channel: 1 },
      { op: "delay", ms: 1e9 }
    ] }
  };
}

async function simulatorFor(model, backend) {
  const context = vm.createContext({
    console, URL, setTimeout, clearTimeout, AliceFirmwareRuntime,
    location: { href: "http://localhost/" },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { getElementById() { return null; }, dispatchEvent() {} },
    fetch: async () => ({ ok: true, json: async () => model }),
    // This intentionally always reports the high phase. PWM tracing must not
    // depend on the schematic's once-per-frame digital sample.
    AliceSchematic: { applyProjectModel() {}, sampleMcuPin() { return 1; }, driveMcuPwm() {}, reset() {} },
    ...(backend === "worker" ? { Worker: FirmwareWorker } : {})
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(root, "simulation-accel.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "hal-simulator.js"), "utf8"), context);
  const sim = context.AliceHalSimulator;
  const build = await sim.build({ files: { "main.c": "int main(void) {}" } });
  assert.equal(build.runtimeBackend, backend);
  return sim;
}

function at(samples, time) { return samples.filter(sample => sample.timeMs <= time).at(-1)?.value; }
function assertOrdered(samples) {
  assert.ok(samples.length <= 720, `unbounded trace: ${samples.length}`);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].timeMs >= samples[i - 1].timeMs, "trace time reversed");
}

for (const backend of ["main-thread", "worker"]) {
  test(`${backend}: PWM edges survive steps synchronized to the PWM period`, async () => {
    for (const frequency of [50, 1000]) {
      const sim = await simulatorFor(pwmModel(frequency), backend);
      sim.setTracePins(["PA8"]);
      await sim.start(); await sim.step(0);
      const period = 1000 / frequency;
      for (let i = 0; i < 5; i++) await sim.step(period);
      const samples = sim.getTrace().samples;
      for (let i = 0; i < 5; i++) {
        assert.equal(at(samples, (i + .04) * period), true, "pulse high phase missing");
        assert.equal(at(samples, (i + .5) * period), false, "pulse falling edge missing");
      }
      assert.equal(sim.getTrace().timeMs, 5 * period, "capture must expose its actual end time");
      assertOrdered(samples);
    }
  });

  test(`${backend}: timer pins are selectable without redundant model.pins entries`, async () => {
    const model = pwmModel(); model.pins = {};
    const sim = await simulatorFor(model, backend);
    assert.equal(sim.getSummary().tracePin, "PA8");
    assert.deepEqual(Array.from(sim.setTracePins(["PA8", "PA9"])), ["PA8", "PA9"]);
  });

  test(`${backend}: compare changes, 0/100% and stop preserve previous PWM history`, async () => {
    const sim = await simulatorFor(pwmModel(50, .075, [
      { op: "pwmStart", timer: "htim1", channel: 1 },
      { op: "delay", ms: 25 },
      { op: "pwmSetCompare", timer: "htim1", channel: 1, compare: 10000 },
      { op: "delay", ms: 15 },
      { op: "pwmSetCompare", timer: "htim1", channel: 1, compare: 0 },
      { op: "delay", ms: 20 },
      { op: "pwmSetCompare", timer: "htim1", channel: 1, compare: 20000 },
      { op: "delay", ms: 20 },
      { op: "pwmStop", timer: "htim1", channel: 1 },
      { op: "delay", ms: 100 }
    ]), backend);
    sim.setTracePins(["PA8"]);
    await sim.start(); await sim.step(0);
    // One batch includes every configuration change and delay.
    await sim.step(100);
    const samples = sim.getTrace().samples;
    assert.equal(at(samples, 21), true);
    assert.equal(at(samples, 22), false);
    assert.equal(at(samples, 26), true);
    assert.equal(at(samples, 31), false);
    assert.equal(at(samples, 41), false);
    assert.equal(at(samples, 61), true);
    assert.equal(at(samples, 81), false);
    assertOrdered(samples);
    await sim.reset();
    assert.ok(sim.getTrace().samples.every(sample => sample.timeMs === 0), "reset retained old PWM edges");
    await sim.start(); await sim.step(0); await sim.step(20);
    assert.equal(at(sim.getTrace().samples, 2), false);
  });

  test(`${backend}: selection during PWM, independent channels and long high-frequency steps stay bounded`, async () => {
    const sim = await simulatorFor(pwmModel(1e6, .25, [
      { op: "pwmStart", timer: "htim1", channel: 1 },
      { op: "pwmStart", timer: "htim1", channel: 2 },
      { op: "delay", ms: 1e9 }
    ]), backend);
    sim.setTracePins(["PC13"]);
    await sim.start(); await sim.step(0); await sim.step(25);
    sim.setTracePins(["PA8", "PA9"]);
    await sim.step(1000);
    for (const channel of sim.getTrace().channels) {
      assertOrdered(channel.samples);
      assert.ok(channel.samples.some(sample => sample.value) && channel.samples.some(sample => !sample.value));
      const fall = channel.samples.find((sample, i, samples) => i && !sample.value && samples[i - 1].value);
      const rise = channel.samples[channel.samples.indexOf(fall) - 1];
      const width = fall.timeMs - rise.timeMs;
      assert.ok(Math.abs(width - (channel.pin === "PA8" ? .00025 : .0005)) < 1e-8, `incorrect pulse width ${width}`);
      assert.ok(channel.samples[0].timeMs > 1024, "trace should retain recent complete pulses");
    }
  });

  test(`${backend}: GPIO takeover stops PWM edges and restarting PWM overrides the old GPIO latch`, async () => {
    const sim = await simulatorFor(pwmModel(50, .5, [
      { op: "gpioWrite", pin: "PA8", value: 0 },
      { op: "pwmStart", timer: "htim1", channel: 1 },
      { op: "delay", ms: 25 },
      { op: "gpioWrite", pin: "PA8", value: 0 },
      { op: "delay", ms: 15 },
      { op: "pwmStart", timer: "htim1", channel: 1 },
      { op: "delay", ms: 100 }
    ]), backend);
    sim.setTracePins(["PA8"]);
    await sim.start(); await sim.step(0); await sim.step(20);
    await sim.pause(); await sim.start(); await sim.step(40);
    const samples = sim.getTrace().samples;
    assert.equal(at(samples, 1), true);
    assert.equal(at(samples, 12), false);
    assert.equal(at(samples, 21), true);
    assert.equal(at(samples, 26), false);
    assert.equal(at(samples, 41), true);
    assert.equal(at(samples, 51), false);
    assertOrdered(samples);
  });
}

function drawPaths(trace, width = 10) {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const draw = source.slice(source.indexOf("function drawLogic()"), source.indexOf('window.addEventListener("resize", resizeCanvas)'));
  const paths = []; let points;
  const context = vm.createContext({
    canvas: { clientWidth: width, clientHeight: 40 }, TRACE_COLORS: ["green"], traceChannelLabel: () => "PWM",
    ctx: { clearRect() {}, beginPath() { points = []; }, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
      stroke() { paths.push(points); }, save() {}, restore() {}, fillText() {} },
    requestAnimationFrame() {},
    window: { AliceHalSimulator: { getTrace: () => trace } }
  });
  vm.runInContext(`${draw}\ndrawLogic();`, context);
  return paths;
}

test("logic canvas draws both edges of a subpixel PWM pulse", () => {
  const paths = drawPaths({ timeMs: 100, channels: [{ pin: "PA8", samples: [
      { timeMs: 0, value: false }, { timeMs: 1, value: true }, { timeMs: 1.01, value: false }, { timeMs: 100, value: false }
  ] }] });
  const waveform = paths.at(-1);
  const edges = waveform.filter((point, i) => i && point[0] === waveform[i - 1][0] && point[1] !== waveform[i - 1][1]);
  assert.equal(edges.length, 2, "pixel sampling erased a narrow but real pulse");
});

test("logic canvas aligns simultaneous edges across channels with different history lengths", () => {
  const paths = drawPaths({ timeMs: 100, channels: [
    { pin: "PA8", samples: [{ timeMs: 0, value: true }, { timeMs: 80, value: false }] },
    { pin: "PA9", samples: [{ timeMs: 50, value: true }, { timeMs: 80, value: false }] }
  ] }, 100);
  const [first, second] = paths.slice(-2);
  const fallingX = waveform => waveform.find((point, i) => i && point[0] === waveform[i - 1][0] && point[1] > waveform[i - 1][1])?.[0];
  assert.equal(fallingX(first), 60, "older channel history was not clipped to the shared capture window");
  assert.equal(fallingX(second), 60, "simultaneous transitions must share the same horizontal position");
});
