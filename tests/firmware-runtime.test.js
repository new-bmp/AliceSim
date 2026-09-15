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
const halCall = (operation, returnKind = "status") => ({ type: "halCall", operation, returnKind });
const inlineCall = operations => ({ type: "inlineCall", operations });

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

test("long simulated time jumps reset the operation guard after firmware delays", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { count: 0 },
    program: {
      operations: [{
        op: "while",
        condition: literal(true),
        body: [
          { op: "assign", target: "count", value: { kind: "add", left: variable("count"), right: literal(1) } },
          { op: "delay", milliseconds: literal(100) }
        ]
      }]
    }
  });

  runtime.start();
  const state = runtime.step(60000);
  assert.notEqual(state.status, "budget-exceeded");
  assert.equal(state.time, 60000);
  // The first iteration runs at t=0 and the boundary iteration starts at
  // t=60000 before its next delay extends beyond this step.
  assert.equal(state.variables.count, 601);
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

test("HAL tick expressions follow simulated time", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { now: 0 },
    program: {
      operations: [
        { op: "delay", milliseconds: 7 },
        { op: "assign", target: "now", value: { kind: "tick" } }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(7);
  assert.equal(state.variables.now, 7);
});

test("ADC poll expressions return HAL_OK only after the ADC has started", () => {
  const polls = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { converted: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", channels: [] } },
    program: {
      operations: [
        { op: "adcStart", adc: "hadc1", instance: "ADC1" },
        {
          op: "if",
          condition: {
            op: "eq",
            left: { kind: "adcPoll", adc: "hadc1", instance: "ADC1", timeout: literal(10) },
            right: constant("HAL_OK")
          },
          then: [{ op: "assign", target: "converted", value: literal(1) }],
          else: [{ op: "assign", target: "converted", value: literal(0) }]
        }
      ]
    }
  }, {
    onAdcPoll(event) { polls.push(event); }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.variables.converted, 1);
  assert.equal(polls.length, 1);
  assert.equal(polls[0].ready, true);
});

test("halCall conditions use private result slots and run ADC GPIO PWM side effects once", () => {
  const adcStarts = [];
  const adcReads = [];
  const gpioReads = [];
  const pwmEvents = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { adcStarted: 0, gpioHigh: 0, adcArithmetic: 0, pwmStarted: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", channels: [] } },
    program: {
      operations: [
        {
          op: "if",
          condition: eq(
            halCall({ op: "adcStart", adc: "hadc1", instance: "ADC1" }),
            constant("HAL_OK")
          ),
          then: [{ op: "assign", target: "adcStarted", value: literal(1) }]
        },
        {
          op: "if",
          condition: eq(
            halCall({ op: "gpioRead", pin: "PA1" }, "value"),
            constant("GPIO_PIN_SET")
          ),
          then: [{ op: "assign", target: "gpioHigh", value: literal(1) }]
        },
        {
          op: "if",
          condition: eq({
            op: "add",
            left: halCall({ op: "adcGetValue", adc: "hadc1", instance: "ADC1" }, "value"),
            right: literal(5)
          }, literal(2053)),
          then: [{ op: "assign", target: "adcArithmetic", value: literal(1) }]
        },
        {
          op: "if",
          condition: eq(
            halCall({ op: "pwmStart", timer: "htim2", instance: "TIM2", channel: 1, period: 999, frequencyHz: 1000 }),
            constant("HAL_OK")
          ),
          then: [{ op: "assign", target: "pwmStarted", value: literal(1) }]
        }
      ]
    }
  }, {
    onAdcStart(event) { adcStarts.push(event); },
    onAdcRead(event) { adcReads.push(event); return { value: 2048 }; },
    onGpioRead(event) { gpioReads.push(event); return { value: 1 }; },
    onPwm(event) { pwmEvents.push(event); }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.deepEqual(
    [state.variables.adcStarted, state.variables.gpioHigh, state.variables.adcArithmetic, state.variables.pwmStarted],
    [1, 1, 1, 1]
  );
  assert.equal(adcStarts.length, 1);
  assert.equal(adcReads.length, 1);
  assert.equal(gpioReads.length, 1);
  assert.equal(pwmEvents.length, 1);
  assert.equal(state.pwm["TIM2:CH1"].active, true);
  assert.equal(Object.keys(state.variables).some(name => /^call-\d+$/.test(name)), false, "expression result slots must stay private");
});

test("conditional expressions execute only the selected HAL branch and preserve blocking", () => {
  const gpioReads = [];
  const selectedReceive = AliceFirmwareRuntime.create({
    variables: { chooseReceive: 1, rx: [0], result: -1 },
    uarts: { huart2: { handle: "huart2", instance: "USART2" } },
    program: {
      operations: [{
        op: "assign",
        target: "result",
        value: {
          kind: "conditional",
          condition: variable("chooseReceive"),
          consequent: halCall({
            op: "uartReceive", uart: "huart2", instance: "USART2", buffer: "rx", length: literal(1), timeout: literal(10)
          }),
          alternate: {
            kind: "conditional",
            condition: literal(true),
            consequent: halCall({ op: "gpioRead", pin: "PA1" }, "value"),
            alternate: halCall({ op: "gpioRead", pin: "PA2" }, "value")
          }
        }
      }]
    }
  }, {
    onGpioRead(event) { gpioReads.push(event); return { value: 1 }; }
  });

  selectedReceive.start();
  let state = selectedReceive.step(0);
  assert.equal(state.status, "blocked");
  assert.equal(gpioReads.length, 0, "the alternate HAL call must not run while the receive branch is selected");

  selectedReceive.enqueueUart("USART2", [0x41]);
  state = selectedReceive.step(0);
  assert.equal(state.status, "completed");
  assert.equal(state.variables.result, 0);
  assert.deepEqual(state.variables.rx, [0x41]);

  const selectedGpio = AliceFirmwareRuntime.create({
    variables: { chooseReceive: 0, rx: [0], result: -1 },
    uarts: { huart2: { handle: "huart2", instance: "USART2" } },
    program: {
      operations: [{
        op: "assign",
        target: "result",
        value: {
          kind: "conditional",
          condition: variable("chooseReceive"),
          consequent: halCall({
            op: "uartReceive", uart: "huart2", instance: "USART2", buffer: "rx", length: literal(1), timeout: literal(10)
          }),
          alternate: {
            kind: "conditional",
            condition: literal(true),
            consequent: halCall({ op: "gpioRead", pin: "PA1" }, "value"),
            alternate: halCall({ op: "gpioRead", pin: "PA2" }, "value")
          }
        }
      }]
    }
  }, {
    onGpioRead(event) { gpioReads.push(event); return { value: 1 }; }
  });

  selectedGpio.start();
  state = selectedGpio.step(0);
  assert.equal(state.status, "completed");
  assert.equal(state.blocked, null);
  assert.equal(state.variables.result, 1);
  assert.equal(gpioReads.length, 1, "the GPIO branch must run once when selected");
  assert.equal(gpioReads[0].pin, "PA1", "nested conditional branches must also short-circuit");
  assert.equal(Object.keys(state.variables).some(name => /^(?:call|conditional)-\d+$/.test(name)), false);
});

test("logical-not precedence is preserved around a HAL value expression", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { selected: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", channels: [] } },
    program: {
      operations: [{
        op: "if",
        condition: {
          op: "eq",
          left: {
            kind: "logicalNot",
            value: halCall({ op: "adcGetValue", adc: "hadc1", instance: "ADC1" }, "value")
          },
          right: literal(1)
        },
        then: [{ op: "assign", target: "selected", value: literal(1) }],
        else: [{ op: "assign", target: "selected", value: literal(2) }]
      }]
    }
  }, {
    onAdcRead() { return { value: 2 }; }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.equal(state.variables.selected, 2, "!2 == 1 is false; !(2 == 1) would be true");
});

test("increment expressions preserve C values in HAL parameters and compound lvalues", () => {
  const uartTx = [];
  const adcStarts = [];
  const adcReads = [];
  const postIncrement = target => ({ kind: "postIncrement", target });
  const preIncrement = target => ({ kind: "preIncrement", target });
  const postDecrement = target => ({ kind: "postDecrement", target });
  const preDecrement = target => ({ kind: "preDecrement", target });
  const runtime = AliceFirmwareRuntime.create({
    variables: {
      conditionIndex: 1,
      postLength: 1,
      preLength: 1,
      postDecrementLength: 2,
      preDecrementLength: 3,
      arrayIndex: 1,
      samples: [10, 20, 30],
      tx: [0x41, 0x42, 0x43],
      pointer: 0,
      pointerResult: 0,
      conditionTaken: 0
    },
    variableTypes: { pointer: "int*" },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", channels: [] } },
    uarts: { huart2: { handle: "huart2", instance: "USART2" } },
    program: {
      operations: [
        {
          op: "if",
          condition: {
            op: "and",
            left: {
              op: "lt",
              left: postIncrement(variable("conditionIndex")),
              right: literal(2)
            },
            right: eq(halCall({ op: "adcStart", adc: "hadc1", instance: "ADC1" }), constant("HAL_OK"))
          },
          then: [{ op: "assign", target: "conditionTaken", value: literal(1) }]
        },
        {
          op: "uartTransmit",
          uart: "huart2",
          instance: "USART2",
          buffer: "tx",
          length: postIncrement(variable("postLength")),
          timeout: literal(0)
        },
        {
          op: "uartTransmit",
          uart: "huart2",
          instance: "USART2",
          buffer: "tx",
          length: preIncrement(variable("preLength")),
          timeout: literal(0)
        },
        {
          op: "uartTransmit",
          uart: "huart2",
          instance: "USART2",
          buffer: "tx",
          length: postDecrement(variable("postDecrementLength")),
          timeout: literal(0)
        },
        {
          op: "uartTransmit",
          uart: "huart2",
          instance: "USART2",
          buffer: "tx",
          length: preDecrement(variable("preDecrementLength")),
          timeout: literal(0)
        },
        {
          op: "compoundAssign",
          target: {
            kind: "arrayIndex",
            name: "samples",
            index: postIncrement(variable("arrayIndex"))
          },
          operator: "add",
          value: halCall({ op: "adcGetValue", adc: "hadc1", instance: "ADC1" }, "value")
        },
        { op: "heapAllocate", function: "malloc", size: literal(4), resultTarget: "pointer" },
        {
          op: "assign",
          target: { kind: "dereference", pointer: variable("pointer") },
          value: literal(8)
        },
        {
          op: "compoundAssign",
          target: { kind: "dereference", pointer: variable("pointer") },
          operator: "add",
          value: literal(7)
        },
        {
          op: "assign",
          target: "pointerResult",
          value: { kind: "dereference", pointer: variable("pointer") }
        }
      ]
    }
  }, {
    onAdcStart(event) { adcStarts.push(event); },
    onAdcRead(event) { adcReads.push(event); return { value: 5 }; },
    onUartTx(event) { uartTx.push(event); }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.conditionTaken, 1);
  assert.equal(state.variables.conditionIndex, 2, "postfix condition uses the old value, then increments once");
  assert.equal(adcStarts.length, 1, "the right side of && runs after the postfix comparison succeeds");
  assert.deepEqual(uartTx.map(event => event.bytes), [[0x41], [0x41, 0x42], [0x41, 0x42], [0x41, 0x42]]);
  assert.equal(state.variables.postLength, 2);
  assert.equal(state.variables.preLength, 2);
  assert.equal(state.variables.postDecrementLength, 1);
  assert.equal(state.variables.preDecrementLength, 2);
  assert.deepEqual(state.variables.samples, [10, 25, 30], "array index is captured before the RHS HAL call");
  assert.equal(state.variables.arrayIndex, 2);
  assert.equal(adcReads.length, 1);
  assert.equal(state.variables.pointerResult, 15, "dereferenced compound assignment writes back to the pointed value");
  assert.deepEqual(state.heap.allocations["1"].bytes, [15, 0, 0, 0]);
});

test("halCall UART receive condition blocks then resumes into the HAL_OK branch", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { rx: [0, 0], success: 0, failure: 0 },
    uarts: { huart2: { handle: "huart2", instance: "USART2" } },
    program: {
      operations: [{
        op: "if",
        condition: eq(
          halCall({
            op: "uartReceive", uart: "huart2", instance: "USART2", buffer: "rx", length: literal(2), timeout: literal(10)
          }),
          constant("HAL_OK")
        ),
        then: [{ op: "assign", target: "success", value: literal(1) }],
        else: [{ op: "assign", target: "failure", value: literal(1) }]
      }]
    }
  });

  runtime.start();
  let state = runtime.step(0);
  assert.equal(state.status, "blocked");
  assert.equal(state.variables.success, 0);
  assert.equal(state.variables.failure, 0);

  runtime.enqueueUart("USART2", [0x41, 0x42]);
  state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.deepEqual(state.variables.rx, [0x41, 0x42]);
  assert.equal(state.variables.success, 1);
  assert.equal(state.variables.failure, 0);
  assert.equal(Object.keys(state.variables).some(name => /^call-\d+$/.test(name)), false);
});

