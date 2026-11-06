"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const core = require("../learning-core.js"), lab = require("../learning-lab.js"), runner = require("../learning-runner.js");
function context() {
  return core.buildContext({ project: { name: "arbitrary project" }, runtime: { status: "RUNNING", timeMs: 120, built: true },
    circuit: { components: [{ id: "chip", type: "mcu", pins: ["PA8", "PA0"] }, { id: "source", type: "adcSource", pins: ["AO"], adcVoltage: 1.65 }],
      wires: [{ id: "w", from: { componentId: "source", pin: "AO" }, to: { componentId: "chip", pin: "PA0" } }],
      nets: [{ id: "n", endpoints: [{ componentId: "chip", pin: "PA0" }], voltage: null, level: null, floating: true }] },
    measurements: { pwm: { PA8: { active: true, frequencyHz: 50, dutyCycle: .075 } } },
    controls: [{ id: "source:voltage", componentId: "source", label: "输入", min: 0, max: 3.3, value: 1.65, unit: "V" }],
    serial: [{ instance: "USART2", timeMs: 100, text: "ANGLE=90" }] });
}
function plan() { return { title: "任意工程", goal: "测量 PWM", steps: [{ title: "测量", instruction: "改变输入后检查输出", targetIds: ["pin:chip:PA8"], hints: ["看引脚", "周期", "代码"], checks: [], cases: [
  { label: "中点", waitMs: 100, stimuli: [{ controlId: "source:voltage", value: 1.65 }], checks: [{ kind: "pwm-pulse", label: "高电平", targetId: "pin:chip:PA8", min: 1490, max: 1510 }] }
] }] }; }
test("declarative tasks reject unknown rules, forged targets, unbounded input and missing numbers", () => {
  const c = context(); assert.equal(lab.normalizePlan(plan(), c).steps.length, 1);
  for (const mutate of [p => p.steps[0].cases[0].checks[0].kind = "execute", p => p.steps[0].cases[0].checks[0].targetId = "pin:unknown:PA8", p => p.steps[0].cases[0].checks[0].min = null, p => p.steps[0].cases[0].stimuli[0].value = 99, p => p.steps[0].cases[0].waitMs = Infinity]) {
    const p = plan(); mutate(p); assert.throws(() => lab.normalizePlan(p, c));
  }
});
test("PWM grading uses actual runtime parameters, preserves failed targets and refuses unknown evidence", () => {
  const c = context(), check = lab.normalizePlan(plan(), c).steps[0].cases[0].checks[0];
  assert.equal(lab.evaluate(check, c).status, "pass"); assert.equal(lab.evaluate(check, c).actual, 1500);
  c.measurements.pwm.PA8.dutyCycle = .1; assert.equal(lab.evaluate(check, c).status, "fail");
  c.runtime.built = false; assert.equal(lab.evaluate(check, c).status, "unknown");
  c.runtime.built = true; c.runtime.status = "budget-exceeded"; assert.equal(lab.evaluate(check, c).status, "unknown");
  c.runtime.status = "RUNNING"; c.measurements = {}; assert.equal(lab.evaluate(check, c).status, "unknown");
});
test("connectivity follows real wires and floating/null voltages never pass as zero", () => {
  const c = context();
  assert.equal(lab.evaluate({ kind: "connected", targetId: "pin:chip:PA0", peerTargetId: "pin:source:AO" }, c).status, "pass");
  assert.equal(lab.evaluate({ kind: "voltage", targetId: "pin:chip:PA0", min: 0, max: 0 }, c).status, "unknown");
  c.circuit.wires = []; assert.equal(lab.evaluate({ kind: "connected", targetId: "pin:chip:PA0", peerTargetId: "pin:source:AO" }, c).status, "fail");
});
test("serial evidence belongs to this test window and no checks never count as passed", () => {
  const c = context(), check = { kind: "serial-contains", contains: "ANGLE=90", instance: "USART2" };
  assert.equal(lab.evaluate(check, c, { sinceMs: 50 }).status, "pass");
  assert.equal(lab.evaluate(check, c, { sinceMs: 101 }).status, "unknown");
  assert.equal(lab.evaluateAll([], c).status, "unknown");
});
function environment() {
  const c = context(); let time = 0, epoch = 0, voltage = .8, pauses = 0;
  c.runtime.status = "PAUSED";
  return { c, get voltage() { return voltage; }, get pauses() { return pauses; }, nextProject() { epoch++; voltage = 3; },
    capture: () => structuredClone(c), generation: () => epoch, controls: () => [{ id: "source:voltage", value: voltage, min: 0, max: 3.3 }],
    setControl(id, value) { voltage = value; return value; }, async start() { c.runtime.status = "RUNNING"; return true; }, pause() { pauses++; c.runtime.status = "PAUSED"; },
    now: () => time, async wait(ms) { time += ms; c.runtime.timeMs += ms; } };
}
test("automatic scenarios advance simulation, restore inputs and restore paused state", async () => {
  const env = environment(), task = lab.normalizePlan(plan(), context()).steps[0];
  const result = await runner.create(env).run(task);
  assert.equal(result.status, "pass"); assert.equal(env.voltage, .8); assert.equal(env.pauses, 1);
});
test("cancellation restores controls; project switch cannot restore into the next project", async () => {
  for (const switchProject of [false, true]) {
    const env = environment(), controller = new AbortController();
    env.wait = async () => { if (switchProject) env.nextProject(); else controller.abort(); };
    await assert.rejects(runner.create(env).run(lab.normalizePlan(plan(), context()).steps[0], { signal: controller.signal }));
    assert.equal(env.voltage, switchProject ? 3 : .8); assert.equal(env.pauses, switchProject ? 0 : 1);
  }
});
