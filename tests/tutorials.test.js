"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { render, resolveUrl } = require("../tutorials/reader.js");
const root = path.resolve(__dirname, "..");
const tutorials = path.join(root, "tutorials");
const read = relative => fs.readFileSync(path.join(tutorials, relative), "utf8");
const catalog = JSON.parse(read("catalog.json"));
const manifest = JSON.parse(read("example-manifest.json"));
const base = "http://127.0.0.1:4173/tutorials/lessons/gpio.md";

test("tutorial Markdown preserves C operators, pointers, formatting strings and code line breaks", () => {
  const code = 'if (HAL_ADC_Start(&hadc1) == HAL_OK) {\n  snprintf(buf, sizeof(buf), "%u.%u mV", value / 10U, value % 10U);\n}';
  const result = render(`# Sample\n\n## Read ADC\n\n\`\`\`c\n${code}\n\`\`\``, base);
  assert.deepEqual(result.headings, [{ level: 2, id: "section-1", text: "Read ADC" }]);
  const output = result.html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1]
    .replace(/<\/?span[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.equal(output, code, "copying rendered code must preserve the firmware text");
});

test("tutorial Markdown rejects executable URLs and escapes untrusted HTML", () => {
  const result = render('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert)\n\n![bad](data:text/html,hello)\n\n`<script>`', base);
  assert.doesNotMatch(result.html, /<(?:img|script|a)(?:\s|>)/);
  assert.match(result.html, /&lt;img/);
  assert.equal(resolveUrl("java\nscript:alert(1)", base), null);
  assert.equal(resolveUrl("../assets/circuit.png", "tauri://localhost/tutorials/lessons/gpio.md"), "tauri://localhost/tutorials/assets/circuit.png");
  assert.equal(resolveUrl("tauri://other-host/private", "tauri://localhost/tutorials/lessons/gpio.md"), null);
  const links = render('[ADC](adc.md)\n\n![Circuit](../assets/lesson-gpio-on.png)\n\n[JSON](../projects/Learning01_GPIO.alice.json)', base).html;
  assert.match(links, /href="#adc"/);
  assert.match(links, /src="http:\/\/127\.0\.0\.1:4173\/tutorials\/assets\/lesson-gpio-on.png"/);
  assert.match(links, /alice\.json" download/);
});

test("every published lesson and local media/download link resolves inside the shipped tutorial folder", () => {
  const ids = new Set(catalog.lessons.map(lesson => lesson.id));
  assert.equal(ids.size, catalog.lessons.length);
  const projectIds = new Set(manifest.projects.map(project => project.id));
  const lessonFiles = fs.readdirSync(path.join(tutorials, "lessons")).filter(name => name.endsWith(".md"));
  assert.deepEqual(lessonFiles.sort(), catalog.lessons.map(lesson => path.basename(lesson.path)).sort());
  for (const lesson of catalog.lessons) {
    if (lesson.project) assert.ok(projectIds.has(lesson.project), lesson.id);
    const source = read(lesson.path);
    assert.ok(render(source, new URL(lesson.path, "http://localhost/tutorials/").href).headings.length >= 3);
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      const file = path.resolve(tutorials, path.dirname(lesson.path), match[1]);
      assert.ok(file.startsWith(tutorials + path.sep), `${lesson.id}: link escaped tutorial package`);
      assert.ok(fs.statSync(file).isFile(), `${lesson.id}: missing ${match[1]}`);
      if (file.endsWith(".md")) assert.ok(ids.has(path.basename(file, ".md")), `${lesson.id}: broken lesson route`);
    }
  }
});

test("all fourteen downloads contain real firmware, IOC, circuit and their third-party licenses", () => {
  assert.equal(manifest.projects.length, 14);
  for (const project of manifest.projects) {
    for (const field of ["main", "ioc", "circuit", "project", "download"]) {
      assert.ok(fs.statSync(path.join(tutorials, project[field])).size > 100, `${project.id}: ${field}`);
    }
    const snapshot = JSON.parse(read(project.project));
    assert.equal(snapshot.files["Core/Src/main.c"].replace(/\r\n/g, "\n"), read(project.main).replace(/\r\n/g, "\n"));
    assert.ok(snapshot.circuit.components.some(component => component.type === "mcu" || component.type === "stm32" || component.id === "mcu"), `${project.id}: MCU missing`);
    assert.ok(snapshot.circuit.wires.length > 0, `${project.id}: unwired circuit`);
    for (const license of project.licenses) assert.ok(read(license).length > 100);
    assert.equal(project.checks.firmwareAndHeadersByteIdentical, true);
  }
});

test("offline navigation to tutorials uses the tutorial shell and APIs stay network-only", async () => {
  const listeners = {};
  const calls = [];
  const sandbox = {
    URL, Promise, Error,
    self: { location: { origin: "http://localhost" }, registration: { scope: "http://localhost/" }, addEventListener: (name, callback) => { listeners[name] = callback; } },
    fetch: async () => { throw new Error("offline"); },
    caches: { match: async url => { calls.push(url); return typeof url === "string" ? { shell: url } : null; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "service-worker.js"), "utf8"), sandbox);
  let result;
  const event = url => ({ request: { method: "GET", mode: "navigate", url }, respondWith: value => { result = value; } });
  listeners.fetch(event("http://localhost/tutorials/#adc"));
  assert.equal((await result).shell, "./tutorials/index.html");
  result = undefined;
  listeners.fetch(event("http://localhost/api/compile"));
  assert.equal(result, undefined);
  assert.equal(calls.at(-1), "./tutorials/index.html");
});
