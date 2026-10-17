"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const actions = fs.readFileSync(path.join(root, "ui-actions.js"), "utf8");

// Execute the production navigation handlers, including their deferred page
// events. Only the DOM and animation-frame boundary are supplied by the test.
function navigation({ page = "code", mobile = false, hidden = false } = {}) {
  function element(text = "", classes = []) {
    const node = new EventTarget();
    const names = new Set(classes);
    node.textContent = text;
    node.dataset = {};
    node.style = {};
    node.attributes = {};
    node.classList = {
      contains: name => names.has(name),
      add: (...values) => values.forEach(value => names.add(value)),
      remove: (...values) => values.forEach(value => names.delete(value)),
      toggle(name, force = !names.has(name)) {
        if (force) names.add(name); else names.delete(name);
        return force;
      }
    };
    node.setAttribute = (name, value) => { node.attributes[name] = value; };
    node.getAttribute = name => node.attributes[name] ?? null;
    node.click = () => node.dispatchEvent(new Event("click"));
    node.focus = () => {};
    return node;
  }
  const body = element("", [`app-page-${page}`, ...(hidden ? ["hide-project-pane"] : [])]);
  body.dataset.appPage = page;
  const sidebar = element();
  const close = element();
  const projectToggle = element();
  const tabs = ["项目", "MCU", "元件", "编辑", "仿真", "视图"].map(label => element(label));
  const views = ["project", "device", "packages"].map(name => {
    const node = element("", name === "project" ? ["active"] : []);
    node.dataset.view = name;
    return node;
  });
  const panels = views.map(view => {
    const node = element("", view.dataset.view === "project" ? ["active"] : []);
    node.dataset.panel = view.dataset.view;
    return node;
  });
  const groups = ["components", "mcu", "run", "view"].map(name => {
    const node = element();
    node.dataset.uiOriginalGroup = name;
    return node;
  });
  const ribbon = element();
  const frames = [];
  const document = Object.assign(new EventTarget(), { body });
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: mobile, addEventListener() {} }),
    AliceRibbonLayout: {
      setCollapsed(value) { body.classList.toggle("ribbon-collapsed", value); }
    }
  });
  function $(selector) {
    if (selector === "#sidebar") return sidebar;
    if (selector === "#mobileSidebarClose") return close;
    if (selector === '[data-pane-toggle="project"]') return projectToggle;
    if (selector === '.activity-item[data-view].active') return views.find(node => node.classList.contains("active"));
    const view = selector.match(/^\.activity-item\[data-view="([^"]+)"\]$/)?.[1];
    if (view) return views.find(node => node.dataset.view === view);
    return null;
  }
  function $$(selector) {
    if (selector === '.activity-item[data-view]') return views;
    if (selector === '.side-view') return panels;
    return [];
  }
  const context = vm.createContext({
    document, window, $, $$, Event,
    CustomEvent: class extends Event {
      constructor(type, options = {}) { super(type); this.detail = options.detail; }
    },
    localStorage: { setItem() {} },
    requestAnimationFrame: callback => frames.push(callback),
    resizeCanvas() {}, toast() {}, openWorkspaceTab() {},
    APP_PAGE_STORAGE_KEY: "page",
    tabButtons: tabs, originalGroups: groups, ribbon
  });
  vm.runInContext(app.slice(app.indexOf("function normalizeAppPage("), app.indexOf("function formatSimulationSpeed(")), context);
  vm.runInContext(app.slice(app.indexOf("const mobileSidebarMedia ="), app.indexOf('syncMobileSidebarLayout();') + 'syncMobileSidebarLayout();'.length), context);
  window.AliceWorkspacePages = { set: context.setAppPage };
  vm.runInContext(actions.slice(actions.indexOf("    function activateSidePanel("), actions.indexOf("    function addRibbonGroup(")), context);
  const setupStart = actions.indexOf("    function setupRibbonTabs(");
  vm.runInContext(actions.slice(actions.indexOf("      const config = {", setupStart), actions.indexOf("\n    }\n\n    setupRibbonTabs();", setupStart)), context);

  function flush() {
    while (frames.length) frames.shift()();
  }
  return {
    body, sidebar, views, groups,
    select(label, { deferred = false } = {}) {
      tabs.find(tab => tab.textContent === label).click();
      if (!deferred) flush();
    },
    changePage(page) { context.setAppPage(page); flush(); },
    selected() { return tabs.filter(tab => tab.getAttribute("aria-selected") === "true").map(tab => tab.textContent); },
    visibleGroup(name) { return groups.find(group => group.dataset.uiOriginalGroup === name).style.display !== "none"; }
  };
}

