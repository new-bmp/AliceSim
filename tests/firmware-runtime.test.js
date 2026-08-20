"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AliceFirmwareRuntime = require("../firmware-runtime.js");

const literal = value => ({ type: "literal", value });
const constant = name => ({ type: "constant", name });
const variable = name => ({ type: "variable", name });
const char = value => ({ type: "char", value });
const arrayIndex = (array, index) => ({ type: "arrayIndex", array, index: literal(index) });
const eq = (left, right) => ({ type: "eq", left, right });

function screenshotModel() {
  return {
    constants: {
      HAL_MAX_DELAY: 0xffffffff,
      GPIO_PIN_RESET: 0,
      GPIO_PIN_SET: 1
    },
    variables: {
      rx_data: [0, 0],
      state: 1
    },
    uartAliases: {
      huart2: "USART2"
    },
    program: {
      operations: [
        {
          type: "while",
          condition: literal(true),
          operations: [
            {
              type: "uartReceive",
              instance: "huart2",
              buffer: "rx_data",
              length: literal(2),
              timeout: constant("HAL_MAX_DELAY"),
              source: { file: "Core/Src/main.c", line: 103, column: 5 }
            },
            { type: "assign", target: "state", value: constant("GPIO_PIN_SET") },
            {
              type: "if",
              condition: eq(arrayIndex("rx_data", 1), char("0")),
              then: [
                { type: "assign", target: "state", value: constant("GPIO_PIN_RESET") }
              ]
            },
            {
              type: "if",
              condition: eq(arrayIndex("rx_data", 0), char("R")),
              then: [
                { type: "gpioWrite", pin: "PA6", value: variable("state") }
              ],
              else: [
                {
                  type: "if",
                  condition: eq(arrayIndex("rx_data", 0), char("G")),
                  then: [
                    { type: "gpioWrite", pin: "PA7", value: variable("state") }
                  ],
                  else: [
                    {
                      type: "if",
                      condition: eq(arrayIndex("rx_data", 0), char("B")),
                      then: [
                        { type: "gpioWrite", pin: "PB0", value: variable("state") }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              type: "uartTransmit",
              instance: "huart2",
              buffer: "rx_data",
              length: literal(2),
              source: { file: "Core/Src/main.c", line: 123, column: 5 }
            }
          ]
        }
      ]
    }
  };
}

function makeRuntime(model = screenshotModel()) {
  const gpio = [];
  const uartTx = [];
  const states = [];
  const runtime = AliceFirmwareRuntime.create(model, {
    onGpio: event => gpio.push(event),
    onUartTx: event => uartTx.push(event),
    onState: state => states.push(state)
  });
  return { runtime, gpio, uartTx, states };
}

test("HAL_MAX_DELAY receive blocks until the complete frame is available", () => {
  const { runtime, gpio, uartTx } = makeRuntime();

  runtime.start();
  runtime.enqueueUart("USART2", "R");
  let state = runtime.step(0);

  assert.equal(state.status, "blocked");
  assert.deepEqual(state.blocked && {
    type: state.blocked.type,
    instance: state.blocked.instance,
    length: state.blocked.length,
    available: state.blocked.available,
    deadline: state.blocked.deadline
  }, {
    type: "uartReceive",
    instance: "USART2",
    length: 2,
    available: 1,
    deadline: null
  });
  assert.deepEqual(state.gpio, {});
  assert.equal(gpio.length, 0);
  assert.equal(uartTx.length, 0);

  runtime.enqueueUart("huart2", "1");
  state = runtime.step(0);

  assert.equal(state.status, "blocked", "the next loop iteration should wait for another frame");
  assert.equal(state.gpio.PA6, 1);
  assert.equal(gpio.length, 1);
  assert.deepEqual(gpio[0], { pin: "PA6", value: 1, previous: 0, time: 0, timeMs: 0 });
  assert.equal(uartTx.length, 1);
  assert.equal(uartTx[0].instance, "USART2");
  assert.equal(uartTx[0].text, "R1");
  assert.deepEqual(uartTx[0].bytes, [82, 49]);
});

test("RGB command branches drive only their physical pin and transmit exact input", () => {
  const cases = [
    { command: "R0", pin: "PA6", value: 0 },
    { command: "G1", pin: "PA7", value: 1 },
    { command: "B1", pin: "PB0", value: 1 },
    { command: "X1", pin: null, value: null }
  ];

  cases.forEach(({ command, pin, value }) => {
    const { runtime, gpio, uartTx } = makeRuntime();
    runtime.start();
    runtime.enqueueUart("USART2", command);
    const state = runtime.step(0);

    assert.equal(state.status, "blocked");
    assert.equal(uartTx.length, 1, command);
    assert.equal(uartTx[0].text, command);
    if (pin) {
      assert.equal(gpio.length, 1, command);
      assert.equal(gpio[0].pin, pin);
      assert.equal(gpio[0].value, value);
      assert.equal(state.gpio[pin], value);
    } else {
      assert.equal(gpio.length, 0, command);
      assert.deepEqual(state.gpio, {});
    }
  });
});

test("generic HAL timer PWM reports live frequency and duty-cycle changes", () => {
  const pwmEvents = [];
  const runtime = AliceFirmwareRuntime.create({
    timers: {
      htim2: {
        handle: "htim2",
        instance: "TIM2",
        prescaler: 71,
        period: 999,
        frequencyHz: 1000,
        channels: [{ channelNumber: 1, pin: "PA0", pulse: 250 }]
      }
    },
    program: {
      operations: [
        { op: "pwmSetCompare", timer: "htim2", instance: "TIM2", channel: 1, compare: literal(250), period: 999 },
        { op: "pwmStart", timer: "htim2", instance: "TIM2", channel: 1, period: 999, frequencyHz: 1000 },
        { op: "pwmSetCompare", timer: "htim2", instance: "TIM2", channel: 1, compare: literal(750), period: 999 }
      ]
    }
  }, { onPwm: event => pwmEvents.push(event) });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.equal(pwmEvents.length, 3);
  assert.equal(pwmEvents[0].active, false);
  assert.equal(pwmEvents[1].dutyPercent, 25);
  assert.equal(pwmEvents[2].dutyPercent, 75);
  assert.equal(pwmEvents[2].frequencyHz, 1000);
  assert.equal(pwmEvents[2].pin, "PA0");
  assert.equal(state.pwm["TIM2:CH1"].dutyPercent, 75);
});

test("default Blinky accepts hal_model milliseconds delay without exhausting the budget", () => {
  const model = {
    program: {
      operations: [
        {
          op: "while",
          condition: literal(true),
          body: [
            { op: "gpioToggle", physicalPin: "PC13" },
            {
              op: "delay",
              milliseconds: 500,
              expression: literal(500),
              source: { file: "Core/Src/main.c", line: 25, column: 5 }
            }
          ]
        }
      ]
    }
  };
  const { runtime, gpio } = makeRuntime(model);

  runtime.start();
  let state = runtime.step(0);
  assert.equal(state.status, "sleeping");
  assert.equal(state.timeMs, 0);
  assert.equal(state.sleepUntil, 500);
  assert.equal(state.gpio.PC13, 1);
  assert.notEqual(state.status, "budget-exceeded");

  state = runtime.step(499);
  assert.equal(state.timeMs, 499);
  assert.equal(state.gpio.PC13, 1);
  assert.equal(gpio.length, 1);

  state = runtime.step(1);
  assert.equal(state.timeMs, 500);
  assert.equal(state.sleepUntil, 1000);
  assert.equal(state.gpio.PC13, 0);
  assert.deepEqual(gpio.map(event => [event.time, event.value]), [[0, 1], [500, 0]]);

  state = runtime.step(500);
  assert.equal(state.timeMs, 1000);
  assert.equal(state.gpio.PC13, 1);
  assert.deepEqual(gpio.map(event => [event.time, event.value]), [[0, 1], [500, 0], [1000, 1]]);
});

test("hal_model comparison operations execute with C precedence", () => {
  const model = {
    variables: { left: 2, right: 3, enabled: 1 },
    program: {
      operations: [
        {
          op: "if",
          condition: {
            op: "and",
            left: { op: "ne", left: variable("left"), right: variable("right") },
            right: { op: "lt", left: variable("left"), right: variable("right") }
          },
          then: [{ op: "gpioWrite", pin: "PA0", value: literal(1) }]
        },
        {
          op: "if",
          condition: {
            op: "or",
            left: { op: "ge", left: variable("left"), right: variable("right") },
            right: { op: "le", left: variable("enabled"), right: literal(1) }
          },
          then: [{ op: "gpioWrite", pin: "PA1", value: literal(1) }]
        },
        {
          op: "if",
          condition: { op: "gt", left: variable("right"), right: variable("left") },
          then: [{ op: "gpioWrite", pin: "PA2", value: literal(1) }]
        }
      ]
    }
  };
  const { runtime } = makeRuntime(model);

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.deepEqual(state.gpio, { PA0: 1, PA1: 1, PA2: 1 });
});

test("FreeRTOS task runtimes expose scheduler, CPU, stack and delay state", () => {
  const model = {
    middlewares: {
      freertos: {
        detected: true,
        api: "FreeRTOS",
        tickRateHz: 1000,
        heapBytes: 4096,
        tasks: [
          {
            id: "fast",
            name: "FastTask",
            entry: "FastTaskEntry",
            priority: 3,
            priorityLabel: "3",
            stackWords: 128,
            operations: [{
              op: "while",
              condition: literal(true),
              body: [
                { op: "gpioToggle", pin: "PA0" },
                { op: "rtosDelay", ticks: literal(10) }
              ]
            }]
          },
          {
            id: "slow",
            name: "SlowTask",
            entry: "SlowTaskEntry",
            priority: 1,
            priorityLabel: "1",
            stackWords: 96,
            operations: [{
              op: "while",
              condition: literal(true),
              body: [
                { op: "gpioToggle", pin: "PB0" },
                { op: "rtosDelay", ticks: literal(20) }
              ]
            }]
          }
        ]
      }
    },
    program: { operations: [] }
  };
  const runtime = AliceFirmwareRuntime.create(model);
  let state = runtime.start();

  assert.equal(state.rtos.detected, true);
  assert.equal(state.rtos.schedulerState, "running");
  assert.equal(state.rtos.tasks.length, 2);

  state = runtime.step(5);
  assert.equal(state.timeMs, 5);
  assert.equal(state.gpio.PA0, 1);
  assert.equal(state.gpio.PB0, 1);
  assert.equal(state.rtos.tickCount, 5);
  assert.ok(state.rtos.heapUsedBytes > 0);
  assert.ok(state.rtos.tasks.every(task => task.stackHighWaterMarkWords > 0));
  assert.ok(state.rtos.tasks.some(task => task.state === "Running" || task.state === "Blocked"));

  state = runtime.step(15);
  assert.equal(state.timeMs, 20);
  assert.ok(state.operationsExecuted > 0);
  assert.ok(state.rtos.tasks.reduce((total, task) => total + task.cpuPercent, 0) <= 100.1);
});

test("a non-yielding while loop is stopped by the per-step operation budget", () => {
  const runtime = AliceFirmwareRuntime.create({
    maxOperationsPerStep: 20,
    variables: { value: 0 },
    program: {
      operations: [
        {
          type: "while",
          condition: literal(true),
          operations: [
            { type: "assign", target: "value", value: literal(1) }
          ]
        }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.running, false);
  assert.equal(state.status, "budget-exceeded");
  assert.equal(state.error && state.error.code, "OPERATION_BUDGET_EXCEEDED");
  assert.equal(state.operationsExecuted, 20);
});

test("for, continue, switch, break and return execute with C control-flow semantics", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { i: 0, total: 0, result: 0 },
    program: {
      operations: [
        {
          op: "for",
          init: [{ op: "assign", target: "i", value: literal(0) }],
          condition: { op: "lt", left: variable("i"), right: literal(4) },
          increment: [{ op: "assign", target: "i", value: { op: "add", left: variable("i"), right: literal(1) } }],
          body: [
            { op: "if", condition: eq(variable("i"), literal(1)), then: [{ op: "continue" }] },
            { op: "assign", target: "total", value: { op: "add", left: variable("total"), right: variable("i") } },
            { op: "if", condition: { op: "gt", left: variable("total"), right: literal(3) }, then: [{ op: "break" }] }
          ]
        },
        {
          op: "switch",
          expression: variable("total"),
          cases: [
            { value: literal(5), body: [{ op: "assign", target: "result", value: literal(50) }, { op: "break" }] }
          ],
          default: [{ op: "assign", target: "result", value: literal(99) }]
        },
        { op: "return", value: variable("result") }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.i, 3);
  assert.equal(state.variables.total, 5);
  assert.equal(state.variables.result, 50);
  assert.equal(state.returnValue, 50);
});

test("HAL GPIO reads sample the wired input and feed later control flow", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { switchState: 0, status: 0 },
    program: {
      operations: [
        { op: "gpioRead", pin: "PA1", resultTarget: "switchState" },
        {
          op: "if",
          condition: eq(variable("switchState"), constant("GPIO_PIN_SET")),
          then: [{ op: "assign", target: "status", value: literal(1) }],
          else: [{ op: "assign", target: "status", value: literal(2) }]
        }
      ]
    }
  }, {
    onGpioRead(event) {
      assert.equal(event.pin, "PA1");
      return { value: 1, connected: true };
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.variables.switchState, 1);
  assert.equal(state.variables.status, 1);
});

test("I2C OLED writes and ADC reads use peripheral hooks and preserve HAL values", () => {
  const i2cEvents = [];
  const adcReads = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: {
      command: [0xaf],
      pixels: [0x40, 0x01, 0x02],
      sample: 0
    },
    i2cs: {
      hi2c1: { handle: "hi2c1", instance: "I2C1", sclPin: "PB6", sdaPin: "PB7" }
    },
    adcs: {
      hadc1: { handle: "hadc1", instance: "ADC1", channels: [{ channel: "ADC_CHANNEL_0", pin: "PA0", rank: 1 }] }
    },
    program: {
      operations: [
        { op: "i2cMemWrite", i2c: "hi2c1", instance: "I2C1", deviceAddress: { kind: "constant", name: "OLED_ADDRESS", value: 0x78 }, memoryAddress: { kind: "literal", value: 0x00 }, memoryAddressSize: 1, buffer: "command", length: 1 },
        { op: "i2cMasterTransmit", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, buffer: "pixels", length: 3 },
        { op: "adcStart", adc: "hadc1", instance: "ADC1" },
        { op: "adcPollForConversion", adc: "hadc1", instance: "ADC1", timeout: 10 },
        { op: "adcGetValue", adc: "hadc1", instance: "ADC1", target: { kind: "variable", name: "sample" } }
      ]
    }
  }, {
    onI2cTx(event) {
      i2cEvents.push(event);
      return { accepted: true, targetCount: 1 };
    },
    onAdcRead(event) {
      adcReads.push(event);
      return { value: 2048, voltage: 1.65, pin: "PA0" };
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(i2cEvents.length, 2);
  assert.deepEqual(i2cEvents[0].bytes, [0xaf]);
  assert.equal(i2cEvents[0].memoryAddress, 0);
  assert.deepEqual(i2cEvents[1].bytes, [0x40, 0x01, 0x02]);
  assert.equal(i2cEvents[1].deviceAddress, 0x78);
  assert.equal(state.i2cTx.length, 2);
  assert.equal(adcReads.length, 1);
  assert.equal(adcReads[0].instance, "ADC1");
  assert.equal(state.variables.sample, 2048);
  assert.deepEqual(state.adc.ADC1, { started: true, ready: false, value: 2048, voltage: 1.65, samples: 1 });
});

test("ADC circular DMA fills buffers in batches and executes half/full callbacks", () => {
  const dmaEvents = [];
  const adcReads = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { samples: [0, 0, 0, 0], halfCount: 0, fullCount: 0 },
    adcs: {
      hadc1: {
        handle: "hadc1",
        instance: "ADC1",
        samplePeriodMs: 1,
        dmaHandle: "hdma_adc1",
        channels: [
          { channel: "ADC_CHANNEL_0", pin: "PA0", rank: 1 },
          { channel: "ADC_CHANNEL_1", pin: "PA1", rank: 2 }
        ]
      }
    },
    dmas: { hdma_adc1: { handle: "hdma_adc1", instance: "DMA1_Channel1", circular: true } },
    callbacks: {
      HAL_ADC_ConvHalfCpltCallback: {
        operations: [{
          op: "if",
          condition: eq({ type: "member", object: variable("hadc"), member: "Instance" }, variable("ADC1")),
          then: [{ op: "assign", target: "halfCount", value: { kind: "add", left: variable("halfCount"), right: literal(1) } }]
        }]
      },
      HAL_ADC_ConvCpltCallback: {
        operations: [{ op: "assign", target: "fullCount", value: { kind: "add", left: variable("fullCount"), right: literal(1) } }]
      }
    },
    program: {
      operations: [
        { op: "adcStartDma", adc: "hadc1", instance: "ADC1", dmaHandle: "hdma_adc1", dmaInstance: "DMA1_Channel1", buffer: "samples", length: 4, circular: true },
        { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 100 }] }
      ]
    }
  }, {
    onAdcRead(event) {
      adcReads.push(event);
      return { value: 100 + event.sampleIndex + event.channelIndex * 10, voltage: 1.0 };
    },
    onDma(event) { dmaEvents.push(event); }
  });

  runtime.start();
  let state = runtime.step(2);
  assert.deepEqual(state.variables.samples, [100, 111, 0, 0]);
  assert.equal(state.variables.halfCount, 1);
  assert.equal(state.variables.fullCount, 0);
  assert.equal(adcReads.length, 2, "half-buffer is sampled as one batch");

  state = runtime.step(2);
  assert.deepEqual(state.variables.samples, [100, 111, 102, 113]);
  assert.equal(state.variables.fullCount, 1);
  assert.equal(state.dma.transfers[0].active, true);
  assert.equal(state.dma.transfers[0].cycle, 1);
  assert.deepEqual(dmaEvents.map(event => event.phase), ["started", "half", "complete"]);
});

test("large time jumps coalesce circular DMA cycles instead of replaying every tick", () => {
  let reads = 0;
  const runtime = AliceFirmwareRuntime.create({
    variables: { samples: [0, 0] },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", samplePeriodMs: 1 } },
    program: {
      operations: [
        { op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer: "samples", length: 2, circular: true },
        { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 1000000 }] }
      ]
    }
  }, {
    onAdcRead() { reads += 1; return reads; }
  });

  runtime.start();
  const state = runtime.step(100000);
  const transfer = state.dma.transfers[0];
  assert.ok(transfer.coalescedCycles > 1000);
  assert.ok(reads < 300, "DMA work per simulation frame must remain bounded");
  assert.equal(state.dma.history.length, 64);
});

test("completed DMA transfer records stay bounded during long UART runs", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { tx: [65] },
    uarts: { huart2: { handle: "huart2", instance: "USART2", baudRate: 115200, frame: { dataBits: 8, stopBits: 1, parity: "none" } } },
    program: {
      operations: [{
        op: "while",
        condition: literal(true),
        body: [
          { op: "uartTransmitDma", uart: "huart2", instance: "USART2", buffer: "tx", length: 1 },
          { op: "delay", milliseconds: 1 }
        ]
      }]
    }
  });

  runtime.start();
  for (let index = 0; index < 1000; index += 1) runtime.step(1);
  const state = runtime.getState();
  assert.ok(state.dma.transfers.length <= 33, "only one active and a bounded completed window should remain");
  assert.ok(JSON.stringify(state.dma).length < 40000);
});

