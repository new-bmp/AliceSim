"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const automation = require("../envelope-automation.js");

test("envelope sampling sorts points, interpolates and follows target step size", () => {
  const points = [
    { id: "end", timeMs: 1000, value: 100 },
    { id: "start", timeMs: 0, value: 0 }
  ];

  assert.equal(automation.sampleEnvelope(points, 0, 0, 100, 0.1, 1000), 0);
  assert.equal(automation.sampleEnvelope(points, 333, 0, 100, 0.1, 1000), 33.3);
  assert.equal(automation.sampleEnvelope(points, 500, 0, 100, 1, 1000), 50);
  assert.equal(automation.sampleEnvelope(points, 1200, 0, 100, 1, 1000), 100);
});

test("envelope engine uses one timestamp, completes once, and supports looping", () => {
  const applied = [];
  const engine = automation.createEngine({ mode: "envelope", durationMs: 1000 });
  engine.setLanes([{
    id: "lane-1",
    targetId: "component-1:percent",
    label: "RV1 position",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    points: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 100 }]
  }]);

  assert.equal(engine.begin(5000, (target, value) => applied.push([target, value])).active, true);
  assert.equal(engine.advance(5500, (target, value) => applied.push([target, value])).values[0].value, 50);
  const completed = engine.advance(6000, (target, value) => applied.push([target, value]));
  assert.equal(completed.complete, true);
  assert.equal(completed.values[0].value, 100);
  assert.equal(engine.advance(6100).active, false);

  engine.setLoop(true);
  engine.begin(10000);
  const looped = engine.advance(11250);
  assert.equal(looped.complete, false);
  assert.equal(looped.timeMs, 250);
  assert.equal(looped.values[0].value, 25);
  assert.ok(applied.some(([target, value]) => target === "component-1:percent" && value === 50));
});

test("infinite mode leaves manual sensor values untouched", () => {
  const engine = automation.createEngine({ mode: "infinite", durationMs: 1000 });
  engine.setLanes([{
    id: "lane-1",
    targetId: "sensor:lux",
    min: 0,
    max: 1000,
    step: 10,
    points: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1000 }]
  }]);
  let calls = 0;
  assert.equal(engine.begin(0, () => calls++).active, false);
  assert.equal(engine.advance(500, () => calls++).values.length, 0);
  assert.equal(calls, 0);
});

test("long envelope durations preserve keyframes beyond ten seconds", () => {
  const engine = automation.createEngine({ mode: "envelope", durationMs: 100000 });
  engine.setLanes([{
    id: "lane-long",
    targetId: "sensor:lux",
    min: 0,
    max: 100000,
    step: 10,
    points: [
      { timeMs: 0, value: 500 },
      { timeMs: 25000, value: 0 },
      { timeMs: 65000, value: 100000 },
      { timeMs: 100000, value: 500 }
    ]
  }]);
  assert.deepEqual(engine.getState().lanes[0].points.map(point => point.timeMs), [0, 25000, 65000, 100000]);
  engine.begin(0);
  assert.equal(engine.advance(65000).values[0].value, 100000);
});

test("loaded and newly added envelope lanes keep unique lane and point ids", () => {
  const lanes = automation.normalizeLaneCollection([
    { id: "lane-1", targetId: "adc-1", min: 0, max: 3300, step: 1, points: [{ id: "point-1", timeMs: 0, value: 100 }, { id: "point-2", timeMs: 10000, value: 100 }] },
    { id: "lane-2", targetId: "adc-2", min: 0, max: 3300, step: 1, points: [{ id: "point-3", timeMs: 0, value: 200 }, { id: "point-4", timeMs: 10000, value: 200 }] },
    { id: "lane-1", targetId: "adc-3", min: 0, max: 3300, step: 1, points: [{ id: "point-1", timeMs: 0, value: 300 }, { id: "point-2", timeMs: 10000, value: 300 }] }
  ], 10000);

  assert.equal(new Set(lanes.map(lane => lane.id)).size, 3);
  assert.equal(new Set(lanes.flatMap(lane => lane.points.map(point => point.id))).size, 6);
  assert.equal(lanes[0].id, "lane-1");
  assert.equal(lanes[1].id, "lane-2");
  assert.notEqual(lanes[2].id, "lane-1");
});
