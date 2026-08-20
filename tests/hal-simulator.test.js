"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const AliceFirmwareRuntime = require("../firmware-runtime.js");

function screenshotModel() {
  const arrayIndex = (name, index) => ({ kind: "arrayIndex", name, index });
  const character = value => ({ kind: "char", value, code: value.charCodeAt(0) });
  const equals = (left, right) => ({ op: "eq", left, right });
  const source = { file: "Core/Src/main.c", line: 1, column: 1 };
  return {
    schemaVersion: 1,
    mcu: "STM32F103C8T6",
    pins: {
      PA2: { physicalPin: "PA2", iocSignal: "USART2_TX", configured: true },
      PA3: { physicalPin: "PA3", iocSignal: "USART2_RX", configured: true },
      PB10: { physicalPin: "PB10", iocSignal: "USART3_TX", configured: true },
      PB11: { physicalPin: "PB11", iocSignal: "USART3_RX", configured: true },
      PA6: { physicalPin: "PA6", iocSignal: "GPIO_Output", label: "RED", configured: true },
      PA7: { physicalPin: "PA7", iocSignal: "GPIO_Output", label: "GREEN", configured: true },
      PB0: { physicalPin: "PB0", iocSignal: "GPIO_Output", label: "BLUE", configured: true }
    },
    outputs: {
      PA6: { physicalPin: "PA6", aliases: ["RED"], writeOperationIds: [6] },
      PA7: { physicalPin: "PA7", aliases: ["GREEN"], writeOperationIds: [8] },
      PB0: { physicalPin: "PB0", aliases: ["BLUE"], writeOperationIds: [10] }
    },
    uarts: {
      huart2: {
        handle: "huart2",
        instance: "USART2",
        baudRate: 115200,
        txPin: "PA2",
        rxPin: "PA3",
        frame: { dataBits: 8, stopBits: 1, parity: "none" },
        receiveCalls: [{ operationId: 2, buffer: "rx_data", length: 2, timeout: "HAL_MAX_DELAY", blocking: true }],
        transmitCalls: [{ operationId: 11, buffer: "rx_data", length: 2, timeout: "HAL_MAX_DELAY", blocking: true }]
      },
      huart3: {
        handle: "huart3",
        instance: "USART3",
        baudRate: 115200,
        txPin: "PB10",
        rxPin: "PB11",
        frame: { dataBits: 8, stopBits: 1, parity: "none" },
        receiveCalls: [],
        transmitCalls: []
      }
    },
    diagnostics: [],
    program: {
      entry: "main",
      operations: [
        {
          op: "while",
          condition: { kind: "literal", value: 1 },
          body: [
            { op: "uartReceive", uart: "huart2", instance: "USART2", buffer: "rx_data", length: 2, timeout: "HAL_MAX_DELAY", blocking: true, source },
            { op: "assign", target: "state", value: { kind: "constant", name: "GPIO_PIN_SET", value: 1 }, source },
            {
              op: "if",
              condition: equals(arrayIndex("rx_data", 1), character("0")),
              then: [{ op: "assign", target: "state", value: { kind: "constant", name: "GPIO_PIN_RESET", value: 0 }, source }],
              else: [],
              source
            },
            {
              op: "if",
              condition: equals(arrayIndex("rx_data", 0), character("R")),
              then: [{ op: "gpioWrite", pin: "PA6", value: { kind: "variable", name: "state" }, source }],
              else: [
                {
                  op: "if",
                  condition: equals(arrayIndex("rx_data", 0), character("G")),
                  then: [{ op: "gpioWrite", pin: "PA7", value: { kind: "variable", name: "state" }, source }],
                  else: [
                    {
                      op: "if",
                      condition: equals(arrayIndex("rx_data", 0), character("B")),
                      then: [{ op: "gpioWrite", pin: "PB0", value: { kind: "variable", name: "state" }, source }],
                      else: [],
                      source
                    }
                  ],
                  source
                }
              ],
              source
            },
            // `source` is source-location metadata in the backend model. The
            // runtime must transmit `buffer`, never serialize this object.
            { op: "uartTransmit", uart: "huart2", instance: "USART2", buffer: "rx_data", length: 2, timeout: "HAL_MAX_DELAY", blocking: true, source }
          ],
          source
        }
      ]
    }
  };
}

