"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "platform-runtime.js"), "utf8");

function boot(options = {}) {
  const events = [];
  const listeners = new Map();
  const location = new URL(options.href || "http://127.0.0.1:4173/");
  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  }
  const serial = options.serial || null;
  const root = {
    location,
    navigator: {
      userAgent: options.userAgent || "AliceSIM Test",
      maxTouchPoints: options.maxTouchPoints || 0,
      serial,
      serviceWorker: options.serviceWorker || null
    },
    document: { documentElement: { dataset: {} } },
    PointerEvent: function PointerEvent() {},
    CustomEvent: FakeCustomEvent,
    fetch: options.fetch || (async () => ({ ok: false, status: 404, async json() { return {}; } })),
    showDirectoryPicker: options.showDirectoryPicker,
    addEventListener(name, handler) { listeners.set(name, handler); },
    dispatchEvent(event) { events.push(event); return true; }
  };
  if (options.tauri) root.__TAURI_INTERNALS__ = {};
  vm.runInNewContext(source, { window: root, globalThis: root, URL, CustomEvent: FakeCustomEvent });
  return { root, platform: root.AlicePlatform, events, listeners };
}

test("web runtime routes API requests and exposes browser file and serial providers", async () => {
  const requests = [];
  const serial = { requestPort() {} };
  const picker = async options => ({ options });
  const harness = boot({
    serial,
    showDirectoryPicker: picker,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, async json() { return { service: "AliceSIM", engine: "Clang 18" }; } };
    }
  });

  assert.equal(harness.platform.kind, "web");
  assert.equal(harness.platform.capabilities.localCompilation, true);
  assert.equal(harness.platform.serial.provider, serial);
  assert.equal((await harness.platform.files.pickDirectory({ mode: "readwrite" })).options.mode, "readwrite");
  const health = await harness.platform.probeBackend();
  assert.equal(health.available, true);
  assert.equal(requests[0].url, "http://127.0.0.1:4173/api/health");
  assert.equal(harness.root.document.documentElement.dataset.aliceHost, "web");
});

test("web runtime discovers the local HAL backend when the page is served from another loopback port", async () => {
  const requests = [];
  const harness = boot({
    href: "http://127.0.0.1:4175/",
    fetch: async url => {
      requests.push(String(url));
      if (String(url) === "http://127.0.0.1:4175/api/health") {
        return { ok: true, status: 200, async json() { return { html: "preview fallback" }; } };
      }
      if (String(url) === "http://127.0.0.1:4173/api/health") {
        return { ok: true, status: 200, async json() { return { service: "AliceSIM", engine: "Clang 18" }; } };
      }
      if (String(url) === "http://127.0.0.1:4173/api/sim-model") {
        return { ok: true, status: 200, async json() { return { ok: true }; } };
      }
      throw new Error("unexpected backend candidate");
    }
  });

  await harness.platform.fetch("/api/sim-model", { method: "POST" });
  assert.deepEqual(requests.slice(0, 4), [
    "http://127.0.0.1:4175/api/sim-model",
    "http://127.0.0.1:4175/api/health",
    "http://127.0.0.1:4173/api/health",
    "http://127.0.0.1:4173/api/sim-model"
  ]);
  const health = await harness.platform.probeBackend();
  assert.equal(health.available, true);
  assert.equal(health.origin, "http://127.0.0.1:4173");
});

test("Tauri desktop retains the local backend and native-shell capabilities", () => {
  const harness = boot({ href: "tauri://localhost/?alice-host=tauri-desktop", tauri: true });
  assert.equal(harness.platform.kind, "tauri-desktop");
  assert.equal(harness.platform.capabilities.nativeShell, true);
  assert.equal(harness.platform.capabilities.mobile, false);
  assert.equal(harness.platform.capabilities.localCompilation, true);
});

test("Tauri mobile rejects local API calls with an explicit non-fake fallback", async () => {
  let networkCalls = 0;
  const harness = boot({
    href: "tauri://localhost/index.html?alice-host=tauri-mobile",
    tauri: true,
    userAgent: "AliceSIM Android",
    maxTouchPoints: 5,
    fetch: async () => { networkCalls += 1; throw new Error("should not fetch"); }
  });

  assert.equal(harness.platform.kind, "tauri-mobile");
  assert.equal(harness.platform.capabilities.mobile, true);
  assert.equal(harness.platform.capabilities.localCompilation, false);
  await assert.rejects(
    harness.platform.fetch("/api/clang-check", { method: "POST" }),
    error => error.code === "ALICE_LOCAL_BACKEND_UNAVAILABLE" && /不包含本地 Python\/Clang/.test(error.message)
  );
  const health = await harness.platform.probeBackend();
  assert.equal(health.available, false);
  assert.match(health.detail, /桌面版/);
  assert.equal(networkCalls, 0);
  assert.equal(harness.events.at(-1).type, "alice:platform-backend");
});

test("directory selection returns null when a device has no writable directory API", async () => {
  const harness = boot();
  assert.equal(harness.platform.capabilities.directoryPicker, false);
  assert.equal(await harness.platform.files.pickDirectory({ mode: "readwrite" }), null);
});