test("halCall UART receive condition chooses the timeout branch after its deadline", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { rx: [0, 0], success: 0, failure: 0 },
    uarts: { huart2: { handle: "huart2", instance: "USART2" } },
    program: {
      operations: [{
        op: "if",
        condition: eq(
          halCall({
            op: "uartReceive", uart: "huart2", instance: "USART2", buffer: "rx", length: literal(2), timeout: "5U"
          }),
          constant("HAL_OK")
        ),
        then: [{ op: "assign", target: "success", value: literal(1) }],
        else: [{ op: "assign", target: "failure", value: literal(1) }]
      }]
    }
  });

  runtime.start();
  let state = runtime.step(0);
  assert.equal(state.status, "blocked");

  state = runtime.step(5);
  assert.equal(state.status, "completed");
  assert.equal(state.timeMs, 5);
  assert.deepEqual(state.variables.rx, [0, 0]);
  assert.equal(state.variables.success, 0);
  assert.equal(state.variables.failure, 1);
});

test("halCall conditions preserve && and || short circuit side effects", () => {
  const adcStarts = [];
  const gpioReads = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { andBranch: 0, orBranch: 0, negatedBranch: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", channels: [] } },
    program: {
      operations: [
        {
          op: "if",
          condition: {
            op: "and",
            left: literal(false),
            right: eq(halCall({ op: "adcStart", adc: "hadc1", instance: "ADC1" }), constant("HAL_OK"))
          },
          then: [{ op: "assign", target: "andBranch", value: literal(1) }]
        },
        {
          op: "if",
          condition: {
            op: "or",
            left: literal(true),
            right: eq(halCall({ op: "gpioRead", pin: "PA1" }, "value"), constant("GPIO_PIN_SET"))
          },
          then: [{ op: "assign", target: "orBranch", value: literal(1) }]
        },
        {
          op: "if",
          condition: {
            kind: "logicalNot",
            value: {
              op: "and",
              left: literal(false),
              right: eq(halCall({ op: "adcStart", adc: "hadc1", instance: "ADC1" }), constant("HAL_OK"))
            }
          },
          then: [{ op: "assign", target: "negatedBranch", value: literal(1) }]
        }
      ]
    }
  }, {
    onAdcStart(event) { adcStarts.push(event); },
    onGpioRead(event) { gpioReads.push(event); return { value: 1 }; }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.andBranch, 0);
  assert.equal(state.variables.orBranch, 1);
  assert.equal(state.variables.negatedBranch, 1);
  assert.equal(adcStarts.length, 0);
  assert.equal(gpioReads.length, 0);
});

test("halCall expressions execute once per for check and once for switch dispatch", () => {
  const gpioReads = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { index: 0, loopBody: 0, selected: 0, stopped: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", channels: [] } },
    program: {
      operations: [
        {
          op: "for",
          init: [{ op: "assign", target: "index", value: literal(0) }],
          condition: {
            op: "and",
            left: { op: "lt", left: variable("index"), right: literal(2) },
            right: eq(halCall({ op: "gpioRead", pin: "PA1" }, "value"), constant("GPIO_PIN_SET"))
          },
          increment: [{
            op: "assign",
            target: "index",
            value: { op: "add", left: variable("index"), right: literal(1) }
          }],
          body: [{
            op: "assign",
            target: "loopBody",
            value: { op: "add", left: variable("loopBody"), right: literal(1) }
          }]
        },
        {
          op: "switch",
          expression: halCall({ op: "gpioRead", pin: "PA2" }, "value"),
          entries: [
            {
              value: literal(1),
              body: [
                { op: "assign", target: "selected", value: literal(1) },
                { op: "break" }
              ]
            },
            { default: true, body: [{ op: "assign", target: "selected", value: literal(2) }] }
          ]
        },
        {
          op: "if",
          condition: eq(halCall({ op: "adcStop", adc: "hadc1", instance: "ADC1" }), constant("HAL_OK")),
          then: [{ op: "assign", target: "stopped", value: literal(1) }]
        }
      ]
    }
  }, {
    onGpioRead(event) {
      gpioReads.push(event.pin);
      return { value: 1 };
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.loopBody, 2);
  assert.equal(state.variables.selected, 1);
  assert.equal(state.variables.stopped, 1);
  assert.deepEqual(gpioReads, ["PA1", "PA1", "PA2"]);
  assert.equal(state.adc.ADC1.started, false);
});

test("halCall values lower before assignments and return statements", () => {
  const starts = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { statusPlusOne: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", channels: [] } },
    program: {
      operations: [
        {
          op: "assign",
          target: "statusPlusOne",
          value: {
            op: "add",
            left: halCall({ op: "adcStart", adc: "hadc1", instance: "ADC1" }),
            right: literal(1)
          }
        },
        { op: "return", value: halCall({ op: "adcStop", adc: "hadc1", instance: "ADC1" }) }
      ]
    }
  }, {
    onAdcStart(event) { starts.push(event); }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.statusPlusOne, 1);
  assert.equal(state.returnValue, 0);
  assert.equal(starts.length, 1);
  assert.equal(state.adc.ADC1.started, false);
});

test("value helpers lower before HAL delay and UART transfer arguments", () => {
  const uartTx = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { tx: [0x41, 0x42, 0x43] },
    uarts: { huart2: { handle: "huart2", instance: "USART2" } },
    program: {
      operations: [
        {
          op: "delay",
          milliseconds: null,
          expression: inlineCall([{ op: "return", value: literal(5) }])
        },
        {
          op: "uartTransmit",
          uart: "huart2",
          instance: "USART2",
          buffer: "tx",
          length: inlineCall([{ op: "return", value: literal(2) }]),
          timeout: literal(10)
        }
      ]
    }
  }, {
    onUartTx(event) { uartTx.push(event); }
  });

  runtime.start();
  let state = runtime.step(0);
  assert.equal(state.status, "sleeping");
  assert.equal(state.sleepUntil, 5);

  state = runtime.step(5);
  assert.equal(state.status, "completed");
  assert.deepEqual(uartTx.map(event => event.bytes), [[0x41, 0x42]]);
  assert.equal(Object.keys(state.variables).some(name => /^inline-\d+$/.test(name)), false);
});