test("CPU wake and DMA stop execute before later DMA completion events", () => {
  const dmaEvents = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { samples: [0, 0], completed: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", samplePeriodMs: 1 } },
    callbacks: { HAL_ADC_ConvCpltCallback: { operations: [{ op: "assign", target: "completed", value: literal(1) }] } },
    program: {
      operations: [
        { op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer: "samples", length: 2 },
        { op: "delay", milliseconds: 1 },
        { op: "adcStopDma", adc: "hadc1", instance: "ADC1" },
        { op: "delay", milliseconds: 100 }
      ]
    }
  }, {
    onAdcRead: () => 123,
    onDma: event => dmaEvents.push({ phase: event.phase, time: event.time })
  });

  runtime.start();
  runtime.step(0);
  const state = runtime.step(10);
  assert.equal(state.variables.completed, 0);
  assert.deepEqual(dmaEvents, [{ phase: "started", time: 0 }, { phase: "stopped", time: 1 }]);
});

test("overlapping DMA starts return HAL_BUSY without cancelling the active transfer", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { first: [65, 66], second: [67, 68], firstStatus: 9, secondStatus: 9 },
    uarts: { huart2: { handle: "huart2", instance: "USART2", baudRate: 1000, frame: { dataBits: 8, stopBits: 1, parity: "none" } } },
    program: {
      operations: [
        { op: "uartTransmitDma", uart: "huart2", instance: "USART2", buffer: "first", length: 2, resultTarget: "firstStatus" },
        { op: "uartTransmitDma", uart: "huart2", instance: "USART2", buffer: "second", length: 2, resultTarget: "secondStatus" },
        { op: "delay", milliseconds: 100 }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.variables.firstStatus, 0);
  assert.equal(state.variables.secondStatus, 2);
  assert.equal(state.dma.transfers.filter(item => item.active).length, 1);
  assert.equal(state.dma.transfers.find(item => item.active).buffer, "first");
});

