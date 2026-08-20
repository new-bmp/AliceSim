"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const actions = fs.readFileSync(path.join(root, "ui-actions.js"), "utf8");

test("schematic toolbar exposes a dedicated save-as-component workflow", () => {
  assert.match(html, /id="saveAsComponentButton"/);
  assert.match(html, /将完整电路保存为组件/);
  assert.match(actions, /openSaveComponentDialog/);
  assert.match(actions, /\.alice-component\.json/);
  assert.match(actions, /OPEN COMPONENT/);
  assert.match(actions, /打开组件内部电路/);
  assert.match(actions, /外部端口/);
  assert.match(actions, /网络端子/);
});
