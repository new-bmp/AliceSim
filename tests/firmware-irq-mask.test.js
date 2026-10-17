"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const runtimeApi = require("../firmware-runtime.js");
const literal = value => ({kind: "literal", value});
const variable = name => ({kind: "variable", name});
const increment = target => ({op: "assign", target, value: {kind: "add", left: variable(target), right: literal(1)}});
const idle = {op: "while", condition: literal(true), body: [{op: "delay", milliseconds: 100}]};
const readMask = target => ({op: "assign", target, value: {kind: "irqMask"}});

test("PRIMASK defers and coalesces timer and EXTI callbacks until enable", () => {
  const callbacks = [];
  const runtime = runtimeApi.create({
    variables: {ticks: 0, edges: 0, enteredAt: 0, seenPin: 0},
    pins: {PA0: {interruptEdge: "both"}},
    timers: {htim2: {instance: "TIM2", frequencyHz: 500}},
    callbacks: {
      HAL_TIM_PeriodElapsedCallback: {operations: [increment("ticks"), {op: "assign", target: "enteredAt", value: {kind: "tick"}}]},
      HAL_GPIO_EXTI_Callback: {parameters: ["selectedPin"], operations: [increment("edges"), {op: "assign", target: "seenPin", value: variable("selectedPin")}]}
    },
    program: {operations: [
      {op: "irqDisable"}, {op: "timerStartIt", timer: "htim2", instance: "TIM2"},
      {op: "delay", milliseconds: 5}, {op: "irqEnable"}, idle
    ]}
  }, {onInterruptCallback: event => callbacks.push(event)});
  runtime.start();
  runtime.step(0);
  runtime.syncGpioInputs({PA0: 0});
  runtime.syncGpioInputs({PA0: 1});
  runtime.syncGpioInputs({PA0: 0});
  let state = runtime.step(4);
  assert.equal(state.variables.edges, 0);
  assert.equal(state.variables.ticks, 0);
  assert.equal(callbacks.length, 0, "callback hooks also represent serviced interrupts, not pending hardware events");
  assert.equal(state.interrupts.pendingCallbacks.length, 2, "same EXTI line and timer each have one pending flag");
  state = runtime.step(1);
  assert.equal(state.variables.edges, 1);
  assert.equal(state.variables.seenPin, 1, "deferred callback retains its GPIO_Pin binding");
  assert.equal(state.variables.ticks, 1, "masked timer updates coalesce instead of replaying two ISRs");
  assert.equal(state.variables.enteredAt, 5, "deferred ISR sees service time, not original trigger time");
  assert.equal(state.interrupts.pendingCallbacks.length, 0);
  state = runtime.step(1);
  assert.equal(state.variables.ticks, 2, "normal timer delivery resumes");
});

test("masked UART IT leaves software buffers untouched and HAL busy until IRQ service", () => {
  const runtime = runtimeApi.create({
    variables: {rx: [0, 0], tx: [65], rxDone: 0, txDone: 0, mask: 0, restartRx: 0, restartTx: 0},
    uarts: {huart2: {instance: "USART2", baudRate: 1000, frame: {dataBits: 8, stopBits: 1, parity: "none"}}},
    callbacks: {
      HAL_UART_RxCpltCallback: {operations: [increment("rxDone")]},
      HAL_UART_TxCpltCallback: {operations: [increment("txDone")]}
    },
    program: {operations: [
      {op: "uartReceiveIt", uart: "huart2", instance: "USART2", buffer: "rx", length: 2},
      {op: "uartTransmitIt", uart: "huart2", instance: "USART2", buffer: "tx", length: 1},
      {op: "irqDisable"}, readMask("mask"), {op: "delay", milliseconds: 19},
      {op: "uartReceiveIt", uart: "huart2", instance: "USART2", buffer: "rx", length: 2, resultTarget: "restartRx"},
      {op: "uartTransmitDma", uart: "huart2", instance: "USART2", buffer: "tx", length: 1, resultTarget: "restartTx"},
      {op: "delay", milliseconds: 1}, {op: "irqEnable"}, idle
    ]}
  });
  runtime.start();
  runtime.step(0);
  let state = runtime.enqueueUart("USART2", [7, 8]);
  assert.deepEqual(state.variables.rx, [0, 0], "CPU UART IRQ must copy DR into the HAL user buffer");
  assert.equal(state.variables.rxDone, 0);
  state = runtime.step(19);
  assert.equal(state.variables.mask, 1);
  assert.equal(state.variables.txDone, 0);
  assert.equal(state.variables.restartRx, 2, "pending RX IT keeps the HAL receive path busy");
  assert.equal(state.variables.restartTx, 2, "pending TX IT also rejects an overlapping DMA start");
  assert.equal(state.interrupts.pendingCallbacks.length, 2);
  state = runtime.step(1);
  assert.equal(state.variables.rxDone, 1);
  assert.equal(state.variables.txDone, 1);
  assert.deepEqual(state.variables.rx, [7, 8]);
  assert.equal(state.interrupts.primask, 0);
});

