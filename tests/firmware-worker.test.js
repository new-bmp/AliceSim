"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadWorker() {
  const root = path.resolve(__dirname, "..");
  const messages = [];
  const context = vm.createContext({
    console,
    postMessage(message) { messages.push(message); }
  });
  context.self = context;
  context.importScripts = function (source) {
    const filename = path.join(root, String(source).split("?")[0]);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  };
  vm.runInContext(fs.readFileSync(path.join(root, "firmware-worker.js"), "utf8"), context, {
    filename: path.join(root, "firmware-worker.js")
  });

  let requestId = 0;
  function send(command) {
    const id = ++requestId;
    context.self.onmessage({ data: Object.assign({ id }, command) });
    const response = messages.find((message) => message.type === "result" && message.id === id);
    assert.ok(response, `Worker request ${id} did not return a result`);
    assert.equal(response.error, "");
    return response.value;
  }

  return { messages, send };
}

test("Worker recomputes PCF MCU lows and their release inside the same batch", () => {
  const worker = loadWorker();
  const model = { variables: { low: [0], high: [0], lowStatus: -1, highStatus: -1 },
    i2cs: { hi2c1: { instance: "I2C1", handle: "hi2c1" } }, program: { operations: [
      { op: "i2cMasterReceive", instance: "I2C1", deviceAddress: 0x40, buffer: "low", length: 1, resultTarget: "lowStatus" },
      { op: "gpioWrite", pin: "PA0", value: 1 },
      { op: "i2cMasterReceive", instance: "I2C1", deviceAddress: 0x40, buffer: "high", length: 1, resultTarget: "highStatus" }
    ] } };
  worker.send({ command: "init", model }); worker.send({ command: "call", method: "start" });
  const state = worker.send({ command: "step", deltaMs: 0, inputs: { gpio: { PA0: 0 }, adc: {}, spi: [], peripherals: [], i2c: [
    { componentId: "port", type: "pcf8574", instance: "I2C1", address: 0x20, ready: true, properties: { inputMask: 255 },
      connection: { ...busConnection, externalInputMask: 255 }, portPins: ["PA0", "", "", "", "", "", "", ""], portMcuLevels: { PA0: 0 } }
  ] } });
  assert.equal(state.variables.lowStatus, 0);
  assert.equal(state.variables.highStatus, 0);
  assert.deepEqual(Array.from(state.variables.low), [0xfe]);
  assert.deepEqual(Array.from(state.variables.high), [0xff]);
});

test("Worker shares Flash SPI with a write-only WS2812 without inventing MISO contention", () => {
  const worker = loadWorker();
  const model = { variables: { command: [0x9f], id: [0, 0, 0], txStatus: -1, rxStatus: -1 },
    spis: { hspi1: { instance: "SPI1", handle: "hspi1" } }, program: { operations: [
      { op: "gpioWrite", pin: "PB0", value: 0 },
      { op: "spiTransmit", instance: "SPI1", buffer: "command", length: 1, resultTarget: "txStatus" },
      { op: "spiReceive", instance: "SPI1", buffer: "id", length: 3, resultTarget: "rxStatus" },
      { op: "gpioWrite", pin: "PB0", value: 1 }
    ] } };
  worker.send({ command: "init", model }); worker.send({ command: "call", method: "start" });
  const state = worker.send({ command: "step", deltaMs: 0, inputs: { gpio: {}, adc: {}, i2c: [], peripherals: [], spi: [
    { componentId: "flash", type: "w25qxx", instance: "SPI1", ready: true, selected: false, csPin: "PB0", properties: {},
      connection: { ...busConnection, dataConnected: true, signalConnected: true, selected: false } },
    { componentId: "strip", type: "ws2812", instance: "SPI1", ready: true, selected: true, noChipSelect: true, csPin: "" }
  ] } });
  assert.equal(state.variables.txStatus, 0);
  assert.equal(state.variables.rxStatus, 0);
  assert.deepEqual(Array.from(state.variables.id), [0xef, 0x40, 0x17]);
});

const busConnection = {powered: true, vccConnected: true, gndConnected: true, vccLevel: 3.3, gndLevel: 0,
  bindingValid: true, busConnected: true, clkConnected: true, dioConnected: true};

