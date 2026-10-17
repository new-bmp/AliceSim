(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) {
    root.AliceSidebarTools = api;
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", api.mount, { once: true });
    else api.mount();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function deviceInfo(ioc, firmware) {
    const clock = Number(ioc?.values?.["RCC.SYSCLKFreq_VALUE"] || ioc?.values?.["RCC.SYSCLKFreq_Value"]);
    const pins = ioc ? (ioc.configuredPins || []) : Object.entries(firmware?.pins || {}).map(([key, value]) => ({ ...value, base: value.physicalPin || key }));
    const unique = new Map();
    pins.forEach(item => {
      const pin = String(item.base || item.physicalPin || item.id || item.pin || "").match(/^P[A-Z]\d+/i)?.[0]?.toUpperCase();
      if (!pin) return;
      unique.set(pin, { pin, signal: item.signal || item.iocSignal || item.mode || "GPIO", label: item.label || item.aliases?.[0] || "", mode: item.mode || "" });
    });
    return {
      mcu: ioc?.mcu || firmware?.mcu || "等待工程",
      packageName: ioc?.packageName || "—",
      source: ioc?.fileName || (firmware ? "已构建固件" : "尚未载入 IOC"),
      clockHz: Number.isFinite(clock) && clock > 0 ? clock : null,
      peripherals: (ioc?.peripherals || []).map(item => item.name),
      pins: [...unique.values()].sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }))
    };
  }

  function filterComponents(catalog, query = "", category = "all") {
    const words = String(query).normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean);
    return catalog.filter(item => !item.disabled && (category === "all" || item.category === category)
      && words.every(word => `${item.type} ${item.label} ${item.description || ""}`.normalize("NFKC").toLowerCase().includes(word)));
  }

  function changeTraceSelection(channels, selected, pin, checked) {
    const available = new Set(channels.map(channel => channel.pin));
    const pins = [...new Set(selected)].filter(item => available.has(item)).slice(0, 4);
    if (!available.has(pin)) return { pins, error: "unknown" };
    if (checked && !pins.includes(pin)) {
      if (pins.length === 4) return { pins, error: "limit" };
      pins.push(pin);
    } else if (!checked && pins.includes(pin)) {
      if (pins.length === 1) return { pins, error: "last" };
      pins.splice(pins.indexOf(pin), 1);
    }
    return { pins, error: "" };
  }

  function reduceMessages(messages, detail = {}) {
    const text = String(detail.text || "");
    if (detail.severity === "command" && text.startsWith("alice hal-build ")) return [];
    if (!text || !["error", "warn", "success"].includes(detail.severity)) return messages;
    return [...messages, { text, severity: detail.severity }].slice(-8);
  }

  function runtimeLabel({ running, busy, status }) {
    if (busy) return "构建中";
    if (!running && ["RUNNING", "SENSOR TEST"].includes(status)) return "已暂停";
    const labels = { IDLE: "未运行", RUNNING: "运行中", PAUSED: "已暂停", WAITING: "等待服务", ERROR: "运行出错", BLOCKED: "等待输入", HALTED: "已结束", "SENSOR TEST": "包络测试", "ENVELOPE DONE": "测试完成" };
    return labels[status] || status || "未运行";
  }

  const CATEGORIES = {
    basic: ["vcc", "ground", "netTerminal", "voltageProbe", "currentProbe", "resistor", "capacitor", "dcDcConverter", "mosfet"],
    input: ["adcSource", "button", "lightSensor", "dht11", "hcsr04", "bmp280", "mpu6050", "bh1750", "sht30", "ina219", "ds18b20", "rotaryEncoder", "potentiometer", "pir", "mq2", "joystick"],
    display: ["led", "oled", "spiDisplay", "sg90", "buzzer", "tm1637", "max7219", "ws2812", "relay"]
  };
  const CATEGORY_LABELS = { basic: "基础与电源", input: "输入与传感器", display: "显示与输出", bus: "通信与扩展" };
  let mounted = false;

  function mount() {
    const document = root?.document;
    if (mounted || !document?.getElementById("sideComponentList")) return false;
    mounted = true;
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text != null) element.textContent = text;
      if (tag === "button") element.type = "button";
      return element;
    };
    const setText = (selector, value) => {
      const element = $(selector);
      if (element && element.textContent !== String(value)) element.textContent = value;
    };
    const empty = (target, text) => target.replaceChildren(node("p", "side-empty", text));
    const openTool = tool => {
      root.AliceWorkspacePages?.set?.("simulation");
      root.AliceSimulationWorkbench?.select?.(tool);
      document.getElementById("simToolTab-" + tool)?.focus({ preventScroll: true });
    };
    const openIoc = (view, pin) => {
      root.AliceWorkspacePages?.set?.("code");
      root.AliceIocViewer?.open?.();
      root.AliceIocViewer?.show?.(view);
      $$(".side-pin-target").forEach(row => row.classList.remove("side-pin-target"));
      if (pin) {
        const row = $$('.ioc-page[data-ioc-content="pins"] tbody tr').find(row => row.children[1]?.textContent.trim() === pin);
        if (row) {
          row.classList.add("side-pin-target");
          row.tabIndex = -1;
          row.focus({ preventScroll: true });
          row.scrollIntoView({ block: "nearest" });
        }
      }
    };
    $$("[data-side-tool]").forEach(button => button.addEventListener("click", () => openTool(button.dataset.sideTool)));
    $$("[data-side-ioc]").forEach(button => button.addEventListener("click", () => openIoc(button.dataset.sideIoc)));

    function renderDevice() {
      const ioc = root.AliceIocViewer?.getData?.();
      const info = deviceInfo(ioc, root.AliceHalSimulator?.getModel?.());
      const tree = ioc && root.AliceClockTree?.fromValues?.(ioc.values || {});
      const frequency = info.clockHz || (tree?.confidence !== "reset-default" ? tree?.sysclk : null);
      setText("#sideDeviceName", info.mcu);
      setText("#sideDevicePackage", info.packageName);
      setText("#sideDeviceSource", info.source);
      setText("#sideDeviceClock", frequency ? `${Number((frequency / 1e6).toFixed(3))} MHz` : "未配置");
      setText("#sidePeripheralCount", info.peripherals.length);
      setText("#sidePinCount", info.pins.length);
      const query = $("#sidePinSearch").value.trim().toLowerCase();
      const pins = info.pins.filter(pin => `${pin.pin} ${pin.signal} ${pin.label} ${pin.mode}`.toLowerCase().includes(query));
      const list = $("#sidePinList");
      if (!pins.length) return empty(list, query ? "没有匹配的引脚。" : "IOC 尚未分配引脚。在 CubeMX 配置后重新导入工程。");
      list.replaceChildren(...pins.map(pin => {
        const button = node("button", "side-pin-row");
        const description = node("span", "side-pin-copy");
        description.append(node("strong", "", pin.label || pin.signal), node("small", "", pin.label ? pin.signal : pin.mode || "配置详情 ↗"));
        button.append(node("b", "side-pin-name", pin.pin), description);
        button.title = `${pin.pin} · ${pin.signal}${pin.label ? " · " + pin.label : ""} · 查看 IOC`;
        button.addEventListener("click", () => openIoc("pins", pin.pin));
        return button;
      }));
    }
    $("#sidePinSearch").addEventListener("input", renderDevice);
    root.addEventListener("alice:ioc-viewer-loaded", renderDevice);

    let messages = [];
    let buildFailed = false;
    function renderMessages() {
      const list = $("#sideDiagnosticList");
      if (!messages.length) return empty(list, "构建或运行后显示错误和提醒。");
      list.replaceChildren(...messages.slice().reverse().map(message => {
        const button = node("button", "side-diagnostic " + message.severity);
        button.append(node("small", "", { error: "错误", warn: "提醒", success: "完成" }[message.severity]), node("span", "", message.text));
        button.title = message.text;
        button.addEventListener("click", () => openTool("build"));
        return button;
      }));
    }
    document.addEventListener("alice:build-message", event => {
      messages = reduceMessages(messages, event.detail);
      const detail = event.detail || {};
      if (detail.severity === "command" && String(detail.text).startsWith("alice hal-build ")) buildFailed = false;
      if (detail.severity === "error" && /^(?:Build failed|Build stopped|HAL simulation build failed)/.test(String(detail.text))) {
        buildFailed = true;
        empty($("#sideTraceChannels"), "构建未通过。修正错误并重新构建后，才能选择采样引脚。");
        setText("#sideTraceNotice", "");
      }
      renderMessages();
      syncRuntime();
    });
    $("#clearSimulationBuild")?.addEventListener("click", () => { messages = []; renderMessages(); });
    $$("#simulationBuildOutput .terminal-line").forEach(line => {
      messages = reduceMessages(messages, { text: line.textContent, severity: ["error", "warn", "success"].find(name => line.classList.contains(name)) });
    });
    $("#sideBuild").addEventListener("click", () => { openTool("build"); $("#ribbonBuild")?.click(); });
    $("#sideReset").addEventListener("click", () => $("#ribbonReset")?.click());
    function syncRuntime() {
      const running = $("#ribbonRun").classList.contains("running");
      const busy = $("#buildButton").classList.contains("busy");
      const status = $("#mcuState").textContent.trim();
      setText("#sideRuntimeStatus", buildFailed && !busy && !running ? "构建失败" : runtimeLabel({ running, busy, status }));
      $("#sideRuntimeStatus").dataset.state = busy ? "busy" : running ? "running" : buildFailed ? "error" : "idle";
      setText("#sideLaunch", running ? "停止仿真" : busy ? "构建中…" : "启动仿真");
      $("#sideLaunch").disabled = busy && !running;
      $("#sideBuild").disabled = busy;
      $("#sideReset").disabled = busy;
    }
    const runtimeObserver = new root.MutationObserver(syncRuntime);
    runtimeObserver.observe($("#ribbonRun"), { attributes: true, attributeFilter: ["class"] });
    runtimeObserver.observe($("#buildButton"), { attributes: true, attributeFilter: ["class"] });
    runtimeObserver.observe($("#mcuState"), { childList: true, characterData: true, subtree: true });

    function renderTrace() {
      const simulator = root.AliceHalSimulator;
      const summary = simulator?.getSummary?.() || {};
      const channels = simulator?.getTraceChannels?.() || [];
      const selected = summary.tracePins || [];
      setText("#sideTraceCount", `${selected.length} / 4`);
      const uarts = summary.uarts || [];
      setText("#sideUartSummary", uarts.length ? uarts.map(uart => `${uart.instance || uart.handle} · ${uart.baudRate || "?"}`).join(" / ") + " ↗" : simulator?.getModel?.() ? "当前固件未启用 UART ↗" : "构建后查看 UART 配置 ↗");
      const list = $("#sideTraceChannels");
      if (!channels.length) return empty(list, "构建工程后，这里会列出可以采样的真实引脚。");
      list.replaceChildren(...channels.map(channel => {
        const label = node("label", "side-trace-row");
        const input = node("input");
        input.type = "checkbox";
        input.checked = selected.includes(channel.pin);
        input.dataset.sideTracePin = channel.pin;
        const copy = node("span");
        const description = [...new Set([channel.label, channel.source].filter(value => value && value !== channel.pin))].join(" · ");
        copy.append(node("strong", "", channel.pin), node("small", "", description || "GPIO"));
        label.append(input, copy);
        input.addEventListener("change", () => {
          const current = simulator.getSummary().tracePins || [];
          const result = changeTraceSelection(simulator.getTraceChannels(), current, channel.pin, input.checked);
          setText("#sideTraceNotice", { limit: "最多同时显示 4 路，请先取消一个通道。", last: "至少保留一个采样通道。", unknown: "引脚配置已变化，请重新构建。" }[result.error] || "");
          if (!result.error) {
            const pins = simulator.setTracePins(result.pins);
            document.dispatchEvent(new CustomEvent("alice:trace-selection", { detail: { pins, channels: simulator.getTraceChannels() } }));
          } else input.checked = current.includes(channel.pin);
        });
        return label;
      }));
    }
    document.addEventListener("alice:trace-selection", () => {
      const selected = root.AliceHalSimulator?.getSummary?.().tracePins || [];
      $$("[data-side-trace-pin]").forEach(input => { input.checked = selected.includes(input.dataset.sideTracePin); });
      setText("#sideTraceCount", `${selected.length} / 4`);
    });

    function renderCatalog() {
      const catalog = $$(".library-items [data-component-type]").map(button => {
        const type = button.dataset.componentType;
        const device = root.AlicePeripheralCatalog?.find?.(type);
        return {
          type, button, category: Object.keys(CATEGORIES).find(key => CATEGORIES[key].includes(type)) || "bus",
          label: button.querySelector("b")?.textContent.trim() || button.getAttribute("aria-label") || type,
          description: [button.title || button.getAttribute("aria-label") || type, device?.bus, device?.title, type === "button" ? "开关 switch" : ""].filter(Boolean).join(" · "),
          disabled: button.hidden || button.disabled || button.style.display === "none"
        };
      });
      const visible = filterComponents(catalog, $("#sideComponentSearch").value, $("#sideComponentCategory").value);
      setText("#sideComponentCount", `${visible.length} 项`);
      const list = $("#sideComponentList");
      if (!visible.length) return empty(list, "没有匹配的元件。试试其他名称或分类，也可在管理元件库中启用器件。");
      list.replaceChildren(...visible.map(item => {
        const button = node("button", "side-component-card");
        button.dataset.sideComponent = item.type;
        button.title = item.description;
        button.setAttribute("aria-label", "添加 " + item.label);
        const symbol = item.button.querySelector(".library-symbol, svg, img")?.cloneNode(true) || node("span", "", "◇");
        symbol.setAttribute("aria-hidden", "true");
        const icon = node("span", "side-component-icon");
        icon.append(symbol);
        const copy = node("span", "side-component-copy");
        copy.append(node("strong", "", item.label), node("small", "", CATEGORY_LABELS[item.category]));
        button.append(icon, copy, node("span", "side-component-add", "+"));
        button.addEventListener("click", () => {
          root.AliceWorkspacePages?.set?.("simulation");
          item.button.click();
          $("#schematicViewport")?.focus({ preventScroll: true });
        });
        return button;
      }));
    }
    $("#sideComponentSearch").addEventListener("input", renderCatalog);
    $("#sideComponentCategory").addEventListener("change", renderCatalog);
    $("#sideLibraryManage").addEventListener("click", () => $('.library-head button[title="管理元件库"]')?.click());
    $("#sideImportDatasheet").addEventListener("click", () => root.AliceDatasheetImport?.open?.());
    const library = $(".library-items");
    if (library) new root.MutationObserver(renderCatalog).observe(library, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden", "disabled"] });
    document.addEventListener("alice:firmware-built", () => {
      renderDevice();
      renderTrace();
      setText("#sideTraceNotice", "");
    });
    document.addEventListener("alice:build-message", event => {
      if (event.detail?.severity === "command" && String(event.detail.text).startsWith("alice hal-build ")) {
        empty($("#sideTraceChannels"), "正在构建，完成后更新采样引脚。");
        setText("#sideTraceCount", "0 / 4");
      }
    });
    renderDevice();
    renderMessages();
    syncRuntime();
    renderTrace();
    renderCatalog();
    return true;
  }

  return Object.freeze({ mount, deviceInfo, filterComponents, changeTraceSelection, reduceMessages, runtimeLabel });
}));