test("paused UART RX DMA queues bytes until the runtime resumes", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { rx: [0, 0], done: 0 },
    callbacks: { HAL_UART_RxCpltCallback: { operations: [{ op: "assign", target: "done", value: literal(1) }] } },
    program: {
      operations: [
        { op: "uartReceiveDma", uart: "huart2", instance: "USART2", buffer: "rx", length: 2 },
        { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 100 }] }
      ]
    }
  });

  runtime.start();
  runtime.step(0);
  runtime.pause();
  let state = runtime.enqueueUart("USART2", [7, 8]);
  assert.deepEqual(state.variables.rx, [0, 0]);
  assert.equal(state.variables.done, 0);
  state = runtime.start();
  assert.deepEqual(state.variables.rx, [7, 8]);
  assert.equal(state.variables.done, 1);
});

test("DMA callback backlog is preserved and drained across bounded steps", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { samples: [0, 0], fullCount: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", samplePeriodMs: 1 } },
    callbacks: {
      HAL_ADC_ConvCpltCallback: {
        operations: [{ op: "assign", target: "fullCount", value: { kind: "add", left: variable("fullCount"), right: literal(1) } }]
      }
    },
    program: {
      operations: [
        { op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer: "samples", length: 2, circular: true },
        { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 2000 }] }
      ]
    }
  }, { onAdcRead: () => 1 });

  runtime.start();
  runtime.step(0);
  let state = runtime.step(1000);
  assert.ok(state.pendingAdvanceMs > 0);
  while (state.pendingAdvanceMs > 0) state = runtime.step(0);
  assert.equal(state.time, 1000);
  assert.equal(state.variables.fullCount, 500);
  assert.equal(state.dma.transfers.find(item => item.active).coalescedCycles || 0, 0);
});

