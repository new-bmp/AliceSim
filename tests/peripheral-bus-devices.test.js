"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const bus = fs.existsSync(require("node:path").join(__dirname, "../peripheral-bus-devices.js"))
  ? require("../peripheral-bus-devices.js") : { supports: () => false, create: () => ({}) };
const i2c = { powered: true, vccConnected: true, gndConnected: true, vccLevel: 3.3, gndLevel: 0, bindingValid: true, busConnected: true, clkConnected: true, dioConnected: true };
const spi = { ...i2c, dataConnected: true, signalConnected: true, selected: false };
function device(type, properties = {}) {
  const d = bus.create(type, { properties, connection: type === "w25qxx" ? spi : i2c });
  assert.equal(typeof d.transmit, "function", type + " must handle real bus writes");
  assert.equal(typeof d.receive, "function", type + " must provide bus response bytes");
  return d;
}
function read(d, reg, length, timeMs = 0) {
  const r = d.receive({ memoryAddress: reg, length, timeMs });
  assert.equal(r.accepted, true, r.reason);
  return r.bytes;
}
function write(d, reg, bytes, timeMs = 0) {
  const r = d.transmit({ memoryAddress: reg, bytes, timeMs });
  assert.equal(r.accepted, true, r.reason);
}
function signed(high, low) { const n = (high << 8) | low; return n & 32768 ? n - 65536 : n; }
function cs(d, selected) { d.setConnection({ ...spi, selected }); }
function flashCommand(d, bytes) { cs(d, true); assert.equal(d.transmit({ bytes }).accepted, true); cs(d, false); }
function flashRead(d, address, length) { cs(d, true); d.transmit({ bytes: [3, address >> 16, address >> 8, address] }); const r = d.receive({ length }); cs(d, false); assert.equal(r.accepted, true); return r.bytes; }

test("bus factory restricts supported types and gives each device independent state", () => {
  for (const type of ["bmp280", "mpu6050", "bh1750", "sht30", "ds3231", "ina219", "pcf8574", "pca9685", "w25qxx"]) assert.equal(bus.supports(type), true, type);
  assert.equal(bus.supports("oled"), false);
  assert.equal(bus.create("absent"), null);
  const a = device("mpu6050", { address: 0x69 });
  const b = device("mpu6050");
  assert.equal(a.accepts(0x69), true);
  assert.equal(a.accepts(0x68), false);
  assert.equal(b.accepts(0x68), true);
  write(a, 0x1b, [0x18]);
  assert.deepEqual(read(b, 0x1b, 1), [0]);
});

test("I2C rejects missing SDA, invalid binding, bad voltage and wrong address without mutating registers", () => {
  const d = device("mpu6050");
  for (const connection of [{ ...i2c, dioConnected: false }, { ...i2c, bindingValid: false }, { ...i2c, vccLevel: 1 }, { ...i2c, powered: false }]) {
    d.setConnection(connection);
    assert.equal(d.getState().ready, false);
    assert.equal(d.transmit({ memoryAddress: 0x1b, bytes: [0x18] }).accepted, false);
    assert.equal(d.receive({ memoryAddress: 0x75, length: 1 }).accepted, false);
  }
  d.setConnection(i2c);
  assert.equal(d.receive({ address: 0x69, memoryAddress: 0x75, length: 1 }).accepted, false);
  assert.deepEqual(read(d, 0x1b, 1), [0]);
  assert.equal(d.receive({ length: -1 }).accepted, false);
});

test("default supply limits distinguish 3.3V chips from sensors that permit 5V", () => {
  for (const type of ["bmp280", "mpu6050", "bh1750", "w25qxx"]) {
    const d = device(type); d.setConnection({ ...(type === "w25qxx" ? spi : i2c), vccLevel: 5 });
    assert.equal(d.getState().ready, false, type);
  }
  for (const type of ["sht30", "ds3231", "ina219", "pcf8574", "pca9685"]) {
    const d = device(type); d.setConnection({ ...i2c, vccLevel: 5 });
    assert.equal(d.getState().ready, true, type);
  }
  const bmp = device("bmp280"); bmp.setConnection({ ...i2c, vccLevel: 1.8 });
  assert.equal(bmp.getState().ready, true);
});