test("sim-model, firmware runtime, UART and schematic use the imported USART2/RGB bindings", async () => {
  const previous = {
    window: global.window,
    document: global.document,
    CustomEvent: global.CustomEvent,
    fetch: global.fetch
  };
  const dispatched = [];
  const drives = [];
  const requests = [];
  const model = screenshotModel();
  const editor = { value: "/* current buffer */", dataset: { aliceProjectPath: "Core/Src/main.c" } };

  global.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  global.document = {
    getElementById(id) { return id === "codeEditor" ? editor : null; },
    dispatchEvent(event) { dispatched.push(event); return true; }
  };
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, async json() { return model; } };
  };
  global.window = {
    AliceFirmwareRuntime,
    AliceProjectWorkspace: {
      getState() { return { activePath: "Core/Src/main.c" }; },
      createClangPayload(options) {
        return {
          files: {
            "Core/Src/main.c": options.activeCode,
            "Core/Inc/main.h": "#define RED_Pin GPIO_PIN_6",
            "Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c": "void HAL_Init(void) {}",
            "Drivers/CMSIS/Include/core_cm3.h": "#define __CORTEX_M 3",
            "Drivers/MySensor/Src/my_sensor.c": "void MySensor_Read(void) {}",
            "UART_RGB.alice-sch.json": "{}",
            "UART_RGB.ioc": "PA2.Signal=USART2_TX\nPA3.Signal=USART2_RX"
          },
          activePath: options.activePath,
          targets: ["Core/Src/main.c", "Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c", "Drivers/MySensor/Src/my_sensor.c"],
          includeDirs: ["Core/Inc"],
          defines: ["USE_HAL_DRIVER", "STM32F103xB"],
          all: options.all
        };
      }
    },
    AliceSchematic: {
      applyProjectModel(received) {
        assert.equal(received, model);
        return { valid: true, outputs: Object.keys(received.outputs) };
      },
      driveMcuPin(pin, value, metadata) {
        drives.push({ pin, value, metadata });
        return value;
      },
      reset() { return true; }
    }
  };

  const modulePath = path.resolve(__dirname, "../hal-simulator.js");
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const simulator = global.window.AliceHalSimulator;
    const build = await simulator.build();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/sim-model");
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.files["Core/Src/main.c"], editor.value);
    assert.equal(payload.files["Drivers/MySensor/Src/my_sensor.c"], "void MySensor_Read(void) {}");
    assert.equal(payload.files["Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c"], undefined);
    assert.equal(payload.files["Drivers/CMSIS/Include/core_cm3.h"], undefined);
    assert.equal(payload.files["UART_RGB.alice-sch.json"], undefined);
    assert.deepEqual(payload.targets, ["Core/Src/main.c", "Drivers/MySensor/Src/my_sensor.c"]);
    assert.equal(payload.all, true);
    assert.equal(requests[0].options.cache, "no-store");
    assert.deepEqual(build.outputs.map(output => output.physicalPin), ["PA6", "PA7", "PB0"]);
    assert.equal(build.uarts[0].instance, "USART2");
    assert.ok(drives.some(event => event.pin === "PA2" && event.value === 1), "USART2 TX should be bound to PA2 idle-high");

    const summary = simulator.getSummary();
    assert.deepEqual(summary.tracePins, ["PA6"]);
    assert.deepEqual(summary.traceChannels.slice(0, 5).map(channel => channel.pin), ["PA6", "PA7", "PB0", "PA2", "PA3"]);
    assert.deepEqual(summary.traceChannels.slice(0, 5).map(channel => channel.source), ["GPIO", "GPIO", "GPIO", "UART", "UART"]);
    assert.deepEqual(simulator.setTracePins(["PA6", "PB0", "PA7", "PA2", "PA3"]), ["PA6", "PB0", "PA7", "PA2"]);

    simulator.start();
    simulator.enqueueSerial("R", "USART2");
    let state = simulator.step(0);
    assert.equal(state.status, "blocked");
    assert.equal(dispatched.filter(event => event.type === "alice:firmware-uart-tx").length, 0);
    assert.equal(drives.filter(event => event.pin === "PA6").length, 0);

    simulator.enqueueSerial("1", "huart2");
    state = simulator.step(0);
    assert.equal(state.status, "blocked");
    assert.equal(state.gpio.PA6, 1);
    assert.ok(drives.some(event => event.pin === "PA6" && event.value === 1));

    const txEvents = dispatched.filter(event => event.type === "alice:firmware-uart-tx");
    assert.equal(txEvents.length, 1);
    assert.equal(txEvents[0].detail.instance, "USART2");
    assert.equal(txEvents[0].detail.txPin, "PA2");
    assert.equal(txEvents[0].detail.rxPin, "PA3");
    assert.equal(txEvents[0].detail.text, "R1");
    assert.doesNotMatch(txEvents[0].detail.text, /ACK/i);

    simulator.enqueueSerialBytes(new Uint8Array([0x00, 0xff]), "USART2");
    const rxEvents = dispatched.filter(event => event.type === "alice:firmware-uart-rx");
    assert.equal(rxEvents.length, 3);
    assert.equal(rxEvents[0].detail.instance, "USART2");
    assert.equal(rxEvents[0].detail.rxPin, "PA3");
    assert.deepEqual(rxEvents[2].detail.bytes, [0x00, 0xff]);

    const trace = simulator.getTrace();
    assert.equal(trace.pin, "PA6");
    assert.ok(trace.samples.some(sample => sample.value === true));
    assert.deepEqual(trace.pins, ["PA6", "PB0", "PA7", "PA2"]);
    assert.equal(trace.channels.length, 4);
    assert.deepEqual(trace.channels.find(channel => channel.pin === "PA6").samples, trace.samples);
    simulator.enqueueSerial("queued for later firmware use", "USART3");
    const allRxEvents = dispatched.filter(event => event.type === "alice:firmware-uart-rx");
    assert.equal(allRxEvents.at(-1).detail.instance, "USART3");
    assert.equal(simulator.getSummary().uartCount, 2);
  } finally {
    delete require.cache[modulePath];
    global.window = previous.window;
    global.document = previous.document;
    global.CustomEvent = previous.CustomEvent;
    global.fetch = previous.fetch;
  }
});