test("UART DMA uses baud timing for TX and incoming bytes for RX callbacks", () => {
  const uartTx = [];
  const callbacks = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { tx: [68, 77, 65, 10], rx: [0, 0, 0, 0], txDone: 0, rxHalf: 0, rxDone: 0 },
    uarts: {
      huart2: {
        handle: "huart2",
        instance: "USART2",
        baudRate: 1000,
        frame: { dataBits: 8, stopBits: 1, parity: "none" },
        txDmaHandle: "hdma_usart2_tx",
        rxDmaHandle: "hdma_usart2_rx"
      }
    },
    callbacks: {
      HAL_UART_TxCpltCallback: { operations: [{ op: "assign", target: "txDone", value: literal(1) }] },
      HAL_UART_RxHalfCpltCallback: { operations: [{ op: "assign", target: "rxHalf", value: literal(1) }] },
      HAL_UART_RxCpltCallback: { operations: [{ op: "assign", target: "rxDone", value: literal(1) }] }
    },
    program: {
      operations: [
        { op: "uartTransmitDma", uart: "huart2", instance: "USART2", buffer: "tx", length: 4, dmaHandle: "hdma_usart2_tx" },
        { op: "uartReceiveDma", uart: "huart2", instance: "USART2", buffer: "rx", length: 4, dmaHandle: "hdma_usart2_rx" },
        { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 100 }] }
      ]
    }
  }, {
    onUartTx(event) { uartTx.push(event); },
    onDmaCallback(event) { callbacks.push(event); }
  });

  runtime.start();
  let state = runtime.step(0);
  assert.equal(uartTx.length, 1);
  assert.equal(uartTx[0].dma, true);
  assert.equal(uartTx[0].durationMs, 40);
  assert.equal(state.variables.txDone, 0);

  runtime.enqueueUart("USART2", [1, 2]);
  state = runtime.getState();
  assert.deepEqual(state.variables.rx, [1, 2, 0, 0]);
  assert.equal(state.variables.rxHalf, 1);
  runtime.enqueueUart("USART2", [3, 4]);
  state = runtime.getState();
  assert.deepEqual(state.variables.rx, [1, 2, 3, 4]);
  assert.equal(state.variables.rxDone, 1);

  state = runtime.step(40);
  assert.equal(state.variables.txDone, 1);
  assert.equal(state.dma.transfers.find(item => item.type === "uartTx").active, false);
  assert.deepEqual(callbacks.map(event => event.callback), [
    "HAL_UART_RxHalfCpltCallback",
    "HAL_UART_RxCpltCallback",
    "HAL_UART_TxHalfCpltCallback",
    "HAL_UART_TxCpltCallback"
  ]);
});

