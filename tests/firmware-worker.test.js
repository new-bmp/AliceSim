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

test("firmware Worker uses synchronized I2C and SPI wiring state for HAL results", () => {
  const worker = loadWorker();
  const model = {
    variables: {
      bytes: [0x11],
      i2cWrong: -1,
      i2cOk: -1,
      spiDeselected: -1,
      spiSelected: -1
    },
    i2cs: { hi2c1: { handle: "hi2c1", instance: "I2C1" } },
    spis: { hspi1: { handle: "hspi1", instance: "SPI1" } },
    outputs: { PB0: { physicalPin: "PB0", initial: 1 }, PB1: { physicalPin: "PB1", initial: 0 } },
    program: {
      operations: [
        { op: "i2cTransmit", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x7a, buffer: "bytes", length: 1, resultTarget: "i2cWrong" },
        { op: "i2cTransmit", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, buffer: "bytes", length: 1, resultTarget: "i2cOk" },
        { op: "spiTransmit", spi: "hspi1", instance: "SPI1", buffer: "bytes", length: 1, resultTarget: "spiDeselected" },
        { op: "gpioWrite", pin: "PB0", value: 0 },
        { op: "gpioWrite", pin: "PB1", value: 1 },
        { op: "spiTransmit", spi: "hspi1", instance: "SPI1", buffer: "bytes", length: 1, resultTarget: "spiSelected" }
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
      i2c: [{ componentId: "oled", instance: "I2C1", handle: "hi2c1", address: 0x3c, ready: true }],
      spi: [{ componentId: "tft", instance: "SPI1", handle: "hspi1", csPin: "PB0", dcPin: "PB1", selected: false, dataMode: false, ready: true }],
      peripherals: []
    }
  });

  assert.equal(state.status, "completed", JSON.stringify({ status: state.status, error: state.error, pc: state.pc, operationsExecuted: state.operationsExecuted, events: worker.messages.filter((message) => message.type === "event").map((message) => message.kind) }));
  assert.equal(state.variables.i2cWrong, 1);
  assert.equal(state.variables.i2cOk, 0);
  assert.equal(state.variables.spiDeselected, 1);
  assert.equal(state.variables.spiSelected, 0);
  assert.deepEqual(Array.from(state.i2cTx, (event) => event.accepted), [false, true]);
  assert.deepEqual(Array.from(state.spiTx, (event) => event.accepted), [false, true]);

  const events = worker.messages.filter((message) => message.type === "event");
  const selectedTransfer = events.findIndex((message, index) =>
    message.kind === "spi-tx" && events.slice(0, index).filter((item) => item.kind === "spi-tx").length === 1
  );
  const chipSelectLow = events.findIndex((message) => message.kind === "gpio" && message.detail.pin === "PB0" && message.detail.value === 0);
  assert.ok(chipSelectLow >= 0 && selectedTransfer > chipSelectLow);
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