test("Worker keeps I2C registers between batches, binds HAL shifted low addresses, and rejects collisions", () => {
  const worker = loadWorker();
  const model = {variables: {config: [0x18], range: [0], readStatus: -1, luxCommand: [0x10], lux: [0, 0], luxStatus: -1},
    i2cs: {hi2c1: {handle: "hi2c1", instance: "I2C1"}}, program: {operations: [
      {op: "i2cMemWrite", instance: "I2C1", deviceAddress: 0xd0, memoryAddress: 0x1b, buffer: "config", length: 1},
      {op: "delay", ms: 10},
      {op: "i2cMemRead", instance: "I2C1", deviceAddress: 0xd0, memoryAddress: 0x1b, buffer: "range", length: 1, resultTarget: "readStatus"},
      {op: "i2cTransmit", instance: "I2C1", deviceAddress: 0x46, buffer: "luxCommand", length: 1},
      {op: "delay", ms: 180},
      {op: "i2cMasterReceive", instance: "I2C1", deviceAddress: 0x46, buffer: "lux", length: 2, resultTarget: "luxStatus"}
    ]}};
  const inputs = {gpio: {}, adc: {}, peripherals: [], spi: [], i2c: [
    {componentId: "imu", type: "mpu6050", instance: "I2C1", address: 0x68, ready: true, properties: {}, connection: busConnection},
    {componentId: "lux", type: "bh1750", instance: "I2C1", address: 0x23, ready: true, properties: {lux: 500}, connection: busConnection}
  ]};
  worker.send({command: "init", model}); worker.send({command: "call", method: "start"});
  worker.send({command: "step", deltaMs: 0, inputs});
  worker.send({command: "step", deltaMs: 10, inputs});
  const state = worker.send({command: "step", deltaMs: 180, inputs});
  assert.equal(state.variables.readStatus, 0);
  assert.deepEqual(Array.from(state.variables.range), [0x18]);
  assert.equal(state.variables.luxStatus, 0);
  assert.deepEqual(Array.from(state.variables.lux), [2, 88]);
  worker.send({command: "init", model}); worker.send({command: "call", method: "start"});
  const collision = {...inputs, i2c: [...inputs.i2c, {...inputs.i2c[1], componentId: "lux2"}]};
  worker.send({command: "step", deltaMs: 0, inputs: collision});
  worker.send({command: "step", deltaMs: 10, inputs: collision});
  assert.equal(worker.send({command: "step", deltaMs: 180, inputs: collision}).variables.luxStatus, 1);
});

test("Worker latches W25Q writes on GPIO chip-select and reads them in the same batch", () => {
  const worker = loadWorker();
  const model = {variables: {wren: [6], program: [2, 0, 0, 16, 0xa5, 0x5a], command: [3, 0, 0, 16], result: [0, 0], status: -1},
    outputs: {PB0: {physicalPin: "PB0", initial: 1}}, spis: {hspi1: {instance: "SPI1", handle: "hspi1"}}, program: {operations: [
      {op: "gpioWrite", pin: "PB0", value: 0}, {op: "spiTransmit", instance: "SPI1", buffer: "wren", length: 1}, {op: "gpioWrite", pin: "PB0", value: 1},
      {op: "gpioWrite", pin: "PB0", value: 0}, {op: "spiTransmit", instance: "SPI1", buffer: "program", length: 6}, {op: "gpioWrite", pin: "PB0", value: 1},
      {op: "gpioWrite", pin: "PB0", value: 0}, {op: "spiTransmit", instance: "SPI1", buffer: "command", length: 4},
      {op: "spiReceive", instance: "SPI1", buffer: "result", length: 2, resultTarget: "status"}, {op: "gpioWrite", pin: "PB0", value: 1}
    ]}};
  worker.send({command: "init", model}); worker.send({command: "call", method: "start"});
  const state = worker.send({command: "step", deltaMs: 0, inputs: {gpio: {}, adc: {}, i2c: [], peripherals: [], spi: [
    {componentId: "flash", type: "w25qxx", instance: "SPI1", ready: true, selected: false, csPin: "PB0", properties: {}, connection: {...busConnection, dataConnected: true, signalConnected: true, selected: false}}
  ]}});
  assert.equal(state.variables.status, 0);
  assert.deepEqual(Array.from(state.variables.result), [0xa5, 0x5a]);
});