test("HAL SPI transmit forwards exact bytes to a schematic display hook", () => {
  const spiTx = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { pixels: [0xf8, 0x00, 0x07, 0xe0] },
    spis: { hspi1: { handle: "hspi1", instance: "SPI1" } },
    program: {
      operations: [
        { op: "spiTransmit", spi: "hspi1", instance: "SPI1", buffer: "pixels", length: 4, timeout: 100 }
      ]
    }
  }, {
    onSpiTx(event) {
      spiTx.push(event);
      return { accepted: true, targetCount: 1 };
    }
  });

  runtime.start();
  const state = runtime.step(1);
  assert.equal(spiTx.length, 1);
  assert.equal(spiTx[0].instance, "SPI1");
  assert.deepEqual(spiTx[0].bytes, [0xf8, 0x00, 0x07, 0xe0]);
  assert.equal(state.spiTx.length, 1);
  assert.equal(state.spiTx[0].accepted, true);
});

test("AliceSIM high-level OLED and light sensor drivers reach the same I2C, ADC and GPIO hooks", () => {
  const i2cEvents = [];
  const runtime = AliceFirmwareRuntime.create({
    i2cs: { hi2c1: { handle: "hi2c1", instance: "I2C1" } },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1" } },
    variables: { raw: 0, lux: 0, level: 0, triggered: 0, sample: {}, copiedLux: 0, status: -1 },
    program: {
      operations: [
        { op: "aliceOledInit", context: "display", i2c: "hi2c1", instance: "I2C1", address: literal(0x3c), timeout: literal(100), resultTarget: "status" },
        { op: "aliceOledClear", context: "display" },
        { op: "aliceOledDrawString", context: "display", x: literal(2), y: literal(2), text: { kind: "string", value: "LUX" }, scale: literal(1), color: literal(1) },
        { op: "aliceOledDrawRectangle", context: "display", x: literal(1), y: literal(14), width: literal(20), height: literal(10), color: literal(1) },
        { op: "aliceOledUpdate", context: "display" },
        { op: "aliceLightInit", context: "light", adc: "hadc1", instance: "ADC1", digitalPin: "PB0", digitalActiveLow: literal(0), referenceMv: literal(3300), adcBits: literal(12), timeout: literal(10) },
        { op: "aliceLightReadRaw", context: "light", target: "raw" },
        { op: "aliceLightReadLux", context: "light", target: "lux" },
        { op: "aliceLightReadDigital", context: "light", levelTarget: "level", triggeredTarget: "triggered" },
        { op: "aliceLightRead", context: "light", target: "sample", resultTarget: "status" },
        { op: "assign", target: "copiedLux", value: { kind: "member", object: variable("sample"), member: "lux" } }
      ]
    }
  }, {
    onI2cTx(event) {
      i2cEvents.push(event);
      return { accepted: true, targetCount: 1 };
    },
    onAdcRead() {
      return { value: 2048, voltage: 1.65, pin: "PA0" };
    },
    onGpioRead() {
      return { value: 1, connected: true };
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.raw, 2048);
  assert.equal(state.variables.lux, 50012);
  assert.equal(state.variables.level, 1);
  assert.equal(state.variables.triggered, 1);
  assert.equal(state.variables.sample.lux, 50012);
  assert.equal(state.variables.sample.percent_x100, 5001);
  assert.equal(state.variables.copiedLux, 50012);
  assert.equal(state.variables.status, 0);
  assert.ok(i2cEvents.length >= 5);
  assert.equal(i2cEvents.at(-1).memoryAddress, 0x40);
  assert.equal(i2cEvents.at(-1).bytes.length, 1024);
  assert.ok(i2cEvents.at(-1).bytes.some((byte) => byte !== 0));
  assert.equal(state.peripherals.oled.display.initialized, true);
  assert.equal(state.peripherals.lightSensor.light.digitalPin, "PB0");
});

test("runtime evaluates ADC arithmetic and writes UART text through a dynamic array index", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { adc_raw: 2048, adc_mv: 0, uart_length: 1, uart_byte: 66, uart_text: [65, 0, 0] },
    program: {
      operations: [
        {
          op: "assign",
          target: "adc_mv",
          value: {
            kind: "div",
            left: { kind: "mul", left: variable("adc_raw"), right: literal(3300) },
            right: literal(4095)
          }
        },
        {
          op: "assign",
          target: { kind: "arrayIndex", name: "uart_text", index: variable("uart_length") },
          value: variable("uart_byte")
        },
        {
          op: "assign",
          target: "uart_length",
          value: { kind: "add", left: variable("uart_length"), right: literal(1) }
        },
        {
          op: "assign",
          target: { kind: "arrayIndex", name: "uart_text", index: variable("uart_length") },
          value: literal(0)
        }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.variables.adc_mv, 1650);
  assert.equal(state.variables.uart_length, 2);
  assert.deepEqual(state.variables.uart_text, [65, 66, 0]);
});

test("peripheral transfer history stays bounded while cumulative counters keep increasing", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { bytes: [0x40, 0x01] },
    program: {
      operations: [{
        op: "while",
        condition: literal(true),
        operations: [
          { op: "i2cMemWrite", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, memoryAddress: 0x40, buffer: "bytes", length: 2 },
          { op: "delay", milliseconds: literal(1) }
        ]
      }]
    }
  }, {
    onI2cTx() { return { accepted: true, targetCount: 1 }; }
  });

  runtime.start();
  let state;
  for (let index = 0; index < 10000; index += 1) state = runtime.step(1);

  assert.equal(state.i2cTxCount, 10001);
  assert.ok(state.i2cTx.length <= 64);
  assert.equal(state.i2cTx.at(-1).timeMs, 10000);
});