test("sim-model build retries one transient backend fetch failure", async () => {
  const previous = {
    window: global.window,
    document: global.document,
    CustomEvent: global.CustomEvent,
    fetch: global.fetch
  };
  const model = screenshotModel();
  let attempts = 0;
  global.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  global.document = {
    getElementById() { return { value: "int main(void) { return 0; }", dataset: { aliceProjectPath: "main.c" } }; },
    dispatchEvent() { return true; }
  };
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, async json() { return model; } };
  };
  global.window = {
    location: { origin: "http://127.0.0.1:4173" },
    AliceFirmwareRuntime,
    AliceSchematic: {
      applyProjectModel() { return { valid: true }; },
      driveMcuPin() { return true; },
      reset() { return true; }
    }
  };

  const modulePath = path.resolve(__dirname, "../hal-simulator.js");
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const result = await global.window.AliceHalSimulator.build({
      files: { "main.c": "int main(void) { return 0; }" },
      activePath: "main.c",
      targets: ["main.c"],
      filename: "main.c",
      code: "int main(void) { return 0; }"
    });
    assert.equal(attempts, 2);
    assert.equal(result.model, model);
  } finally {
    delete require.cache[modulePath];
    global.window = previous.window;
    global.document = previous.document;
    global.CustomEvent = previous.CustomEvent;
    global.fetch = previous.fetch;
  }
});