test("firmware Worker uses synchronized I2C and SPI wiring state for HAL results", () => {
  const worker = loadWorker();
  const model = {
    variables: {
      bytes: [0x11],
      i2cWrong: -1,
      i2cOk: -1,
      i2cRead: [0, 0],
      i2cReadStatus: -1,
      spiDeselected: -1,
      spiSelected: -1,
      spiRead: [0, 0],
      spiReadStatus: -1
    },
    i2cs: { hi2c1: { handle: "hi2c1", instance: "I2C1" } },
    spis: { hspi1: { handle: "hspi1", instance: "SPI1" } },
    outputs: { PB0: { physicalPin: "PB0", initial: 1 }, PB1: { physicalPin: "PB1", initial: 0 } },
    program: {
      operations: [
        { op: "i2cTransmit", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x7a, buffer: "bytes", length: 1, resultTarget: "i2cWrong" },
        { op: "i2cTransmit", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, buffer: "bytes", length: 1, resultTarget: "i2cOk" },
        { op: "i2cMasterReceive", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, buffer: "i2cRead", length: 2, resultTarget: "i2cReadStatus" },
        { op: "spiTransmit", spi: "hspi1", instance: "SPI1", buffer: "bytes", length: 1, resultTarget: "spiDeselected" },
        { op: "gpioWrite", pin: "PB0", value: 0 },
        { op: "gpioWrite", pin: "PB1", value: 1 },
        { op: "spiTransmit", spi: "hspi1", instance: "SPI1", buffer: "bytes", length: 1, resultTarget: "spiSelected" },
        { op: "spiReceive", spi: "hspi1", instance: "SPI1", buffer: "spiRead", length: 2, resultTarget: "spiReadStatus" }
      ]
    }
  };

  worker.send({ command: "init", model });
  worker.send({ command: "call", method: "start", args: [] });
  const state = worker.send({
    command: "step",
    deltaMs: 0,
    inputs: {
      gpio: {},
      adc: {},
      i2c: [{ componentId: "sensor", instance: "I2C1", handle: "hi2c1", address: 0x3c, readBytes: [0x60, 0x01], ready: true }],
      spi: [{ componentId: "flash", instance: "SPI1", handle: "hspi1", csPin: "PB0", dcPin: "PB1", selected: false, dataMode: false, readBytes: [0xef, 0x17], ready: true }],
      peripherals: []
    }
  });

  assert.equal(state.status, "completed", JSON.stringify({ status: state.status, error: state.error, pc: state.pc, operationsExecuted: state.operationsExecuted, events: worker.messages.filter((message) => message.type === "event").map((message) => message.kind) }));
  assert.equal(state.variables.i2cWrong, 1);
  assert.equal(state.variables.i2cOk, 0);
  assert.equal(state.variables.i2cReadStatus, 0);
  assert.deepEqual(Array.from(state.variables.i2cRead), [0x60, 0x01]);
  assert.equal(state.variables.spiDeselected, 1);
  assert.equal(state.variables.spiSelected, 0);
  assert.equal(state.variables.spiReadStatus, 0);
  assert.deepEqual(Array.from(state.variables.spiRead), [0xef, 0x17]);
  assert.deepEqual(Array.from(state.i2cTx, (event) => event.accepted), [false, true]);
  assert.deepEqual(Array.from(state.spiTx, (event) => event.accepted), [false, true]);
  assert.deepEqual(Array.from(state.i2cRx, (event) => event.bytes), [[0x60, 0x01]]);
  assert.deepEqual(Array.from(state.spiRx, (event) => event.bytes), [[0xef, 0x17]]);

  const events = worker.messages.filter((message) => message.type === "event");
  const selectedTransfer = events.findIndex((message, index) =>
    message.kind === "spi-tx" && events.slice(0, index).filter((item) => item.kind === "spi-tx").length === 1
  );
  const chipSelectLow = events.findIndex((message) => message.kind === "gpio" && message.detail.pin === "PB0" && message.detail.value === 0);
  assert.ok(chipSelectLow >= 0 && selectedTransfer > chipSelectLow);
  assert.ok(events.some((message) => message.kind === "i2c-rx"));
  assert.ok(events.some((message) => message.kind === "spi-rx"));
});