test("dynamic ADC digits are drawn into the OLED framebuffer as 2048 and 1650", () => {
  const digit = (value, divisor) => ({
    kind: "add",
    left: char("0"),
    right: {
      kind: "mod",
      left: divisor === 1 ? variable(value) : { kind: "div", left: variable(value), right: literal(divisor) },
      right: literal(10)
    }
  });
  const operations = [
    { op: "aliceOledClear", context: "display" },
    ...[1000, 100, 10, 1].map((divisor, index) => ({
      op: "aliceOledDrawChar", context: "display", x: literal(index * 6), y: literal(0),
      character: digit("adc_raw", divisor), scale: literal(1), color: literal(1)
    })),
    ...[1000, 100, 10, 1].map((divisor, index) => ({
      op: "aliceOledDrawChar", context: "display", x: literal(index * 6), y: literal(12),
      character: digit("adc_mv", divisor), scale: literal(1), color: literal(1)
    }))
  ];
  const runtime = AliceFirmwareRuntime.create({
    variables: { adc_raw: 2048, adc_mv: 1650 },
    program: { operations }
  });

  runtime.start();
  const state = runtime.step(0);
  const framebuffer = state.peripherals.oled.display.framebuffer;
  const columns = (x, y) => Array.from({ length: 5 }, (_, offset) => {
    let value = 0;
    for (let row = 0; row < 7; row += 1) {
      const pixelY = y + row;
      const byte = framebuffer[x + offset + Math.floor(pixelY / 8) * 128];
      if ((byte >> (pixelY & 7)) & 1) value |= 1 << row;
    }
    return value;
  });

  assert.deepEqual([0, 6, 12, 18].map(x => columns(x, 0)), [
    [0x42, 0x61, 0x51, 0x49, 0x46],
    [0x3e, 0x51, 0x49, 0x45, 0x3e],
    [0x18, 0x14, 0x12, 0x7f, 0x10],
    [0x36, 0x49, 0x49, 0x49, 0x36]
  ]);
  assert.deepEqual([0, 6, 12, 18].map(x => columns(x, 12)), [
    [0x00, 0x42, 0x7f, 0x40, 0x00],
    [0x3c, 0x4a, 0x49, 0x49, 0x30],
    [0x27, 0x45, 0x45, 0x45, 0x39],
    [0x3e, 0x51, 0x49, 0x45, 0x3e]
  ]);
});