test("UART byte callback can rearm and process a burst after deferred IRQ service", () => {
  const runtime = runtimeApi.create({
    variables: {rx: [0], done: 0, total: 0, rearmStatus: 0},
    callbacks: {HAL_UART_RxCpltCallback: {operations: [
      increment("done"),
      {op: "assign", target: "total", value: {kind: "add", left: variable("total"), right: {kind: "arrayIndex", name: "rx", index: literal(0)}}},
      {op: "uartReceiveIt", uart: "huart2", instance: "USART2", buffer: "rx", length: 1, resultTarget: "rearmStatus"}
    ]}},
    program: {operations: [
      {op: "uartReceiveIt", uart: "huart2", instance: "USART2", buffer: "rx", length: 1},
      {op: "irqDisable"}, {op: "delay", milliseconds: 5}, {op: "irqEnable"}, idle
    ]}
  });
  runtime.start();
  runtime.step(0);
  let state = runtime.enqueueUart("USART2", [1, 2, 3]);
  assert.equal(state.variables.done, 0);
  state = runtime.step(5);
  assert.equal(state.variables.done, 3);
  assert.equal(state.variables.total, 6);
  assert.equal(state.variables.rearmStatus, 0);
  state = runtime.enqueueUart("USART2", Array(400).fill(1));
  assert.equal(state.variables.done, 403, "burst delivery must use an iterative service loop rather than recursive callbacks");
  assert.equal(state.variables.total, 406);
  assert.equal(state.variables.rearmStatus, 0);
  assert.equal(state.uartRx.USART2.length, 0);
});

test("stopping a masked timer cancels its pending update callback", () => {
  const runtime = runtimeApi.create({
    variables: {ticks: 0},
    timers: {htim2: {instance: "TIM2", frequencyHz: 500}},
    callbacks: {HAL_TIM_PeriodElapsedCallback: {operations: [increment("ticks")]}},
    program: {operations: [
      {op: "timerStartIt", timer: "htim2", instance: "TIM2"}, {op: "irqDisable"},
      {op: "delay", milliseconds: 5}, {op: "timerStopIt", timer: "htim2", instance: "TIM2"}, {op: "irqEnable"}, idle
    ]}
  });
  runtime.start();
  const state = runtime.step(10);
  assert.equal(state.variables.ticks, 0);
  assert.equal(state.interrupts.pendingCallbacks.length, 0);
});

test("UART partial RX becomes visible on IRQ service and remains busy until full length", () => {
  const runtime = runtimeApi.create({
    variables: {rx: [0, 0], done: 0},
    callbacks: {HAL_UART_RxCpltCallback: {operations: [increment("done")]}},
    program: {operations: [
      {op: "uartReceiveIt", uart: "huart2", instance: "USART2", buffer: "rx", length: 2},
      {op: "irqDisable"}, {op: "delay", milliseconds: 5}, {op: "irqEnable"}, idle
    ]}
  });
  runtime.start();
  runtime.step(0);
  let state = runtime.enqueueUart("USART2", [7]);
  assert.deepEqual(state.variables.rx, [0, 0]);
  state = runtime.step(5);
  assert.deepEqual(state.variables.rx, [7, 0], "RX IRQ must copy a partial frame even before completion");
  assert.equal(state.variables.done, 0);
  state = runtime.enqueueUart("USART2", [8]);
  assert.deepEqual(state.variables.rx, [7, 8]);
  assert.equal(state.variables.done, 1);
});

