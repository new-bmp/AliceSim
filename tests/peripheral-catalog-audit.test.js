"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const catalog = require("../peripheral-catalog.js");

test("peripheral catalog has unique components, valid controls and complete installable registrations", () => {
  const report = catalog.audit();
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.equal(report.count, 27);
  assert.equal(report.catalogCount, 25);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});