test("firmware Worker returns synchronized ADC and high-level sensor values", () => {
  const worker = loadWorker();
  const model = {
    variables: {
      adcValue: 0,
      dht: {},
      dhtStatus: -1,
      distanceMm: 0,
      distanceStatus: -1
    },
    adcs: {
      hadc1: {
        handle: "hadc1",
        instance: "ADC1",
        channels: [{ channel: "ADC_CHANNEL_0", pin: "PA0", rank: 1 }]
      }
    },
    program: {
      operations: [
        { op: "adcStart", adc: "hadc1", instance: "ADC1" },
        { op: "adcPollForConversion", adc: "hadc1", instance: "ADC1", timeout: 10 },
        { op: "adcGetValue", adc: "hadc1", instance: "ADC1", target: "adcValue" },
        { op: "aliceDht11Init", context: "climate", dataPin: "PA2" },
        { op: "aliceDht11Read", context: "climate", target: "dht", resultTarget: "dhtStatus" },
        { op: "aliceHcsr04Init", context: "range", triggerPin: "PB0", echoPin: "PB1", timeout: 30000 },
        { op: "aliceHcsr04Measure", context: "range", target: "distanceMm", resultTarget: "distanceStatus" }
      ]
    }
  };

  worker.send({ command: "init", model });
  worker.send({ command: "call", method: "start", args: [] });
  const state = worker.send({
    command: "step",
    deltaMs: 0,
    inputs: {
      gpio: {},
      adc: {
        "ADC1|ADC_CHANNEL_0|PA0": { value: 2482, raw: 2482, voltage: 2.0, pin: "PA0", connected: true },
        "ADC1||": { value: 2482, raw: 2482, voltage: 2.0, pin: "PA0", connected: true }
      },
      i2c: [],
      spi: [],
      peripherals: [
        {
          componentId: "dht",
          type: "dht11",
          ready: true,
          connection: { dataPin: "PA2" },
          state: { temperatureC: 23.4, humidityPercent: 56.7 }
        },
        {
          componentId: "range",
          type: "hcsr04",
          ready: true,
          connection: { triggerPin: "PB0", echoPin: "PB1" },
          state: { distanceCm: 32.1, distanceMm: 321, echoPulseUs: 1872 }
        }
      ]
    }
  });

  assert.equal(state.status, "completed", JSON.stringify({ status: state.status, error: state.error, pc: state.pc, operationsExecuted: state.operationsExecuted, events: worker.messages.filter((message) => message.type === "event").map((message) => message.kind) }));
  assert.equal(state.variables.adcValue, 2482);
  assert.equal(state.adc.ADC1.voltage, 2.0);
  assert.equal(state.variables.dhtStatus, 0);
  assert.equal(state.variables.dht.temperature_x10, 234);
  assert.equal(state.variables.dht.humidity_x10, 567);
  assert.equal(state.variables.distanceStatus, 0);
  assert.equal(state.variables.distanceMm, 321);
});

test("firmware Worker forwards stdio output from printf", () => {
  const worker = loadWorker();
  const model = {
    variables: { value: 42 },
    program: {
      operations: [{
        op: "stdioWrite",
        function: "printf",
        stream: "stdout",
        format: { kind: "string", value: "value=%d\n" },
        arguments: [{ kind: "variable", name: "value" }]
      }]
    }
  };

  worker.send({ command: "init", model });
  worker.send({ command: "call", method: "start", args: [] });
  const state = worker.send({ command: "step", deltaMs: 0, inputs: { gpio: {}, adc: {}, i2c: [], spi: [], peripherals: [] } });
  const event = worker.messages.find(message => message.type === "event" && message.kind === "stdio");

  assert.equal(state.status, "completed");
  assert.equal(event.detail.stream, "stdout");
  assert.equal(event.detail.text, "value=42\n");
});

test("firmware Worker transmits to a no-CS LED strip while rejecting the wrong SPI bus", () => {
  const worker = loadWorker();
  const model = { variables: { bytes: [0x92], ok: -1, wrong: -1 },
    spis: { hspi1: { handle: "hspi1", instance: "SPI1" }, hspi2: { handle: "hspi2", instance: "SPI2" } },
    program: { operations: [
      { op: "spiTransmit", spi: "hspi1", instance: "SPI1", buffer: "bytes", length: 1, resultTarget: "ok" },
      { op: "spiTransmit", spi: "hspi2", instance: "SPI2", buffer: "bytes", length: 1, resultTarget: "wrong" }
    ] } };
  worker.send({ command: "init", model });
  worker.send({ command: "call", method: "start", args: [] });
  const state = worker.send({ command: "step", deltaMs: 0, inputs: { gpio: {}, adc: {}, i2c: [], peripherals: [], spi: [{ instance: "SPI1", noChipSelect: true, ready: true, selected: false }] } });
  assert.equal(state.status, "completed");
  assert.equal(state.variables.ok, 0);
  assert.equal(state.variables.wrong, 1);
});
