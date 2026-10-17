(function (root) {
  "use strict";

  if (!root || root.AlicePlatform) return;

  var location = root.location || { href: "", origin: "", protocol: "" };
  var navigator = root.navigator || {};
  var search = "";
  try { search = new URL(location.href).searchParams.get("alice-host") || ""; } catch (_) {}

  var tauriRuntime = Boolean(root.__TAURI_INTERNALS__ || root.__TAURI__);
  var mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigator.userAgent || ""));
  var mobile = search === "tauri-mobile" || mobileUserAgent || Boolean(navigator.userAgentData && navigator.userAgentData.mobile);
  var kind = search === "tauri-desktop" || (tauriRuntime && !mobile)
    ? "tauri-desktop"
    : (search === "tauri-mobile" || (tauriRuntime && mobile) ? "tauri-mobile" : "web");
  var browserFetch = typeof root.fetch === "function" ? root.fetch.bind(root) : null;
  var mobileBackendMessage = "手机和平板版本不包含本地 Python/Clang 编译服务。请在桌面版中构建，或通过提供 AliceSIM 后端的网页使用编译与 HAL 仿真。";
  var backendOrigin = "";
  var backendState = {
    available: false,
    service: "",
    engine: "",
    detail: kind === "tauri-mobile" ? mobileBackendMessage : "not-probed",
    origin: ""
  };

  function isApiRequest(value) {
    var text = typeof value === "string" ? value : value && value.url;
    if (!text) return false;
    try { return /^\/api(?:\/|$)/.test(new URL(text, location.origin || location.href).pathname); }
    catch (_) { return /^\/api(?:\/|$)/.test(String(text)); }
  }

  function apiUrl(value) {
    var text = String(value || "");
    if (!/^\/api(?:\/|$)/.test(text)) return value;
    try { return new URL(text, backendOrigin || location.origin || location.href).href; } catch (_) { return text; }
  }

  function isLoopbackLocation() {
    try {
      var parsed = new URL(location.href);
      return /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(parsed.hostname) && /^https?:$/i.test(parsed.protocol);
    } catch (_) {
      return false;
    }
  }

  function backendCandidates() {
    var candidates = [];
    function add(origin) {
      var normalized = String(origin || "").replace(/\/$/, "");
      if (normalized && candidates.indexOf(normalized) < 0) candidates.push(normalized);
    }
    try {
      var parsed = new URL(location.href);
      add(parsed.origin);
      if (!isLoopbackLocation()) return candidates;
      var configured = parsed.searchParams.get("alice-backend");
      if (configured) {
        try { add(new URL(configured, parsed.origin).origin); } catch (_) {}
      }
      var host = parsed.hostname;
      var protocol = parsed.protocol;
      // The standalone launcher normally serves both UI and API from one
      // port. During development the UI may be opened by a preview server
      // on 4174/4175 while the local HAL service remains on its default
      // 4173 port, so check the small loopback range explicitly.
      for (var port = 4173; port <= 4193; port += 1) add(protocol + "//" + host + ":" + port);
    } catch (_) {}
    return candidates;
  }

  async function platformFetch(input, init) {
    if (!browserFetch) return Promise.reject(new Error("Fetch is unavailable on this device"));
    if (kind === "tauri-mobile" && isApiRequest(input)) {
      var unavailable = new Error(mobileBackendMessage);
      unavailable.code = "ALICE_LOCAL_BACKEND_UNAVAILABLE";
      return Promise.reject(unavailable);
    }
    var request = typeof input === "string" ? apiUrl(input) : input;
    var apiRequest = isApiRequest(input);
    try {
      var response = await browserFetch(request, init);
      if (!apiRequest || backendOrigin) return response;
      var discovered = await probeBackend();
      var retryUrl = apiUrl(input);
      if (discovered.available && retryUrl !== request) return browserFetch(retryUrl, init);
      return response;
    } catch (error) {
      if (!apiRequest) throw error;
      var discoveredAfterError = await probeBackend();
      var retryAfterError = apiUrl(input);
      if (discoveredAfterError.available && retryAfterError !== request) return browserFetch(retryAfterError, init);
      throw error;
    }
  }

  function directoryPicker(options) {
    if (typeof root.showDirectoryPicker !== "function") return Promise.resolve(null);
    return root.showDirectoryPicker(options || { mode: "read" });
  }

  function backendSnapshot() {
    return Object.freeze(Object.assign({}, backendState));
  }

  async function probeBackend() {
    if (kind === "tauri-mobile") {
      backendOrigin = "";
      backendState = {
        available: false,
        service: "",
        engine: "",
        detail: mobileBackendMessage,
        origin: ""
      };
      root.dispatchEvent(new CustomEvent("alice:platform-backend", { detail: backendSnapshot() }));
      return backendSnapshot();
    }
    var lastError = null;
    var candidates = backendCandidates();
    for (var index = 0; index < candidates.length; index += 1) {
      var origin = candidates[index];
      try {
        var response = await browserFetch(origin + "/api/health", { cache: "no-store" });
        var payload = response.ok ? await response.json() : null;
        if (!response.ok || !payload || payload.service !== "AliceSIM") {
          lastError = new Error("HTTP " + (response.status || 404));
          continue;
        }
        backendOrigin = origin;
        backendState = {
          available: true,
          service: payload.service || "AliceSIM",
          engine: payload.engine || "",
          detail: payload.detail || "",
          origin: backendOrigin
        };
        root.dispatchEvent(new CustomEvent("alice:platform-backend", { detail: backendSnapshot() }));
        return backendSnapshot();
      } catch (error) {
        lastError = error;
      }
    }
    backendOrigin = "";
    backendState = {
      available: false,
      service: "",
      engine: "",
      detail: lastError && lastError.message || "offline",
      origin: ""
    };
    root.dispatchEvent(new CustomEvent("alice:platform-backend", { detail: backendSnapshot() }));
    return backendSnapshot();
  }

  var capabilities = Object.freeze({
    touch: "ontouchstart" in root || Number(navigator.maxTouchPoints || 0) > 0,
    pointer: typeof root.PointerEvent === "function",
    directoryPicker: typeof root.showDirectoryPicker === "function",
    serial: Boolean(navigator.serial && typeof navigator.serial.requestPort === "function"),
    serviceWorker: Boolean(navigator.serviceWorker),
    nativeShell: kind !== "web",
    mobile: mobile,
    localCompilation: kind !== "tauri-mobile"
  });

  var platform = Object.freeze({
    kind: kind,
    capabilities: capabilities,
    fetch: platformFetch,
    apiUrl: apiUrl,
    probeBackend: probeBackend,
    getBackendState: backendSnapshot,
    files: Object.freeze({ pickDirectory: directoryPicker }),
    serial: Object.freeze({ provider: navigator.serial || null })
  });

  root.AlicePlatform = platform;
  if (root.document && root.document.documentElement) {
    root.document.documentElement.dataset.aliceHost = kind;
    root.document.documentElement.dataset.aliceInput = capabilities.touch ? "touch" : "pointer";
  }

  root.addEventListener("load", function () {
    probeBackend();
    if (kind !== "web" || !capabilities.serviceWorker || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(function () {
      // PWA installation is optional; the simulator remains usable without it.
    });
  }, { once: true });
}(typeof window !== "undefined" ? window : globalThis));
