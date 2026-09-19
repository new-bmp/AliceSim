"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const devices = require("../peripheral-devices.js");
const visuals = require("../peripheral-visuals.js");
const connected = { powered: true, vccConnected: true, gndConnected: true, vccLevel: 5, gndLevel: 0, bindingValid: true, clkConnected: true, dioConnected: true, dataConnected: true, signalConnected: true, pwmConnected: true };

test("seven segment face uses raw segments, colon, brightness, clear and power", () => {
  const device = devices.createTM1637({ connection: connected });
  device.setSegments([0x80, 0x40, 0x3f, 0x06], true);
  let face = visuals.frame("tm1637", device.getState());
  assert.deepEqual(face.segments, [0x80, 0x40, 0x3f, 0x06]);
  assert.equal(face.colon, true);
  device.setBrightness(0, true);
  assert.ok(visuals.frame("tm1637", device.getState()).brightness > 0, "brightness zero is the dimmest setting, not shutdown");
  device.setBrightness(7, false);
  assert.deepEqual(visuals.frame("tm1637", device.getState()).segments, [0, 0, 0, 0]);
  device.setBrightness(7, true);
  device.clear();
  assert.deepEqual(visuals.frame("tm1637", device.getState()).segments, [0, 0, 0, 0]);
  device.displayNumber(-12, false, true);
  assert.equal(visuals.frame("tm1637", device.getState()).segments[0], 0x40);
  device.setConnection({ powered: false });
  assert.equal(visuals.frame("tm1637", device.getState()).colon, false);
});

function maxRegister(device, register, value) {
  device.setConnection({ ...connected, selected: true });
  assert.equal(device.transmit([register, value]), 2);
  device.setConnection({ ...connected, selected: false });
}

test("MAX7219 latches split SPI packets only on CS rising, including shutdown and scan limits", () => {
  const a = devices.createMAX7219({ connection: connected });
  const b = devices.createMAX7219({ connection: connected });
  maxRegister(a, 12, 1);
  maxRegister(a, 11, 7);
  a.setConnection({ ...connected, selected: true });
  a.transmit([1]);
  a.transmit([0x81]);
  assert.equal(a.getState().rows[0], 0);
  a.setConnection({ ...connected, selected: false });
  assert.equal(a.getState().rows[0], 0x81);
  assert.equal(b.getState().rows[0], 0);
  maxRegister(a, 8, 0xff);
  maxRegister(a, 11, 0);
  assert.equal(visuals.frame("max7219", a.getState()).rows[7], 0);
  maxRegister(a, 15, 1);
  assert.deepEqual(visuals.frame("max7219", a.getState()).rows, Array(8).fill(255));
  maxRegister(a, 15, 0);
  maxRegister(a, 12, 0);
  assert.deepEqual(visuals.frame("max7219", a.getState()).rows, Array(8).fill(0));
  a.setConnection({ powered: false });
  assert.equal(a.transmit([12, 1]), 0);
  a.setConnection(connected);
  assert.equal(a.getState().visible, false);
  assert.deepEqual(a.getState().rows, Array(8).fill(0));
});

function spiRgb(colors) {
  let bits = "";
  for (const rgb of colors) for (const byte of [(rgb >> 8) & 255, (rgb >> 16) & 255, rgb & 255]) for (let bit = 7; bit >= 0; bit--) bits += byte & (1 << bit) ? "110" : "100";
  const bytes = bits.match(/.{8}/g).map(value => parseInt(value, 2));
  return bytes.concat(Array(18).fill(0));
}

test("WS2812 decodes GRB SPI pulses across transfers and waits for the reset before displaying", () => {
  const d = devices.createWS2812({ properties: { count: 3 }, connection: connected });
  const data = spiRgb([0xff0000, 0x00ff00, 0x0000ff]);
  d.transmitSpi(data.slice(0, 5), 2400000);
  d.transmitSpi(data.slice(5, 27), 2400000);
  assert.deepEqual(d.getState().colors, [0, 0, 0]);
  d.transmitSpi(data.slice(27), 2400000);
  assert.deepEqual(d.getState().colors, [0xff0000, 0x00ff00, 0x0000ff]);
  assert.deepEqual(visuals.frame("ws2812", d.getState()).colors, d.getState().colors);
  d.transmitSpi(spiRgb([0, 0, 0]), 2400000);
  assert.deepEqual(d.getState().colors, [0, 0, 0]);
});

test("WS2812 rejects invalid timing and partial/corrupt frames and bounds storage", () => {
  const d = devices.createWS2812({ properties: { count: 2 }, connection: connected });
  const valid = spiRgb([0xf8a342, 0x901030]);
  for (const hz of [NaN, 1000000, 8000000]) assert.equal(d.transmitSpi(valid, hz), 0);
  d.transmitSpi([0xff].concat(valid), 2400000);
  assert.deepEqual(d.getState().colors, [0, 0]);
  d.transmitSpi(valid.slice(0, 3).concat(Array(18).fill(0)), 2400000);
  assert.deepEqual(d.getState().colors, [0, 0]);
  d.transmitSpi(valid, 2400000);
  assert.deepEqual(d.getState().colors, [0xf8a342, 0x901030]);
  d.setConnection({ powered: false });
  assert.deepEqual(visuals.frame("ws2812", d.getState()).colors, [0, 0]);
  assert.equal(d.transmitSpi(valid, 2400000), 0);
});

test("servo horn matches pulse width; separate devices do not share state", () => {
  const a = devices.createSG90({ connection: connected });
  const b = devices.createSG90({ connection: connected });
  a.setPulseUs(500);
  assert.equal(visuals.frame("sg90", a.getState()).angle, -90);
  a.setPulseUs(2500);
  assert.equal(visuals.frame("sg90", a.getState()).angle, 90);
  assert.equal(visuals.frame("sg90", b.getState()).angle, 0);
});

test("input effects follow physical properties instead of a clock-driven animation", () => {
  const frame = (type, properties) => visuals.frame(type, { properties, power: { powered: true } });
  assert.equal(frame("potentiometer", { percent: 0 }).angle, -135);
  assert.equal(frame("potentiometer", { percent: 100 }).angle, 135);
  assert.equal(frame("rotaryEncoder", { position: -1 }).angle, -18);
  assert.equal(frame("joystick", { xPercent: 100, yPercent: 0 }).x, 75);
  assert.equal(frame("joystick", { xPercent: 100, yPercent: 0 }).y, 12);
  assert.equal(frame("joystick", { pressed: 1 }).pressed, true);
  assert.ok(frame("bh1750", { lux: 1000 }).light > frame("bh1750", { lux: 10 }).light);
  assert.equal(frame("mq2", { ppm: 1100, thresholdPpm: 1000 }).alarm, true);
  assert.equal(frame("pcf8574", { inputMask: 0xa5 }).mask, 0xa5);
});

test("relay/buzzer output is gated by power and real input, floating is never active-low", () => {
  const relay = devices.createGeneric("relay", { properties: { activeLow: 1 }, connection: connected });
  assert.equal(relay.getState().energized, false);
  relay.setConnection({ ...connected, signalLevel: 0 });
  assert.equal(visuals.frame("relay", relay.getState()).active, true);
  relay.setConnection({ ...connected, powered: false, signalLevel: 0 });
  assert.equal(visuals.frame("relay", relay.getState()).active, false);
  const buzzer = devices.createBuzzer({ connection: connected });
  buzzer.setTone(2000, 500);
  assert.equal(visuals.frame("buzzer", buzzer.getState()).active, true);
  buzzer.stop();
  assert.equal(visuals.frame("buzzer", buzzer.getState()).active, false);
});
