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

function connectedDisplay(width = 3, height = 2) {
  const display = spiDisplay.create({ width, height });
  display.setConnection({ powered: true, busConnected: true, bindingValid: true, selected: true });
  display.transmit([0x11, 0x29], false);
  return display;
}

function register(display, code, bytes) {
  display.transmit([code], false);
  if (bytes) display.transmit(bytes, true);
}

test("ST7735 MADCTL maps mirror and exchanged row/column addresses onto the physical glass", () => {
  const mirrored = connectedDisplay();
  register(mirrored, 0x36, [0xc0]);
  register(mirrored, 0x2c, [0xf8, 0x00]);
  assert.deepEqual(Array.from(mirrored.getDisplayFramebuffer()), [0, 0, 0, 0, 0, 0xf800]);

  const rotated = connectedDisplay();
  register(rotated, 0x36, [0x20]);
  register(rotated, 0x2a, [0, 0, 0, 1]);
  register(rotated, 0x2b, [0, 0, 0, 2]);
  register(rotated, 0x2c, [0xf8, 0, 0x07, 0xe0, 0, 0x1f, 0xff, 0xff, 0xff, 0xe0, 0xf8, 0x1f]);
  assert.deepEqual(Array.from(rotated.getDisplayFramebuffer()), [0xf800, 0x001f, 0xffe0, 0x07e0, 0xffff, 0xf81f]);
});

test("ST7735 BGR order and inversion alter visible colors without corrupting display RAM", () => {
  const display = connectedDisplay();
  register(display, 0x2c, [0xf8, 0]);
  register(display, 0x36, [0x08]);
  assert.equal(display.getDisplayFramebuffer()[0], 0x001f);
  register(display, 0x21);
  assert.equal(display.getDisplayFramebuffer()[0], 0xffe0);
  assert.equal(display.getFramebuffer()[0], 0xf800);
  register(display, 0x20);
  assert.equal(display.getDisplayFramebuffer()[0], 0x001f);
  register(display, 0x01);
  assert.equal(display.getState().inverse, false);
  assert.equal(display.getState().madctl, 0);
});

test("ST7735 COLMOD RGB666 accepts split pixel data and switches back to RGB565", () => {
  const display = connectedDisplay();
  register(display, 0x3a, [0x06]);
  register(display, 0x2c, [0xfc]);
  display.transmit([0, 0, 0, 0xfc], true);
  display.transmit([0], true);
  assert.deepEqual(Array.from(display.getFramebuffer()).slice(0, 3), [0xf800, 0x07e0, 0]);
  register(display, 0x3a, [0x05]);
  register(display, 0x2c, [0x00, 0x1f]);
  assert.equal(display.getFramebuffer()[0], 0x001f);
});

test("ST7789 has a 240 square framebuffer and accepts real RGB565 register writes", () => {
  const display = spiDisplay.create({ controller: "ST7789" });
  display.setConnection({ powered: true, busConnected: true, bindingValid: true, selected: true, resetReleased: true, backlightOn: true });
  register(display, 0x11);
  register(display, 0x29);
  register(display, 0x3a, [0x55]);
  register(display, 0x2a, [0, 239, 0, 239]);
  register(display, 0x2b, [0, 239, 0, 239]);
  register(display, 0x2c, [0xf8]);
  display.transmit([0], true);
  assert.equal(display.getState().controller, "ST7789");
  assert.equal(display.getState().width, 240);
  assert.equal(display.getState().height, 240);
  assert.equal(display.getFramebuffer()[239 * 240 + 239], 0xf800);
  assert.equal(display.getState().visible, true);
});

test("ST7789 backlight blanks the glass without losing RAM and reset holds the controller", () => {
  const display = spiDisplay.create({ controller: "ST7789" });
  display.setConnection({ powered: true, busConnected: true, bindingValid: true, selected: true, resetReleased: true, backlightOn: true });
  register(display, 0x11);
  register(display, 0x29);
  register(display, 0x2c, [0x07, 0xe0]);
  display.setConnection({ backlightOn: false });
  assert.equal(display.getState().visible, false);
  assert.equal(display.getFramebuffer()[0], 0x07e0);
  display.setConnection({ backlightOn: true });
  assert.equal(display.getState().visible, true);
  display.setConnection({ resetReleased: false });
  assert.equal(display.transmit([0x11, 0x29], false), 0);
  assert.equal(display.getState().visible, false);
  assert.equal(display.getFramebuffer()[0], 0);
  display.setConnection({ resetReleased: true });
  assert.equal(display.getState().visible, false, "reset needs a fresh initialization sequence");
});

test("off-glass SPI display addresses never overwrite the last visible pixel", () => {
  const display = connectedDisplay();
  register(display, 0x2a, [0, 100, 0, 101]);
  register(display, 0x2b, [0, 100, 0, 101]);
  register(display, 0x2c, [0xff, 0xff]);
  assert.ok(Array.from(display.getFramebuffer()).every(pixel => pixel === 0));
});
