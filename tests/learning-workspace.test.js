"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("../learning-core.js");
const adapter = fs.existsSync(require("node:path").join(__dirname, "../learning-workspace.js")) ? require("../learning-workspace.js") : {};

test("workspace capture reads unsaved editor, IOC and real diagnostics without building firmware", () => {
  assert.equal(typeof adapter.create, "function");
  let builds = 0;
  const env = {
    AliceLearningCore: core,
    AliceProjectWorkspace: { getState: () => ({ rootName: "demo", files: new Map([["main.c", { content: "old" }]]) }) },
    AliceEditorHost: { getCurrentFile: () => ({ path: "main.c", content: "new\ncode" }) },
    AliceIocViewer: { getRaw: () => "PA0.Signal=ADC1_IN0" },
    AliceSchematic: { getLearningSnapshot: () => ({ components: [], wires: [] }) },
    AliceLearningEvidence: { getSnapshot: () => ({ runtime: { built: false }, diagnostics: [{ text: "syntax error", severity: "error" }] }) },
    AliceHalSimulator: { build: () => builds++, getTrace: () => ({ channels: [] }) }
  };
  const context = adapter.create(env).capture();
  assert.equal(context.files.find(f => f.path === "main.c").content, "new\ncode");
  assert.ok(context.files.some(f => f.content.includes("PA0.Signal")));
  assert.equal(context.diagnostics[0].text, "syntax error");
  assert.equal(builds, 0);
});

test("annotation clipping uses visible viewport coordinates and rejects hidden targets", () => {
  assert.equal(typeof adapter.clipRect, "function");
  assert.deepEqual(adapter.clipRect({ left: 10, top: 20, width: 80, height: 100 }, { left: 0, top: 50, width: 60, height: 50 }), { left: 10, top: 50, width: 50, height: 50 });
  assert.equal(adapter.clipRect({ left: 100, top: 20, width: 20, height: 20 }, { left: 0, top: 0, width: 60, height: 50 }), null);
});