test("MCU reset clears peripheral state and replays OLED initialization after restart", () => {
  const i2cEvents = [];
  const runtime = AliceFirmwareRuntime.create({
    i2cs: { hi2c1: { handle: "hi2c1", instance: "I2C1" } },
    program: {
      operations: [
        { op: "aliceOledInit", context: "display", i2c: "hi2c1", instance: "I2C1", address: literal(0x3c), timeout: literal(100) },
        { op: "aliceOledDrawString", context: "display", x: literal(0), y: literal(0), text: { kind: "string", value: "READY" }, scale: literal(1), color: literal(1) },
        { op: "aliceOledUpdate", context: "display" }
      ]
    }
  }, {
    onI2cTx(event) {
      i2cEvents.push(event);
      return { accepted: true, targetCount: 1 };
    }
  });

  runtime.start();
  let state = runtime.step(0);
  const firstBootTransfers = i2cEvents.length;
  assert.equal(state.peripherals.oled.display.initialized, true);
  assert.ok(firstBootTransfers > 0);

  state = runtime.reset();
  assert.deepEqual(state.peripherals.oled, {});
  assert.equal(state.status, "idle");

  runtime.start();
  state = runtime.step(0);
  assert.equal(state.peripherals.oled.display.initialized, true);
  assert.ok(i2cEvents.length > firstBootTransfers);
});