test("HAL I2C and ADC operations are routed through the wired schematic hooks", async () => {
  const previous = {
    window: global.window,
    document: global.document,
    CustomEvent: global.CustomEvent,
    fetch: global.fetch
  };
  const dispatched = [];
  const i2cTransactions = [];
  const adcSamples = [];
  const model = {
    schemaVersion: 1,
    mcu: "STM32F103C8T6",
    pins: {
      PB6: { physicalPin: "PB6", iocSignal: "I2C1_SCL", configured: true },
      PB7: { physicalPin: "PB7", iocSignal: "I2C1_SDA", configured: true },
      PA0: { physicalPin: "PA0", iocSignal: "ADC2_IN0", configured: true },
      PB0: { physicalPin: "PB0", iocSignal: "ADC2_IN8", configured: true }
    },
    outputs: {},
    uarts: {},
    i2cs: {
      hi2c1: { handle: "hi2c1", instance: "I2C1", sclPin: "PB6", sdaPin: "PB7", clockSpeed: 100000, addressBits: 7 }
    },
    adcs: {
      hadc2: {
        handle: "hadc2",
        instance: "ADC2",
        channels: [
          { channel: "ADC_CHANNEL_0", channelNumber: 0, pin: "PA0", rank: null },
          { channel: "ADC_CHANNEL_8", channelNumber: 8, pin: "PB0", rank: 1, slot: 1 }
        ]
      }
    },
    variables: { oledCommand: [0xaf], sample: 0 },
    diagnostics: [],
    program: {
      operations: [
        { op: "i2cMemWrite", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, memoryAddress: 0, memoryAddressSize: 1, buffer: "oledCommand", length: 1 },
        { op: "adcStart", adc: "hadc2", instance: "ADC2" },
        { op: "adcPollForConversion", adc: "hadc2", instance: "ADC2", timeout: 10 },
        { op: "adcGetValue", adc: "hadc2", instance: "ADC2", target: { kind: "variable", name: "sample" } }
      ]
    }
  };

  global.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  global.document = {
    getElementById() { return { value: "", dataset: {} }; },
    dispatchEvent(event) { dispatched.push(event); return true; }
  };
  global.fetch = async () => ({ ok: true, async json() { return model; } });
  global.window = {
    AliceFirmwareRuntime,
    AliceSchematic: {
      applyProjectModel() { return { valid: true }; },
      handleI2cTransmission(event) {
        i2cTransactions.push(event);
        return { accepted: true, targetCount: 1, targets: [{ ref: "OLED1" }] };
      },
      sampleAdc(instance, options) {
        adcSamples.push({ instance, options });
        return { value: 1234, raw: 1234, voltage: 0.994, pin: options.pin, connected: true };
      },
      reset() { return true; }
    }
  };

  const modulePath = path.resolve(__dirname, "../hal-simulator.js");
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const simulator = global.window.AliceHalSimulator;
    const build = await simulator.build();
    assert.equal(build.i2cs[0].instance, "I2C1");
    assert.equal(build.adcs[0].instance, "ADC2");

    simulator.start();
    const state = simulator.step(0);
    assert.equal(state.status, "completed");
    assert.equal(state.variables.sample, 1234);
    assert.equal(i2cTransactions.length, 1);
    assert.equal(i2cTransactions[0].sclPin, "PB6");
    assert.equal(i2cTransactions[0].sdaPin, "PB7");
    assert.equal(i2cTransactions[0].memoryAddress, 0);
    assert.equal(adcSamples.length, 1);
    assert.equal(adcSamples[0].instance, "ADC2");
    assert.equal(adcSamples[0].options.pin, "PB0");
    assert.equal(adcSamples[0].options.channel, "ADC_CHANNEL_8");
    assert.equal(simulator.getSummary().i2cCount, 1);
    assert.equal(simulator.getSummary().adcCount, 1);
    assert.equal(dispatched.filter(event => event.type === "alice:firmware-i2c-tx").length, 1);
    assert.equal(dispatched.filter(event => event.type === "alice:firmware-adc-read").length, 1);
  } finally {
    delete require.cache[modulePath];
    global.window = previous.window;
    global.document = previous.document;
    global.CustomEvent = previous.CustomEvent;
    global.fetch = previous.fetch;
  }
});