test("ADC UART and timer interrupt APIs complete asynchronously and execute callbacks", () => {
  const uartTx = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { adcValue: 0, adcDone: 0, tx: [79, 75], rx: [0, 0], txDone: 0, rxDone: 0, timerTicks: 0 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", samplePeriodMs: 2 } },
    uarts: { huart2: { handle: "huart2", instance: "USART2", baudRate: 1000, frame: { dataBits: 8, stopBits: 1, parity: "none" } } },
    timers: { htim2: { handle: "htim2", instance: "TIM2", frequencyHz: 100 } },
    callbacks: {
      HAL_ADC_ConvCpltCallback: {
        parameters: ["adcHandle"],
        operations: [
          { op: "adcGetValue", adc: "adcHandle", instance: null, target: "adcValue" },
          { op: "assign", target: "adcDone", value: literal(1) }
        ]
      },
      HAL_UART_TxCpltCallback: { parameters: ["uartHandle"], operations: [{ op: "assign", target: "txDone", value: literal(1) }] },
      HAL_UART_RxCpltCallback: { parameters: ["uartHandle"], operations: [{ op: "assign", target: "rxDone", value: literal(1) }] },
      HAL_TIM_PeriodElapsedCallback: {
        parameters: ["timerHandle"],
        operations: [{
          op: "if",
          condition: eq({ type: "member", object: variable("timerHandle"), member: "Instance" }, variable("TIM2")),
          then: [{ op: "assign", target: "timerTicks", value: { kind: "add", left: variable("timerTicks"), right: literal(1) } }]
        }]
      }
    },
    program: {
      operations: [
        { op: "adcStartIt", adc: "hadc1", instance: "ADC1" },
        { op: "uartTransmitIt", uart: "huart2", instance: "USART2", buffer: "tx", length: 2 },
        { op: "uartReceiveIt", uart: "huart2", instance: "USART2", buffer: "rx", length: 2 },
        { op: "timerStartIt", timer: "htim2", instance: "TIM2", frequencyHz: 100 },
        { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 100 }] }
      ]
    }
  }, {
    onAdcRead: () => ({ value: 1234, voltage: 1.0 }),
    onUartTx: event => uartTx.push(event)
  });

  runtime.start();
  let state = runtime.step(0);
  assert.equal(state.variables.adcDone, 0);
  assert.equal(state.variables.txDone, 0);
  assert.equal(uartTx[0].interrupt, true);
  state = runtime.enqueueUart("USART2", [7, 8]);
  assert.deepEqual(state.variables.rx, [7, 8]);
  assert.equal(state.variables.rxDone, 1);
  state = runtime.step(2);
  assert.equal(state.variables.adcValue, 1234);
  assert.equal(state.variables.adcDone, 1);
  state = runtime.step(18);
  assert.equal(state.variables.txDone, 1);
  assert.equal(state.variables.timerTicks, 2);
});

test("fatal firmware callback failures stop and fault the parent runtime", () => {
  const callbackName = "HAL_TIM_PeriodElapsedCallback";
  const source = { file: "Core/Src/stm32f1xx_it.c", line: 42, column: 3 };
  const cases = [
    {
      name: "Error_Handler",
      operations: [{ op: "fault", message: "Firmware entered Error_Handler()", source }],
      status: "error",
      code: "RUNTIME_ERROR",
      message: /Error_Handler/
    },
    {
      name: "unsupported expression",
      operations: [{ op: "assign", target: "value", value: { kind: "mysteryExpression", text: "__WFI()" }, source }],
      status: "error",
      code: "RUNTIME_ERROR",
      message: /Unsupported firmware expression.*__WFI/
    },
    {
      name: "unsupported operation",
      operations: [{ op: "mysteryOperation", statement: "custom_instruction();", source }],
      status: "error",
      code: "RUNTIME_ERROR",
      message: /Unsupported firmware operation.*custom_instruction/
    },
    {
      name: "operation budget",
      operations: [{ op: "while", condition: literal(true), body: [{ op: "assign", target: "spin", value: literal(1), source }], source }],
      status: "budget-exceeded",
      code: "OPERATION_BUDGET_EXCEEDED",
      message: /operations without yielding/
    }
  ];

  for (const scenario of cases) {
    const runtime = AliceFirmwareRuntime.create({
      maxOperationsPerStep: 12,
      timers: { htim2: { handle: "htim2", instance: "TIM2", frequencyHz: 1000 } },
      callbacks: { [callbackName]: { operations: scenario.operations } },
      program: {
        operations: [
          { op: "timerStartIt", timer: "htim2", instance: "TIM2", frequencyHz: 1000 },
          { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 100 }] }
        ]
      }
    });

    runtime.start();
    runtime.step(0);
    const state = runtime.step(1);
    assert.equal(state.status, scenario.status, scenario.name);
    assert.equal(state.running, false, scenario.name);
    assert.equal(state.error && state.error.code, scenario.code, scenario.name);
    assert.equal(state.error && state.error.callback, callbackName, scenario.name);
    assert.match(state.error && state.error.message, scenario.message, scenario.name);
    assert.deepEqual(state.error && state.error.source, source, scenario.name);
    assert.equal(runtime.step(100).time, 1, scenario.name + " must stop simulated time");
  }
});

test("I2C and SPI abort IT cancel active interrupt and DMA transfers", () => {
  const cases = [
    {
      name: "I2C interrupt",
      bus: "i2c",
      start: { op: "i2cMasterTransmitIt", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, buffer: "tx", length: 4 },
      abort: { op: "i2cAbortIt", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, resultTarget: "abortStatus" },
      abortCallback: "HAL_I2C_AbortCpltCallback",
      completionCallback: "HAL_I2C_MasterTxCpltCallback",
      history: "interrupts"
    },
    {
      name: "I2C DMA",
      bus: "i2c",
      start: { op: "i2cMasterTransmitDma", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, buffer: "tx", length: 4 },
      abort: { op: "i2cAbortIt", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x78, resultTarget: "abortStatus" },
      abortCallback: "HAL_I2C_AbortCpltCallback",
      completionCallback: "HAL_I2C_MasterTxCpltCallback",
      history: "dma"
    },
    {
      name: "SPI interrupt",
      bus: "spi",
      start: { op: "spiTransmitIt", spi: "hspi1", instance: "SPI1", buffer: "tx", length: 4 },
      abort: { op: "spiAbortIt", spi: "hspi1", instance: "SPI1", resultTarget: "abortStatus" },
      abortCallback: "HAL_SPI_AbortCpltCallback",
      completionCallback: "HAL_SPI_TxCpltCallback",
      history: "interrupts"
    },
    {
      name: "SPI DMA",
      bus: "spi",
      start: { op: "spiTransmitDma", spi: "hspi1", instance: "SPI1", buffer: "tx", length: 4 },
      abort: { op: "spiAbortIt", spi: "hspi1", instance: "SPI1", resultTarget: "abortStatus" },
      abortCallback: "HAL_SPI_AbortCpltCallback",
      completionCallback: "HAL_SPI_TxCpltCallback",
      history: "dma"
    }
  ];

  for (const scenario of cases) {
    const busEvents = [];
    const runtime = AliceFirmwareRuntime.create({
      variables: { tx: [1, 2, 3, 4], abortStatus: -1, abortDone: 0, transferDone: 0 },
      i2cs: { hi2c1: { handle: "hi2c1", instance: "I2C1", clockSpeed: 1000 } },
      spis: { hspi1: { handle: "hspi1", instance: "SPI1", baudRate: 1000 } },
      callbacks: {
        [scenario.abortCallback]: { operations: [{ op: "assign", target: "abortDone", value: literal(1) }] },
        [scenario.completionCallback]: { operations: [{ op: "assign", target: "transferDone", value: literal(1) }] }
      },
      program: { operations: [scenario.start, scenario.abort, { op: "delay", milliseconds: 100 }] }
    }, {
      onI2cTx(event) { if (scenario.bus === "i2c") busEvents.push(event); return { accepted: true }; },
      onSpiTx(event) { if (scenario.bus === "spi") busEvents.push(event); return { accepted: true }; }
    });

    runtime.start();
    const state = runtime.step(100);
    assert.equal(state.status, "completed", scenario.name);
    assert.equal(state.variables.abortStatus, 0, scenario.name);
    assert.equal(state.variables.abortDone, 1, scenario.name);
    assert.equal(state.variables.transferDone, 0, scenario.name);
    assert.equal(state.interrupts.events.some(event => event.active && event.bus === scenario.bus), false, scenario.name);
    assert.equal(state.dma.transfers.some(transfer => transfer.active && transfer.bus === scenario.bus), false, scenario.name);
    assert.equal(state[scenario.history].history.some(event => event.phase === "stopped"), true, scenario.name);
    assert.deepEqual(busEvents.map(event => event.kind), ["abort"], scenario.name);
  }
});

test("GPIO EXTI callbacks honor configured edges and callback parameter names", () => {
  const gpioEvents = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: {},
    pins: { PA0: { physicalPin: "PA0", interruptEdge: "rising" } },
    callbacks: {
      HAL_GPIO_EXTI_Callback: {
        parameters: ["selectedPin"],
        operations: [{
          op: "if",
          condition: eq(variable("selectedPin"), literal(1)),
          then: [{ op: "gpioToggle", pin: "PA5" }]
        }]
      }
    },
    program: { operations: [{ op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 100 }] }] }
  }, { onGpio: event => gpioEvents.push(event) });

  runtime.start();
  runtime.step(0);
  runtime.syncGpioInputs({ PA0: 0 });
  let state = runtime.syncGpioInputs({ PA0: 1 });
  assert.equal(state.gpio.PA5, 1);
  runtime.syncGpioInputs({ PA0: 0 });
  state = runtime.syncGpioInputs({ PA0: 1 });
  assert.equal(state.gpio.PA5, 0);
  assert.equal(gpioEvents.length, 2);
  assert.equal(state.interrupts.history.filter(event => event.type === "gpioExti").length, 2);
});

