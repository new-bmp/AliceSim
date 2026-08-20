"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const actions = fs.readFileSync(path.join(root, "ui-actions.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const panelResize = fs.readFileSync(path.join(root, "panel-resize.js"), "utf8");

test("ribbon navigation has one clear responsibility per tab", () => {
  const block = html.match(/<div class="ribbon-tabs"[\s\S]*?<\/div>/)?.[0] || "";
  const labels = Array.from(block.matchAll(/<button[^>]*>([^<]+)<\/button>/g), match => match[1].trim());
  assert.deepEqual(labels, ["项目", "MCU", "元件", "编辑", "仿真", "视图"]);
  ["文件", "开始", "代码", "调试", "帮助"].forEach(label => assert.ok(!labels.includes(label)));
  assert.match(block, /工程与文件/);
});

test("duplicate page and tool-window commands are removed from the ribbon", () => {
  assert.doesNotMatch(html, /data-pane-toggle="simulator"/);
  assert.doesNotMatch(html, /data-ribbon-tab="code"/);
  assert.doesNotMatch(html, /data-activity="debug"/);
  assert.doesNotMatch(html, /data-bottom-open="serial"/);
});

test("ribbon command groups follow the simplified information architecture", () => {
  assert.match(actions, /"项目": \{ original: \[\], generated: \["file-project", "project-drivers", "file-save"\]/);
  assert.match(actions, /"MCU": \{ original: \["mcu"\]/);
  assert.match(actions, /"元件": \{ original: \["components"\]/);
  assert.match(actions, /"编辑": \{ original: \[\], generated: \["code-edit", "code-view"\]/);
  assert.match(actions, /"仿真": \{ original: \["run"\], generated: \["sim-circuit", "sim-view"\]/);
  assert.match(actions, /"视图": \{ original: \["view"\], generated: \["layout"\]/);
});

test("component library is moved into the dedicated ribbon tab", () => {
  assert.match(actions, /componentLibrary\.classList\.add\("ribbon-group", "ribbon-component-library"\)/);
  assert.match(actions, /ribbon\.appendChild\(componentLibrary\)/);
  assert.match(actions, /dataset\.uiOriginalGroup = "components"/);
});

test("the top ribbon can be folded and remembers its state", () => {
  assert.match(html, /id="ribbonCollapseToggle"[^>]*aria-controls="mainRibbon"[^>]*aria-expanded="true"/);
  assert.match(html, /class="ribbon" id="mainRibbon"/);
  assert.match(panelResize, /RIBBON_COLLAPSED_KEY = "alice\.ribbon\.collapsed\.v1"/);
  assert.match(panelResize, /function setRibbonCollapsed\(collapsed/);
  assert.match(styles, /body\.visio-theme\.ribbon-collapsed \{ --top: 68px; \}/);
  assert.match(styles, /ribbon-collapsed \.topbar > \.ribbon \{ display: none; \}/);
});
