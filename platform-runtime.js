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
  var backendState = {
    available: false,
    service: "",
    engine: "",
    detail: kind === "tauri-mobile" ? mobileBackendMessage : "not-probed"
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
    try { return new URL(text, location.origin || location.href).href; } catch (_) { return text; }
  }

  function platformFetch(input, init) {
    if (!browserFetch) return Promise.reject(new Error("Fetch is unavailable on this device"));
    if (kind === "tauri-mobile" && isApiRequest(input)) {
      var unavailable = new Error(mobileBackendMessage);
      unavailable.code = "ALICE_LOCAL_BACKEND_UNAVAILABLE";
      return Promise.reject(unavailable);
    }
    var request = typeof input === "string" ? apiUrl(input) : input;
    return browserFetch(request, init);
  }

  function directoryPicker(options) {
    if (typeof root.showDirectoryPicker !== "function") return Promise.resolve(null);
    return root.showDirectoryPicker(options || { mode: "read" });
  }

  function backendSnapshot() {
    return Object.freeze(Object.assign({}, backendState));
  }

  async function probeBackend() {
    try {
      var response = await platformFetch("/api/health", { cache: "no-store" });
      var payload = response.ok ? await response.json() : null;
      backendState = {
        available: Boolean(payload && payload.service === "AliceSIM"),
        service: payload && payload.service || "",
        engine: payload && payload.engine || "",
        detail: payload && payload.detail || ""
      };
    } catch (error) {
      backendState = { available: false, service: "", engine: "", detail: error && error.message || "offline" };
    }
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
