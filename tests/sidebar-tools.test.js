"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const target = path.join(__dirname, "..", "sidebar-tools.js");
const tools = fs.existsSync(target) ? require(target) : {};

test("device information uses the loaded IOC clock and includes analog pins", () => {
  assert.equal(typeof tools.deviceInfo, "function");
  const info = tools.deviceInfo({
    mcu: "STM32F103C8T6", packageName: "LQFP48", fileName: "Sensors.ioc",
    values: { "RCC.SYSCLKFreq_VALUE": "8000000" },
    configuredPins: [
      { base: "PB0", signal: "ADC2_IN8", label: "AO2", mode: "IN8" },
      { base: "PA0", signal: "ADC1_IN0", label: "AO1", mode: "IN0" }
    ], peripherals: [{ name: "ADC1" }, { name: "ADC2" }]
  });
  assert.equal(info.clockHz, 8000000);
  assert.deepEqual(info.pins.map(pin => [pin.pin, pin.signal, pin.label]), [
    ["PA0", "ADC1_IN0", "AO1"], ["PB0", "ADC2_IN8", "AO2"]
  ]);
  assert.equal(info.source, "Sensors.ioc");
});

test("an unknown device does not invent a 72 MHz clock or memory sizes", () => {
  assert.equal(typeof tools.deviceInfo, "function");
  const info = tools.deviceInfo(null, { mcu: "STM32G0", pins: { PA2: { physicalPin: "PA2", signal: "USART2_TX" } } });
  assert.equal(info.mcu, "STM32G0");
  assert.equal(info.clockHz, null);
  assert.equal(info.packageName, "—");
  assert.deepEqual(info.pins.map(pin => pin.pin), ["PA2"]);
});

test("a newly loaded IOC takes precedence over an older compiled pin model", () => {
  assert.equal(typeof tools.deviceInfo, "function");
  const info = tools.deviceInfo({ mcu: "STM32F103", values: {}, configuredPins: [], peripherals: [] }, {
    mcu: "STM32F407", pins: { PC13: { signal: "GPIO_Output" } }
  });
  assert.deepEqual(info.pins, []);
  assert.equal(info.mcu, "STM32F103");
});

test("component search combines category and multiword aliases without exposing disabled parts", () => {
  assert.equal(typeof tools.filterComponents, "function");
  const catalog = [
    { type: "oled", label: "OLED", description: "SSD1306 I²C 屏幕", category: "display" },
    { type: "spiDisplay", label: "SPI 屏幕", description: "ST7735", category: "display" },
    { type: "adcSource", label: "ADC 采集源", category: "input" },
    { type: "hiddenOled", label: "OLED", description: "SSD1306 I2C", category: "display", disabled: true }
  ];
  assert.deepEqual(tools.filterComponents(catalog, " oled  i2c ", "display").map(item => item.type), ["oled"]);
  assert.deepEqual(tools.filterComponents(catalog, "", "input").map(item => item.type), ["adcSource"]);
  assert.deepEqual(tools.filterComponents(catalog, "missing", "all"), []);
});

test("trace selection prevents a fifth channel and keeps existing choices intact", () => {
  assert.equal(typeof tools.changeTraceSelection, "function");
  const channels = ["PA0", "PA1", "PA2", "PA3", "PA4"].map(pin => ({ pin }));
  const selected = ["PA0", "PA1", "PA2", "PA3"];
  const result = tools.changeTraceSelection(channels, selected, "PA4", true);
  assert.deepEqual(result.pins, selected);
  assert.equal(result.error, "limit");
  assert.deepEqual(selected, ["PA0", "PA1", "PA2", "PA3"]);
});

test("trace selection retains the last channel and ignores unavailable pins", () => {
  assert.equal(typeof tools.changeTraceSelection, "function");
  const channels = [{ pin: "PA0" }, { pin: "PB0" }];
  assert.deepEqual(tools.changeTraceSelection(channels, ["PA0"], "PA0", false), { pins: ["PA0"], error: "last" });
  assert.deepEqual(tools.changeTraceSelection(channels, ["PA0"], "PC13", true), { pins: ["PA0"], error: "unknown" });
  assert.deepEqual(tools.changeTraceSelection(channels, ["PA0", "PB0"], "PA0", false), { pins: ["PB0"], error: "" });
});

test("sidebar diagnostics stay bounded and a new build removes stale failures", () => {
  assert.equal(typeof tools.reduceMessages, "function");
  let messages = [];
  for (let index = 0; index < 30; index++) messages = tools.reduceMessages(messages, { text: `failure ${index}`, severity: "error" });
  assert.equal(messages.length, 8);
  assert.equal(messages.at(-1).text, "failure 29");
  assert.deepEqual(tools.reduceMessages(messages, { text: "alice hal-build --target STM32F103", severity: "command" }), []);
  assert.deepEqual(tools.reduceMessages([], { text: "parsing...", severity: "" }), []);
});

test("a late worker status cannot label a paused simulation as running", () => {
  assert.equal(typeof tools.runtimeLabel, "function");
  assert.equal(tools.runtimeLabel({ running: false, busy: false, status: "RUNNING" }), "已暂停");
  assert.equal(tools.runtimeLabel({ running: true, busy: false, status: "RUNNING" }), "运行中");
  assert.equal(tools.runtimeLabel({ running: false, busy: true, status: "ERROR" }), "构建中");
  assert.equal(tools.runtimeLabel({ running: false, busy: false, status: "ERROR" }), "运行出错");
});