test("BMP280 exposes chip ID, calibration and environmentally consistent 20-bit measurements", () => {
  const d = device("bmp280", { temperatureC: 25.08, pressurePa: 100653.25 });
  assert.deepEqual(read(d, 0xd0, 1), [0x58]);
  assert.deepEqual(read(d, 0x88, 6), [0x70, 0x6b, 0x43, 0x67, 0x18, 0xfc]);
  write(d, 0xf4, [0x27]);
  let data = read(d, 0xf7, 6);
  let pressure = data[0] * 4096 + data[1] * 16 + (data[2] >> 4);
  let temperature = data[3] * 4096 + data[4] * 16 + (data[5] >> 4);
  assert.ok(Math.abs(temperature - 519888) < 100);
  assert.ok(Math.abs(pressure - 415148) < 100);
  d.setProperties({ temperatureC: 0, pressurePa: 90000 });
  data = read(d, 0xf7, 6);
  assert.ok(data[3] * 4096 + data[4] * 16 + (data[5] >> 4) < temperature);
  write(d, 0xe0, [0xb6]);
  assert.deepEqual(read(d, 0xf4, 1), [0]);
  assert.deepEqual(read(d, 0xd0, 1), [0x58]);
});

test("MPU6050 wake and full-scale registers determine signed acceleration and gyro bytes", () => {
  const d = device("mpu6050", { accelX: 1, accelY: -1, accelZ: 0.5, gyroZ: -100, temperatureC: 25 });
  assert.deepEqual(read(d, 0x75, 1), [0x68]);
  assert.deepEqual(read(d, 0x3b, 14), Array(14).fill(0));
  write(d, 0x6b, [0]);
  let b = read(d, 0x3b, 14);
  assert.equal(signed(b[0], b[1]), 16384);
  assert.equal(signed(b[2], b[3]), -16384);
  assert.equal(signed(b[4], b[5]), 8192);
  assert.equal(signed(b[12], b[13]), -13100);
  write(d, 0x1c, [0x10]);
  write(d, 0x1b, [0x18]);
  b = read(d, 0x3b, 14);
  assert.equal(signed(b[0], b[1]), 4096);
  assert.equal(signed(b[12], b[13]), -1640);
  d.transmit({ bytes: [0x75] });
  assert.deepEqual(d.receive({ length: 1 }).bytes, [0x68]);
  write(d, 0x6b, [0x80]);
  assert.deepEqual(read(d, 0x6b, 1), [0x40]);
});

test("BH1750 requires a completed command measurement and observes mode, MTreg and power-down", () => {
  const d = device("bh1750", { lux: 500 });
  assert.equal(d.receive({ length: 2 }).accepted, false);
  assert.equal(d.transmit({ bytes: [0x10], timeMs: 0 }).accepted, true);
  assert.equal(d.receive({ length: 2, timeMs: 119 }).accepted, false);
  assert.deepEqual(d.receive({ length: 2, timeMs: 120 }).bytes, [2, 88]);
  d.setProperties({ lux: 1000 });
  assert.deepEqual(d.receive({ length: 2, timeMs: 240 }).bytes, [4, 176]);
  d.transmit({ bytes: [0x21], timeMs: 240 });
  assert.deepEqual(d.receive({ length: 2, timeMs: 360 }).bytes, [9, 96]);
  assert.equal(d.receive({ length: 2, timeMs: 480 }).accepted, false);
  d.transmit({ bytes: [0x00] });
  assert.equal(d.receive({ length: 2 }).accepted, false);
});

test("BH1750 sensitivity commands change both response scale and conversion time", () => {
  const d = device("bh1750", { lux: 1000 });
  d.transmit({ bytes: [0x44, 0x6a, 0x10], timeMs: 0 });
  assert.equal(d.receive({ length: 2, timeMs: 239 }).accepted, false);
  assert.deepEqual(d.receive({ length: 2, timeMs: 240 }).bytes, [9, 96]);
});

test("SHT30 returns accurate conversion words with independent CRC8 after conversion delay", () => {
  const d = device("sht30", { temperatureC: 25, humidityPercent: 50 });
  d.transmit({ bytes: [0x24, 0x00], timeMs: 0 });
  assert.equal(d.receive({ length: 6, timeMs: 14 }).accepted, false);
  const r = d.receive({ length: 6, timeMs: 15 });
  assert.equal(r.accepted, true);
  assert.deepEqual(r.bytes, [0x66, 0x66, 0x93, 0x80, 0x00, 0xa2]);
  d.setProperties({ temperatureC: -45, humidityPercent: 100 });
  d.transmit({ bytes: [0x24, 0x00], timeMs: 15 });
  assert.deepEqual(d.receive({ length: 6, timeMs: 30 }).bytes, [0, 0, 0x81, 255, 255, 0xac]);
});

