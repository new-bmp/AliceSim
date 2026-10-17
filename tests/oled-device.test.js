"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AliceOledDevice = require("../oled-device.js");

const connected = Object.freeze({
  powered: true,
  busConnected: true,
  bindingValid: true,
  vccLevel: 3.3,
  gndLevel: 0,
  sclPin: "PB6",
  sdaPin: "PB7"
});

function createConnected(options = {}) {
  return AliceOledDevice.create({
    ...options,
    connection: { ...connected, ...(options.connection || {}) }
  });
}

function framebufferOf(device) {
  return device.getState({ framebuffer: true }).framebuffer;
}

function offset(page, column) {
  return page * AliceOledDevice.WIDTH + column;
}

test("exports the 128x64 SSD1306 geometry and normalizes its I2C address", () => {
  assert.equal(AliceOledDevice.WIDTH, 128);
  assert.equal(AliceOledDevice.HEIGHT, 64);
  assert.equal(AliceOledDevice.BUFFER_SIZE, 1024);

  const device = AliceOledDevice.create({ address: "0x3d" });
  assert.equal(device.address, 0x3d);
  assert.equal(device.accepts(0x3d), true);
  assert.equal(device.accepts("61"), true);
  assert.equal(device.accepts(0x3c), false);
  assert.equal(device.accepts(), true);
});

test("visibility is gated by power, bus, pin binding, initialization and display state", () => {
  const variants = [
    { field: "powered", value: false },
    { field: "busConnected", value: false },
    { field: "bindingValid", value: false }
  ];

  variants.forEach(({ field, value }) => {
    const device = createConnected({ connection: { [field]: value } });
    device.command(0xaf);
    assert.equal(device.isVisible(), false, `${field} must gate the display`);
  });

  const device = createConnected();
  assert.equal(device.isVisible(), false, "an uninitialized controller is dark");

  device.command(0xaf);
  assert.equal(device.isVisible(), true);

  device.command(0xae);
  assert.equal(device.isVisible(), false, "DISPLAYOFF must blank the panel");

  device.command(0xaf);
  assert.equal(device.isVisible(), true, "DISPLAYON restores a fully connected panel");
});

test("losing power clears RAM and resets the controller before a later power-up", () => {
  const device = createConnected();
  device.command(0xaf);
  device.data([0xff, 0xaa]);
  assert.equal(device.isVisible(), true);
  assert.deepEqual(framebufferOf(device).slice(0, 2), [0xff, 0xaa]);

  device.setConnection({ ...connected, powered: false });
  let state = device.getState({ framebuffer: true });
  assert.equal(state.visible, false);
  assert.equal(state.initialized, false);
  assert.equal(state.displayOn, false);
  assert.equal(state.framebuffer.every(byte => byte === 0), true);

  device.setConnection(connected);
  assert.equal(device.isVisible(), false, "power restoration alone must not initialize the SSD1306");
});

test("decodes display, inverse, entire-display, contrast and mapping commands", () => {
  const device = createConnected();
  device.command(new Uint8Array([
    0xaf,
    0xa7,
    0xa5,
    0x81, 0x2a,
    0x45,
    0xd3, 0x03,
    0xa1,
    0xc8
  ]));

  const state = device.getState();
  assert.equal(state.initialized, true);
  assert.equal(state.displayOn, true);
  assert.equal(state.inverse, true);
  assert.equal(state.entireDisplayOn, true);
  assert.equal(state.contrast, 0x2a);
  assert.equal(device.startLine, 5);
  assert.equal(device.displayOffset, 3);
  assert.equal(device.segmentRemap, true);
  assert.equal(device.comScanDec, true);

  device.command([0xa4, 0xa6, 0xa0, 0xc0, 0xae]);
  assert.equal(device.entireDisplayOn, false);
  assert.equal(device.inverse, false);
  assert.equal(device.segmentRemap, false);
  assert.equal(device.comScanDec, false);
  assert.equal(device.displayOn, false);
});

test("horizontal addressing fills columns first and then advances pages", () => {
  const device = createConnected();
  device.command([
    0x20, 0x00,
    0x21, 2, 3,
    0x22, 1, 2
  ]);
  device.data([0x11, 0x22, 0x33, 0x44]);

  const framebuffer = framebufferOf(device);
  assert.equal(device.addressingMode, "horizontal");
  assert.equal(framebuffer[offset(1, 2)], 0x11);
  assert.equal(framebuffer[offset(1, 3)], 0x22);
  assert.equal(framebuffer[offset(2, 2)], 0x33);
  assert.equal(framebuffer[offset(2, 3)], 0x44);
  assert.equal(device.column, 2);
  assert.equal(device.page, 1);
});

