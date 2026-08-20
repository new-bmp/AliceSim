const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const schematic = fs.readFileSync(path.join(root, "schematic.js"), "utf8");

test("user-controlled status and IOC names render as text rather than HTML", () => {
  assert.match(app, /copy\.textContent = String\(message \?\? ""\)/);
  assert.doesNotMatch(app, /toast\.innerHTML\s*=\s*`<i><\/i><span>\$\{message\}/);
  assert.match(app, /projectName\.textContent = `\$\{config\.name\} `/);
  assert.doesNotMatch(app, /project-name"\)\.innerHTML\s*=\s*`\$\{config\.name\}/);
});

test("imported measurement values cannot inject markup into the schematic", () => {
  assert.match(schematic, /probeReadout\.textContent = model\.value/);
  assert.doesNotMatch(schematic, /measurement-probe-readout[^\n]+\+ model\.value \+/);
});