test("DS3231 ticks only with simulated time and accepts BCD writes across midnight", () => {
  const d = device("ds3231", { unixTime: Date.UTC(2026, 11, 31, 23, 59, 59) / 1000 });
  assert.deepEqual(read(d, 0, 3, 0), [0x59, 0x59, 0x23]);
  assert.deepEqual(read(d, 0, 7, 2000), [0x01, 0, 0, 0x06, 0x01, 0x01, 0x27]);
  write(d, 0, [0x58, 0x59, 0x23, 0x04, 0x28, 0x02, 0x24], 2000);
  assert.deepEqual(read(d, 0, 7, 4000), [0, 0, 0, 0x05, 0x29, 0x02, 0x24]);
  d.setConnection({ ...i2c, powered: false });
  d.setTime(5000);
  d.setConnection(i2c);
  assert.deepEqual(read(d, 0, 3, 5000), [1, 0, 0]);
});

test("DS3231 retains 12-hour mode while crossing noon", () => {
  const d = device("ds3231");
  write(d, 0, [0x59, 0x59, 0x51, 0x04, 0x01, 0x01, 0x26]);
  assert.deepEqual(read(d, 0, 3, 0), [0x59, 0x59, 0x51]);
  assert.deepEqual(read(d, 0, 3, 1000), [0, 0, 0x72]);
});

test("INA219 uses big-endian voltage/current/calibration registers with signed current", () => {
  const d = device("ina219", { busVoltageV: 12, currentA: -0.5, shuntOhms: 0.1 });
  assert.deepEqual(read(d, 2, 2), [0x5d, 0xc2]);
  assert.deepEqual(read(d, 4, 2), [0, 0]);
  write(d, 5, [0x10, 0x00]);
  assert.deepEqual(read(d, 4, 2), [0xec, 0x78]);
  assert.deepEqual(read(d, 1, 2), [0xec, 0x78]);
  write(d, 0, [0x80, 0]);
  assert.deepEqual(read(d, 5, 2), [0, 0]);
  assert.deepEqual(read(d, 0, 2), [0x39, 0x9f]);
});

test("PCF8574 read resolves released inputs and written low outputs independently", () => {
  const d = device("pcf8574", { inputMask: 0xa5 });
  assert.deepEqual(d.receive({ length: 1 }).bytes, [0xa5]);
  d.transmit({ bytes: [0xf0] });
  assert.equal(d.getState().outputLatch, 0xf0);
  assert.deepEqual(d.receive({ length: 1 }).bytes, [0xa0]);
  d.setPortInputs(0x7f);
  assert.equal(d.getState().interruptActive, true);
  assert.deepEqual(d.getState().pinLevels, [0, 0, 0, 0, 0, 1, 0, 0]);
  assert.deepEqual(d.receive({ length: 1 }).bytes, [0x20]);
  assert.equal(d.getState().interruptActive, false);
  const other = device("pcf8574");
  assert.deepEqual(other.receive({ length: 1 }).bytes, [255]);
});

test("PCA9685 honors prescale, auto-increment, sleep, full-on/off and output enable", () => {
  const d = device("pca9685");
  write(d, 0, [0x30]);
  write(d, 0xfe, [121]);
  write(d, 0, [0x20]);
  write(d, 6, [0, 0, 0x33, 0x01]);
  let state = d.getState();
  assert.ok(Math.abs(state.frequencyHz - 50.0288) < 0.001);
  assert.ok(Math.abs(state.channels[0].pulseUs - 1500) < 5);
  assert.equal(state.channels[0].active, true);
  assert.equal(state.channels.length, 16);
  write(d, 0x0a, [0, 0x10, 0, 0]);
  assert.equal(d.getState().channels[1].dutyCycle, 1);
  write(d, 0x0d, [0x10]);
  assert.equal(d.getState().channels[1].active, false);
  d.setConnection({ ...i2c, outputEnabled: false });
  assert.equal(d.getState().channels[0].active, false);
  d.setConnection({ ...i2c, dioConnected: false, outputEnabled: true });
  assert.equal(d.getState().channels[0].active, true, "programmed PWM survives disconnected control bus");
  d.setConnection(i2c);
  write(d, 0, [0x30]);
  assert.equal(d.getState().channels[0].active, false);
});

test("PCA9685 initial controls and live channel properties drive every available channel", () => {
  const d = device("pca9685", { frequencyHz: 50, channel0: 307, channel15: 2048 });
  assert.equal(d.getState().channels[15].dutyCycle, 0.5);
  assert.ok(Math.abs(d.getState().channels[0].pulseUs - 1500) < 5);
  d.setProperties({ channel14: 1024, channel15: 0, frequencyHz: 100 });
  assert.equal(d.getState().channels[14].dutyCycle, 0.25);
  assert.equal(d.getState().channels[15].active, false);
  assert.ok(Math.abs(d.getState().frequencyHz - 100) < 1);
});