test("no-DMA UART and SPI abort callbacks are synchronous C calls even with PRIMASK set", () => {
  const runtime = runtimeApi.create({
    variables: {uartAborted: 0, spiAborted: 0},
    callbacks: {
      HAL_UART_AbortCpltCallback: {operations: [increment("uartAborted")]},
      HAL_SPI_AbortCpltCallback: {operations: [increment("spiAborted")]}
    },
    program: {operations: [
      {op: "irqDisable"}, {op: "uartAbortIt", uart: "huart2", instance: "USART2"},
      {op: "spiAbortIt", spi: "hspi1", instance: "SPI1"}, idle
    ]}
  });
  runtime.start();
  const state = runtime.step(0);
  assert.equal(state.interrupts.primask, 1);
  assert.equal(state.variables.uartAborted, 1);
  assert.equal(state.variables.spiAborted, 1);
  assert.equal(state.interrupts.pendingCallbacks.length, 0);
});

test("stopping masked ADC DMA clears both pending half and full flags", () => {
  for (const circular of [true, false]) {
  const runtime = runtimeApi.create({
    variables: {samples: [0, 0, 0, 0], half: 0, full: 0},
    adcs: {hadc1: {instance: "ADC1", samplePeriodMs: 1}},
    callbacks: {
      HAL_ADC_ConvHalfCpltCallback: {operations: [increment("half")]},
      HAL_ADC_ConvCpltCallback: {operations: [increment("full")]}
    },
    program: {operations: [
      {op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer: "samples", length: 4, circular},
      {op: "irqDisable"}, {op: "delay", milliseconds: 5},
      {op: "adcStopDma", adc: "hadc1", instance: "ADC1"}, {op: "irqEnable"}, idle
    ]}
  });
  runtime.start();
  const state = runtime.step(10);
  assert.equal(state.variables.half, 0);
  assert.equal(state.variables.full, 0);
  assert.equal(state.interrupts.pendingCallbacks.length, 0);
  }
});

test("unmask inside synchronous callback preserves pending hardware callback code", () => {
  const runtime = runtimeApi.create({
    variables: {ticks: 0, aborted: 0, rx: [0], rxDone: 0},
    timers: {htim2: {instance: "TIM2", frequencyHz: 500}},
    callbacks: {
      HAL_TIM_PeriodElapsedCallback: {operations: [increment("ticks")]},
      HAL_UART_RxCpltCallback: {operations: [increment("rxDone")]},
      HAL_UART_AbortCpltCallback: {operations: [{op: "irqEnable"}, increment("aborted")]}
    },
    program: {operations: [
      {op: "timerStartIt", timer: "htim2", instance: "TIM2"},
      {op: "uartReceiveIt", uart: "huart2", instance: "USART2", buffer: "rx", length: 1},
      {op: "irqDisable"}, {op: "delay", milliseconds: 5},
      {op: "uartAbortIt", uart: "huart1", instance: "USART1"}, idle
    ]}
  });
  runtime.start();
  runtime.step(0);
  runtime.enqueueUart("USART2", [7]);
  let state = runtime.step(5);
  assert.equal(state.variables.aborted, 1);
  assert.equal(state.variables.ticks, 1, "callback engine must retain the pending IRQ's original handler descriptor");
  assert.equal(state.variables.rxDone, 1, "nested unmask services UART bytes before returning to the outer caller");
  assert.deepEqual(state.variables.rx, [7]);
  assert.equal(state.interrupts.pendingCallbacks.length, 0);
  state = runtime.step(1);
  assert.equal(state.variables.ticks, 2, "timer continues after the nested unmask");
});

test("masked ADC IT samples at conversion time and defers only ISR software", () => {
  const sampledAt = [];
  const runtime = runtimeApi.create({
    variables: {done: 0, sampled: 0},
    adcs: {hadc1: {instance: "ADC1", samplePeriodMs: 1}},
    callbacks: {HAL_ADC_ConvCpltCallback: {operations: [
      {op: "adcGetValue", adc: "hadc1", instance: "ADC1", target: "sampled"}, increment("done")
    ]}},
    program: {operations: [
      {op: "adcStartIt", adc: "hadc1", instance: "ADC1"},
      {op: "irqDisable"}, {op: "delay", milliseconds: 5}, {op: "irqEnable"}, idle
    ]}
  }, {onAdcRead: event => { sampledAt.push(event.timeMs); return event.timeMs; }});
  runtime.start();
  let state = runtime.step(4);
  assert.deepEqual(sampledAt, [1]);
  assert.equal(state.variables.done, 0);
  assert.equal(state.adc.ADC1.value, 1);
  state = runtime.step(1);
  assert.deepEqual(sampledAt, [1], "ISR service must not resample an already completed conversion");
  assert.equal(state.variables.done, 1);
  assert.equal(state.variables.sampled, 1);
});

