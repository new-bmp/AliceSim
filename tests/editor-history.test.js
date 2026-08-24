"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const actions = fs.readFileSync(path.join(root, "ui-actions.js"), "utf8");
const schematic = fs.readFileSync(path.join(root, "schematic.js"), "utf8");

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

test("circuit edits expose an independent undo/redo history", () => {
  assert.match(schematic, /circuitHistory: \[\]/);
  assert.match(schematic, /function undoCircuit\(\)/);
  assert.match(schematic, /function redoCircuit\(\)/);
  assert.match(schematic, /undo: undoCircuit/);
  assert.match(schematic, /redo: redoCircuit/);
  assert.match(schematic, /recordCircuitHistory\(\);[\s\S]*?new CustomEvent\("alice:schematic-change"/);
});

test("undo commands follow the active code or schematic page", () => {
  assert.match(actions, /function isSchematicContext\(\)/);
  assert.match(actions, /function undoActive\(\)/);
  assert.match(actions, /function redoActive\(\)/);
  assert.match(actions, /quickUndo\?\.addEventListener\("click", undoActive\)/);
  assert.match(actions, /quickRedo\?\.addEventListener\("click", redoActive\)/);
  assert.match(actions, /alice:schematic-history-change/);
  assert.match(actions, /if \(modifier && isSchematicContext\(\) && !editorFocused/);
});

test("manual wire creation and deletion are recorded in circuit history", () => {
  assert.match(schematic, /var wireCountBefore = schematicState\.wires\.length;[\s\S]*?emitSchematicChange\("add-wire", wire\)/);
  assert.match(schematic, /var removedWire = selection\.kind === "wire" \? findWire\(selection\.id\) : null;/);
  assert.match(schematic, /else if \(removedWire\) emitSchematicChange\("delete-wire", removedWire\)/);
});
