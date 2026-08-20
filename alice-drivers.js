(function (root, factory) {
  "use strict";

  var api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AlicePeripheralDrivers = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var COMMON_FILES = ["Drivers/AliceSIM/Inc/alicesim_peripherals.h"];
  var DRIVERS = [
    {
      id: "ssd1306",
      name: "AliceSIM SSD1306 OLED",
      description: "128×64 I²C OLED 驱动，包含显存、像素、线框、位图和 5×7 文本绘制。",
      componentTypes: ["oled"],
      files: [
        "Drivers/AliceSIM/Inc/alicesim_ssd1306.h",
        "Drivers/AliceSIM/Src/alicesim_ssd1306.c"
      ],
      installable: true,
      status: "available",
      attribution: "libdriver 制作 · AliceSIM 适配",
      upstream: {
        author: "libdriver",
        repository: "ssd1306",
        url: "https://github.com/libdriver/ssd1306",
        license: "MIT"
      }
    },
    {
      id: "light-sensor",
      name: "AliceSIM 光敏传感器",
      description: "AO ADC 采样、毫伏/照度换算、DO 阈值读取和线性标定。",
      componentTypes: ["lightSensor"],
      files: [
        "Drivers/AliceSIM/Inc/alicesim_light_sensor.h",
        "Drivers/AliceSIM/Src/alicesim_light_sensor.c"
      ],
      installable: true,
      status: "available",
      attribution: "AliceSIM 制作",
      upstream: null
    }
  ];
  var catalogApi = root.AlicePeripheralCatalog;
  if (!catalogApi && typeof require === "function") {
    try { catalogApi = require("./peripheral-catalog.js"); } catch (_) { catalogApi = null; }
  }
  if (catalogApi && typeof catalogApi.drivers === "function") {
    catalogApi.drivers().forEach(function (driver) {
      if (!DRIVERS.some(function (existing) { return existing.id === driver.id; })) DRIVERS.push(driver);
    });
  }
  var libdriverRegistry = root.AliceLibDriverRegistry;
  if (!libdriverRegistry && typeof require === "function") {
    try { libdriverRegistry = require("./libdriver-registry.js"); } catch (_) { libdriverRegistry = null; }
  }

  var scriptSource = root.document && root.document.currentScript && root.document.currentScript.src;
  var baseUrl = scriptSource && typeof URL === "function" ? new URL(".", scriptSource).toString() : "./";

  function copyDriver(driver) {
    return {
      id: driver.id,
      name: driver.name,
      description: driver.description,
      componentTypes: driver.componentTypes.slice(),
      files: driver.files.slice(),
      plannedFiles: Array.isArray(driver.plannedFiles) ? driver.plannedFiles.slice() : driver.files.slice(),
      bus: driver.bus || "",
      installable: driver.installable !== false,
      status: driver.status || "available",
      attribution: driver.attribution || "AliceSIM 制作",
      upstream: driver.upstream ? Object.assign({}, driver.upstream) : null
    };
  }

  function list() {
    return DRIVERS.map(copyDriver);
  }

  function upstreamCandidates() {
    if (!libdriverRegistry || typeof libdriverRegistry.list !== "function") return [];
    var alreadyCollected = new Set(DRIVERS.map(function (driver) {
      return driver.upstream && driver.upstream.repository;
    }).filter(Boolean));
    return libdriverRegistry.list().filter(function (candidate) {
      return !alreadyCollected.has(candidate.repository);
    });
  }

  function upstreamCategories() {
    return libdriverRegistry && typeof libdriverRegistry.categories === "function" ? libdriverRegistry.categories() : [];
  }

  function selectedDrivers(ids) {
    var requested;
    if (ids == null || ids === "all" || ids === "*") requested = DRIVERS.filter(function (driver) { return driver.installable !== false; }).map(function (driver) { return driver.id; });
    else requested = Array.isArray(ids) ? ids.slice() : [ids];
    var unique = [];
    requested.forEach(function (id) {
      var normalized = String(id || "").trim();
      if (!normalized || unique.indexOf(normalized) >= 0) return;
      var matched = DRIVERS.find(function (driver) { return driver.id === normalized; });
      if (!matched) {
        throw new Error("未知的 AliceSIM 外设驱动：" + normalized);
      }
      if (matched.installable === false) throw new Error(matched.name + " 驱动仍在适配中，暂时不能加入工程");
      unique.push(normalized);
    });
    return DRIVERS.filter(function (driver) { return unique.indexOf(driver.id) >= 0; });
  }

  function sourceUrl(path) {
    var normalized = String(path || "").replace(/^\/+/, "");
    if (typeof URL === "function" && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(baseUrl)) {
      return new URL(normalized, baseUrl).toString();
    }
    return baseUrl.replace(/\/?$/, "/") + normalized;
  }

  async function getFiles(ids, options) {
    var config = options && typeof options === "object" ? options : {};
    var fetchSource = config.fetch || root.fetch;
    if (typeof fetchSource !== "function") throw new Error("当前环境不支持读取 AliceSIM 驱动源码");
    var selected = selectedDrivers(ids);
    var paths = [];
    selected.forEach(function (driver) {
      driver.files.forEach(function (path) { if (paths.indexOf(path) < 0) paths.push(path); });
    });
    var availableDrivers = DRIVERS.filter(function (driver) { return driver.installable !== false; });
    if (selected.length === availableDrivers.length && selected.every(function (driver) { return availableDrivers.indexOf(driver) >= 0; })) {
      COMMON_FILES.forEach(function (path) { if (paths.indexOf(path) < 0) paths.push(path); });
    }
    var loaded = await Promise.all(paths.map(async function (path) {
      var response = await fetchSource(sourceUrl(path));
      if (!response || response.ok === false || typeof response.text !== "function") {
        throw new Error("无法读取驱动源码：" + path);
      }
      return [path, await response.text()];
    }));
    var output = {};
    loaded.forEach(function (entry) { output[entry[0]] = entry[1]; });
    return output;
  }

  function stateFileEntries(state) {
    if (!state || !state.files) return [];
    if (state.files instanceof Map) {
      return Array.from(state.files.entries()).map(function (entry) {
        return [entry[0], entry[1] && typeof entry[1] === "object" ? entry[1].content : entry[1]];
      });
    }
    return Object.keys(state.files).map(function (path) {
      var value = state.files[path];
      return [path, value && typeof value === "object" ? value.content : value];
    });
  }

  async function install(ids, options) {
    var config = options && typeof options === "object" ? options : {};
    var workspace = config.workspace || root.AliceProjectWorkspace;
    if (!workspace) throw new Error("AliceSIM 工程工作区尚未就绪");
    var files = await getFiles(ids, config);
    var overwrite = Boolean(config.overwrite);

    if (typeof workspace.addFiles === "function") {
      var writer = overwrite && typeof workspace.upsertFiles === "function" ? workspace.upsertFiles : workspace.addFiles;
      var incrementalResult = await writer.call(workspace, files, {
        overwrite: overwrite,
        markDirty: true,
        source: "AlicePeripheralDrivers"
      });
      var installedPaths = incrementalResult && Array.isArray(incrementalResult.added)
        ? incrementalResult.added.concat(incrementalResult.updated || [])
        : Object.keys(files);
      var skippedPaths = incrementalResult && Array.isArray(incrementalResult.skipped)
        ? incrementalResult.skipped.map(function (item) { return typeof item === "string" ? item : item.path; }).filter(Boolean)
        : [];
      return { installed: installedPaths, skipped: skippedPaths, mode: "incremental", result: incrementalResult };
    }
    if (typeof workspace.getState !== "function" || typeof workspace.loadFiles !== "function") {
      throw new Error("当前工程工作区不支持写入驱动文件");
    }

    var state = workspace.getState();
    var merged = {};
    stateFileEntries(state).forEach(function (entry) {
      if (typeof entry[1] === "string") merged[entry[0]] = entry[1];
    });
    var installed = [];
    var skipped = [];
    Object.keys(files).forEach(function (path) {
      if (!overwrite && Object.prototype.hasOwnProperty.call(merged, path)) {
        skipped.push(path);
        return;
      }
      merged[path] = files[path];
      installed.push(path);
    });
    if (installed.length > 0) {
      await workspace.loadFiles(merged, state.rootName || "STM32_Project");
      if (state.activePath && typeof workspace.openFile === "function") workspace.openFile(state.activePath);
    }
    if (root.dispatchEvent && typeof root.CustomEvent === "function") {
      root.dispatchEvent(new root.CustomEvent("alice-peripheral-drivers-installed", {
        detail: { ids: selectedDrivers(ids).map(function (driver) { return driver.id; }), installed: installed, skipped: skipped }
      }));
    }
    return { installed: installed, skipped: skipped, mode: "workspace-reload" };
  }

  return Object.freeze({
    schemaVersion: 1,
    libraryId: "alicesim-peripherals",
    version: "1.0.0",
    manifestUrl: sourceUrl("Drivers/AliceSIM/manifest.json"),
    list: list,
    upstreamCandidates: upstreamCandidates,
    upstreamCategories: upstreamCategories,
    getFiles: getFiles,
    install: install,
    sourceUrl: sourceUrl
  });
}));