test("timer interrupt backlog drains across bounded steps", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { ticks: 0 },
    timers: { htim2: { handle: "htim2", instance: "TIM2", frequencyHz: 1000 } },
    callbacks: {
      HAL_TIM_PeriodElapsedCallback: {
        operations: [{ op: "assign", target: "ticks", value: { kind: "add", left: variable("ticks"), right: literal(1) } }]
      }
    },
    program: {
      operations: [
        { op: "timerStartIt", timer: "htim2", instance: "TIM2", frequencyHz: 1000 },
        { op: "while", condition: literal(true), body: [{ op: "delay", milliseconds: 2000 }] }
      ]
    }
  });

  runtime.start();
  runtime.step(0);
  let state = runtime.step(1000);
  assert.ok(state.pendingAdvanceMs > 0);
  while (state.pendingAdvanceMs > 0) state = runtime.step(0);
  assert.equal(state.variables.ticks, 1000);
  assert.equal(state.interrupts.history.length, 64);
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

test("interrupt and DMA starts on the same peripheral return HAL_BUSY symmetrically", () => {
  const dmaAfterIt = AliceFirmwareRuntime.create({
    variables: { samples: [0, 0], itStatus: 9, dmaStatus: 9 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", samplePeriodMs: 1 } },
    program: {
      operations: [
        { op: "adcStartIt", adc: "hadc1", instance: "ADC1", resultTarget: "itStatus" },
        { op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer: "samples", length: 2, resultTarget: "dmaStatus" },
        { op: "delay", milliseconds: 10 }
      ]
    }
  });
  dmaAfterIt.start();
  let state = dmaAfterIt.step(0);
  assert.equal(state.variables.itStatus, 0);
  assert.equal(state.variables.dmaStatus, 2);
  assert.equal(state.dma.transfers.filter(item => item.active).length, 0);

  const itAfterDma = AliceFirmwareRuntime.create({
    variables: { samples: [0, 0], dmaStatus: 9, itStatus: 9 },
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", samplePeriodMs: 1 } },
    program: {
      operations: [
        { op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer: "samples", length: 2, resultTarget: "dmaStatus" },
        { op: "adcStartIt", adc: "hadc1", instance: "ADC1", resultTarget: "itStatus" },
        { op: "delay", milliseconds: 10 }
      ]
    }
  });
  itAfterDma.start();
  state = itAfterDma.step(0);
  assert.equal(state.variables.dmaStatus, 0);
  assert.equal(state.variables.itStatus, 2);
  assert.equal(state.interrupts.events.filter(item => item.active).length, 0);
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

test("UART IT and DMA receive honor address and offset buffer expressions", () => {
  const addressOf = (value) => ({ kind: "addressOf", value });
  const arrayElement = (name, index) => ({ kind: "arrayIndex", name, index: literal(index) });

  const interruptRuntime = AliceFirmwareRuntime.create({
    variableTypes: { storage: "uint8_t" },
    variables: { storage: [0, 0, 0, 0] },
    program: {
      operations: [
        {
          op: "uartReceiveIt",
          uart: "huart2",
          instance: "USART2",
          buffer: addressOf(arrayElement("storage", 1)),
          length: literal(2)
        },
        { op: "delay", milliseconds: literal(1) }
      ]
    }
  });
  interruptRuntime.start();
  interruptRuntime.step(0);
  interruptRuntime.enqueueUart("USART2", [0x41]);
  let state = interruptRuntime.enqueueUart("USART2", [0x42]);
  assert.deepEqual(state.variables.storage, [0, 0x41, 0x42, 0]);

  const dmaRuntime = AliceFirmwareRuntime.create({
    variableTypes: { storage: "uint8_t", rx: "uint8_t*" },
    variables: {
      storage: [0, 0, 0, 0],
      rx: { __alicePointer: "variable", name: "storage", offset: 1, elementSize: 1, pointeeType: "uint8_t", unsigned: true }
    },
    callbacks: {
      HAL_UART_RxCpltCallback: { operations: [{ op: "assign", target: "done", value: literal(1) }] }
    },
    program: {
      operations: [
        { op: "uartReceiveDma", uart: "huart2", instance: "USART2", buffer: "rx", length: literal(2) },
        { op: "delay", milliseconds: literal(1) }
      ]
    }
  });
  // Callback variables are intentionally allowed to be introduced by the
  // model, matching the existing ad-hoc test fixtures.
  dmaRuntime.start();
  dmaRuntime.step(0);
  dmaRuntime.enqueueUart("USART2", [0x43]);
  state = dmaRuntime.enqueueUart("USART2", [0x44]);
  assert.deepEqual(state.variables.storage, [0, 0x43, 0x44, 0]);
  assert.equal(state.variables.done, 1);
});

test("ADC DMA writes through typed pointer and address-of offset buffers", () => {
  const makeModel = (buffer, variables) => ({
    variableTypes: { storage: "uint16_t", samples: "uint16_t*" },
    variables,
    adcs: { hadc1: { handle: "hadc1", instance: "ADC1", samplePeriodMs: 1 } },
    program: {
      operations: [
        { op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer, length: literal(2) },
        { op: "delay", milliseconds: literal(10) }
      ]
    }
  });
  const sampleHook = (event) => ({ value: event.sampleIndex ? 0x5678 : 0x1234 });

  let runtime = AliceFirmwareRuntime.create(makeModel("samples", {
    storage: [0, 0, 0, 0],
    samples: { __alicePointer: "variable", name: "storage", offset: 2, elementSize: 2, pointeeType: "uint16_t", unsigned: true }
  }), { onAdcRead: sampleHook });
  runtime.start();
  let state = runtime.step(2);
  assert.deepEqual(state.variables.storage, [0, 0x1234, 0x5678, 0]);

  runtime = AliceFirmwareRuntime.create(makeModel({
    kind: "addressOf",
    value: { kind: "arrayIndex", name: "storage", index: literal(1) }
  }, { storage: [9, 0, 0, 9] }), { onAdcRead: sampleHook });
  runtime.start();
  state = runtime.step(2);
  assert.deepEqual(state.variables.storage, [9, 0x1234, 0x5678, 9]);
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

test("HAL I2C and SPI receive operations write verified device bytes and preserve read metadata", () => {
  const i2cReads = [];
  const spiReads = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: {
      master: [0, 0],
      register: [0, 0, 0],
      spi: [0, 0],
      masterStatus: -1,
      registerStatus: -1,
      spiStatus: -1
    },
    i2cs: { hi2c1: { handle: "hi2c1", instance: "I2C1" } },
    spis: { hspi1: { handle: "hspi1", instance: "SPI1" } },
    program: {
      operations: [
        { op: "i2cMasterReceive", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x76, buffer: "master", length: 2, timeout: 10, resultTarget: "masterStatus" },
        { op: "i2cMemRead", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x76, memoryAddress: 0xd0, memoryAddressSize: 1, buffer: "register", length: 3, timeout: 10, resultTarget: "registerStatus" },
        { op: "spiReceive", spi: "hspi1", instance: "SPI1", buffer: "spi", length: 2, timeout: 10, resultTarget: "spiStatus" }
      ]
    }
  }, {
    onI2cRx(event) {
      i2cReads.push(event);
      return event.kind === "masterReceive"
        ? { accepted: true, bytes: [0x12, 0x34] }
        : { accepted: true, bytes: [0x58, 0x00, 0x01] };
    },
    onSpiRx(event) {
      spiReads.push(event);
      return { accepted: true, bytes: [0xef, 0x40] };
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.deepEqual(state.variables.master, [0x12, 0x34]);
  assert.deepEqual(state.variables.register, [0x58, 0x00, 0x01]);
  assert.deepEqual(state.variables.spi, [0xef, 0x40]);
  assert.equal(state.variables.masterStatus, 0);
  assert.equal(state.variables.registerStatus, 0);
  assert.equal(state.variables.spiStatus, 0);
  assert.equal(i2cReads.length, 2);
  assert.equal(i2cReads[1].memoryAddress, 0xd0);
  assert.equal(i2cReads[1].memoryAddressSize, 1);
  assert.equal(spiReads.length, 1);
  assert.deepEqual(state.i2cRx.map(event => event.kind), ["masterReceive", "memRead"]);
  assert.deepEqual(state.i2cRx[1].bytes, [0x58, 0x00, 0x01]);
  assert.deepEqual(state.spiRx[0].bytes, [0xef, 0x40]);
});

test("HAL bus receive rejects missing or short device responses without overwriting firmware buffers", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { i2cBuffer: [9, 9], spiBuffer: [8, 8], i2cStatus: -1, spiStatus: -1 },
    program: {
      operations: [
        { op: "i2cMasterReceive", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x76, buffer: "i2cBuffer", length: 2, resultTarget: "i2cStatus" },
        { op: "spiReceive", spi: "hspi1", instance: "SPI1", buffer: "spiBuffer", length: 2, resultTarget: "spiStatus" }
      ]
    }
  }, {
    onI2cRx() { return { accepted: false, reason: "not-connected" }; },
    onSpiRx() { return { accepted: true, bytes: [0x55] }; }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.equal(state.variables.i2cStatus, 1);
  assert.equal(state.variables.spiStatus, 1);
  assert.deepEqual(state.variables.i2cBuffer, [9, 9]);
  assert.deepEqual(state.variables.spiBuffer, [8, 8]);
  assert.equal(state.i2cRx[0].reason, "not-connected");
  assert.equal(state.spiRx[0].reason, "short-read");
});

test("HAL bus receive status calls can control firmware branches without duplicate reads", () => {
  let i2cCalls = 0;
  let spiCalls = 0;
  const runtime = AliceFirmwareRuntime.create({
    variables: { i2cBuffer: [0], spiBuffer: [0], i2cBranch: 0, spiBranch: 0 },
    program: {
      operations: [
        {
          op: "if",
          condition: eq(
            halCall({ op: "i2cMasterReceive", i2c: "hi2c1", instance: "I2C1", deviceAddress: 0x23, buffer: "i2cBuffer", length: 1 }),
            constant("HAL_OK")
          ),
          then: [{ op: "assign", target: "i2cBranch", value: literal(1) }]
        },
        {
          op: "if",
          condition: eq(
            halCall({ op: "spiReceive", spi: "hspi1", instance: "SPI1", buffer: "spiBuffer", length: 1 }),
            constant("HAL_OK")
          ),
          then: [{ op: "assign", target: "spiBranch", value: literal(1) }]
        }
      ]
    }
  }, {
    onI2cRx() { i2cCalls += 1; return { accepted: true, bytes: [0x5a] }; },
    onSpiRx() { spiCalls += 1; return { accepted: true, bytes: [0xa5] }; }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.variables.i2cBranch, 1);
  assert.equal(state.variables.spiBranch, 1);
  assert.deepEqual(state.variables.i2cBuffer, [0x5a]);
  assert.deepEqual(state.variables.spiBuffer, [0xa5]);
  assert.equal(i2cCalls, 1);
  assert.equal(spiCalls, 1);
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

test("snprintf formatting writes decimal millivolts and strlen drives UART length", () => {
  const uart = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: {
      adc1_mv10: 11000,
      adc2_mv10: 22005,
      oled_line: new Array(24).fill(0),
      uart_report: new Array(64).fill(0),
      report_length: 0
    },
    program: {
      operations: [
        {
          op: "formatString",
          buffer: "oled_line",
          capacity: { kind: "sizeOf", value: variable("oled_line") },
          format: { kind: "string", value: "PA0 %lu.%01lu mV" },
          arguments: [
            { kind: "div", left: variable("adc1_mv10"), right: literal(10) },
            { kind: "mod", left: variable("adc1_mv10"), right: literal(10) }
          ]
        },
        {
          op: "formatString",
          buffer: "uart_report",
          capacity: { kind: "sizeOf", value: variable("uart_report") },
          format: { kind: "string", value: "PA0=%lu.%01lumV PB0=%lu.%01lumV\r\n" },
          arguments: [
            { kind: "div", left: variable("adc1_mv10"), right: literal(10) },
            { kind: "mod", left: variable("adc1_mv10"), right: literal(10) },
            { kind: "div", left: variable("adc2_mv10"), right: literal(10) },
            { kind: "mod", left: variable("adc2_mv10"), right: literal(10) }
          ],
          resultTarget: "report_length"
        },
        {
          op: "uartTransmit",
          uart: "huart2",
          instance: "USART2",
          buffer: "uart_report",
          length: { kind: "stringLength", value: variable("uart_report") }
        }
      ]
    }
  }, {
    onUartTx(event) { uart.push(event); }
  });

  runtime.start();
  const state = runtime.step(0);
  const oledLength = state.variables.oled_line.indexOf(0);
  assert.equal(Buffer.from(state.variables.oled_line.slice(0, oledLength)).toString(), "PA0 1100.0 mV");
  assert.equal(uart.length, 1);
  assert.equal(uart[0].text, "PA0=1100.0mV PB0=2200.5mV\r\n");
  assert.equal(state.variables.report_length, uart[0].bytes.length);
});

test("snprintf writes to addressed array offsets without changing the prefix", () => {
  const runtime = AliceFirmwareRuntime.create({
    variableTypes: { line: "char" },
    variables: { line: [88, 88, 88, 0, 0, 0, 0, 0] },
    program: {
      operations: [{
        op: "formatString",
        buffer: {
          kind: "addressOf",
          value: { kind: "arrayIndex", name: "line", index: literal(3) }
        },
        capacity: literal(5),
        format: { kind: "string", value: "%s" },
        arguments: [{ kind: "string", value: "ADC" }]
      }]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.deepEqual(state.variables.line, [88, 88, 88, 65, 68, 67, 0, 0]);
});

test("printf formatting preserves non-finite values and emits C hex floats", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { line: new Array(128).fill(0) },
    program: {
      operations: [{
        op: "formatString",
        buffer: "line",
        capacity: literal(128),
        format: { kind: "string", value: "%f %+F %08g %.3a %.2A %#.0a %.1a" },
        arguments: [literal(NaN), literal(Infinity), literal(-Infinity), literal(1.5), literal(0.1), literal(1), literal(Number.MAX_VALUE)]
      }]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  const length = state.variables.line.indexOf(0);
  assert.equal(state.status, "completed", JSON.stringify(state.error));
  assert.equal(Buffer.from(state.variables.line.slice(0, length)).toString(), "nan +INF     -inf 0x1.800p+0 0X1.9AP-4 0x1.p+0 0x1.0p+1024");
});

test("printf pointer formatting is deterministic and preserves Alice pointer offsets", () => {
  const runtime = AliceFirmwareRuntime.create({
    heapBytes: 16,
    variableTypes: { heap: "char*", storage: "char" },
    variables: {
      heap: 0,
      storage: [1, 2, 3, 4],
      line: new Array(128).fill(0)
    },
    program: {
      operations: [
        { op: "heapAllocate", function: "malloc", size: literal(4), resultTarget: "heap" },
        {
          op: "formatString",
          buffer: "line",
          capacity: literal(128),
          format: { kind: "string", value: "%p %p %p %p %p" },
          arguments: [
            { kind: "addressOf", value: { kind: "arrayIndex", name: "storage", index: literal(0) } },
            { kind: "addressOf", value: { kind: "arrayIndex", name: "storage", index: literal(2) } },
            variable("heap"),
            variable("heap"),
            literal(0)
          ]
        }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  const length = state.variables.line.indexOf(0);
  const pointers = Buffer.from(state.variables.line.slice(0, length)).toString().split(" ");
  assert.equal(state.status, "completed", JSON.stringify(state.error));
  assert.match(pointers[0], /^0x2[0-9a-f]{7}$/);
  assert.equal(Number.parseInt(pointers[1], 16) - Number.parseInt(pointers[0], 16), 2);
  assert.match(pointers[2], /^0x3[0-9a-f]{7}$/);
  assert.equal(pointers[2], pointers[3]);
  assert.equal(pointers[4], "0x0");
});

test("printf integer widths, zero precision and alternate octal follow STM32 C rules", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { line: new Array(128).fill(0) },
    program: {
      operations: [{
        op: "formatString",
        buffer: "line",
        capacity: literal(128),
        format: { kind: "string", value: "%hhu %hhd %hu %hd %ld %zu %llu %.0u %#.0o %#.3o" },
        arguments: [257, 255, 65537, 65535, -1, 42, -1, 0, 0, 1].map(literal)
      }]
    }
  });
  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed", JSON.stringify(state.error));
  assert.equal(Buffer.from(state.variables.line.slice(0, state.variables.line.indexOf(0))).toString(),
    "1 -1 1 -1 -1 42 18446744073709551615  0 001");
});

test("snprintf respects fixed array bounds and returns the untruncated length", () => {
  for (const [capacity, expectedStatus, expectedBytes] of [
    [0, "completed", [88, 88, 88, 88]],
    [4, "completed", [72, 69, 76, 0]],
    [8, "error", [88, 88, 88, 88]]
  ]) {
    const runtime = AliceFirmwareRuntime.create({
      variables: { line: [88, 88, 88, 88], result: -1 },
      program: { operations: [{
        op: "formatString", buffer: "line", capacity: literal(capacity),
        format: { kind: "string", value: "HELLO" }, arguments: [], resultTarget: "result"
      }] }
    });
    runtime.start();
    const state = runtime.step(0);
    assert.equal(state.status, expectedStatus, JSON.stringify(state.error));
    assert.deepEqual(state.variables.line, expectedBytes);
    if (expectedStatus === "completed") assert.equal(state.variables.result, 5);
    else assert.match(state.error.message, /out of bounds/);
  }
});

test("printf rejects unknown, unsupported and incomplete conversions", () => {
  for (const [format, expected] of [
    ["value=%q", /Unsupported printf conversion: %q/],
    ["count=%n", /Unsupported printf conversion: %n/],
    ["wide=%ls", /Unsupported printf conversion: %ls/],
    ["trailing%", /Incomplete printf conversion/]
  ]) {
    const runtime = AliceFirmwareRuntime.create({
      variables: { line: new Array(32).fill(0) },
      program: {
        operations: [{
          op: "formatString",
          buffer: "line",
          capacity: literal(32),
          format: { kind: "string", value: format },
          arguments: [literal(1)]
        }]
      }
    });

    runtime.start();
    const state = runtime.step(0);
    assert.equal(state.status, "error");
    assert.match(state.error.message, expected);
  }
});

test("C floating literals, casts and division preserve ADC millivolt decimals", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { raw: 2048, millivolts: 0, line: new Array(32).fill(0) },
    variableTypes: { raw: "uint32_t", millivolts: "float" },
    program: {
      operations: [
        {
          op: "assign",
          target: "millivolts",
          value: {
            kind: "div",
            left: {
              kind: "mul",
              left: { kind: "cast", cType: "float", value: variable("raw") },
              right: { kind: "literal", value: 3300, numericType: "float" }
            },
            right: { kind: "literal", value: 4095, numericType: "float" }
          }
        },
        {
          op: "formatString",
          buffer: "line",
          capacity: literal(32),
          format: { kind: "string", value: "%.2f mV" },
          arguments: [variable("millivolts")]
        }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  const lineLength = state.variables.line.indexOf(0);
  assert.equal(Buffer.from(state.variables.line.slice(0, lineLength)).toString(), "1650.40 mV");
  assert.ok(Math.abs(state.variables.millivolts - 1650.4029) < 0.001);
});

test("unsupported expression errors include the original C text", () => {
  const runtime = AliceFirmwareRuntime.create({
    program: {
      operations: [{
        op: "assign",
        target: "value",
        value: { kind: "expression", text: "raw ? 1U : 0U" },
        source: { file: "Core/Src/main.c", line: 7, column: 3 }
      }]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "error");
  assert.match(state.error.message, /raw \? 1U : 0U/);
  assert.deepEqual(state.error.source, { file: "Core/Src/main.c", line: 7, column: 3 });
});

test("stdio string stdlib and heap operations preserve C behavior", () => {
  const stdio = [];
  const runtime = AliceFirmwareRuntime.create({
    heapBytes: 64,
    variableTypes: { heap_value: "int*", compare_result: "int", parsed_value: "int" },
    variables: {
      source_text: [97, 98, 99, 0, 0, 0, 0, 0],
      destination: new Array(16).fill(0),
      heap_value: 0,
      compare_result: 9,
      parsed_value: 0,
      scanned_value: 0,
      scanned_voltage: 0,
      scan_count: 0
    },
    program: {
      operations: [
        { op: "libcMemory", function: "memset", arguments: [variable("destination"), literal(0), literal(16)] },
        { op: "libcMemory", function: "strcpy", arguments: [variable("destination"), variable("source_text")] },
        { op: "libcMemory", function: "strcat", arguments: [variable("destination"), { kind: "string", value: "!" }] },
        { op: "assign", target: "compare_result", value: { kind: "libcCall", function: "strcmp", arguments: [variable("destination"), { kind: "string", value: "abc!" }] } },
        { op: "assign", target: "parsed_value", value: { kind: "libcCall", function: "atoi", arguments: [{ kind: "string", value: "1234" }] } },
        {
          op: "stdioScan",
          input: { kind: "string", value: "17 2.5" },
          format: { kind: "string", value: "%d %f" },
          targets: [
            { kind: "addressOf", value: variable("scanned_value") },
            { kind: "addressOf", value: variable("scanned_voltage") }
          ],
          resultTarget: "scan_count"
        },
        { op: "heapAllocate", function: "malloc", size: literal(4), resultTarget: "heap_value" },
        { op: "assign", target: { kind: "dereference", pointer: variable("heap_value") }, value: variable("parsed_value") },
        {
          op: "stdioWrite",
          function: "printf",
          format: { kind: "string", value: "heap=%d %s\n" },
          arguments: [
            { kind: "dereference", pointer: variable("heap_value") },
            variable("destination")
          ]
        },
        { op: "stdioWrite", function: "puts", stream: "stdout", data: { kind: "string", value: "done" }, newline: true },
        { op: "heapFree", pointer: variable("heap_value") }
      ]
    }
  }, {
    onStdio(event) { stdio.push(event); }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(Buffer.from(state.variables.destination.slice(0, 4)).toString(), "abc!");
  assert.equal(state.variables.compare_result, 0);
  assert.equal(state.variables.parsed_value, 1234);
  assert.equal(state.variables.scanned_value, 17);
  assert.equal(state.variables.scanned_voltage, 2.5);
  assert.equal(state.variables.scan_count, 2);
  assert.deepEqual(stdio.map(event => event.text), ["heap=1234 abc!\n", "done\n"]);
  assert.equal(state.heap.usedBytes, 0);
  assert.equal(state.heap.peakBytes, 4);
});

test("bounded string inspection reads raw bytes only until its C stopping point", () => {
  const runtime = AliceFirmwareRuntime.create({
    heapBytes: 8,
    variableTypes: {
      terminated: "char*",
      unterminated: "char*"
    },
    variables: {
      highLeft: [0x80, 0],
      highRight: [0x81, 0],
      oneByteLeft: [0x41],
      oneByteRight: [0x41],
      terminated: 0,
      unterminated: 0,
      rawCompare: 0,
      earlyCompare: 0,
      oneByteCompare: 1,
      terminatedLength: 0,
      boundedLength: 0
    },
    program: {
      operations: [
        { op: "assign", target: "rawCompare", value: { kind: "libcCall", function: "strcmp", arguments: [variable("highLeft"), variable("highRight")] } },
        { op: "assign", target: "earlyCompare", value: { kind: "libcCall", function: "strncmp", arguments: [variable("highLeft"), variable("highRight"), literal(32)] } },
        { op: "assign", target: "oneByteCompare", value: { kind: "libcCall", function: "strncmp", arguments: [variable("oneByteLeft"), variable("oneByteRight"), literal(1)] } },
        { op: "heapAllocate", function: "malloc", size: literal(2), resultTarget: "terminated" },
        { op: "assign", target: { kind: "dereference", pointer: variable("terminated") }, value: literal(0x41) },
        { op: "assign", target: { kind: "dereference", pointer: { kind: "add", left: variable("terminated"), right: literal(1) } }, value: literal(0) },
        { op: "assign", target: "terminatedLength", value: { kind: "libcCall", function: "strnlen", arguments: [variable("terminated"), literal(100)] } },
        { op: "heapAllocate", function: "malloc", size: literal(2), resultTarget: "unterminated" },
        { op: "assign", target: { kind: "dereference", pointer: variable("unterminated") }, value: literal(0x42) },
        { op: "assign", target: { kind: "dereference", pointer: { kind: "add", left: variable("unterminated"), right: literal(1) } }, value: literal(0x43) },
        { op: "assign", target: "boundedLength", value: { kind: "libcCall", function: "strnlen", arguments: [variable("unterminated"), literal(2)] } }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed", JSON.stringify(state.error));
  assert.ok(state.variables.rawCompare < 0);
  assert.ok(state.variables.earlyCompare < 0);
  assert.equal(state.variables.oneByteCompare, 0);
  assert.equal(state.variables.terminatedLength, 1);
  assert.equal(state.variables.boundedLength, 2);
});

test("strncpy and strncat honor bounded non-terminated sources and C padding", () => {
  const runtime = AliceFirmwareRuntime.create({
    heapBytes: 8,
    variableTypes: {
      copySource: "char*",
      concatSource: "char*"
    },
    variables: {
      copySource: 0,
      concatSource: 0,
      copied: new Array(5).fill(0x55),
      padded: new Array(5).fill(0x55),
      combined: [0x58, 0, 0x55, 0x55, 0x55]
    },
    program: {
      operations: [
        { op: "heapAllocate", function: "malloc", size: literal(3), resultTarget: "copySource" },
        { op: "assign", target: { kind: "dereference", pointer: variable("copySource") }, value: literal(0x41) },
        { op: "assign", target: { kind: "dereference", pointer: { kind: "add", left: variable("copySource"), right: literal(1) } }, value: literal(0x42) },
        { op: "assign", target: { kind: "dereference", pointer: { kind: "add", left: variable("copySource"), right: literal(2) } }, value: literal(0x43) },
        { op: "libcMemory", function: "strncpy", arguments: [variable("copied"), variable("copySource"), literal(3)] },
        { op: "libcMemory", function: "strncpy", arguments: [variable("padded"), { kind: "string", value: "A" }, literal(4)] },
        { op: "heapAllocate", function: "malloc", size: literal(2), resultTarget: "concatSource" },
        { op: "assign", target: { kind: "dereference", pointer: variable("concatSource") }, value: literal(0x59) },
        { op: "assign", target: { kind: "dereference", pointer: { kind: "add", left: variable("concatSource"), right: literal(1) } }, value: literal(0x5a) },
        { op: "libcMemory", function: "strncat", arguments: [variable("combined"), variable("concatSource"), literal(2)] }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed", JSON.stringify(state.error));
  assert.deepEqual(state.variables.copied, [0x41, 0x42, 0x43, 0x55, 0x55]);
  assert.deepEqual(state.variables.padded, [0x41, 0, 0, 0, 0x55]);
  assert.deepEqual(state.variables.combined, [0x58, 0x59, 0x5a, 0, 0x55]);
});

test("declared math and string helpers execute with C-compatible results", () => {
  const source = Array.from(Buffer.from("alpha,beta;gamma\0"));
  const runtime = AliceFirmwareRuntime.create({
    variableTypes: {
      source: "char",
      found: "char*",
      token1: "char*",
      token2: "char*",
      token3: "char*",
      token4: "char*",
      message: "char*",
      integerEnd: "char*",
      floatEnd: "char*",
      exponent: "int",
      integral: "double",
      nanValue: "double",
      negativeZero: "double",
      infiniteValue: "float",
      heapFloat: "float*",
      heapNan: "float",
      piMacro: "double",
      eofMacro: "int",
      randMaxMacro: "int"
    },
    variables: {
      source,
      found: 0,
      foundByte: 0,
      token1: 0,
      token2: 0,
      token3: 0,
      token4: 1,
      firstMatches: 1,
      secondMatches: 1,
      thirdMatches: 1,
      message: 0,
      messageMatches: 1,
      integerEnd: 0,
      floatEnd: 0,
      parsedOctal: 0,
      parseTail: 0,
      parsedFloat: 0,
      floatTail: 0,
      eofUpper: 0,
      highByteUpper: 0,
      highByteSpace: 1,
      ceiling: 0,
      floatingDivision: 0,
      hyperbolic: 0,
      powerOfTwo: 0,
      binaryLog: 0,
      cubeRoot: 0,
      nearbyEven: 0,
      rintEven: 0,
      roundedAway: 0,
      ieeeRemainder: 0,
      exponent: 0,
      fraction: 0,
      integral: 0,
      fractional: 0,
      nanValue: 0,
      negativeZero: 0,
      infiniteValue: 0,
      heapFloat: 0,
      heapNan: 0,
      piMacro: 0,
      eofMacro: 0,
      randMaxMacro: 0
    },
    program: {
      operations: [
        { op: "assign", target: "found", value: { kind: "libcCall", function: "memchr", arguments: [variable("source"), literal("p".charCodeAt(0)), literal(source.length)] } },
        { op: "assign", target: "foundByte", value: { kind: "dereference", pointer: variable("found") } },
        { op: "assign", target: "token1", value: { kind: "libcCall", function: "strtok", arguments: [variable("source"), { kind: "string", value: ",;" }] } },
        { op: "assign", target: "token2", value: { kind: "libcCall", function: "strtok", arguments: [literal(0), { kind: "string", value: ",;" }] } },
        { op: "assign", target: "token3", value: { kind: "libcCall", function: "strtok", arguments: [literal(0), { kind: "string", value: ",;" }] } },
        { op: "assign", target: "token4", value: { kind: "libcCall", function: "strtok", arguments: [literal(0), { kind: "string", value: ",;" }] } },
        { op: "assign", target: "firstMatches", value: { kind: "libcCall", function: "strcmp", arguments: [variable("token1"), { kind: "string", value: "alpha" }] } },
        { op: "assign", target: "secondMatches", value: { kind: "libcCall", function: "strcmp", arguments: [variable("token2"), { kind: "string", value: "beta" }] } },
        { op: "assign", target: "thirdMatches", value: { kind: "libcCall", function: "strcmp", arguments: [variable("token3"), { kind: "string", value: "gamma" }] } },
        { op: "assign", target: "message", value: { kind: "libcCall", function: "strerror", arguments: [literal(22)] } },
        { op: "assign", target: "messageMatches", value: { kind: "libcCall", function: "strcmp", arguments: [variable("message"), { kind: "string", value: "Invalid argument" }] } },
        { op: "assign", target: "parsedOctal", value: { kind: "libcCall", function: "strtol", arguments: [{ kind: "string", value: " 010tail" }, { kind: "addressOf", value: variable("integerEnd") }, literal(0)] } },
        { op: "assign", target: "parseTail", value: { kind: "dereference", pointer: variable("integerEnd") } },
        { op: "assign", target: "parsedFloat", value: { kind: "libcCall", function: "strtof", arguments: [{ kind: "string", value: "1.5V" }, { kind: "addressOf", value: variable("floatEnd") }] } },
        { op: "assign", target: "floatTail", value: { kind: "dereference", pointer: variable("floatEnd") } },
        { op: "assign", target: "eofUpper", value: { kind: "libcCall", function: "toupper", arguments: [literal(-1)] } },
        { op: "assign", target: "highByteUpper", value: { kind: "libcCall", function: "toupper", arguments: [literal(0xe0)] } },
        { op: "assign", target: "highByteSpace", value: { kind: "libcCall", function: "isspace", arguments: [literal(0xa0)] } },
        { op: "assign", target: "ceiling", value: { kind: "libcCall", function: "ceil", arguments: [literal(1.2)] } },
        { op: "assign", target: "floatingDivision", value: { kind: "div", left: { kind: "libcCall", function: "hypot", arguments: [literal(3), literal(4)] }, right: literal(2) } },
        { op: "assign", target: "hyperbolic", value: { kind: "libcCall", function: "cosh", arguments: [literal(0)] } },
        { op: "assign", target: "powerOfTwo", value: { kind: "libcCall", function: "exp2", arguments: [literal(3)] } },
        { op: "assign", target: "binaryLog", value: { kind: "libcCall", function: "log2", arguments: [literal(8)] } },
        { op: "assign", target: "cubeRoot", value: { kind: "libcCall", function: "cbrt", arguments: [literal(27)] } },
        { op: "assign", target: "nearbyEven", value: { kind: "libcCall", function: "nearbyint", arguments: [literal(2.5)] } },
        { op: "assign", target: "rintEven", value: { kind: "libcCall", function: "rint", arguments: [literal(3.5)] } },
        { op: "assign", target: "roundedAway", value: { kind: "libcCall", function: "round", arguments: [literal(-1.5)] } },
        { op: "assign", target: "ieeeRemainder", value: { kind: "libcCall", function: "remainder", arguments: [literal(7), literal(2)] } },
        { op: "assign", target: "fraction", value: { kind: "libcCall", function: "frexp", arguments: [literal(8), { kind: "addressOf", value: variable("exponent") }] } },
        { op: "assign", target: "fractional", value: { kind: "libcCall", function: "modf", arguments: [literal(-2.75), { kind: "addressOf", value: variable("integral") }] } },
        { op: "assign", target: "nanValue", value: { kind: "constant", name: "NAN" } },
        { op: "assign", target: "negativeZero", value: { kind: "libcCall", function: "copysign", arguments: [literal(0), literal(-1)] } },
        { op: "assign", target: "infiniteValue", value: { kind: "constant", name: "INFINITY" } },
        { op: "heapAllocate", function: "malloc", size: literal(4), resultTarget: "heapFloat" },
        { op: "assign", target: { kind: "dereference", pointer: variable("heapFloat") }, value: { kind: "constant", name: "NAN" } },
        { op: "assign", target: "heapNan", value: { kind: "dereference", pointer: variable("heapFloat") } },
        { op: "assign", target: "piMacro", value: { kind: "constant", name: "M_PI" } },
        { op: "assign", target: "eofMacro", value: { kind: "constant", name: "EOF" } },
        { op: "assign", target: "randMaxMacro", value: { kind: "constant", name: "RAND_MAX" } }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed", JSON.stringify(state.error));
  assert.equal(state.variables.foundByte, "p".charCodeAt(0));
  assert.equal(state.variables.token4, 0);
  assert.equal(state.variables.firstMatches, 0);
  assert.equal(state.variables.secondMatches, 0);
  assert.equal(state.variables.thirdMatches, 0);
  assert.equal(state.variables.messageMatches, 0);
  assert.equal(state.variables.parsedOctal, 8);
  assert.equal(state.variables.parseTail, "t".charCodeAt(0));
  assert.equal(state.variables.parsedFloat, 1.5);
  assert.equal(state.variables.floatTail, "V".charCodeAt(0));
  assert.equal(state.variables.eofUpper, -1);
  assert.equal(state.variables.highByteUpper, 0xe0);
  assert.equal(state.variables.highByteSpace, 0);
  assert.equal(state.variables.ceiling, 2);
  assert.equal(state.variables.floatingDivision, 2.5);
  assert.equal(state.variables.hyperbolic, 1);
  assert.equal(state.variables.powerOfTwo, 8);
  assert.equal(state.variables.binaryLog, 3);
  assert.equal(state.variables.cubeRoot, 3);
  assert.equal(state.variables.nearbyEven, 2);
  assert.equal(state.variables.rintEven, 4);
  assert.equal(state.variables.roundedAway, -2);
  assert.equal(state.variables.ieeeRemainder, -1);
  assert.equal(state.variables.exponent, 4);
  assert.equal(state.variables.fraction, 0.5);
  assert.equal(state.variables.integral, -2);
  assert.equal(state.variables.fractional, -0.75);
  assert.ok(Number.isNaN(state.variables.nanValue));
  assert.ok(Object.is(state.variables.negativeZero, -0));
  assert.equal(state.variables.infiniteValue, Infinity);
  assert.ok(Number.isNaN(state.variables.heapNan));
  assert.equal(state.variables.piMacro, Math.PI);
  assert.equal(state.variables.eofMacro, -1);
  assert.equal(state.variables.randMaxMacro, 0x7fffffff);
});

test("srand accepts zero as a real seed", () => {
  function randomAfterSeed(seed) {
    const runtime = AliceFirmwareRuntime.create({
      variables: { result: 0 },
      program: {
        operations: [
          { op: "libcSeed", seed: literal(seed) },
          { op: "assign", target: "result", value: { kind: "libcCall", function: "rand", arguments: [] } }
        ]
      }
    });
    runtime.start();
    return runtime.step(0).variables.result;
  }

  assert.equal(randomAfterSeed(0), 12345);
  assert.notEqual(randomAfterSeed(0), randomAfterSeed(1));
});

test("sscanf consumes whitespace per conversion and preserves partial assignments", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: {
      compact_left: 0,
      compact_right: 0,
      compact_count: 0,
      signed_value: 0,
      word: new Array(8).fill(0),
      spaced_count: 0,
      partial_value: 0,
      untouched_value: 99,
      partial_count: 0,
      eof_count: 0,
      mismatch_count: 0
    },
    program: {
      operations: [
        {
          op: "stdioScan",
          input: { kind: "string", value: "12,34 trailing input" },
          format: { kind: "string", value: "%d , %d" },
          targets: [
            { kind: "addressOf", value: variable("compact_left") },
            { kind: "addressOf", value: variable("compact_right") }
          ],
          resultTarget: "compact_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "\t-7 \nname" },
          format: { kind: "string", value: "%d%s" },
          targets: [
            { kind: "addressOf", value: variable("signed_value") },
            { kind: "addressOf", value: variable("word") }
          ],
          resultTarget: "spaced_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "41 nope" },
          format: { kind: "string", value: "%d %d" },
          targets: [
            { kind: "addressOf", value: variable("partial_value") },
            { kind: "addressOf", value: variable("untouched_value") }
          ],
          resultTarget: "partial_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "" },
          format: { kind: "string", value: "%d" },
          targets: [{ kind: "addressOf", value: variable("partial_value") }],
          resultTarget: "eof_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "not-a-number" },
          format: { kind: "string", value: "%d" },
          targets: [{ kind: "addressOf", value: variable("partial_value") }],
          resultTarget: "mismatch_count"
        }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  const wordLength = state.variables.word.indexOf(0);

  assert.equal(state.status, "completed");
  assert.deepEqual([state.variables.compact_left, state.variables.compact_right, state.variables.compact_count], [12, 34, 2]);
  assert.equal(state.variables.signed_value, -7);
  assert.equal(Buffer.from(state.variables.word.slice(0, wordLength)).toString(), "name");
  assert.equal(state.variables.spaced_count, 2);
  assert.equal(state.variables.partial_value, 41);
  assert.equal(state.variables.untouched_value, 99);
  assert.equal(state.variables.partial_count, 1);
  assert.equal(state.variables.eof_count, -1);
  assert.equal(state.variables.mismatch_count, 0);
});

test("sscanf supports scansets, field widths, suppressed fields and percent-n", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: {
      channel: new Array(9).fill(0),
      suffix: new Array(5).fill(0),
      channel_count: 0,
      channel_consumed: 0,
      letters: new Array(4).fill(0),
      range_count: 0,
      range_consumed: 0,
      first_character: new Array(1).fill(0),
      next_characters: new Array(2).fill(0),
      character_count: 0,
      character_consumed: 0,
      leading_scanset: new Array(5).fill(0),
      leading_scanset_count: 0,
      selected_value: 0,
      suppressed_count: 0,
      suppressed_consumed: 0,
      narrow_value: 0,
      narrow_count: 0,
      narrow_consumed: 0,
      whitespace_value: 0,
      whitespace_count: 0,
      whitespace_consumed: 0
    },
    program: {
      operations: [
        {
          op: "stdioScan",
          input: { kind: "string", value: "sensor-A,rest+extra" },
          format: { kind: "string", value: "%8[^,],%4s%n" },
          targets: [
            { kind: "addressOf", value: variable("channel") },
            { kind: "addressOf", value: variable("suffix") },
            { kind: "addressOf", value: variable("channel_consumed") }
          ],
          resultTarget: "channel_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "abc123" },
          format: { kind: "string", value: "%3[a-z]%*3[0-9]%n" },
          targets: [
            { kind: "addressOf", value: variable("letters") },
            { kind: "addressOf", value: variable("range_consumed") }
          ],
          resultTarget: "range_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: " xy" },
          format: { kind: "string", value: "%c%2c%n" },
          targets: [
            { kind: "addressOf", value: variable("first_character") },
            { kind: "addressOf", value: variable("next_characters") },
            { kind: "addressOf", value: variable("character_consumed") }
          ],
          resultTarget: "character_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: " abc,tail" },
          format: { kind: "string", value: "%4[^,]" },
          targets: [{ kind: "addressOf", value: variable("leading_scanset") }],
          resultTarget: "leading_scanset_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "10,20" },
          format: { kind: "string", value: "%*d,%d%n" },
          targets: [
            { kind: "addressOf", value: variable("selected_value") },
            { kind: "addressOf", value: variable("suppressed_consumed") }
          ],
          resultTarget: "suppressed_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "1234" },
          format: { kind: "string", value: "%2d%n" },
          targets: [
            { kind: "addressOf", value: variable("narrow_value") },
            { kind: "addressOf", value: variable("narrow_consumed") }
          ],
          resultTarget: "narrow_count"
        },
        {
          op: "stdioScan",
          input: { kind: "string", value: "7   " },
          format: { kind: "string", value: "%d%n" },
          targets: [
            { kind: "addressOf", value: variable("whitespace_value") },
            { kind: "addressOf", value: variable("whitespace_consumed") }
          ],
          resultTarget: "whitespace_count"
        }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  const cStringFrom = name => Buffer.from(state.variables[name].slice(0, state.variables[name].indexOf(0))).toString();

  assert.equal(state.status, "completed");
  assert.equal(cStringFrom("channel"), "sensor-A");
  assert.equal(cStringFrom("suffix"), "rest");
  assert.deepEqual([state.variables.channel_count, state.variables.channel_consumed], [2, 13]);
  assert.equal(cStringFrom("letters"), "abc");
  assert.deepEqual([state.variables.range_count, state.variables.range_consumed], [1, 6]);
  assert.deepEqual(state.variables.first_character, [32]);
  assert.deepEqual(state.variables.next_characters, [120, 121]);
  assert.deepEqual([state.variables.character_count, state.variables.character_consumed], [2, 3]);
  assert.equal(cStringFrom("leading_scanset"), " abc");
  assert.equal(state.variables.leading_scanset_count, 1);
  assert.deepEqual([state.variables.selected_value, state.variables.suppressed_count, state.variables.suppressed_consumed], [20, 1, 5]);
  assert.deepEqual([state.variables.narrow_value, state.variables.narrow_count, state.variables.narrow_consumed], [12, 1, 2]);
  assert.deepEqual([state.variables.whitespace_value, state.variables.whitespace_count, state.variables.whitespace_consumed], [7, 1, 1]);
});

test("freed heap memory cannot be dereferenced", () => {
  const runtime = AliceFirmwareRuntime.create({
    heapBytes: 16,
    variables: { pointer: 0, result: 0 },
    program: {
      operations: [
        { op: "heapAllocate", function: "calloc", count: literal(1), size: literal(4), resultTarget: "pointer" },
        { op: "heapFree", pointer: variable("pointer") },
        { op: "assign", target: "result", value: { kind: "dereference", pointer: variable("pointer") } }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "error");
  assert.match(state.error.message, /freed or invalid memory/);
});

test("typed heap pointer indexing uses the C element width", () => {
  const runtime = AliceFirmwareRuntime.create({
    heapBytes: 16,
    variableTypes: { pointer: "int*", result: "int" },
    variables: { pointer: 0, result: 0 },
    program: {
      operations: [
        { op: "heapAllocate", function: "calloc", count: literal(2), size: literal(4), resultTarget: "pointer" },
        { op: "assign", target: { kind: "arrayIndex", name: "pointer", index: literal(1) }, value: literal(1000) },
        { op: "assign", target: "result", value: { kind: "arrayIndex", name: "pointer", index: literal(1) } }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.equal(state.variables.result, 1000);
  assert.deepEqual(state.heap.allocations["1"].bytes, [0, 0, 0, 0, 0xe8, 0x03, 0, 0]);
});

test("typed variable pointers use byte offsets and sizeof follows C object widths", () => {
  const runtime = AliceFirmwareRuntime.create({
    variableTypes: {
      samples: "uint16_t",
      cursor: "uint16_t*",
      count: "size_t",
      elementBytes: "size_t",
      arrayBytes: "size_t",
      pointedBytes: "size_t",
      pointedValue: "uint16_t"
    },
    variables: {
      samples: [11, 22, 33, 44],
      cursor: 0,
      count: 0,
      elementBytes: 0,
      arrayBytes: 0,
      pointedBytes: 0,
      pointedValue: 0
    },
    program: {
      operations: [
        { op: "assign", target: "count", value: { kind: "div", left: { kind: "sizeOf", value: variable("samples") }, right: { kind: "sizeOf", value: { kind: "arrayIndex", name: "samples", index: 0 } } } },
        { op: "assign", target: "elementBytes", value: { kind: "sizeOf", cType: "uint16_t" } },
        { op: "assign", target: "arrayBytes", value: { kind: "sizeOf", value: variable("samples") } },
        { op: "assign", target: "cursor", value: { kind: "addressOf", value: { kind: "arrayIndex", name: "samples", index: 0 } } },
        { op: "assign", target: "cursor", value: { kind: "add", left: variable("cursor"), right: literal(2) } },
        { op: "assign", target: "pointedValue", value: { kind: "dereference", pointer: variable("cursor") } },
        { op: "assign", target: "pointedBytes", value: { kind: "sub", left: variable("cursor"), right: { kind: "addressOf", value: { kind: "arrayIndex", name: "samples", index: 0 } } } }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.equal(state.variables.count, 4);
  assert.equal(state.variables.elementBytes, 2);
  assert.equal(state.variables.arrayBytes, 8);
  assert.equal(state.variables.pointedValue, 33);
  assert.equal(state.variables.pointedBytes, 2);
});

test("sizeof does not execute increments or HAL calls in its operand", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { index: 0, incrementWidth: 0, halWidth: 0 },
    program: {
      operations: [
        {
          op: "assign",
          target: "incrementWidth",
          value: { kind: "sizeOf", value: { kind: "postIncrement", target: variable("index") } }
        },
        {
          op: "assign",
          target: "halWidth",
          value: {
            kind: "sizeOf",
            value: {
              kind: "halCall",
              operation: { op: "adcStart", adc: "hadc1", instance: "ADC1" },
              returnKind: "status"
            }
          }
        }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.index, 0);
  assert.equal(state.variables.incrementWidth, 4);
  assert.equal(state.variables.halWidth, 4);
  assert.equal(state.adc.ADC1, undefined);
});

test("standalone expression statements execute once and advance", () => {
  const runtime = AliceFirmwareRuntime.create({
    variables: { index: 0 },
    program: {
      operations: [
        { op: "expression", expression: { kind: "postIncrement", target: variable("index") } },
        { op: "return", value: variable("index") }
      ]
    }
  });

  runtime.start();
  const state = runtime.step(0);

  assert.equal(state.status, "completed");
  assert.equal(state.variables.index, 1);
  assert.equal(state.returnValue, 1);
});

test("HAL transfers read pointer and literal buffer expressions", () => {
  const uart = [];
  const runtime = AliceFirmwareRuntime.create({
    variables: { frame: [65, 66, 67, 0], offset: 1 },
    program: {
      operations: [
        { op: "uartTransmit", uart: "huart2", buffer: { kind: "string", value: "OK" }, length: literal(2) },
        {
          op: "uartTransmit",
          uart: "huart2",
          buffer: { kind: "addressOf", value: { kind: "arrayIndex", name: "frame", index: variable("offset") } },
          length: literal(2)
        }
      ]
    }
  }, { onUartTx(event) { uart.push(event); } });

  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.deepEqual(uart.map((event) => event.text), ["OK", "BC"]);
});

test("UART receive and snprintf honor pointer-valued buffer variables", () => {
  const uart = [];
  const runtime = AliceFirmwareRuntime.create({
    variableTypes: { rx: "uint8_t*", line: "char*" },
    variables: {
      storage: [0, 0, 0, 0],
      rx: { __alicePointer: "variable", name: "storage", offset: 1, elementSize: 1, pointeeType: "uint8_t", unsigned: true },
      lineStorage: new Array(12).fill(0),
      line: { __alicePointer: "variable", name: "lineStorage", offset: 2, elementSize: 1, pointeeType: "char", unsigned: false }
    },
    program: {
      operations: [
        { op: "uartReceive", instance: "USART2", buffer: "rx", length: literal(2), timeout: literal(0) },
        { op: "formatString", buffer: "line", capacity: literal(8), format: { kind: "string", value: "OK" }, arguments: [] }
      ]
    }
  }, { onUartTx(event) { uart.push(event); } });

  runtime.start();
  runtime.enqueueUart("USART2", [65, 66]);
  const state = runtime.step(0);
  assert.equal(state.status, "completed");
  assert.deepEqual(state.variables.storage, [0, 65, 66, 0]);
  assert.deepEqual(state.variables.lineStorage.slice(2, 5), [79, 75, 0]);
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
