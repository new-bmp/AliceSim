"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const serialBridge = require("../serial-device-bridge.js");

function makePort() {
  const writes = [];
  const opened = [];
  let closed = false;
  const writer = {
    async write(value) { writes.push(Array.from(value)); },
    releaseLock() {}
  };
  return {
    port: {
      readable: null,
      writable: { getWriter() { return writer; } },
      getInfo() { return { usbVendorId: 0x0483, usbProductId: 0x5740 }; },
      async open(options) { opened.push({ ...options }); },
      async close() { closed = true; }
    },
    writes,
    opened,
    isClosed() { return closed; }
  };
}

test("physical serial bridge maps one selected MCU UART bidirectionally", async () => {
  const mockPort = makePort();
  const rx = [];
  const events = [];
  const bridge = serialBridge.create({
    serial: { async requestPort() { return mockPort.port; } },
    hal: { enqueueSerialBytes(bytes, instance) { rx.push({ bytes: Array.from(bytes), instance }); return { timeMs: 12 }; } },
    onEvent(name, detail) { events.push({ name, detail }); }
  });

  bridge.configure([
    { instance: "USART1", handle: "huart1", baudRate: 9600, frame: { dataBits: 8, parity: "none", stopBits: 1 } },
    { instance: "USART2", handle: "huart2", baudRate: 57600, frame: { dataBits: 7, parity: "even", stopBits: 2 } }
  ]);
  const connected = await bridge.connect("USART2");

  assert.equal(connected.connected, true);
  assert.equal(connected.targetInstance, "USART2");
  assert.deepEqual(mockPort.opened[0], {
    baudRate: 57600,
    dataBits: 7,
    stopBits: 2,
    parity: "even",
    bufferSize: 4096,
    flowControl: "none"
  });
  assert.deepEqual(connected.device, { usbVendorId: 0x0483, usbProductId: 0x5740, bluetoothServiceClassId: null });

  assert.equal(await bridge.forwardFirmwareTx({ instance: "USART1", bytes: [1] }), false);
  assert.equal(await bridge.forwardFirmwareTx({ handle: "huart2", bytes: [0x41, 0x00, 0xff] }), true);
  assert.deepEqual(mockPort.writes, [[0x41, 0x00, 0xff]]);

  bridge.receivePhysical(new Uint8Array([0x52, 0x58, 0x00]));
  assert.deepEqual(rx, [{ instance: "USART2", bytes: [0x52, 0x58, 0x00] }]);
  assert.equal(events.some(event => event.name === "alice:serial-bridge-tx"), true);
  assert.equal(events.some(event => event.name === "alice:serial-bridge-rx"), true);

  const disconnected = await bridge.disconnect();
  assert.equal(disconnected.connected, false);
  assert.equal(mockPort.isClosed(), true);
});

test("physical serial bridge reports unsupported browsers without fake connection", async () => {
  const bridge = serialBridge.create({ serial: null, hal: {} });
  bridge.configure([{ instance: "USART1", baudRate: 115200 }]);
  assert.equal(bridge.isSupported(), false);
  await assert.rejects(() => bridge.connect("USART1"), /不支持 Web Serial/);
  assert.equal(bridge.getState().connected, false);
});