test("masked circular DMA retains distinct half and full pending flags and updates the buffer", () => {
  let sample = 0;
  const runtime = runtimeApi.create({
    variables: {samples: [0, 0, 0, 0], half: 0, full: 0},
    adcs: {hadc1: {instance: "ADC1", samplePeriodMs: 1}},
    callbacks: {
      HAL_ADC_ConvHalfCpltCallback: {operations: [increment("half")]},
      HAL_ADC_ConvCpltCallback: {operations: [increment("full")]}
    },
    program: {operations: [
      {op: "adcStartDma", adc: "hadc1", instance: "ADC1", buffer: "samples", length: 4, circular: true},
      {op: "irqDisable"}, {op: "delay", milliseconds: 13}, {op: "irqEnable"}, idle
    ]}
  }, {onAdcRead: () => ++sample});
  runtime.start();
  let state = runtime.step(12);
  assert.equal(state.variables.half, 0);
  assert.equal(state.variables.full, 0);
  assert.ok(state.variables.samples.every(value => value > 4), "DMA must keep copying while CPU callbacks are masked");
  assert.equal(state.interrupts.pendingCallbacks.length, 2, "repeated half and full flags coalesce separately");
  state = runtime.step(1);
  assert.equal(state.variables.half, 1);
  assert.equal(state.variables.full, 1);
  assert.deepEqual(state.variables.samples, [9, 10, 11, 12]);
  state = runtime.step(4);
  assert.equal(state.variables.half, 2);
  assert.equal(state.variables.full, 2);
});

test("saved PRIMASK preserves an outer critical section and reset discards pending callbacks", () => {
  const runtime = runtimeApi.create({
    variables: {outer: 0, inner: 0, edges: 0, observed: 0},
    pins: {PA0: {interruptEdge: "rising"}},
    callbacks: {HAL_GPIO_EXTI_Callback: {operations: [increment("edges")]}},
    program: {operations: [
      readMask("outer"), {op: "irqDisable"}, readMask("inner"), {op: "irqDisable"},
      {op: "delay", milliseconds: 5}, {op: "irqSetMask", value: variable("inner")},
      readMask("observed"), {op: "delay", milliseconds: 5},
      {op: "irqSetMask", value: variable("outer")}, idle
    ]}
  });
  runtime.start();
  runtime.step(0);
  runtime.syncGpioInputs({PA0: 0});
  runtime.syncGpioInputs({PA0: 1});
  let state = runtime.step(5);
  assert.equal(state.variables.outer, 0);
  assert.equal(state.variables.inner, 1);
  assert.equal(state.variables.observed, 1);
  assert.equal(state.variables.edges, 0, "restoring inner PRIMASK=1 must keep outer critical section masked");
  state = runtime.step(5);
  assert.equal(state.variables.edges, 1);
  runtime.reset();
  runtime.start();
  runtime.step(0);
  runtime.syncGpioInputs({PA0: 0});
  runtime.syncGpioInputs({PA0: 1});
  state = runtime.reset();
  assert.equal(state.interrupts.primask, 0);
  assert.equal(state.interrupts.pendingCallbacks.length, 0);
  assert.equal(state.variables.edges, 0);
  runtime.start();
  state = runtime.step(10);
  assert.equal(state.variables.edges, 0, "reset must not later dispatch stale pending edges");
});

test("PRIMASK is shared by cooperative task engines and cleared by scheduler reset", () => {
  const runtime = runtimeApi.create({
    variables: {observedMask: 0},
    middlewares: {freertos: {detected: true, tickRateHz: 1000, tasks: [
      {id: "masker", entry: "Masker", priority: 2, operations: [
        {op: "irqDisable"}, {op: "rtosDelay", ticks: literal(5)}, {op: "irqEnable"}, {op: "rtosDelay", ticks: literal(100)}
      ]},
      {id: "observer", entry: "Observer", priority: 1, operations: [{
        op: "while", condition: literal(true), body: [readMask("observedMask"), {op: "rtosDelay", ticks: literal(1)}]
      }]}
    ]}},
    program: {operations: []}
  });
  runtime.start();
  let state = runtime.step(2);
  assert.equal(state.variables.observedMask, 1);
  assert.equal(state.interrupts.primask, 1);
  state = runtime.step(5);
  assert.equal(state.variables.observedMask, 0);
  state = runtime.reset();
  assert.equal(state.interrupts.primask, 0);
  assert.equal(state.interrupts.pendingCallbacks.length, 0);
});
