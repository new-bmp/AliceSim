"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const spiDisplay = require("../spi-display-device.js");

test("ST7735 SPI display accepts command/data windows and RGB565 pixels", () => {
  const display = spiDisplay.create();
  display.setConnection({ powered: true, busConnected: true, bindingValid: true, selected: true });

  display.transmit([0x11], false);
  display.transmit([0x29], false);
  display.transmit([0x2a], false);
  display.transmit([0x00, 0x01, 0x00, 0x02], true);
  display.transmit([0x2b], false);
  display.transmit([0x00, 0x03, 0x00, 0x03], true);
  display.transmit([0x2c], false);
  display.transmit([0xf8, 0x00, 0x07, 0xe0], true);

  const state = display.getState();
  const framebuffer = display.getFramebuffer();
  assert.equal(state.visible, true);
  assert.equal(framebuffer[3 * state.width + 1], 0xf800);
  assert.equal(framebuffer[3 * state.width + 2], 0x07e0);
  assert.equal(state.bytesReceived, 17);
});

test("SPI display rejects transfers when power, binding or chip select is missing", () => {
  const display = spiDisplay.create();
  assert.equal(display.transmit([0x11], false), 0);
  display.setConnection({ powered: true, busConnected: true, bindingValid: true, selected: false });
  assert.equal(display.transmit([0x11], false), 0);
  assert.equal(display.getState().initialized, false);
});
