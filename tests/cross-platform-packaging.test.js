"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("PWA manifest provides raster install icons and a standalone shell", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.type === "image/png"));
  for (const icon of manifest.icons.filter(item => item.type === "image/png")) {
    const file = path.join(root, icon.src.replace(/^\.\//, ""));
    assert.ok(fs.statSync(file).size > 500, `${icon.src} should contain a generated icon`);
  }
});

test("service worker keeps compilation APIs network-only", () => {
  const worker = read("service-worker.js");
  const apiGuard = worker.indexOf('url.pathname.startsWith("/api/")');
  const respondWith = worker.indexOf("event.respondWith", worker.indexOf('addEventListener("fetch"'));
  assert.ok(apiGuard >= 0 && apiGuard < respondWith);
  assert.match(worker, /assets\/pwa\/192x192\.png/);
  assert.match(worker, /assets\/pwa\/512x512\.png/);
  assert.doesNotMatch(worker.match(/const APP_SHELL = \[[\s\S]*?\];/)?.[0] || "", /\/api\//);
});

test("web build includes every local JavaScript entry used by the application", () => {
  const html = read("index.html");
  const build = read("scripts/build-web.mjs");
  const localScripts = Array.from(html.matchAll(/<script src="\.\/([^"?]+)(?:\?[^" ]*)?"/g), match => match[1]);
  assert.ok(localScripts.length > 10);
  for (const script of localScripts) assert.match(build, new RegExp(`"${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.ok(html.indexOf("platform-runtime.js") < html.indexOf("app.js"));
});

test("Tauri desktop and mobile configurations keep their backend boundaries", () => {
  const desktop = JSON.parse(read("src-tauri/tauri.conf.json"));
  const android = JSON.parse(read("src-tauri/tauri.android.conf.json"));
  const ios = JSON.parse(read("src-tauri/tauri.ios.conf.json"));
  assert.equal(desktop.identifier, "io.alicesim.app");
  assert.equal(desktop.app.windows[0].fullscreen, true);
  assert.equal(desktop.app.windows[0].decorations, false);
  assert.deepEqual(desktop.bundle.externalBin, ["binaries/alicesim-backend"]);
  assert.ok(desktop.bundle.icon.some(icon => icon.endsWith("icon.ico")));
  for (const mobile of [android, ios]) {
    assert.deepEqual(mobile.bundle.externalBin, []);
    assert.match(mobile.app.windows[0].url, /alice-host=tauri-mobile/);
  }
});

test("desktop launcher uses a concrete socket address and packaged sidecar", () => {
  const rust = read("src-tauri/src/lib.rs");
  assert.match(rust, /SocketAddr::from\(\(\[127, 0, 0, 1\], port\)\)/);
  assert.match(rust, /TcpStream::connect_timeout\(&address,/);
  assert.match(rust, /\.sidecar\("alicesim-backend"\)/);
  assert.match(rust, /window\.eval\(&format!/);
});
