"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const actions = fs.readFileSync(path.join(root, "ui-actions.js"), "utf8");
const schematic = fs.readFileSync(path.join(root, "schematic.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

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

test("double-clicking a terminal in select mode starts wiring without opening component properties", () => {
  assert.match(schematic, /components\.addEventListener\("dblclick", function \(event\) \{[\s\S]*?closest\("\.component-pin"\)[\s\S]*?schematicState\.tool === "select"[\s\S]*?handleWirePin\(pin, \{ selectMode: true \}\);[\s\S]*?return;/);
  assert.match(schematic, /pin && schematicState\.tool === "select"[\s\S]*?if \(schematicState\.wireStart\) \{[\s\S]*?handleWirePin\(pin, \{ selectMode: true \}\);/);
  assert.match(schematic, /pin && schematicState\.tool === "select" && event\.button === 0/);
  assert.match(schematic, /isRecentSelectPinGesture\(pin\)[\s\S]*?selectPinGesture = null/);
  assert.match(schematic, /单击另一个端子完成连接/);
});

test("right click cancels an active wire before leaving wire mode", () => {
  assert.match(schematic, /viewport\.addEventListener\("pointerdown", function \(event\) \{[\s\S]*?schematicState\.tool === "wire" && event\.button === 2/);
  assert.match(schematic, /if \(schematicState\.wireStart\) \{[\s\S]*?cancelWire\(\);[\s\S]*?仍处于导线模式[\s\S]*?\} else \{[\s\S]*?setTool\("select"\)/);
});

test("touch and pen users get an explicit cancel action while drawing a wire", () => {
  assert.match(html, /id="cancelWireButton"[^>]*aria-label="取消当前导线"[^>]*hidden/);
  assert.match(fs.readFileSync(path.join(root, "styles.css"), "utf8"), /schematic-toolbar button\[hidden\] \{ display: none !important; \}/);
  assert.match(schematic, /function updateWireCancelAction\(\)[\s\S]*?hidden = !schematicState\.wireStart/);
  assert.match(schematic, /pinElement\.classList\.add\("wire-start"\);[\s\S]*?updateWireCancelAction\(\)/);
  assert.match(schematic, /cancelWireButton\.addEventListener\("click"[\s\S]*?cancelWire\(\)/);
});

test("the primary save command persists the complete project instead of one editor buffer", () => {
  assert.match(html, /button title="保存项目"/);
  assert.match(actions, /function saveWholeProject\(options = \{\}\)/);
  assert.match(actions, /saveWholeProject[\s\S]*?AliceProjectWorkspace\?\.saveProject/);
  assert.match(actions, /quickSave\?\.addEventListener\("click", saveWholeProject\)/);
  assert.match(actions, /if \(event\.shiftKey\) exportProject\(\);[\s\S]*?else saveWholeProject\(\)/);
  assert.match(actions, /function createProjectSaveFeedback\(initialMessage\)/);
  assert.match(actions, /alice-project-save-progress/);
  assert.match(actions, /setProjectSaveBusy\(true\)[\s\S]*?setProjectSaveBusy\(false\)/);
  assert.match(actions, /setAttribute\("aria-busy", String\(Boolean\(busy\)\)\)/);
  assert.match(actions, /feedbackRemaining = 600 - \(Date\.now\(\) - feedbackStartedAt\)/);
  assert.match(html, /id="saveCircuitButton" title="单独另存电路/);
  assert.match(actions, /async function saveCurrentCircuit\(\)[\s\S]*?api\.downloadCircuit\(filename\)/);
  assert.match(actions, /label: "另存电路", shortcut: "Ctrl\+Alt\+S", action: saveCurrentCircuit/);
  assert.doesNotMatch(actions, /async function saveCurrentCircuit\(\)[\s\S]*?saveWholeProject\(\{ source: "circuit" \}\)/);
});
