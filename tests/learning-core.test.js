"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const target = path.join(__dirname, "..", "learning-core.js");
const core = fs.existsSync(target) ? require(target) : {};

function fixture() {
  return {
    project: { name: "Custom sensor" },
    files: [{ path: "Core/Src/main.c", content: "int main(void) {\n  work();\n}\n" }, { path: ".env", content: "SECRET=private" }],
    activeFile: { path: "Core/Src/main.c", content: "int main(void) {\n  read();\n}\n" },
    circuit: { components: [{ id: "u1", type: "custom", ref: "U1", pins: [{ name: "AN" }, { name: "GND" }] }], wires: [] },
    trace: { channels: [{ pin: "PA8", samples: [{ timeMs: 0, value: 0 }, { timeMs: 1, value: 1 }] }] },
    uiTargets: [{ id: "ui:serial", kind: "ui", label: "串口" }]
  };
}

test("context includes unsaved source and arbitrary component pins but excludes secrets", () => {
  assert.equal(typeof core.buildContext, "function");
  const context = core.buildContext(fixture());
  assert.equal(context.files[0].content, "int main(void) {\n  read();\n}\n");
  assert.equal(JSON.stringify(context).includes("SECRET"), false);
  assert.ok(context.targets.find(t => t.kind === "pin" && t.componentId === "u1" && t.pin === "AN"));
  assert.ok(context.targets.find(t => t.kind === "trace" && t.pin === "PA8"));
});

test("context bounds large sources and traces and reports omitted data", () => {
  assert.equal(typeof core.buildContext, "function");
  const input = fixture();
  input.activeFile.content = "x\n".repeat(80000);
  input.trace.channels[0].samples = Array.from({ length: 1000 }, (_, i) => ({ timeMs: i, value: i % 2 }));
  const context = core.buildContext(input);
  assert.ok(context.files[0].content.length <= 24000);
  assert.equal(context.files[0].truncated, true);
  assert.ok(context.trace.channels[0].samples.length <= 120);
  assert.equal(context.trace.channels[0].sampled, true);
  assert.ok(context.omissions.length);
});

test("context preserves observed net voltages and peripheral configuration without treating them as a code revision", () => {
  const input = fixture();
  input.circuit.nets = [{ id: "net1", endpoints: [{ componentId: "u1", pin: "AN" }], voltage: null, level: null, floating: true }];
  input.peripherals = { adcs: [{ instance: "ADC1", channels: [{ pin: "PA0", channel: 0 }] }] };
  const context = core.buildContext(input);
  assert.equal(context.circuit.nets[0].voltage, null);
  assert.equal(context.peripherals.adcs[0].channels[0].pin, "PA0");
  input.circuit.nets[0].voltage = 1.65;
  assert.equal(core.buildContext(input).revision, context.revision);
});

test("a null item from a model cannot break validation or persisted lecture restoration", () => {
  const context = core.buildContext(fixture());
  const result = core.normalizeGuidance({ message: "hello", annotations: [null], handout: { sections: [null] } }, context);
  assert.equal(result.annotations.length, 0);
  const session = core.createSession();
  assert.doesNotThrow(() => session.restore({ version: 1, messages: [null], handouts: [{ evidence: { circuit: { components: [null], wires: [null] }, files: [null], serial: [null] } }] }));
});

test("revision changes for edited source outside the excerpt but not canvas movement or ticking", () => {
  assert.equal(typeof core.buildContext, "function");
  const input = fixture();
  input.activeFile.content = "a".repeat(30000);
  const first = core.buildContext(input);
  input.circuit.components[0].x = 420;
  input.runtime = { timeMs: 2000 };
  assert.equal(core.buildContext(input).revision, first.revision);
  input.activeFile.content += "b";
  assert.notEqual(core.buildContext(input).revision, first.revision);
});

test("guidance validates semantic targets and code ranges without executing actions", () => {
  assert.equal(typeof core.normalizeGuidance, "function");
  const context = core.buildContext(fixture());
  const component = context.targets.find(t => t.kind === "component");
  const file = context.targets.find(t => t.kind === "code");
  const result = core.normalizeGuidance({ message: "检查这里", annotations: [
    { targetId: component.id, style: "circle", label: "元件" },
    { targetId: file.id, style: "highlight", label: "采样", startLine: 2, endLine: 2 },
    { targetId: "javascript:alert(1)", style: "circle", label: "bad" },
    { targetId: file.id, startLine: 900, endLine: 901 },
    { targetId: component.id, style: "eval", code: "danger()" }
  ] }, context);
  assert.equal(result.annotations.length, 2);
  assert.equal(result.rejected.length, 3);
  assert.equal(result.annotations[1].startLine, 2);
});

test("handout HTML is inert and includes the captured experiment evidence", () => {
  assert.equal(typeof core.createHandout, "function");
  const context = core.buildContext(fixture());
  const doc = core.createHandout({ title: "<script>alert(1)</script>", sections: [{ heading: "记录", body: "<img src=x onerror=alert(1)>" }], exercises: ["接下来怎样验证？"] }, context);
  const html = core.handoutHtml(doc);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("Custom sensor"));
  assert.ok(core.handoutMarkdown(doc).includes("read();"));
});

test("saving and reopening a handout preserves its creation time and excerpt warnings", () => {
  const input = fixture();
  input.circuit.components[0].adcVoltage = 1.65;
  input.circuit.components[0].peripheralProperties = { threshold: 42 };
  input.activeFile.content = "x".repeat(26000);
  const doc = core.createHandout({ title: "Old lesson", sections: [], exercises: [] }, core.buildContext(input));
  doc.createdAt = "2026-11-01T00:00:00.000Z";
  const first = core.createSession(); first.addHandout(doc);
  const second = core.createSession(); second.restore(first.export());
  const reopened = second.export().handouts[0];
  assert.equal(reopened.createdAt, "2026-11-01T00:00:00.000Z");
  assert.equal(reopened.evidence.files[0].truncated, true);
  assert.equal(reopened.evidence.revision, doc.evidence.revision);
  assert.equal(reopened.evidence.capturedAt, doc.evidence.capturedAt);
  assert.deepEqual(reopened.evidence.circuit.components[0].properties, { adcVoltage: 1.65 });
  assert.deepEqual(reopened.evidence.circuit.components[0].parameters, { threshold: 42 });
});

test("session ignores cancelled or superseded responses and safely bounds persisted history", () => {
  assert.equal(typeof core.createSession, "function");
  const session = core.createSession();
  const context = core.buildContext(fixture());
  const first = session.begin(context);
  const second = session.begin(context);
  assert.equal(session.accept(first, context.revision, { message: "旧回答" }), false);
  assert.equal(session.accept(second, "different", { message: "旧工程" }), false);
  const third = session.begin(context);
  session.cancel();
  assert.equal(session.accept(third, context.revision, { message: "取消后到达" }), false);
  const fourth = session.begin(context);
  assert.ok(session.accept(fourth, context.revision, { message: "当前回答" }));
  session.restore({ version: 1, messages: Array.from({ length: 200 }, () => ({ role: "system", text: "bad" })), handouts: [] });
  assert.equal(session.export().messages.length, 0);
  assert.equal(session.export().version, 1);
});