test("W25Qxx returns JEDEC ID only while selected and latches writes on CS rising", () => {
  const d = device("w25qxx", { capacityKiB: 8192 });
  assert.equal(d.transmit({ bytes: [0x9f] }).accepted, false);
  cs(d, true); d.transmit({ bytes: [0x9f] });
  assert.deepEqual(d.receive(3).bytes, [0xef, 0x40, 0x17]); cs(d, false);
  flashCommand(d, [0x06]);
  cs(d, true); d.transmit({ bytes: [2, 0, 1] }); d.transmit({ bytes: [0x10, 0x12, 0x34] });
  assert.equal(d.getState().storedBytes, 0);
  cs(d, false);
  assert.deepEqual(flashRead(d, 0x110, 3), [0x12, 0x34, 0xff]);
  assert.equal(d.getState().writeEnabled, false);
});

test("W25Qxx programs NOR bits, wraps within pages, requires WREN and retains data after power loss", () => {
  const d = device("w25qxx", { capacityKiB: 512 });
  flashCommand(d, [2, 0, 0, 0xff, 0x12]);
  assert.deepEqual(flashRead(d, 255, 1), [255]);
  flashCommand(d, [6]); flashCommand(d, [2, 0, 0, 0xff, 0xf0, 0x55]);
  assert.deepEqual(flashRead(d, 255, 1), [0xf0]);
  assert.deepEqual(flashRead(d, 0, 1), [0x55]);
  flashCommand(d, [6]); flashCommand(d, [2, 0, 0, 0xff, 0x0f]);
  assert.deepEqual(flashRead(d, 255, 1), [0]);
  d.setConnection({ ...spi, powered: false }); d.setConnection(spi);
  assert.deepEqual(flashRead(d, 0, 1), [0x55]);
  flashCommand(d, [6]); flashCommand(d, [0x20, 0, 0, 0]);
  assert.deepEqual(flashRead(d, 0, 1), [255]);
  assert.deepEqual(flashRead(d, 255, 1), [255]);
});

test("W25Qxx full duplex accounts for command/header clocks without consuming receive data twice", () => {
  const d = device("w25qxx");
  cs(d, true);
  d.transmit({ bytes: [0x9f, 255, 255, 255] });
  assert.deepEqual(d.receive({ length: 4, clockedByTransmit: true }).bytes, [255, 0xef, 0x40, 0x17]);
  cs(d, false);
  flashCommand(d, [6]); flashCommand(d, [2, 0, 0, 0x10, 0x12, 0x34, 0x56]);
  cs(d, true);
  d.transmit({ bytes: [3, 0, 0, 0x10, 255, 255] });
  assert.deepEqual(d.receive({ length: 6, clockedByTransmit: true }).bytes, [255, 255, 255, 255, 0x12, 0x34]);
  assert.deepEqual(d.receive({ length: 1 }).bytes, [0x56]);
  cs(d, false);
});

test("W25Qxx aborted or disconnected program never commits and WRDI clears status", () => {
  const d = device("w25qxx");
  flashCommand(d, [6]);
  cs(d, true); d.transmit({ bytes: [5] });
  assert.deepEqual(d.receive({ length: 1 }).bytes, [2]); cs(d, false);
  flashCommand(d, [4]);
  assert.equal(d.getState().writeEnabled, false);
  flashCommand(d, [6]); cs(d, true); d.transmit({ bytes: [2, 0, 0, 0, 0] });
  d.setConnection({ ...spi, dioConnected: false, selected: false });
  d.setConnection(spi);
  assert.deepEqual(flashRead(d, 0, 1), [255]);
});

test("W25Qxx bounds page buffers and releases sparse storage on erase or capacity reduction", () => {
  const d = device("w25qxx", { capacityKiB: 1024 });
  flashCommand(d, [6]);
  flashCommand(d, [2, 0, 0, 0].concat(Array(256).fill(0xf0), Array(44).fill(0x0f)));
  assert.deepEqual(flashRead(d, 0, 2), [0x0f, 0x0f]);
  assert.deepEqual(flashRead(d, 44, 1), [0xf0]);
  assert.equal(d.getState().storedBytes, 256);
  flashCommand(d, [6]); flashCommand(d, [2, 0x0c, 0, 0, 0x12]);
  assert.equal(d.getState().storedBytes, 257);
  d.setProperties({ capacityKiB: 512 });
  assert.equal(d.getState().storedBytes, 256);
  flashCommand(d, [6]); flashCommand(d, [0xc7]);
  assert.equal(d.getState().storedBytes, 0);
});
