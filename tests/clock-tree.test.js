"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clockTree = require("../clock-tree.js");

test("clock tree reads CubeMX frequencies and doubles timer clocks after APB prescaling", () => {
  const tree = clockTree.fromValues({
    "Mcu.Family": "STM32F1",
    "RCC.HSE_VALUE": "8000000",
    "RCC.PLLSourceVirtual": "RCC_PLLSOURCE_HSE",
    "RCC.PLLMul": "RCC_PLL_MUL9",
    "RCC.PLLCLKFreq_Value": "72000000",
    "RCC.SYSCLKSource": "RCC_SYSCLKSOURCE_PLLCLK",
    "RCC.SYSCLKFreq_VALUE": "72000000",
    "RCC.HCLKFreq_Value": "72000000",
    "RCC.APB1CLKDivider": "RCC_HCLK_DIV2",
    "RCC.APB1Freq_Value": "36000000",
    "RCC.APB2CLKDivider": "RCC_HCLK_DIV1",
    "RCC.APB2Freq_Value": "72000000"
  });

  assert.equal(tree.sysclk, 72000000);
  assert.equal(tree.pclk1, 36000000);
  assert.equal(tree.timerPclk1, 72000000);
  assert.equal(tree.timerPclk2, 72000000);
  assert.equal(tree.source, "PLLCLK");
  assert.equal(tree.valid, true);
});

test("clock tree no longer invents 72 MHz for an unconfigured STM32F1 project", () => {
  const tree = clockTree.fromValues({ "Mcu.CPN": "STM32F103C8T6" });
  assert.equal(tree.sysclk, 8000000);
  assert.equal(tree.confidence, "reset-default");
  assert.match(tree.issues[0], /复位 HSI/);
});
