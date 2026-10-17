"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const audio = require("../peripheral-audio.js");

function audioHarness() {
  const oscillators = [];
  const gains = [];
  const listeners = {};
  const context = {
    state: "suspended", currentTime: 0, destination: {},
    async resume() { this.state = "running"; },
    createOscillator() {
      const oscillator = { frequency: { value: 0 }, type: "", stopped: false, started: false,
        connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; },
        setPeriodicWave(wave) { this.wave = wave; } };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() { const gain = { gain: { value: 0 }, connect() {}, disconnect() {} }; gains.push(gain); return gain; },
    createPeriodicWave(real, imaginary) { return { real, imaginary }; }
  };
  const document = { hidden: false, addEventListener(name, handler) { listeners[name] = handler; }, removeEventListener() {} };
  const window = { addEventListener(name, handler) { listeners[name] = handler; }, removeEventListener() {} };
  let created = 0;
  const player = audio.create({ contextFactory() { created++; return context; }, document, window });
  return { player, context, oscillators, gains, document, listeners, created: () => created };
}

function buzzer(id, frequencyHz = 440, overrides = {}) {
  return { id, type: "buzzer", deviceState: { ready: true, active: true, frequencyHz, dutyPermille: 500, power: { powered: true }, ...overrides } };
}

test("buzzer audio needs explicit enable and follows the powered PWM tone", async () => {
  const h = audioHarness();
  h.player.sync([buzzer("one")], { running: true });
  assert.equal(h.created(), 0, "simulation alone must not initialize audible playback");
  assert.equal(await h.player.setEnabled(true), true);
  h.player.sync([buzzer("one")]);
  assert.equal(h.player.getState().voiceCount, 1);
  assert.equal(h.oscillators[0].frequency.value, 440);
  assert.equal(h.oscillators[0].started, true);
  assert.ok(h.gains[0].gain.value > 0 && h.gains[0].gain.value <= .025);
  h.player.sync([buzzer("one", 880, { dutyPermille: 250 })]);
  assert.equal(h.oscillators[0].frequency.value, 880);
  assert.ok(h.oscillators[0].wave, "PWM duty changes the audible waveform");
  h.player.sync([buzzer("one", 880, { power: { powered: false } })]);
  assert.equal(h.player.getState().voiceCount, 0);
  assert.equal(h.oscillators[0].stopped, true);
});

test("pause, removal, disabled audio and hidden pages silence every bounded voice", async () => {
  const h = audioHarness();
  await h.player.setEnabled(true);
  h.player.sync(Array.from({ length: 10 }, (_, i) => buzzer(String(i))), { running: true });
  assert.ok(h.player.getState().voiceCount > 0 && h.player.getState().voiceCount <= 4);
  h.player.setRunning(false);
  assert.equal(h.player.getState().voiceCount, 0);
  assert.ok(h.oscillators.every(o => o.stopped));
  h.player.sync([buzzer("one")], { running: true });
  h.player.sync([]);
  assert.equal(h.player.getState().voiceCount, 0);
  h.player.sync([buzzer("one")]);
  h.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.player.getState().voiceCount, 0);
  h.player.sync([buzzer("one")]);
  assert.equal(h.player.getState().voiceCount, 0);
  h.document.hidden = false;
  h.player.sync([buzzer("one")]);
  h.listeners.pagehide();
  assert.equal(h.player.getState().voiceCount, 0);
  await h.player.setEnabled(false);
  assert.equal(h.player.getState().enabled, false);
});

test("invalid and static PWM cannot sound, and unavailable audio is handled", async () => {
  const h = audioHarness();
  await h.player.setEnabled(true);
  h.player.sync([buzzer("zero", 0), buzzer("dc", 1000, { dutyPermille: 1000 }), buzzer("float", 440, { ready: false }), buzzer("off", 440, { active: false })], { running: true });
  assert.equal(h.player.getState().voiceCount, 0);
  const unavailable = audio.create({ contextFactory() { throw new Error("unavailable"); } });
  assert.equal(await unavailable.setEnabled(true), false);
  assert.equal(unavailable.getState().voiceCount, 0);
});
