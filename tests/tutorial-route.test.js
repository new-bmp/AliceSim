"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const markdown = require("../tutorials/reader.js");

// Execute the real tutorial controller. The fixture supplies only DOM methods
// used by routing, plus a manually controlled response for the second lesson.
function tutorialPage() {
  function node(tagName = "div") {
    const classes = new Set();
    const listeners = new Map();
    return {
      tagName, hidden: false, value: "", textContent: "", innerHTML: "", children: [], attributes: {},
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); return force; }
      },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; this.textContent = ""; },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(name, callback) { listeners.set(name, callback); },
      focus() {}, scrollIntoView() {}, contains(target) { return this === target || this.children.some(child => child.contains?.(target)); }
    };
  }
  const ids = ["sidebar", "menuToggle", "search", "navigation", "searchStatus", "lessonContent", "contents", "lessonStatus", "exampleActions", "pagination", "lesson", "article", "lessonTitle", "lessonSummary", "breadcrumb", "lessonLabel"];
  const nodes = Object.fromEntries(ids.map(id => [id, node()]));
  nodes.lessonContent.hidden = true;
  const document = { getElementById: id => nodes[id] || null, createElement: node, createDocumentFragment: node,
    createTextNode: value => Object.assign(node("#text"), { textContent: value }), addEventListener() {} };
  const windowListeners = new Map();
  const window = { AliceTutorialMarkdown: markdown, addEventListener: (name, callback) => windowListeners.set(name, callback) };
  const location = { href: "http://localhost/tutorials/#start", hash: "#start" };
  let finishSecond, secondRequested = false;
  const lessons = [
    { id: "start", title: "Lesson A", summary: "Summary A", group: "Test", path: "lessons/start.md" },
    { id: "second", title: "Lesson B", summary: "Summary B", group: "Test", path: "lessons/second.md" }
  ];
  const response = content => ({ ok: true, json: async () => content, text: async () => content });
  const fetch = async url => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/catalog.json")) return response({ lessons });
    if (pathname.endsWith("/example-manifest.json")) return response({ projects: [] });
    if (pathname.endsWith("/start.md")) return response("# A\n\n## A heading\n\nArticle A is visible.");
    if (pathname.endsWith("/second.md")) {
      secondRequested = true;
      return new Promise(resolve => { finishSecond = () => resolve(response("# B\n\n## B heading\n\nArticle B is visible.")); });
    }
    throw new Error("Unexpected request: " + pathname);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../tutorials/tutorials.js"), "utf8"), { window, document, location, navigator: {}, URL, fetch, console });
  return { nodes, get secondRequested() { return secondRequested; }, finishSecond: () => finishSecond(),
    navigate(hash) { location.hash = hash; windowListeners.get("hashchange")(); } };
}

async function until(predicate, label) {
  for (let turn = 0; turn < 20; turn++) {
    if (predicate()) return;
    await new Promise(setImmediate);
  }
  assert.fail(label);
}

test("returning to loaded A while B is pending restores A and rejects B's late response", async () => {
  const page = tutorialPage();
  await until(() => page.nodes.lessonTitle.textContent === "Lesson A", "initial lesson did not render");
  assert.equal(page.nodes.lessonContent.hidden, false);
  assert.match(page.nodes.article.innerHTML, /Article A is visible/);

  page.navigate("#second");
  await until(() => page.secondRequested, "second lesson request did not begin");
  assert.equal(page.nodes.lessonContent.hidden, true);
  assert.equal(page.nodes.lessonStatus.hidden, false);

  page.navigate("#start");
  await until(() => !page.nodes.lessonContent.hidden, "returning to cached A left the article hidden");
  assert.equal(page.nodes.lessonTitle.textContent, "Lesson A");
  assert.equal(page.nodes.lessonSummary.textContent, "Summary A");
  assert.equal(page.nodes.lessonStatus.hidden, true);
  assert.match(page.nodes.article.innerHTML, /Article A is visible/);

  page.finishSecond();
  await new Promise(setImmediate);
  assert.equal(page.nodes.lessonContent.hidden, false);
  assert.equal(page.nodes.lessonStatus.hidden, true);
  assert.equal(page.nodes.lessonTitle.textContent, "Lesson A");
  assert.match(page.nodes.article.innerHTML, /Article A is visible/);
  assert.doesNotMatch(page.nodes.article.innerHTML, /Article B is visible/);
});
