"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const clockTree = require("../clock-tree.js");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const start = source.indexOf("function applyClockTree(");
const end = source.indexOf('$("#importButton").addEventListener', start);

function clockDisplay() {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: "", title: "",
      classList: { toggle() {} },
      querySelector: child => $(selector + " " + child)
    });
    return nodes.get(selector);
  };
  // IOC imports are published on window. A separate document target makes a
  // misplaced listener fail as it does in the browser (the event does not bubble).
  const window = Object.assign(new EventTarget(), { AliceClockTree: clockTree });
  const document = new EventTarget();
  const context = vm.createContext({ window, document, $, altFiles: { "STM32_Empty.ioc": "Mcu.CPN=STM32F103C8T6" } });
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context, { filename: "app-clock-display.js" });
  return {
    text: selector => $(selector).textContent,
    load(text, fileName) {
      const event = new Event("alice:ioc-viewer-loaded");
      event.detail = { fileName, clockTree: clockTree.fromText(text) };
      window.dispatchEvent(event);
    }
  };
}

test("CubeMX IOC import updates the clock page and ribbon from reset 8 MHz to 72 MHz", () => {
  const display = clockDisplay();
  assert.equal(display.text("#clockSysclkValue"), "8 MHz");
  display.load(fs.readFileSync(path.join(root, "examples/STM32F103_HAL_Init/STM32F103_HAL_Init.ioc"), "utf8"), "STM32F103_HAL_Init.ioc");
  assert.equal(display.text("#clockRibbonValue"), "72");
  assert.equal(display.text("#clockSysclkValue"), "72 MHz");
  assert.equal(display.text("#clockSysclkSource"), "PLLCLK");
  assert.equal(display.text("#clockPllMultiplier"), "× 9");
  assert.equal(display.text("#clockHclkValue"), "72 MHz");
  assert.equal(display.text("#clockPclk1Value"), "36 MHz");
  assert.equal(display.text("#clockPclk1Detail"), "APB1 ÷ 2 · TIM 72 MHz");
  assert.equal(display.text("#clockPclk2Value"), "72 MHz");
  assert.match(display.text("#clockTreeSubtitle"), /^STM32F103_HAL_Init\.ioc/);

  // A later import or restored project must replace the previous clock too.
  display.load("Mcu.CPN=STM32F103C8T6\nRCC.SYSCLKSource=RCC_SYSCLKSOURCE_HSI\nRCC.SYSCLKFreq_VALUE=8000000", "HSI.ioc");
  assert.equal(display.text("#clockRibbonValue"), "8");
  assert.equal(display.text("#clockSysclkValue"), "8 MHz");
  assert.equal(display.text("#clockSysclkSource"), "HSI");
  assert.equal(display.text("#clockPclk1Detail"), "APB1 ÷ 1 · TIM 8 MHz");
  assert.match(display.text("#clockTreeSubtitle"), /^HSI\.ioc/);
});
