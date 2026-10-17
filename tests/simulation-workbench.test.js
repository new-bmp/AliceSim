"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeState, reduceState } = require("../simulation-workbench.js");

test("simulation workbench normalizes persisted tool state", () => {
  assert.deepEqual(normalizeState({ active: "missing", collapsed: "yes", height: 900 }), {
    active: "build", collapsed: true, compare: false, height: 640
  });
  assert.deepEqual(normalizeState({ active: "envelope", collapsed: false, compare: true, height: 280 }), {
    active: "envelope", collapsed: false, compare: true, height: 280
  });
});

test("saved RTOS layouts reopen on build output while retaining size and visibility", () => {
  for (const collapsed of [true, false]) {
    assert.deepEqual(normalizeState({ active: "rtos", collapsed, compare: true, height: 320 }), {
      active: "build", collapsed, compare: true, height: 320
    });
  }
});

test("obsolete RTOS shortcuts cannot replace the selected tool", () => {
  const state = { active: "serial", collapsed: false, compare: false, height: 300 };
  assert.deepEqual(reduceState(state, { type: "select", tool: "rtos" }), state);
});

test("selecting a simulation tool expands only that workbench", () => {
  const next = reduceState({ active: "build", collapsed: true, compare: false, height: 280 }, { type: "select", tool: "logic" });
  assert.deepEqual(next, { active: "logic", collapsed: false, compare: false, height: 280 });
  assert.deepEqual(reduceState(next, { type: "compare", value: true }), {
    active: "logic", collapsed: false, compare: true, height: 280
  });
});

test("invalid tool actions cannot hide the workbench or corrupt its height", () => {
  const state = { active: "serial", collapsed: false, compare: false, height: 300 };
  assert.deepEqual(reduceState(state, { type: "select", tool: "gpu" }), state);
  assert.equal(reduceState(state, { type: "height", value: 20 }).height, 160);
});