for (const page of ["code", "simulation"]) {
  test(`opening components from ${page} keeps the component palette selected after the page event`, () => {
    const ui = navigation({ page });
    ui.select("元件");
    assert.equal(ui.body.dataset.appPage, "simulation");
    assert.deepEqual(ui.selected(), ["元件"]);
    assert.equal(ui.visibleGroup("components"), true);
    assert.equal(ui.visibleGroup("run"), false);
  });
}

test("opening MCU tools from simulation keeps the MCU tab selected", () => {
  const ui = navigation({ page: "simulation" });
  ui.select("MCU");
  assert.equal(ui.body.dataset.appPage, "code");
  assert.deepEqual(ui.selected(), ["MCU"]);
  assert.equal(ui.visibleGroup("mcu"), true);
});

test("rapid tool switches ignore older deferred page events", () => {
  const ui = navigation();
  ui.select("元件", { deferred: true });
  ui.select("MCU");
  assert.equal(ui.body.dataset.appPage, "code");
  assert.deepEqual(ui.selected(), ["MCU"]);
  assert.equal(ui.visibleGroup("mcu"), true);
});

test("a pending page event does not replace explicitly selected project tools", () => {
  const ui = navigation({ mobile: true });
  ui.select("元件", { deferred: true });
  ui.select("项目");
  assert.deepEqual(ui.selected(), ["项目"]);
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "false");
});

test("explicit page switches replace tools belonging to the previous page", () => {
  const ui = navigation();
  ui.select("元件");
  ui.changePage("code");
  assert.deepEqual(ui.selected(), ["编辑"]);
  ui.changePage("simulation");
  assert.deepEqual(ui.selected(), ["仿真"]);
});

test("reselecting the project ribbon keeps its mobile drawer open", () => {
  const ui = navigation({ mobile: true });
  ui.select("项目");
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "false");
  ui.select("项目");
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "false");
  assert.equal(ui.views[0].getAttribute("aria-expanded"), "true");
});

test("opening components closes a mobile sidebar that would cover the circuit", () => {
  const ui = navigation({ mobile: true });
  ui.views.find(view => view.dataset.view === "packages").click();
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "false");
  ui.select("元件");
  assert.equal(ui.sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(ui.body.classList.contains("mobile-sidebar-open"), false);
});

test("desktop activity buttons restore a hidden sidebar", () => {
  const ui = navigation({ hidden: true });
  ui.views.find(view => view.dataset.view === "packages").click();
  assert.equal(ui.body.classList.contains("hide-project-pane"), false);
});

test("selecting a ribbon tab reveals commands when the ribbon was folded", () => {
  const ui = navigation();
  ui.body.classList.add("ribbon-collapsed");
  ui.select("元件");
  assert.equal(ui.body.classList.contains("ribbon-collapsed"), false);
});

test("automatic page synchronization preserves a folded ribbon", () => {
  const ui = navigation();
  ui.body.classList.add("ribbon-collapsed");
  ui.changePage("simulation");
  assert.deepEqual(ui.selected(), ["仿真"]);
  assert.equal(ui.body.classList.contains("ribbon-collapsed"), true);
});