test("vertical addressing fills pages first and then advances columns", () => {
  const device = createConnected();
  device.command([
    0x20, 0x01,
    0x21, 4, 5,
    0x22, 2, 3
  ]);
  device.data(new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4]));

  const framebuffer = framebufferOf(device);
  assert.equal(device.addressingMode, "vertical");
  assert.equal(framebuffer[offset(2, 4)], 0xa1);
  assert.equal(framebuffer[offset(3, 4)], 0xb2);
  assert.equal(framebuffer[offset(2, 5)], 0xc3);
  assert.equal(framebuffer[offset(3, 5)], 0xd4);
  assert.equal(device.column, 4);
  assert.equal(device.page, 2);
});

test("page addressing honors page and split column commands without changing page", () => {
  const device = createConnected();
  device.command([
    0x20, 0x02,
    0xb3,
    0x0a,
    0x12
  ]);
  device.data([0x5a, 0xa5]);

  const framebuffer = framebufferOf(device);
  assert.equal(device.addressingMode, "page");
  assert.equal(framebuffer[offset(3, 42)], 0x5a);
  assert.equal(framebuffer[offset(3, 43)], 0xa5);
  assert.equal(device.page, 3);
  assert.equal(device.column, 44);
});

test("framebuffer writes and pixel output obey normal, inverse and entire-display modes", () => {
  const device = createConnected();
  assert.equal(device.writeFramebuffer([0x01, 0x80]), 2);
  assert.equal(device.pixelAt(0, 0), 1);
  assert.equal(device.pixelAt(0, 1), 0);
  assert.equal(device.pixelAt(1, 7), 1);
  assert.equal(device.pixelAt(-1, 0), 0);

  device.command(0xa7);
  assert.equal(device.pixelAt(0, 0), 0);
  assert.equal(device.pixelAt(0, 1), 1);

  device.command([0xa6, 0xa5]);
  assert.equal(device.pixelAt(0, 1), 1);
  assert.equal(device.pixelAt(127, 63), 1);

  device.command(0xa4);
  assert.equal(device.pixelAt(127, 63), 0);
});

test("the common A1/C8 initialization keeps logical framebuffer coordinates upright", () => {
  const device = createConnected();
  device.command([0xa1, 0xc8, 0xaf]);
  const framebuffer = new Uint8Array(128 * 8);
  framebuffer[0] = 0x01;
  framebuffer[127 + 7 * 128] = 0x80;
  device.writeFramebuffer(framebuffer);

  assert.equal(device.pixelAt(0, 0), 1);
  assert.equal(device.pixelAt(127, 63), 1);
  assert.equal(device.pixelAt(127, 0), 0);
});

test("SSD1306 scroll configuration consumes all arguments without moving the RAM write cursor", () => {
  const device = createConnected();
  device.command([0x20, 2, 0xb3, 0x13, 0x07]);
  device.command([0x26, 0, 0, 7, 0, 0, 0xff]);
  device.data([0x5a]);
  assert.equal(framebufferOf(device)[offset(3, 55)], 0x5a);
  assert.equal(device.page, 3);
  assert.equal(device.column, 56);
});

test("SSD1306 horizontal scrolling advances selected pages using simulation time and stops in place", () => {
  const device = createConnected({ frameRateHz: 100 });
  const data = new Uint8Array(AliceOledDevice.BUFFER_SIZE);
  data[offset(0, 0)] = 1;
  data[offset(1, 0)] = 1;
  device.writeFramebuffer(data);
  device.setTime(100);
  device.command([0x27, 0, 1, 7, 1, 0, 0xff, 0x2f]);
  assert.equal(device.pixelAt(0, 8, 119), 1);
  assert.equal(device.pixelAt(127, 8, 120), 1, "left scrolling wraps the first column to the right edge");
  assert.equal(device.pixelAt(0, 8, 120), 0);
  assert.equal(device.pixelAt(0, 0, 120), 1, "pages outside the selected range remain fixed");
  device.setTime(140);
  device.command(0x2e);
  assert.equal(device.pixelAt(126, 8, 1000), 1);
  assert.equal(device.getState().scroll.active, false);
  assert.equal(framebufferOf(device)[offset(1, 0)], 1, "scrolling never rewrites RAM");
});

test("SSD1306 diagonal scrolling respects the vertical scroll area and split command arguments", () => {
  const device = createConnected({ frameRateHz: 100 });
  const data = new Uint8Array(AliceOledDevice.BUFFER_SIZE);
  data[offset(0, 0)] = 1;
  data[offset(1, 0)] = 4;
  data[offset(3, 0)] = 0x40;
  device.writeFramebuffer(data);
  device.command([0xa3, 8]);
  device.command([16, 0x29, 0, 1, 7]);
  device.command([2, 2, 0x2f], { timeMs: 50 });
  assert.equal(device.pixelAt(0, 10, 69), 1);
  assert.equal(device.pixelAt(1, 8, 70), 1, "one step moves right one column and up two rows");
  assert.equal(device.pixelAt(0, 0, 70), 1);
  assert.equal(device.pixelAt(0, 30, 70), 1);
  assert.equal(device.getState().scroll.verticalOffset, 2);
});
