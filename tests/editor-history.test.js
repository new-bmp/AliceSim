"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const actions = fs.readFileSync(path.join(root, "ui-actions.js"), "utf8");

test("programmatic file opens reset undo history instead of recording a cross-file edit", () => {
  assert.match(app, /dispatchEvent\(new CustomEvent\("alice-editor-file-open"/);
  assert.match(actions, /addEventListener\("alice-editor-file-open", handleEditorFileOpen\)/);
  assert.match(actions, /function handleEditorFileOpen[\s\S]*?syncSplitEditor\(\);[\s\S]*?resetHistory\(\);/);
});

test("starter files use the editor host so file switches follow the same history path", () => {
  assert.match(app, /AliceEditorHost\?\.openFile/);
  assert.match(app, /AliceEditorHost\.openFile\(file, content, \{ readOnly: false \}\)/);
});

test("split-editor input preserves input type and dispatches through the primary editor", () => {
  assert.match(actions, /splitEditor\.addEventListener\("input", event =>/);
  assert.match(actions, /new InputEvent\("input", \{ bubbles: true, inputType, data:/);
  assert.match(actions, /editor\.dispatchEvent\(inputEvent\)/);
});
