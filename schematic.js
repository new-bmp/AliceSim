(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var WORLD_WIDTH = 1200;
  var WORLD_HEIGHT = 720;
  var GRID_SIZE = 10;
  var WIRE_STUB = 14;
  var MCU_WIDTH = 170;
  var MCU_MIN_HEIGHT = 210;
  var MCU_MAX_HEIGHT = WORLD_HEIGHT - 40;
  var MCU_SIDE_MARGIN = 30;
  var MCU_PIN_PITCH = 16;
  var CIRCUIT_SCHEMA_VERSION = 1;
  var CIRCUIT_KIND = "AliceSIMCircuit";
  var CIRCUIT_FILE_EXTENSION = ".alice-sch.json";
  var COMPONENT_SCHEMA_VERSION = 1;
  var COMPONENT_KIND = "AliceSIMComponent";
  var COMPONENT_FILE_EXTENSION = ".alice-component.json";
  var MAX_CIRCUIT_COMPONENTS = 1000;
  var MAX_CIRCUIT_WIRES = 5000;
  var MAX_WIRE_ROUTE_POINTS = 512;
  var MAX_CIRCUIT_JSON_LENGTH = 8 * 1024 * 1024;
  var COMPONENT_LABELS_STORAGE_KEY = "alicesim.schematic.showComponentLabels";
  var LEGACY_COMPONENT_NAMES_STORAGE_KEY = "alicesim.schematic.showComponentNames";
  var DEFAULT_MCU_PINS = [
    { name: "VDD", x: 85, y: 0, side: "top", signal: "POWER" },
    { name: "VSS", x: 85, y: MCU_MIN_HEIGHT, side: "bottom", signal: "GROUND" },
    { name: "PD0", x: 0, y: 30, side: "left", signal: "RCC_OSC_IN" },
    { name: "PA9", x: 0, y: 105, side: "left", signal: "USART1_TX" },
    { name: "PA13", x: 0, y: 180, side: "left", signal: "SYS_JTMS-SWDIO" },
    { name: "PC13", x: MCU_WIDTH, y: 30, side: "right", signal: "GPIO_Output" },
    { name: "PD1", x: MCU_WIDTH, y: 80, side: "right", signal: "RCC_OSC_OUT" },
    { name: "PA10", x: MCU_WIDTH, y: 130, side: "right", signal: "USART1_RX" },
    { name: "PA14", x: MCU_WIDTH, y: 180, side: "right", signal: "SYS_JTCK-SWCLK" }
  ];

  function createMcuSymbol(width, height, pins) {
    var bodyX = 20;
    var bodyY = 10;
    var bodyWidth = width - bodyX * 2;
    var bodyHeight = height - bodyY * 2;
    var coreWidth = Math.min(76, bodyWidth - 30);
    var coreHeight = Math.min(92, bodyHeight - 54);
    var coreX = Math.round((width - coreWidth) / 2);
    var coreY = Math.round((height - coreHeight) / 2) + 8;
    var padMarkup = (pins || []).filter(function (pin) {
      return pin.side === "left" || pin.side === "right";
    }).map(function (pin) {
      var padX = pin.side === "left" ? bodyX - 4 : bodyX + bodyWidth - 2;
      var padY = clampNumber(Math.round(pin.y - 2), bodyY + 8, height - bodyY - 12);
      return '<rect class="mcu-simple-pad" x="' + padX + '" y="' + padY + '" width="6" height="4"/>';
    }).join("");
    return '<svg class="component-symbol mcu-symbol component-flat-symbol" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true">' +
      '<rect class="mcu-simple-outline" x="' + bodyX + '" y="' + bodyY + '" width="' + bodyWidth + '" height="' + bodyHeight + '" rx="3"/>' +
      padMarkup +
      '<path class="mcu-simple-divider" d="M' + (bodyX + 12) + " 48H" + (bodyX + bodyWidth - 12) + '"/>' +
      '<rect class="mcu-simple-core" x="' + coreX + '" y="' + coreY + '" width="' + coreWidth + '" height="' + coreHeight + '" rx="2"/>' +
      '<circle class="mcu-simple-pin-one" cx="' + (coreX + 9) + '" cy="' + (coreY + 10) + '" r="2.5"/>' +
      '<text class="mcu-simple-title" x="' + (width / 2) + '" y="32" text-anchor="middle">STM32</text>' +
      '<text class="mcu-simple-part" x="' + (width / 2) + '" y="' + (coreY + coreHeight / 2 - 3) + '" text-anchor="middle">F103C8T6</text>' +
      '<text class="mcu-simple-core-label" x="' + (width / 2) + '" y="' + (coreY + coreHeight / 2 + 12) + '" text-anchor="middle">CORTEX-M3</text></svg>';
  }

  var componentDefinitions = {
    mcu: {
      width: MCU_WIDTH,
      height: MCU_MIN_HEIGHT,
      prefix: "U",
      value: "STM32F103C8T6",
      title: "STM32F103",
      pins: DEFAULT_MCU_PINS.map(function (pin) { return Object.assign({}, pin); }),
      symbol: createMcuSymbol(MCU_WIDTH, MCU_MIN_HEIGHT, DEFAULT_MCU_PINS)
    },
    vcc: {
      width: 64,
      height: 58,
      prefix: "PWR",
      value: "+3V3",
      title: "VCC 电源",
      pins: [{ name: "VCC", x: 32, y: 58, side: "bottom" }],
      symbol: '<svg class="component-symbol power-port-symbol" viewBox="0 0 64 58" aria-hidden="true"><path d="M32 58V21M23 30l9-9 9 9"/><text x="32" y="11" text-anchor="middle">VCC</text></svg>'
    },
    ground: {
      width: 64,
      height: 58,
      prefix: "GND",
      value: "0V",
      title: "接地",
      pins: [{ name: "GND", x: 32, y: 0, side: "top" }],
      symbol: '<svg class="component-symbol" viewBox="0 0 64 58" aria-hidden="true"><path d="M32 0v25M14 25h36M20 34h24M27 43h10"/><text x="32" y="56" text-anchor="middle">GND</text></svg>'
    },
    netTerminal: {
      width: 110,
      height: 42,
      prefix: "PORT",
      value: "NET1",
      title: "网络端子",
      pins: [{ name: "NET", x: 0, y: 21, side: "left" }],
      symbol: '<svg class="component-symbol net-terminal-symbol" viewBox="0 0 110 42" aria-hidden="true"><circle cx="4" cy="21" r="3"/><path d="M7 21h14l9-12h72v24H30L21 21"/><text class="net-terminal-symbol-label" x="64" y="25" text-anchor="middle">NET1</text></svg>'
    },
    voltageProbe: {
      width: 92,
      height: 66,
      prefix: "VP",
      value: "— V",
      title: "电压探针",
      pins: [{ name: "TIP", x: 0, y: 33, side: "left" }],
      symbol: '<svg class="component-symbol component-flat-symbol measurement-probe-symbol" viewBox="0 0 92 66" aria-hidden="true"><image class="component-flat-image" href="./assets/components/voltage-probe.svg?v=20260801.1" x="5" y="4" width="82" height="58" preserveAspectRatio="xMidYMid meet"/></svg>'
    },
    currentProbe: {
      width: 104,
      height: 66,
      prefix: "IP",
      value: "— A",
      title: "电流探针",
      pins: [
        { name: "IN", x: 0, y: 33, side: "left" },
        { name: "OUT", x: 104, y: 33, side: "right" }
      ],
      symbol: '<svg class="component-symbol component-flat-symbol measurement-probe-symbol" viewBox="0 0 104 66" aria-hidden="true"><image class="component-flat-image" href="./assets/components/current-probe.svg?v=20260801.1" x="5" y="4" width="94" height="58" preserveAspectRatio="xMidYMid meet"/></svg>'
    },
    adcSource: {
      width: 112,
      height: 72,
      prefix: "ADC",
      value: "1.650 V",
      title: "ADC 采集源",
      pins: [
        { name: "GND", x: 0, y: 54, side: "left" },
        { name: "AO", x: 112, y: 36, side: "right" }
      ],
      symbol: '<svg class="component-symbol adc-source-symbol" viewBox="0 0 112 72" aria-hidden="true"><rect x="8" y="7" width="96" height="58" rx="5"/><path class="adc-source-wave" d="M17 39l14-14 14 18 16-25 17 22 17-12"/><path class="adc-source-axis" d="M17 51h78"/></svg>'
    },
    uartSender: {
      width: 126,
      height: 84,
      prefix: "TXG",
      value: "启动后 · 1000 ms",
      title: "条件串口发送器",
      pins: [
        { name: "TRIG", x: 0, y: 26, side: "left" },
        { name: "GND", x: 0, y: 64, side: "left" },
        { name: "TX", x: 126, y: 42, side: "right" }
      ],
      symbol: '<svg class="component-symbol uart-sender-symbol" viewBox="0 0 126 84" aria-hidden="true"><rect x="8" y="7" width="110" height="70" rx="5"/><path d="M20 24h42M20 35h58M20 46h38M83 27l20 15-20 15M20 61h52"/></svg>'
    },
    resistor: {
      width: 96,
      height: 52,
      prefix: "R",
      value: "330 Ω",
      title: "电阻",
      pins: [
        { name: "1", x: 0, y: 26, side: "left" },
        { name: "2", x: 96, y: 26, side: "right" }
      ],
      symbol: '<svg class="component-symbol" viewBox="0 0 96 52" aria-hidden="true"><path d="M0 26h18l6-12 10 24 10-24 10 24 10-24 8 12h24"/></svg>'
    },
    led: {
      width: 72,
      height: 64,
      prefix: "D",
      value: "RED LED",
      title: "发光二极管",
      pins: [
        { name: "A", x: 0, y: 32, side: "left" },
        { name: "K", x: 72, y: 32, side: "right" }
      ],
      symbol: '<svg class="component-symbol" viewBox="0 0 72 64" aria-hidden="true"><path d="M0 32h18M54 32h18M18 15v34l32-17-32-17ZM51 14v36M42 14l9-9M46 6h5v5M49 23l10-9M54 14h5v5"/><circle class="led-lens" cx="34" cy="32" r="25"/></svg>'
    },
    button: {
      width: 78,
      height: 60,
      prefix: "SW",
      value: "OFF",
      title: "拨动开关",
      pins: [
        { name: "1", x: 0, y: 30, side: "left" },
        { name: "2", x: 78, y: 30, side: "right" }
      ],
      symbol: '<svg class="component-symbol" viewBox="0 0 78 60" aria-hidden="true"><path d="M0 30h25M53 30h25M25 24v12M53 24v12"/><path class="switch-lever" d="M25 30l26-15"/><circle cx="25" cy="30" r="3"/><circle cx="53" cy="30" r="3"/></svg>'
    },
    oled: {
      width: 132,
      height: 88,
      prefix: "OLED",
      value: "SSD1306 · 0x3C",
      title: "SSD1306 OLED",
      pins: [
        { name: "VCC", x: 0, y: 18, side: "left" },
        { name: "GND", x: 0, y: 68, side: "left" },
        { name: "SCL", x: 132, y: 28, side: "right" },
        { name: "SDA", x: 132, y: 58, side: "right" }
      ],
      symbol: '<svg class="component-symbol component-flat-symbol oled-module-symbol" viewBox="0 0 132 88" aria-hidden="true"><image class="component-flat-image" href="./assets/components/oled-ssd1306.svg" x="8" y="5" width="116" height="78" preserveAspectRatio="none"/></svg>'
    },
    spiDisplay: {
      width: 144,
      height: 108,
      prefix: "TFT",
      value: "ST7735 · 160×128",
      title: "ST7735 SPI 屏幕",
      pins: [
        { name: "VCC", x: 0, y: 18, side: "left" },
        { name: "DC", x: 0, y: 46, side: "left" },
        { name: "RST", x: 0, y: 72, side: "left" },
        { name: "GND", x: 0, y: 94, side: "left" },
        { name: "SCK", x: 144, y: 24, side: "right" },
        { name: "MOSI", x: 144, y: 52, side: "right" },
        { name: "CS", x: 144, y: 82, side: "right" }
      ],
      symbol: '<svg class="component-symbol spi-display-symbol" viewBox="0 0 144 108" aria-hidden="true"><rect x="8" y="5" width="128" height="98" rx="5"/><rect class="spi-display-bezel" x="19" y="13" width="106" height="80" rx="2"/><circle cx="72" cy="98" r="2"/></svg>'
    },
    lightSensor: {
      width: 104,
      height: 76,
      prefix: "LS",
      value: "500 lux",
      title: "仿真光敏传感器",
      pins: [
        { name: "VCC", x: 0, y: 18, side: "left" },
        { name: "GND", x: 0, y: 58, side: "left" },
        { name: "AO", x: 104, y: 22, side: "right" },
        { name: "DO", x: 104, y: 54, side: "right" }
      ],
      symbol: '<svg class="component-symbol component-flat-symbol light-sensor-module-symbol" viewBox="0 0 104 76" aria-hidden="true"><image class="component-flat-image" href="./assets/components/light-sensor.svg" x="7" y="5" width="90" height="66" preserveAspectRatio="none"/></svg>'
    },
    capacitor: {
      width: 76,
      height: 60,
      prefix: "C",
      value: "100 nF",
      title: "电容",
      pins: [
        { name: "1", x: 0, y: 30, side: "left" },
        { name: "2", x: 76, y: 30, side: "right" }
      ],
      symbol: '<svg class="component-symbol" viewBox="0 0 76 60" aria-hidden="true"><path d="M0 30h29M47 30h29M29 10v40M47 10v40"/></svg>'
    }
  };

  if (window.AlicePeripheralCatalog && typeof window.AlicePeripheralCatalog.schematicDefinitions === "function") {
    var catalogDefinitions = window.AlicePeripheralCatalog.schematicDefinitions();
    Object.keys(catalogDefinitions).forEach(function (type) {
      if (!componentDefinitions[type]) componentDefinitions[type] = catalogDefinitions[type];
    });
  }

  var schematicState = {
    initialized: false,
    tool: "select",
    zoom: 1,
    panX: 0,
    panY: 0,
    userView: false,
    components: new Map(),
    componentElements: new Map(),
    wires: [],
    // `signals` is retained as a compatibility/debug snapshot only. Electrical
    // levels are compiled from endpoints, passive parts and explicit drivers.
    signals: new Map([["VCC", true], ["GND", false]]),
    mcuDrives: new Map(),
    mcuPwm: new Map(),
    devices: new Map(),
    compiledNetlist: null,
    projectModel: null,
    firmwareOutputs: [],
    selection: null,
    wireStart: null,
    previewPoint: null,
    interaction: null,
    editingComponentId: null,
    propertiesReturnFocus: null,
    componentCounter: 0,
    wireCounter: 0,
    addOffset: 0,
    time: 0,
    tick: 0,
    powerCalculationEnabled: true,
    showComponentLabels: true,
    powerAlertFingerprint: ""
  };

  var referenceCounters = {
    mcu: 0,
    vcc: 0,
    ground: 0,
    netTerminal: 0,
    voltageProbe: 0,
    currentProbe: 0,
    adcSource: 0,
    uartSender: 0,
    resistor: 0,
    led: 0,
    button: 0,
    oled: 0,
    spiDisplay: 0,
    lightSensor: 0,
    capacitor: 0
  };
  Object.keys(componentDefinitions).forEach(function (type) {
    if (!Object.prototype.hasOwnProperty.call(referenceCounters, type)) referenceCounters[type] = 0;
  });

  var schematicNodes = {};
  var spiceValidationState = {
    timer: null,
    requestId: 0,
    requestedFingerprint: "",
    appliedFingerprint: "",
    results: new Map(),
    engine: ""
  };

  function clampNumber(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function snapToGrid(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  function readComponentLabelsPreference() {
    try {
      var stored = window.localStorage.getItem(COMPONENT_LABELS_STORAGE_KEY);
      if (stored == null) stored = window.localStorage.getItem(LEGACY_COMPONENT_NAMES_STORAGE_KEY);
      return stored !== "0";
    } catch (error) {
      return true;
    }
  }

  function persistComponentLabelsPreference(visible) {
    try {
      window.localStorage.setItem(COMPONENT_LABELS_STORAGE_KEY, visible ? "1" : "0");
    } catch (error) {
      // Private browsing and embedded test documents may not expose storage.
    }
  }

  function applyComponentLabelsVisibility() {
    if (schematicNodes.world) {
      schematicNodes.world.classList.toggle("hide-component-labels", !schematicState.showComponentLabels);
    }
    if (schematicNodes.showComponentLabels) {
      schematicNodes.showComponentLabels.checked = schematicState.showComponentLabels;
      schematicNodes.showComponentLabels.setAttribute("aria-label", schematicState.showComponentLabels ? "隐藏全部元件标签" : "显示全部元件标签");
    }
  }

  function setComponentLabelsVisible(visible, announce) {
    schematicState.showComponentLabels = visible !== false;
    persistComponentLabelsPreference(schematicState.showComponentLabels);
    applyComponentLabelsVisibility();
    if (announce !== false && schematicState.initialized) {
      setStatus(schematicState.showComponentLabels ? "全部元件标签已显示" : "全部元件标签已隐藏");
    }
    return schematicState.showComponentLabels;
  }

  function normalizeRotation(value) {
    var turns = Math.round((Number(value) || 0) / 90);
    return ((turns % 4) + 4) % 4 * 90;
  }

  function componentSizeForRotation(definition, rotation) {
    var quarterTurn = normalizeRotation(rotation) === 90 || normalizeRotation(rotation) === 270;
    return {
      width: quarterTurn ? definition.height : definition.width,
      height: quarterTurn ? definition.width : definition.height
    };
  }

  function rotatePinSide(side, rotation) {
    var sides = ["top", "right", "bottom", "left"];
    var index = sides.indexOf(side);
    if (index < 0) return side;
    return sides[(index + normalizeRotation(rotation) / 90) % 4];
  }

  function rotatedPinGeometry(component, pin) {
    var definition = componentDefinitions[component.type];
    var rotation = normalizeRotation(component.rotation);
    var x = pin.x;
    var y = pin.y;
    if (rotation === 90) {
      x = definition.height - pin.y;
      y = pin.x;
    } else if (rotation === 180) {
      x = definition.width - pin.x;
      y = definition.height - pin.y;
    } else if (rotation === 270) {
      x = pin.y;
      y = definition.width - pin.x;
    }
    return { x: x, y: y, side: rotatePinSide(pin.side, rotation) };
  }

  function componentBodyTransform(definition, rotation) {
    var normalized = normalizeRotation(rotation);
    if (normalized === 90) return "translate(" + definition.height + "px, 0) rotate(90deg)";
    if (normalized === 180) return "translate(" + definition.width + "px, " + definition.height + "px) rotate(180deg)";
    if (normalized === 270) return "translate(0, " + definition.width + "px) rotate(270deg)";
    return "none";
  }

  function clampComponentPosition(component, x, y) {
    return {
      x: clampNumber(Number(x) || 0, 0, WORLD_WIDTH - component.width),
      y: clampNumber(Number(y) || 0, 0, WORLD_HEIGHT - component.height)
    };
  }

  function normalizeSignalName(name) {
    var normalized = String(name == null ? "" : name).trim().toUpperCase().replace(/[\s_.-]+/g, "");
    if (normalized === "3V3" || normalized === "+3V3" || normalized === "VDD") return "VCC";
    if (normalized === "0V" || normalized === "VSS") return "GND";
    var gpioPin = normalized.match(/^GPIOP?([A-Z])(\d+)$/);
    if (gpioPin) return "P" + gpioPin[1] + gpioPin[2];
    return normalized;
  }

  function normalizeNetLabel(value) {
    var label = String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, "_");
    return /^[A-Z0-9][A-Z0-9_./:+-]{0,47}$/.test(label) ? label : "";
  }

  function normalizeMcuPinName(name) {
    var normalized = normalizeSignalName(name);
    var direct = normalized.match(/^P([A-Z])(\d+)$/);
    return direct ? "P" + direct[1] + String(Number(direct[2])) : "";
  }

  function isStm32F103C8GpioPin(name) {
    var pin = normalizeMcuPinName(name);
    var match = pin.match(/^P([A-D])(\d+)$/);
    if (!match) return false;
    var port = match[1];
    var number = Number(match[2]);
    if (port === "A" || port === "B") return number >= 0 && number <= 15;
    if (port === "C") return number >= 13 && number <= 15;
    return port === "D" && number >= 0 && number <= 1;
  }

  function normalizeDriveLevel(value) {
    if (value == null) return null;
    if (typeof value === "string") {
      var normalized = value.trim().toUpperCase().replace(/[\s_-]+/g, "");
      if (!normalized || normalized === "Z" || normalized === "HZ" || normalized === "HIGHZ" || normalized === "HIZ" || normalized === "INPUT" || normalized === "FLOATING") return null;
      if (normalized === "0" || normalized === "FALSE" || normalized === "LOW" || normalized === "OFF" || normalized === "RESET" || normalized === "GPIOPINRESET") return 0;
      if (normalized === "1" || normalized === "TRUE" || normalized === "HIGH" || normalized === "ON" || normalized === "SET" || normalized === "GPIOPINSET") return 1;
    }
    if (value === false || Number(value) === 0) return 0;
    if (value === true || Number(value) === 1) return 1;
    return null;
  }

  function ledColorDescriptor(value) {
    var normalized = String(value == null ? "" : value).trim().toUpperCase();
    if (/GREEN|GREEN_LED|\bG\b|绿色|绿灯/.test(normalized)) return { name: "GREEN", hex: "#2ea043", off: "#f2fbf3" };
    if (/BLUE|BLUE_LED|\bB\b|蓝色|蓝灯/.test(normalized)) return { name: "BLUE", hex: "#1677d2", off: "#f1f7fe" };
    if (/YELLOW|AMBER|黄色|黄灯/.test(normalized)) return { name: "YELLOW", hex: "#c58a00", off: "#fff9e8" };
    if (/WHITE|白色|白灯/.test(normalized)) return { name: "WHITE", hex: "#8a8a8a", off: "#ffffff" };
    return { name: "RED", hex: "#d13438", off: "#fff4f4" };
  }

  function toLogicValue(value) {
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true" || normalized === "high" || normalized === "on";
    }
    return Boolean(value);
  }

  function distributePinCoordinate(index, count, start, end) {
    if (count <= 1) return Math.round((start + end) / 2);
    return Math.round(start + (end - start) * index / (count - 1));
  }

  function normalizedConfiguredMcuPins(configuration) {
    var unique = new Map();
    var configuredPins = configuration && Array.isArray(configuration.configuredPins) ? configuration.configuredPins : [];
    configuredPins.forEach(function (pin, index) {
      var name = pinNameFromDescriptor(pin);
      if (!/^P[A-Z]\d+$/.test(name) || unique.has(name)) return;
      unique.set(name, {
        name: name,
        order: Number(pin.order) || index + 1,
        signal: String(pin.signal || ""),
        mode: String(pin.mode || ""),
        label: String(pin.label || ""),
        codeLabel: String(pin.codeLabel || pin.label || ""),
        locked: Boolean(pin.locked)
      });
    });
    var requiredPins = collectRequiredExperimentPins(configuration || {});
    return Array.from(unique.values()).filter(function (pin) {
      return shouldExposeProjectPin(Object.assign({ configured: true, explicit: true, aliases: [] }, pin), requiredPins);
    });
  }

  function pinNameFromDescriptor(value) {
    if (value == null) return "";
    if (typeof value === "string") {
      var match = value.trim().toUpperCase().match(/^P[A-Z]\d+/);
      return match ? normalizeMcuPinName(match[0]) : normalizeMcuPinName(value);
    }
    if (Array.isArray(value)) return pinNameFromDescriptor(value[0]);
    if (typeof value === "object") {
      return pinNameFromDescriptor(value.base || value.pin || value.physicalPin || value.gpio || value.id || value.name);
    }
    return "";
  }

  function collectRequiredExperimentPins(model) {
    var required = new Set();
    function add(value) {
      var pin = pinNameFromDescriptor(value);
      if (pin) required.add(pin);
    }

    var outputs = model && model.outputs;
    if (Array.isArray(outputs)) outputs.forEach(add);
    else if (outputs && typeof outputs === "object") {
      Object.keys(outputs).forEach(function (key) { add(outputs[key]); add(key); });
    }

    var uarts = model && model.uarts;
    var uartRecords = Array.isArray(uarts) ? uarts : (uarts && typeof uarts === "object" ? Object.keys(uarts).map(function (key) { return uarts[key]; }) : []);
    uartRecords.forEach(function (uart) {
      if (!uart || typeof uart !== "object") return;
      add(uart.txPin);
      add(uart.rxPin);
    });

    var i2cs = model && model.i2cs;
    var i2cRecords = Array.isArray(i2cs) ? i2cs : (i2cs && typeof i2cs === "object" ? Object.keys(i2cs).map(function (key) { return i2cs[key]; }) : []);
    i2cRecords.forEach(function (i2c) {
      if (!i2c || typeof i2c !== "object") return;
      add(i2c.sclPin);
      add(i2c.sdaPin);
    });

    var spis = model && model.spis;
    var spiRecords = Array.isArray(spis) ? spis : (spis && typeof spis === "object" ? Object.keys(spis).map(function (key) { return spis[key]; }) : []);
    spiRecords.forEach(function (spi) {
      if (!spi || typeof spi !== "object") return;
      add(spi.sckPin);
      add(spi.mosiPin);
      add(spi.misoPin);
    });

    var adcs = model && model.adcs;
    var adcRecords = Array.isArray(adcs) ? adcs : (adcs && typeof adcs === "object" ? Object.keys(adcs).map(function (key) { return adcs[key]; }) : []);
    adcRecords.forEach(function (adc) {
      if (!adc || typeof adc !== "object") return;
      add(adc.pin);
      (Array.isArray(adc.channels) ? adc.channels : []).forEach(function (channel) { add(channel && channel.pin); });
    });

    var visited = new Set();
    function visitProgram(node) {
      if (!node || typeof node !== "object" || visited.has(node)) return;
      visited.add(node);
      if (/^gpio/i.test(String(node.op || ""))) add(node.pin || node.physicalPin);
      if (Array.isArray(node)) node.forEach(visitProgram);
      else Object.keys(node).forEach(function (key) { visitProgram(node[key]); });
    }
    visitProgram(model && model.program);
    return required;
  }

  function isSystemOrDebugPin(pin) {
    var text = String(pin && pin.signal || "") + " " + String(pin && pin.mode || "");
    return /(?:RCC|OSC(?:32)?_(?:IN|OUT)|SYS_|SWD(?:IO)?|SWCLK|JTAG|JTMS|JTCK|JTDI|JTDO|JTRST|TRACE|DEBUG|BOOT|NRST)/i.test(text);
  }

  function shouldExposeProjectPin(pin, requiredPins) {
    if (!pin || !pin.name) return false;
    if (requiredPins.has(pin.name)) return true;
    if (isSystemOrDebugPin(pin)) return false;
    if (pin.configured === false && !(pin.aliases || []).length) return false;
    return Boolean(pin.explicit || pin.signal || pin.mode || pin.label || (pin.aliases || []).length);
  }

  function normalizedUartPins(model) {
    var source = model && model.uarts;
    var records = [];
    if (Array.isArray(source)) records = source.map(function (uart) { return { key: "", uart: uart }; });
    else if (source && typeof source === "object") records = Object.keys(source).map(function (key) { return { key: key, uart: source[key] }; });
    var pins = [];
    records.forEach(function (entry, index) {
      var uart = entry.uart;
      if (!uart || typeof uart !== "object") return;
      var instance = String(uart.instance || entry.key || uart.handle || "UART").toUpperCase();
      [["txPin", "TX"], ["rxPin", "RX"]].forEach(function (pair, offset) {
        var physical = pinNameFromDescriptor(uart[pair[0]]);
        if (!physical) return;
        pins.push({
          name: physical,
          base: physical,
          order: 1000 + index * 2 + offset,
          signal: instance + "_" + pair[1],
          mode: "communication",
          label: instance + " " + pair[1],
          codeLabel: instance + " " + pair[1],
          configured: true,
          explicit: true,
          aliases: []
        });
      });
    });
    return pins;
  }

  function normalizedPeripheralPins(model) {
    var pins = [];
    modelI2cRecords(model).forEach(function (entry, index) {
      var instance = String(entry.instance || entry.handle || "I2C").toUpperCase();
      [["sclPin", "SCL"], ["sdaPin", "SDA"]].forEach(function (pair, offset) {
        var physical = pinNameFromDescriptor(entry[pair[0]]);
        if (!physical) return;
        pins.push({
          name: physical,
          base: physical,
          order: 1200 + index * 2 + offset,
          signal: instance + "_" + pair[1],
          mode: "communication",
          label: instance + " " + pair[1],
          codeLabel: instance + " " + pair[1],
          configured: true,
          explicit: true,
          aliases: []
        });
      });
    });
    modelAdcRecords(model).forEach(function (adc, adcIndex) {
      (Array.isArray(adc.channels) ? adc.channels : [{ pin: adc.pin, channel: adc.channel }]).forEach(function (channel, channelIndex) {
        var physical = pinNameFromDescriptor(channel && channel.pin);
        if (!physical) return;
        var instance = String(adc.instance || adc.handle || "ADC").toUpperCase();
        var channelName = String(channel && (channel.channel || channel.channelNumber) || "IN");
        pins.push({
          name: physical,
          base: physical,
          order: 1400 + adcIndex * 16 + channelIndex,
          signal: instance + "_" + channelName,
          mode: "analog",
          label: instance + " " + channelName,
          codeLabel: instance + " " + channelName,
          configured: true,
          explicit: true,
          aliases: []
        });
      });
    });
    modelSpiRecords(model).forEach(function (spi, spiIndex) {
      var instance = String(spi.instance || spi.handle || "SPI").toUpperCase();
      [["sckPin", "SCK"], ["mosiPin", "MOSI"], ["misoPin", "MISO"]].forEach(function (pair, offset) {
        var physical = pinNameFromDescriptor(spi[pair[0]]);
        if (!physical) return;
        pins.push({
          name: physical,
          base: physical,
          order: 1600 + spiIndex * 4 + offset,
          signal: instance + "_" + pair[1],
          mode: "communication",
          label: instance + " " + pair[1],
          codeLabel: instance + " " + pair[1],
          configured: true,
          explicit: true,
          aliases: []
        });
      });
    });
    return pins;
  }

  function modelI2cRecords(model) {
    var source = model && model.i2cs;
    if (Array.isArray(source)) return source.filter(Boolean);
    return source && typeof source === "object" ? Object.keys(source).map(function (key) {
      return source[key] && typeof source[key] === "object" ? Object.assign({ handle: source[key].handle || key }, source[key]) : null;
    }).filter(Boolean) : [];
  }

  function modelAdcRecords(model) {
    var source = model && model.adcs;
    if (Array.isArray(source)) return source.filter(Boolean);
    return source && typeof source === "object" ? Object.keys(source).map(function (key) {
      return source[key] && typeof source[key] === "object" ? Object.assign({ handle: source[key].handle || key }, source[key]) : null;
    }).filter(Boolean) : [];
  }

  function modelSpiRecords(model) {
    var source = model && model.spis;
    if (Array.isArray(source)) return source.filter(Boolean);
    return source && typeof source === "object" ? Object.keys(source).map(function (key) {
      return source[key] && typeof source[key] === "object" ? Object.assign({ handle: source[key].handle || key }, source[key]) : null;
    }).filter(Boolean) : [];
  }

  function normalizeProjectPins(model) {
    var source = model && (model.pins || model.configuredPins);
    var records = [];
    if (Array.isArray(source)) records = source.slice();
    else if (source && typeof source === "object") {
      Object.keys(source).forEach(function (key) {
        var value = source[key];
        if (value && typeof value === "object" && !Array.isArray(value)) records.push(Object.assign({ pin: key }, value));
        else records.push([key, value]);
      });
    }

    var requiredPins = collectRequiredExperimentPins(model || {});
    var unique = new Map();
    records.forEach(function (record, index) {
      var name = pinNameFromDescriptor(record);
      var metadata = {};
      if (Array.isArray(record)) {
        metadata.signal = String(record[1] == null ? "" : record[1]);
      } else if (record && typeof record === "object") {
        metadata.signal = String(record.iocSignal || record.signal || record.function || record.af || "");
        metadata.mode = String(record.mode || record.direction || "");
        metadata.aliases = Array.isArray(record.aliases) ? record.aliases.map(String).filter(Boolean) : [];
        metadata.label = String(record.label || record.codeLabel || metadata.aliases[0] || record.userLabel || record.macro || "");
        metadata.locked = Boolean(record.locked);
        metadata.order = Number(record.order);
        metadata.configured = record.configured == null ? true : Boolean(record.configured);
        metadata.explicit = record.configured == null;
      } else if (typeof record === "string") {
        metadata.signal = "";
        metadata.configured = true;
        metadata.explicit = true;
      }
      if (!name) return;
      var previous = unique.get(name) || { name: name, base: name, order: index + 1, signal: "", mode: "", label: "", locked: false, configured: false, explicit: false, aliases: [] };
      if (metadata.signal) previous.signal = metadata.signal;
      if (metadata.mode) previous.mode = metadata.mode;
      if (metadata.label) previous.label = metadata.label;
      if (metadata.locked) previous.locked = true;
      if (metadata.configured) previous.configured = true;
      if (metadata.explicit) previous.explicit = true;
      (metadata.aliases || []).forEach(function (alias) { if (previous.aliases.indexOf(alias) < 0) previous.aliases.push(alias); });
      if (Number.isFinite(metadata.order) && metadata.order > 0) previous.order = metadata.order;
      unique.set(name, previous);
    });
    normalizedUartPins(model || {}).forEach(function (uartPin) {
      var previous = unique.get(uartPin.name);
      if (!previous) unique.set(uartPin.name, uartPin);
      else {
        previous.signal = previous.signal || uartPin.signal;
        previous.mode = previous.mode || uartPin.mode;
        previous.label = previous.label || uartPin.label;
        previous.codeLabel = previous.codeLabel || uartPin.codeLabel;
        previous.configured = true;
      }
    });
    normalizedPeripheralPins(model || {}).forEach(function (peripheralPin) {
      var previous = unique.get(peripheralPin.name);
      if (!previous) unique.set(peripheralPin.name, peripheralPin);
      else {
        previous.signal = previous.signal || peripheralPin.signal;
        previous.mode = previous.mode || peripheralPin.mode;
        previous.label = previous.label || peripheralPin.label;
        previous.codeLabel = previous.codeLabel || peripheralPin.codeLabel;
        previous.configured = true;
      }
    });
    return Array.from(unique.values()).filter(function (pin) { return shouldExposeProjectPin(pin, requiredPins); }).sort(function (left, right) { return left.order - right.order || left.name.localeCompare(right.name, undefined, { numeric: true }); });
  }

  function outputDescriptor(record, key, index) {
    var descriptor = {};
    if (typeof record === "string") {
      descriptor.pin = pinNameFromDescriptor(record);
      descriptor.label = descriptor.pin === normalizeMcuPinName(record) ? "" : record;
    } else if (Array.isArray(record)) {
      descriptor.pin = pinNameFromDescriptor(record[0]) || pinNameFromDescriptor(record[1]);
      descriptor.label = pinNameFromDescriptor(record[0]) ? String(record[1] || "") : String(record[0] || "");
    } else if (record && typeof record === "object") {
      descriptor.pin = pinNameFromDescriptor(record);
      descriptor.aliases = Array.isArray(record.aliases) ? record.aliases.map(String).filter(Boolean) : [];
      descriptor.label = String(descriptor.aliases[0] || record.label || record.codeLabel || record.output || record.channel || record.macro || "");
      descriptor.color = String(record.color || record.ledColor || descriptor.label || "");
      descriptor.signal = String(record.iocSignal || record.signal || "GPIO_Output");
      descriptor.mode = String(record.mode || record.direction || "output");
      descriptor.initial = record.initialState != null ? record.initialState : (record.initial != null ? record.initial : (record.level != null ? record.level : record.value));
      descriptor.activeLow = Boolean(record.activeLow || record.active_low);
    }
    if (!descriptor.pin && key) {
      descriptor.pin = pinNameFromDescriptor(key) || pinNameFromDescriptor(record);
      if (!descriptor.label && !pinNameFromDescriptor(key)) descriptor.label = String(key);
    }
    if (descriptor.pin && key && !descriptor.label && !pinNameFromDescriptor(key)) descriptor.label = String(key);
    if (!descriptor.pin) return null;
    descriptor.pin = normalizeMcuPinName(descriptor.pin);
    descriptor.label = descriptor.label || descriptor.pin;
    descriptor.aliases = descriptor.aliases && descriptor.aliases.length ? descriptor.aliases : [descriptor.label];
    descriptor.signal = descriptor.signal || "GPIO_Output";
    descriptor.mode = descriptor.mode || "output";
    descriptor.order = index + 1;
    descriptor.colorDescriptor = ledColorDescriptor(descriptor.color || descriptor.label);
    descriptor.initialLevel = normalizeDriveLevel(descriptor.initial);
    return descriptor;
  }

  function normalizeFirmwareOutputs(model, pins) {
    var source = model && model.outputs;
    var records = [];
    if (Array.isArray(source)) records = source.map(function (record) { return { record: record, key: "" }; });
    else if (source && typeof source === "object") {
      Object.keys(source).forEach(function (key) { records.push({ record: source[key], key: key }); });
    }
    var outputs = records.map(function (entry, index) { return outputDescriptor(entry.record, entry.key, index); }).filter(Boolean);
    if (!outputs.length) {
      (pins || []).forEach(function (pin, index) {
        if (!/OUTPUT/i.test(String(pin.signal || "") + " " + String(pin.mode || ""))) return;
        outputs.push(outputDescriptor({
          pin: pin.name || pin.base,
          label: pin.label || pin.name || pin.base,
          signal: pin.signal,
          mode: pin.mode
        }, "", index));
      });
    }
    var unique = new Map();
    outputs.forEach(function (output) {
      if (!output || !output.pin) return;
      var previous = unique.get(output.pin);
      if (!previous || previous.label === previous.pin) unique.set(output.pin, output);
    });
    return Array.from(unique.values());
  }

  function mergeOutputPins(pins, outputs) {
    var merged = new Map();
    (pins || []).forEach(function (pin, index) {
      var name = pinNameFromDescriptor(pin);
      if (!name) return;
      merged.set(name, Object.assign({ name: name, base: name, order: index + 1 }, pin));
    });
    (outputs || []).forEach(function (output, index) {
      var pin = merged.get(output.pin) || { name: output.pin, base: output.pin, order: (pins || []).length + index + 1, locked: false };
      pin.signal = output.signal || pin.signal || "GPIO_Output";
      pin.mode = output.mode || pin.mode || "output";
      pin.label = output.label || pin.label || output.pin;
      pin.codeLabel = output.label || output.pin;
      merged.set(output.pin, pin);
    });
    return Array.from(merged.values());
  }

  function mcuPinDescriptor(metadata, x, y, side) {
    return {
      name: metadata.name,
      x: x,
      y: y,
      side: side,
      signal: metadata.signal || "",
      mode: metadata.mode || "",
      label: metadata.label || "",
      codeLabel: metadata.codeLabel || metadata.label || "",
      locked: Boolean(metadata.locked)
    };
  }

  function createMcuPinLayout(configuredPins) {
    var leftPins = [];
    var rightPins = [];
    configuredPins.forEach(function (pin, index) {
      // Start on the right so the default PC13 LED connection keeps its familiar direction.
      (index % 2 === 0 ? rightPins : leftPins).push(pin);
    });

    var maximumSidePins = Math.max(leftPins.length, rightPins.length, 1);
    var desiredHeight = MCU_SIDE_MARGIN * 2 + Math.max(0, maximumSidePins - 1) * MCU_PIN_PITCH;
    var height = Math.max(MCU_MIN_HEIGHT, Math.ceil(desiredHeight / GRID_SIZE) * GRID_SIZE);
    height = Math.min(MCU_MAX_HEIGHT, height);
    var pins = [];

    pins.push(mcuPinDescriptor({ name: "VDD", signal: "POWER" }, Math.round(MCU_WIDTH / 2), 0, "top"));
    pins.push(mcuPinDescriptor({ name: "VSS", signal: "GROUND" }, Math.round(MCU_WIDTH / 2), height, "bottom"));
    leftPins.forEach(function (pin, index) {
      pins.push(mcuPinDescriptor(
        pin,
        0,
        distributePinCoordinate(index, leftPins.length, MCU_SIDE_MARGIN, height - MCU_SIDE_MARGIN),
        "left"
      ));
    });
    rightPins.forEach(function (pin, index) {
      pins.push(mcuPinDescriptor(
        pin,
        MCU_WIDTH,
        distributePinCoordinate(index, rightPins.length, MCU_SIDE_MARGIN, height - MCU_SIDE_MARGIN),
        "right"
      ));
    });
    return { pins: pins, height: height };
  }

  function setMcuConfiguration(configuration) {
    if (!configuration || typeof configuration !== "object") return null;
    cancelActiveInteraction(true);

    var normalizedConfiguration = configuration;
    if (!Array.isArray(configuration.configuredPins) && Array.isArray(configuration.pins)) {
      normalizedConfiguration = Object.assign({}, configuration, { configuredPins: configuration.pins });
    }
    var configuredPins = normalizedConfiguredMcuPins(normalizedConfiguration);
    var layout = createMcuPinLayout(configuredPins);
    var definition = componentDefinitions.mcu;
    var mcuComponents = [];
    var oldCenters = new Map();
    var preservedConnections = [];
    schematicState.components.forEach(function (component) {
      if (component.type !== "mcu") return;
      mcuComponents.push(component);
      oldCenters.set(component.id, {
        x: component.x + component.width / 2,
        y: component.y + component.height / 2
      });
      preservedConnections = preservedConnections.concat(prepareComponentRotationConnections(component.id));
    });

    definition.width = MCU_WIDTH;
    definition.height = layout.height;
    definition.pins = layout.pins;
    definition.symbol = createMcuSymbol(definition.width, definition.height, definition.pins);
    if (String(configuration.mcu || "").trim()) definition.value = String(configuration.mcu).trim();

    var validPinNames = new Set(layout.pins.map(function (pin) { return pin.name; }));
    var mcuIds = new Set(mcuComponents.map(function (component) { return component.id; }));
    var removedWireIds = new Set();
    schematicState.wires = schematicState.wires.filter(function (wire) {
      var fromValid = !mcuIds.has(wire.from.componentId) || validPinNames.has(wire.from.pin);
      var toValid = !mcuIds.has(wire.to.componentId) || validPinNames.has(wire.to.pin);
      if (fromValid && toValid) return true;
      removedWireIds.add(wire.id);
      return false;
    });

    schematicState.wireStart = null;
    schematicState.previewPoint = null;
    schematicState.componentElements.forEach(function (element) {
      element.querySelectorAll(".component-pin.wire-start").forEach(function (pin) { pin.classList.remove("wire-start"); });
    });
    if (schematicState.selection && schematicState.selection.kind === "wire" && removedWireIds.has(schematicState.selection.id)) {
      schematicState.selection = null;
    }

    mcuComponents.forEach(function (component) {
      var center = oldCenters.get(component.id);
      var size = componentSizeForRotation(definition, component.rotation);
      component.width = size.width;
      component.height = size.height;
      component.value = definition.value;
      var position = clampComponentPosition(component, center.x - size.width / 2, center.y - size.height / 2);
      component.x = position.x;
      component.y = position.y;
      clearRotationConnectionsForComponent(component.id);
      if (schematicState.initialized) renderComponent(component);
      if (schematicState.editingComponentId === component.id && schematicNodes.componentValueInput) {
        schematicNodes.componentValueInput.value = component.value;
      }
    });

    var survivingWires = new Set(schematicState.wires);
    preservedConnections.forEach(function (item) {
      if (survivingWires.has(item.wire) && getPinDefinition(item.endpoint)) rebuildRotationConnection(item);
      clearWireRotationConnections(item.wire);
    });

    if (schematicState.initialized) {
      updateComponentActionState();
      renderWires();
      setStatus("IOC 已同步 · " + configuredPins.length + " 个已启用 IO · 模块电源脚 VDD / VSS");
      if (!schematicState.userView) requestAnimationFrame(function () { fitToContent(false); });
    }

    return {
      mcu: definition.value,
      configuredPins: configuredPins.map(function (pin) { return pin.name; }),
      pins: layout.pins.map(function (pin) { return pin.name; }),
      height: layout.height,
      removedWires: removedWireIds.size
    };
  }

  function nextReference(type) {
    var candidate;
    do {
      referenceCounters[type] += 1;
      candidate = componentDefinitions[type].prefix + referenceCounters[type];
    } while (Array.from(schematicState.components.values()).some(function (component) { return component.ref === candidate; }));
    return candidate;
  }

  function parseVoltageValue(value, fallback) {
    var text = String(value == null ? "" : value).trim().toUpperCase().replace(/,/g, ".");
    var compact = text.replace(/\s+/g, "");
    var split = compact.match(/([+-]?\d+)V(\d+)/);
    if (split) return Math.max(0, Number(split[1]) + Number("0." + split[2]));
    var embedded = compact.match(/([+-]?\d+(?:\.\d+)?)V/);
    if (embedded) return Math.max(0, Number(embedded[1]));
    var numeric = Number(compact.replace(/^\+/, ""));
    return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
  }

  function normalizeOledAddress(value) {
    if (window.AliceOledDevice && typeof window.AliceOledDevice.normalizeAddress === "function") {
      return window.AliceOledDevice.normalizeAddress(value);
    }
    var numeric = typeof value === "string" && /^0x/i.test(value.trim()) ? parseInt(value, 16) : Number(value);
    return Number.isFinite(numeric) ? clampNumber(Math.floor(numeric), 0x03, 0x77) : 0x3c;
  }

  function oledAddressFromValue(value, fallback) {
    var text = String(value == null ? "" : value);
    var hexadecimal = text.match(/0x([0-9a-f]{1,2})/i);
    if (hexadecimal) return normalizeOledAddress(parseInt(hexadecimal[1], 16));
    var decimal = text.match(/(?:ADDR(?:ESS)?\s*[:=]?\s*)(\d{1,3})/i);
    return decimal ? normalizeOledAddress(Number(decimal[1])) : normalizeOledAddress(fallback == null ? 0x3c : fallback);
  }

  function normalizeLuxValue(value, fallback) {
    var text = String(value == null ? "" : value).trim().replace(/,/g, "");
    var numeric = Number(text.replace(/\s*(?:lx|lux|勒克斯)\s*$/i, ""));
    if (!Number.isFinite(numeric)) numeric = Number(fallback);
    if (!Number.isFinite(numeric)) numeric = 500;
    return clampNumber(numeric, 0, 100000);
  }

  function normalizeAdcSourceVoltage(value, fallback, referenceVoltage) {
    var reference = Math.max(0.1, Number(referenceVoltage) || 3.3);
    var text = String(value == null ? "" : value).trim();
    var numeric = text ? parseVoltageValue(text, Number(fallback)) : Number(fallback);
    if (!Number.isFinite(numeric)) numeric = reference / 2;
    return clampNumber(numeric, 0, reference);
  }

  function formatAdcSourceValue(voltage) {
    return Number(voltage || 0).toFixed(3) + " V";
  }

  function normalizeUartSenderCondition(value) {
    var condition = String(value || "startup").trim().toLowerCase();
    return ["startup", "rising", "high", "periodic"].indexOf(condition) >= 0 ? condition : "startup";
  }

  function uartSenderConditionLabel(value) {
    return {
      startup: "启动后",
      rising: "TRIG 上升沿",
      high: "TRIG 高电平",
      periodic: "周期发送"
    }[normalizeUartSenderCondition(value)];
  }

  function formatUartSenderValue(component) {
    return uartSenderConditionLabel(component && component.uartCondition) + " · " + Math.round(Number(component && component.uartDelayMs) || 0) + " ms";
  }

  function catalogDefinition(type) {
    var definition = componentDefinitions[type];
    return definition && definition.catalog ? definition : null;
  }

  var AUTOMATABLE_CATALOG_CONTROLS = Object.freeze({
    dht11: ["temperatureC", "humidityPercent"],
    hcsr04: ["distanceCm"],
    bmp280: ["pressurePa", "temperatureC"],
    mpu6050: ["accelX", "gyroZ"],
    bh1750: ["lux"],
    sht30: ["temperatureC", "humidityPercent"],
    ds3231: ["unixTime"],
    pcf8574: ["inputMask"],
    ina219: ["busVoltageV", "currentA"],
    ds18b20: ["temperatureC"],
    rotaryEncoder: ["position", "pressed"],
    potentiometer: ["percent"],
    pir: ["motion"],
    mq2: ["ppm"],
    joystick: ["xPercent", "yPercent", "pressed"]
  });

  function normalizeCatalogProperties(type, input) {
    var definition = catalogDefinition(type);
    if (!definition) return null;
    var source = input && typeof input === "object" ? input : {};
    var output = {};
    (definition.controls || []).forEach(function (control) {
      var raw = Object.prototype.hasOwnProperty.call(source, control.key) ? source[control.key] : control.value;
      var numeric = Number(raw);
      if (!Number.isFinite(numeric)) numeric = Number(control.value) || 0;
      output[control.key] = clampNumber(numeric, Number(control.min), Number(control.max));
    });
    return output;
  }

  function catalogPropertiesFromConfig(type, config) {
    var definition = catalogDefinition(type);
    if (!definition) return null;
    var source = Object.assign({}, config && config.properties || {}, config && config.peripheralProperties || {});
    (definition.controls || []).forEach(function (control) {
      if (config && Object.prototype.hasOwnProperty.call(config, control.key)) source[control.key] = config[control.key];
    });
    return normalizeCatalogProperties(type, source);
  }

  function formatCatalogValue(type, properties) {
    var props = properties || {};
    if (type === "dht11" || type === "sht30") return Number(props.temperatureC || 0).toFixed(1) + " °C · " + Number(props.humidityPercent || 0).toFixed(1) + " %RH";
    if (type === "hcsr04") return Number(props.distanceCm || 0).toFixed(1) + " cm";
    if (type === "sg90") return Math.round(Number(props.angle) || 0) + "°";
    if (type === "buzzer") return ((Number(props.frequencyHz) || 0) / 1000).toFixed(1) + " kHz";
    if (type === "tm1637") return String(Math.trunc(Number(props.displayValue) || 0));
    if (type === "bh1750") return Math.round(Number(props.lux) || 0) + " lux";
    if (type === "ds18b20") return Number(props.temperatureC || 0).toFixed(2) + " °C";
    if (type === "potentiometer") return Number(props.percent || 0).toFixed(1) + " %";
    if (type === "mosfet") return "N-MOS · VTH " + Number(props.gateThresholdV || 0).toFixed(1) + " V";
    if (type === "dcDcConverter") return Number(props.outputVoltageV || 0).toFixed(1) + " V · " + Number(props.maxOutputCurrentA || 0).toFixed(2) + " A · " + Math.round(Number(props.efficiencyPercent) || 0) + "%";
    if (type === "pir") return Number(props.motion) ? "MOTION" : "NO MOTION";
    if (type === "mq2") return Math.round(Number(props.ppm) || 0) + " ppm";
    if (type === "joystick") return "X " + Math.round(Number(props.xPercent) || 0) + "% · Y " + Math.round(Number(props.yPercent) || 0) + "%";
    var definition = catalogDefinition(type);
    var first = definition && definition.controls && definition.controls[0];
    if (!first) return definition ? definition.value : "";
    return String(props[first.key] == null ? first.value : props[first.key]) + (first.unit ? " " + first.unit : "");
  }

  function ensureComponentDevice(component) {
    if (!component || (component.type !== "oled" && component.type !== "spiDisplay" && component.type !== "lightSensor" && !catalogDefinition(component.type))) return null;
    var existing = schematicState.devices.get(component.id);
    if (existing) return existing;
    var device = null;
    if (component.type === "oled" && window.AliceOledDevice && typeof window.AliceOledDevice.create === "function") {
      device = window.AliceOledDevice.create({ address: component.oledAddress });
    } else if (component.type === "spiDisplay" && window.AliceSpiDisplayDevice && typeof window.AliceSpiDisplayDevice.create === "function") {
      device = window.AliceSpiDisplayDevice.create({ width: 160, height: 128 });
    } else if (component.type === "lightSensor" && window.AliceLightSensorDevice && typeof window.AliceLightSensorDevice.create === "function") {
      device = window.AliceLightSensorDevice.create({
        lux: component.lux,
        thresholdLux: component.thresholdLux,
        adcBits: component.adcBits,
        adcReferenceVoltage: component.adcReferenceVoltage,
        supplyVoltage: component.supplyVoltage,
        minOperatingVoltage: component.minOperatingVoltage,
        maxOperatingVoltage: component.maxOperatingVoltage,
        gamma: component.sensorGamma,
        analogInverted: component.analogInverted,
        digitalActiveLow: component.digitalActiveLow
      });
    } else if (catalogDefinition(component.type) && window.AlicePeripheralDevices) {
      var peripheralOptions = Object.assign({}, component.peripheralProperties || {});
      peripheralOptions.properties = Object.assign({}, component.peripheralProperties || {});
      peripheralOptions.nominalVoltage = catalogDefinition(component.type).catalog.nominalVoltage || 3.3;
      peripheralOptions.minOperatingVoltage = catalogDefinition(component.type).catalog.minOperatingVoltage || 2.4;
      peripheralOptions.maxOperatingVoltage = catalogDefinition(component.type).catalog.maxOperatingVoltage || 5.5;
      var factories = {
        dht11: "createDHT11",
        hcsr04: "createHCSR04",
        sg90: "createSG90",
        buzzer: "createBuzzer",
        tm1637: "createTM1637"
      };
      var factoryName = factories[component.type];
      if (factoryName && typeof window.AlicePeripheralDevices[factoryName] === "function") device = window.AlicePeripheralDevices[factoryName](peripheralOptions);
      else if (typeof window.AlicePeripheralDevices.createGeneric === "function") device = window.AlicePeripheralDevices.createGeneric(component.type, peripheralOptions);
    }
    if (device) schematicState.devices.set(component.id, device);
    return device;
  }

  function componentDevice(componentOrId) {
    var component = typeof componentOrId === "string" ? schematicState.components.get(componentOrId) : componentOrId;
    return component ? (schematicState.devices.get(component.id) || ensureComponentDevice(component)) : null;
  }

  function createComponentModel(type, x, y, options) {
    var definition = componentDefinitions[type];
    if (!definition) return null;
    var config = options || {};
    var rotation = normalizeRotation(config.rotation);
    var size = componentSizeForRotation(definition, rotation);
    var componentId = config.id ? String(config.id) : "";
    var adcReferenceVoltage = type === "adcSource" ? Math.max(0.1, Number(config.adcReferenceVoltage) || 3.3) : null;
    var adcBits = type === "adcSource" ? clampNumber(Math.round(Number(config.adcBits) || 12), 1, 24) : null;
    var adcVoltage = type === "adcSource" ? normalizeAdcSourceVoltage(config.adcVoltage == null ? config.value : config.adcVoltage, adcReferenceVoltage / 2, adcReferenceVoltage) : null;
    if (!componentId) {
      do {
        schematicState.componentCounter += 1;
        componentId = "component-" + schematicState.componentCounter;
      } while (schematicState.components.has(componentId));
    }
    var model = {
      id: componentId,
      type: type,
      x: snapToGrid(clampNumber(Number(x) || 0, 0, WORLD_WIDTH - size.width)),
      y: snapToGrid(clampNumber(Number(y) || 0, 0, WORLD_HEIGHT - size.height)),
      width: size.width,
      height: size.height,
      rotation: rotation,
      ref: config.ref || nextReference(type),
      value: config.value == null ? definition.value : String(config.value),
      autoGenerated: Boolean(config.autoGenerated),
      autoSource: config.autoSource ? String(config.autoSource) : "",
      autoKey: config.autoKey ? String(config.autoKey) : "",
      codeLabel: config.codeLabel ? String(config.codeLabel) : "",
      ledColor: config.ledColor ? String(config.ledColor) : "",
      adcVoltage: adcVoltage,
      adcBits: type === "adcSource" ? adcBits : (type === "lightSensor" ? clampNumber(Math.round(Number(config.adcBits) || 12), 1, 24) : null),
      adcReferenceVoltage: type === "adcSource" ? adcReferenceVoltage : (type === "lightSensor" ? Math.max(0.1, Number(config.adcReferenceVoltage) || 3.3) : null),
      uartPayload: type === "uartSender" ? String(config.uartPayload == null ? "Hello from AliceSIM\\r\\n" : config.uartPayload) : "",
      uartCondition: type === "uartSender" ? normalizeUartSenderCondition(config.uartCondition) : "",
      uartDelayMs: type === "uartSender" ? clampNumber(Number(config.uartDelayMs) || 0, 0, 3600000) : 0,
      uartRuntime: type === "uartSender" ? { sent: false, previousTrigger: 0, dueAt: null, lastSentAt: null, count: 0, error: "" } : null,
      oledAddress: type === "oled" ? normalizeOledAddress(config.oledAddress == null ? oledAddressFromValue(config.value == null ? definition.value : config.value, 0x3c) : config.oledAddress) : null,
      lux: type === "lightSensor" ? normalizeLuxValue(config.lux == null ? (config.value == null ? definition.value : config.value) : config.lux, 500) : null,
      thresholdLux: type === "lightSensor" ? normalizeLuxValue(config.thresholdLux == null ? 1000 : config.thresholdLux, 1000) : null,
      supplyVoltage: type === "lightSensor" ? Math.max(0.1, Number(config.supplyVoltage) || 3.3) : null,
      minOperatingVoltage: type === "lightSensor" ? Math.max(0.1, Number(config.minOperatingVoltage) || 2.4) : null,
      maxOperatingVoltage: type === "lightSensor" ? Math.max(0.1, Number(config.maxOperatingVoltage) || 5.5) : null,
      sensorGamma: type === "lightSensor" ? clampNumber(Number(config.sensorGamma == null ? config.gamma : config.sensorGamma) || 1, 0.05, 10) : null,
      analogInverted: type === "lightSensor" ? Boolean(config.analogInverted) : null,
      digitalActiveLow: type === "lightSensor" ? Boolean(config.digitalActiveLow) : null
    };
    if (type === "button") {
      model.buttonClosed = config.buttonClosed == null
        ? /^(?:ON|CLOSED|1)$/i.test(String(config.value == null ? definition.value : config.value).trim())
        : Boolean(config.buttonClosed);
      model.value = model.buttonClosed ? "ON" : "OFF";
    }
    if (type === "adcSource") model.value = formatAdcSourceValue(model.adcVoltage);
    if (type === "uartSender") model.value = formatUartSenderValue(model);
    if (catalogDefinition(type)) {
      model.peripheralProperties = catalogPropertiesFromConfig(type, config);
      model.value = config.value == null ? formatCatalogValue(type, model.peripheralProperties) : String(config.value);
    }
    schematicState.components.set(model.id, model);
    ensureComponentDevice(model);
    if (schematicState.initialized) renderComponent(model);
    return model;
  }

  function applyLedLensStyle(component, element, isOn, dutyCycle) {
    if (!component || component.type !== "led" || !element) return;
    var descriptor = ledColorDescriptor(component.ledColor || component.codeLabel || component.value);
    element.dataset.ledColor = descriptor.name.toLowerCase();
    var lens = element.querySelector(".led-lens");
    if (!lens) return;
    lens.style.stroke = descriptor.hex;
    lens.style.fill = isOn ? descriptor.hex : descriptor.off;
    lens.style.filter = isOn ? "drop-shadow(0 0 5px " + descriptor.hex + ")" : "none";
    lens.style.fillOpacity = isOn ? String(0.28 + 0.72 * clampNumber(Number(dutyCycle == null ? 1 : dutyCycle), 0, 1)) : "1";
  }

  function createOledLiveMarkup(component, body) {
    var screen = document.createElement("div");
    screen.className = "oled-live-screen";
    screen.setAttribute("aria-label", "OLED 128×64 显示区域");
    var canvas = document.createElement("canvas");
    canvas.className = "oled-pixel-canvas";
    canvas.width = 128;
    canvas.height = 64;
    canvas.setAttribute("aria-label", "OLED 128×64 像素显示区域");
    screen.appendChild(canvas);
    body.appendChild(screen);
  }

  function updateOledVisual(component, element) {
    if (!component || component.type !== "oled") return;
    var target = element || schematicState.componentElements.get(component.id);
    var canvas = target && target.querySelector(".oled-pixel-canvas");
    var device = componentDevice(component);
    if (!canvas || !device || typeof device.getState !== "function") return;
    var state = device.getState({ framebuffer: true });
    var context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#071419";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (state.visible) {
      if (state.contentMode === "text" && Array.isArray(state.textEntries) && state.textEntries.length) {
        state.textEntries.forEach(function (entry) {
          context.fillStyle = entry.color || "#9ffcff";
          context.font = Math.max(6, Number(entry.size) || 8) + "px Consolas, monospace";
          context.textBaseline = "top";
          context.fillText(entry.text, Number(entry.x) || 0, Number(entry.y) || 0);
        });
      } else {
        context.fillStyle = "#92f5ff";
        for (var y = 0; y < state.height; y += 1) {
          for (var x = 0; x < state.width; x += 1) {
            if (device.pixelAt(x, y)) context.fillRect(x, y, 1, 1);
          }
        }
      }
    }
    target.classList.toggle("is-powered", Boolean(state.connection && state.connection.powered));
    target.classList.toggle("is-bus-connected", Boolean(state.connection && state.connection.busConnected));
    target.classList.toggle("is-display-on", Boolean(state.visible));
    target.classList.toggle("is-visible", Boolean(state.visible));
    target.classList.toggle("is-off", !state.visible);
    var screenNode = target.querySelector(".oled-live-screen");
    if (screenNode) {
      var oledStateLabel = state.visible ? "DISPLAY ON" : (!state.connection.powered ? "NO POWER" : (!state.connection.busConnected || !state.connection.bindingValid ? "NO I²C" : (state.initialized ? "DISPLAY OFF" : "WAIT INIT")));
      screenNode.dataset.visible = state.visible ? "true" : "false";
      screenNode.setAttribute("aria-label", "OLED 128×64 · 0x" + state.address.toString(16).toUpperCase().padStart(2, "0") + " · " + oledStateLabel);
    }
  }

  function createAdcSourceLiveMarkup(component, body) {
    var face = document.createElement("div");
    face.className = "adc-source-face";
    face.innerHTML = '<strong class="adc-source-voltage"></strong><span class="adc-source-raw"></span><span class="adc-source-bar"><i></i></span>';
    body.appendChild(face);
    updateAdcSourceVisual(component);
  }

  function adcSourceRaw(component) {
    var maximum = Math.pow(2, clampNumber(Math.round(Number(component.adcBits) || 12), 1, 24)) - 1;
    var ratio = clampNumber(Number(component.adcVoltage) / Math.max(0.1, Number(component.adcReferenceVoltage) || 3.3), 0, 1);
    return Math.round(maximum * ratio);
  }

  function updateAdcSourceVisual(component, element) {
    if (!component || component.type !== "adcSource") return;
    var target = element || schematicState.componentElements.get(component.id);
    if (!target) return;
    var voltage = target.querySelector(".adc-source-voltage");
    var raw = target.querySelector(".adc-source-raw");
    var fill = target.querySelector(".adc-source-bar i");
    var ratio = clampNumber(Number(component.adcVoltage) / Math.max(0.1, Number(component.adcReferenceVoltage) || 3.3), 0, 1);
    if (voltage) voltage.textContent = formatAdcSourceValue(component.adcVoltage);
    if (raw) raw.textContent = "ADC " + adcSourceRaw(component) + " / " + (Math.pow(2, component.adcBits) - 1) + " · " + component.adcBits + " bit";
    if (fill) fill.style.width = (ratio * 100).toFixed(2) + "%";
  }

  function createUartSenderLiveMarkup(body) {
    var face = document.createElement("div");
    face.className = "uart-sender-face";
    face.innerHTML = '<strong class="uart-sender-condition"></strong><span class="uart-sender-payload"></span><span class="uart-sender-status">WAIT</span>';
    body.appendChild(face);
  }

  function updateUartSenderVisual(component, element) {
    if (!component || component.type !== "uartSender") return;
    var target = element || schematicState.componentElements.get(component.id);
    if (!target) return;
    var runtime = component.uartRuntime || {};
    var condition = target.querySelector(".uart-sender-condition");
    var payload = target.querySelector(".uart-sender-payload");
    var status = target.querySelector(".uart-sender-status");
    if (condition) condition.textContent = uartSenderConditionLabel(component.uartCondition) + " · " + Math.round(component.uartDelayMs) + " ms";
    if (payload) payload.textContent = String(component.uartPayload || "").replace(/\\r/g, "↵").replace(/\\n/g, "↲").slice(0, 28) || "(空内容)";
    if (status) status.textContent = runtime.error ? "ERROR" : (runtime.lastSentAt == null ? "WAIT" : "SENT ×" + runtime.count);
    target.classList.toggle("has-sent", runtime.lastSentAt != null && !runtime.error);
    target.classList.toggle("has-error", Boolean(runtime.error));
  }

  function createSpiDisplayLiveMarkup(body) {
    var screen = document.createElement("div");
    screen.className = "spi-display-live-screen";
    screen.setAttribute("aria-label", "ST7735 160×128 SPI 显示区域");
    var canvas = document.createElement("canvas");
    canvas.className = "spi-display-canvas";
    canvas.width = 160;
    canvas.height = 128;
    canvas.setAttribute("aria-label", "ST7735 160×128 SPI 屏幕显示区域");
    screen.appendChild(canvas);
    body.appendChild(screen);
  }

  function updateSpiDisplayVisual(component, element) {
    if (!component || component.type !== "spiDisplay") return;
    var target = element || schematicState.componentElements.get(component.id);
    var device = componentDevice(component);
    var canvas = target && target.querySelector(".spi-display-canvas");
    if (!target || !canvas || !device || typeof device.getState !== "function") return;
    var state = device.getState();
    var context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#090b0e";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (state.visible && typeof device.getFramebuffer === "function") {
      var framebuffer = device.getFramebuffer();
      var image = context.createImageData(state.width, state.height);
      for (var index = 0; index < framebuffer.length; index += 1) {
        var color = framebuffer[index];
        image.data[index * 4] = ((color >> 11) & 0x1f) * 255 / 31;
        image.data[index * 4 + 1] = ((color >> 5) & 0x3f) * 255 / 63;
        image.data[index * 4 + 2] = (color & 0x1f) * 255 / 31;
        image.data[index * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    }
    var connection = state.connection || {};
    var spiStateLabel = state.visible ? "DISPLAY ON" : (!connection.powered ? "NO POWER" : (!connection.busConnected || !connection.bindingValid ? "NO SPI" : (!connection.selected ? "CS HIGH" : (state.initialized ? "DISPLAY OFF" : "WAIT INIT"))));
    var screenNode = target.querySelector(".spi-display-live-screen");
    if (screenNode) screenNode.setAttribute("aria-label", "ST7735 160×128 SPI · " + spiStateLabel);
    target.classList.toggle("is-powered", Boolean(connection.powered));
    target.classList.toggle("is-bus-connected", Boolean(connection.busConnected));
    target.classList.toggle("is-display-on", Boolean(state.visible));
  }

  function createLightSensorLiveMarkup(body) {
    var face = document.createElement("div");
    face.className = "light-sensor-face";
    face.innerHTML = '<span class="light-sensor-sun" aria-hidden="true">☀</span><span class="light-sensor-lux"></span><span class="light-sensor-gauge"><i class="light-sensor-gauge-fill"></i></span><span class="light-sensor-status"></span>';
    body.appendChild(face);
  }

  function updateLightSensorVisual(component, element) {
    if (!component || component.type !== "lightSensor") return;
    var target = element || schematicState.componentElements.get(component.id);
    var device = componentDevice(component);
    if (!target || !device || typeof device.getState !== "function") return;
    var state = device.getState();
    var luxNode = target.querySelector(".light-sensor-lux");
    var gaugeNode = target.querySelector(".light-sensor-gauge-fill");
    var statusNode = target.querySelector(".light-sensor-status");
    if (luxNode) luxNode.textContent = Math.round(state.lux).toLocaleString() + " lx";
    if (gaugeNode) gaugeNode.style.height = Math.max(1, Math.min(100, state.analog.ratio * 100)) + "%";
    if (statusNode) {
      var voltage = state.analog.voltage == null ? "AO —" : "AO " + state.analog.voltage.toFixed(2) + "V · ADC " + state.analog.adcRaw;
      var digital = state.digital.level == null ? "DO —" : "DO " + state.digital.level;
      statusNode.textContent = state.powered ? voltage + " · " + digital : "NO POWER";
    }
    target.classList.toggle("is-powered", Boolean(state.powered));
    target.classList.toggle("is-unpowered", !state.powered);
    target.classList.toggle("digital-triggered", Boolean(state.digital.triggered));
    var faceNode = target.querySelector(".light-sensor-face");
    if (faceNode) {
      faceNode.dataset.powered = state.powered ? "true" : "false";
      faceNode.dataset.aoVoltage = state.analog.voltage == null ? "" : state.analog.voltage.toFixed(4);
      faceNode.dataset.adcRaw = state.analog.adcRaw == null ? "" : String(state.analog.adcRaw);
      faceNode.dataset.doLevel = state.digital.level == null ? "" : String(state.digital.level);
    }
    target.style.setProperty("--sensor-intensity", String(Math.max(0, Math.min(1, state.analog.ratio))));
  }

  function createCatalogLiveMarkup(component, body) {
    var live = document.createElement("div");
    live.className = "catalog-live catalog-live-" + component.type;
    live.innerHTML = component.type === "tm1637"
      ? '<strong class="catalog-primary tm1637-digits">----</strong><span class="catalog-secondary"></span><span class="catalog-status"></span>'
      : '<strong class="catalog-primary"></strong><span class="catalog-secondary"></span><span class="catalog-status"></span>';
    body.appendChild(live);
  }

  function updateCatalogVisual(component, element) {
    if (!component || !catalogDefinition(component.type)) return;
    var target = element || schematicState.componentElements.get(component.id);
    var device = componentDevice(component);
    if (!target || !device || typeof device.getState !== "function") return;
    var state = device.getState();
    var properties = state.properties || component.peripheralProperties || {};
    var primary = target.querySelector(".catalog-primary");
    var secondary = target.querySelector(".catalog-secondary");
    var status = target.querySelector(".catalog-status");
    if (component.type === "dht11") {
      if (primary) primary.textContent = Number(state.temperatureC || 0).toFixed(1) + " °C";
      if (secondary) secondary.textContent = Number(state.humidityPercent || 0).toFixed(1) + " %RH";
    } else if (component.type === "hcsr04") {
      if (primary) primary.textContent = Number(state.distanceCm || 0).toFixed(1) + " cm";
      if (secondary) secondary.textContent = "";
    } else if (component.type === "sg90") {
      if (primary) primary.textContent = Math.round(Number(state.angle) || 0) + "°";
      if (secondary) secondary.textContent = "";
    } else if (component.type === "buzzer") {
      if (primary) primary.textContent = state.active ? Math.round(state.frequencyHz) + " Hz" : "STOP";
      if (secondary) secondary.textContent = "";
    } else if (component.type === "tm1637") {
      var digits = target.querySelector(".tm1637-digits");
      if (digits) digits.textContent = state.visible ? String(state.text || "    ").replace(/ /g, " ") : "----";
      if (secondary) secondary.textContent = "BRI " + Number(state.brightness || 0) + "/7";
    } else if (component.type === "dcDcConverter") {
      var converterPower = component.powerState;
      if (primary) primary.textContent = Number(properties.outputVoltageV || 0).toFixed(2) + " V OUT";
      if (secondary) secondary.textContent = converterPower && converterPower.enabled
        ? (converterPower.outputCurrentA * 1000).toFixed(0) + " mA · " + formatPower(converterPower.outputPowerW)
        : "MAX " + Number(properties.maxOutputCurrentA || 0).toFixed(2) + " A";
    } else {
      if (primary) primary.textContent = formatCatalogValue(component.type, properties);
      if (secondary) secondary.textContent = "";
    }
    if (status) {
      var powered = state.power && state.power.powered;
      var bus = String(catalogDefinition(component.type).bus || "DEVICE");
      if (component.type === "dcDcConverter" && component.powerState && component.powerState.overload) status.textContent = "OVERLOAD " + Math.round(component.powerState.utilizationPercent || 0) + "%";
      else if (state.power && !powered) status.textContent = "NO INPUT POWER";
      else if (component.type === "dcDcConverter") status.textContent = component.converterEnabled ? "CONVERTING · " + Math.round(Number(properties.efficiencyPercent) || 0) + "%" : "DISABLED";
      else if (component.type === "mosfet") status.textContent = component.mosfetOn ? "CHANNEL ON" : "CHANNEL OFF";
      else if (!state.ready) status.textContent = "WAIT WIRING";
      else if (state.active || state.visible) status.textContent = "ACTIVE";
      else status.textContent = bus + " READY";
    }
    target.classList.toggle("is-powered", Boolean(state.power && state.power.powered));
    target.classList.toggle("is-unpowered", !(state.power && state.power.powered));
    target.classList.toggle("is-device-ready", Boolean(state.ready));
    target.classList.toggle("is-device-active", Boolean(state.active || state.visible || (component.type === "mosfet" && component.mosfetOn)));
    target.classList.toggle("power-overload", Boolean(component.powerState && component.powerState.overload));
  }

  function renderComponent(model) {
    if (!schematicNodes.components || !model) return null;
    var existing = schematicState.componentElements.get(model.id);
    if (existing) existing.remove();

    var definition = componentDefinitions[model.type];
    model.rotation = normalizeRotation(model.rotation);
    var rotatedSize = componentSizeForRotation(definition, model.rotation);
    model.width = rotatedSize.width;
    model.height = rotatedSize.height;
    var element = document.createElement("div");
    element.className = "schematic-component type-" + model.type;
    if (catalogDefinition(model.type)) element.classList.add("catalog-peripheral");
    element.dataset.type = model.type;
    element.dataset.componentId = model.id;
    element.dataset.rotation = String(model.rotation);
    if (model.autoGenerated) element.dataset.autoGenerated = "true";
    if (model.autoSource) element.dataset.autoSource = model.autoSource;
    if (model.autoKey) element.dataset.autoKey = model.autoKey;
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-label", definition.title + " " + model.ref + "，数值 " + model.value + "，方向 " + model.rotation + " 度");
    if (model.type === "button") {
      element.classList.toggle("is-closed", Boolean(model.buttonClosed));
      element.setAttribute("aria-pressed", model.buttonClosed ? "true" : "false");
      element.setAttribute("aria-label", definition.title + " " + model.ref + "，" + (model.buttonClosed ? "ON，已导通" : "OFF，已断开") + "，双击切换");
    }
    element.style.left = model.x + "px";
    element.style.top = model.y + "px";
    element.style.width = model.width + "px";
    element.style.height = model.height + "px";
    element.style.setProperty("--component-width", model.width + "px");
    element.style.setProperty("--component-height", model.height + "px");

    var body = document.createElement("div");
    body.className = "component-body";
    body.innerHTML = definition.symbol;
    body.style.inset = "auto";
    body.style.left = "0";
    body.style.top = "0";
    body.style.width = definition.width + "px";
    body.style.height = definition.height + "px";
    body.style.transformOrigin = "0 0";
    body.style.transform = componentBodyTransform(definition, model.rotation);
    if (model.type === "button" && model.buttonClosed) {
      var switchLever = body.querySelector(".switch-lever");
      if (switchLever) switchLever.setAttribute("d", "M25 30H53");
    }

    if (model.type === "netTerminal") {
      var terminalLabel = body.querySelector(".net-terminal-symbol-label");
      if (terminalLabel) terminalLabel.textContent = model.value;
    }

    if (model.type === "mcu") {
      body.classList.add("mcu-simple-body");
    } else if (model.type === "oled") {
      createOledLiveMarkup(model, body);
    } else if (model.type === "spiDisplay") {
      createSpiDisplayLiveMarkup(body);
    } else if (model.type === "adcSource") {
      createAdcSourceLiveMarkup(model, body);
    } else if (model.type === "uartSender") {
      createUartSenderLiveMarkup(body);
    } else if (model.type === "lightSensor") {
      createLightSensorLiveMarkup(body);
    } else if (model.type === "voltageProbe" || model.type === "currentProbe") {
      var probeFace = document.createElement("div");
      probeFace.className = "measurement-probe-face";
      var probeReadout = document.createElement("strong");
      probeReadout.className = "measurement-probe-readout";
      probeReadout.textContent = model.value;
      var probeStatus = document.createElement("small");
      probeStatus.className = "measurement-probe-status";
      probeStatus.textContent = "等待接线";
      probeFace.appendChild(probeReadout);
      probeFace.appendChild(probeStatus);
      body.appendChild(probeFace);
    } else if (catalogDefinition(model.type)) {
      createCatalogLiveMarkup(model, body);
    }

    var reference = document.createElement("span");
    reference.className = "component-ref";
    reference.textContent = model.ref;
    var componentName = document.createElement("span");
    componentName.className = "component-name";
    componentName.textContent = definition.title;
    componentName.title = definition.title;
    var value = document.createElement("span");
    value.className = "component-value";
    value.textContent = model.value;
    value.title = model.value;
    var identity = document.createElement("span");
    identity.className = "component-identity";
    identity.appendChild(reference);
    identity.appendChild(componentName);
    var caption = document.createElement("div");
    caption.className = "component-caption";
    caption.appendChild(identity);
    caption.appendChild(value);
    element.appendChild(body);
    element.appendChild(caption);

    definition.pins.forEach(function (pin) {
      var rotatedPin = rotatedPinGeometry(model, pin);
      var pinElement = document.createElement("button");
      pinElement.type = "button";
      pinElement.className = "component-pin pin-" + rotatedPin.side;
      pinElement.dataset.pin = pin.name;
      pinElement.dataset.componentId = model.id;
      var visibleLabel = model.type === "mcu" ? String(pin.codeLabel || pin.label || "").trim() : "";
      var signalDescription = [visibleLabel, pin.signal, pin.mode].filter(Boolean).join(" · ");
      pinElement.title = model.ref + "." + pin.name + (signalDescription ? " · " + signalDescription : "");
      pinElement.setAttribute("aria-label", model.ref + " 引脚 " + pin.name);
      pinElement.style.left = rotatedPin.x + "px";
      pinElement.style.top = rotatedPin.y + "px";
      pinElement.style.setProperty("--pin-x", rotatedPin.x + "px");
      pinElement.style.setProperty("--pin-y", rotatedPin.y + "px");
      var pinName = document.createElement("span");
      pinName.className = "pin-name";
      var pinCode = document.createElement("span");
      pinCode.className = "pin-code";
      pinCode.textContent = pin.name;
      pinName.appendChild(pinCode);
      if (visibleLabel && visibleLabel !== pin.name) {
        var pinFunction = document.createElement("span");
        pinFunction.className = "pin-function";
        pinFunction.textContent = visibleLabel;
        pinName.appendChild(pinFunction);
      }
      pinElement.appendChild(pinName);
      element.appendChild(pinElement);
    });

    schematicNodes.components.appendChild(element);
    schematicState.componentElements.set(model.id, element);
    if (schematicState.selection && schematicState.selection.kind === "component" && schematicState.selection.id === model.id) {
      element.classList.add("selected");
      element.setAttribute("aria-selected", "true");
    } else {
      element.setAttribute("aria-selected", "false");
    }
    applyLedLensStyle(model, element, false);
    updateOledVisual(model, element);
    updateSpiDisplayVisual(model, element);
    updateAdcSourceVisual(model, element);
    updateUartSenderVisual(model, element);
    updateLightSensorVisual(model, element);
    updateCatalogVisual(model, element);
    return element;
  }

  function updateComponentElement(model) {
    var element = schematicState.componentElements.get(model.id);
    if (!element) return;
    element.style.left = model.x + "px";
    element.style.top = model.y + "px";
  }

  function endpointKey(endpoint) {
    return endpoint.componentId + ":" + endpoint.pin;
  }

  function sameEndpoint(first, second) {
    return first && second && first.componentId === second.componentId && first.pin === second.pin;
  }

  function getPinDefinition(endpoint) {
    var component = schematicState.components.get(endpoint.componentId);
    if (!component) return null;
    var definition = componentDefinitions[component.type];
    var pin = definition.pins.find(function (candidate) { return candidate.name === endpoint.pin; });
    return pin ? { component: component, pin: pin } : null;
  }

  function getPinPoint(endpoint) {
    var found = getPinDefinition(endpoint);
    if (!found) return null;
    var rotatedPin = rotatedPinGeometry(found.component, found.pin);
    return {
      x: found.component.x + rotatedPin.x,
      y: found.component.y + rotatedPin.y,
      side: rotatedPin.side
    };
  }

  function findMcuPinEndpoint(pinName) {
    var normalized = normalizeMcuPinName(pinName);
    if (!normalized) return null;
    var endpoint = null;
    schematicState.components.forEach(function (component) {
      if (endpoint || component.type !== "mcu") return;
      var definition = componentDefinitions.mcu;
      if (definition.pins.some(function (pin) { return pin.name === normalized; })) endpoint = { componentId: component.id, pin: normalized };
    });
    return endpoint;
  }

  function resolveMcuPinName(pinOrLabel) {
    var physical = normalizeMcuPinName(pinOrLabel);
    if (physical) return physical;
    var normalizedLabel = normalizeSignalName(pinOrLabel);
    var output = schematicState.firmwareOutputs.find(function (candidate) {
      return normalizeSignalName(candidate.label) === normalizedLabel ||
        (candidate.aliases || []).some(function (alias) { return normalizeSignalName(alias) === normalizedLabel; });
    });
    if (output) return output.pin;
    var pin = componentDefinitions.mcu.pins.find(function (candidate) {
      return normalizeSignalName(candidate.label) === normalizedLabel;
    });
    return pin ? pin.name : "";
  }

  function compileNetlist() {
    var parents = new Map();
    var ranks = new Map();

    function ensure(key) {
      if (!parents.has(key)) {
        parents.set(key, key);
        ranks.set(key, 0);
      }
      return key;
    }

    function find(key) {
      ensure(key);
      var parent = parents.get(key);
      if (parent !== key) {
        parent = find(parent);
        parents.set(key, parent);
      }
      return parent;
    }

    function union(left, right) {
      var leftRoot = find(left);
      var rightRoot = find(right);
      if (leftRoot === rightRoot) return leftRoot;
      var leftRank = ranks.get(leftRoot) || 0;
      var rightRank = ranks.get(rightRoot) || 0;
      if (leftRank < rightRank) {
        parents.set(leftRoot, rightRoot);
        return rightRoot;
      }
      parents.set(rightRoot, leftRoot);
      if (leftRank === rightRank) ranks.set(leftRoot, leftRank + 1);
      return leftRoot;
    }

    schematicState.components.forEach(function (component) {
      var definition = componentDefinitions[component.type];
      if (!definition) return;
      definition.pins.forEach(function (pin) { ensure(endpointKey({ componentId: component.id, pin: pin.name })); });
    });

    schematicState.wires.forEach(function (wire) {
      if (!getPinDefinition(wire.from) || !getPinDefinition(wire.to)) return;
      union(endpointKey(wire.from), endpointKey(wire.to));
    });

    // Ideal current probes are zero-ohm links. Resistors must keep two distinct
    // nets so the DC solver can calculate their voltage drop, current and power.
    schematicState.components.forEach(function (component) {
      if (component.type === "resistor") {
        var resistance = parseResistanceValue(component.value);
        if (resistance != null && resistance <= 1e-9) union(endpointKey({ componentId: component.id, pin: "1" }), endpointKey({ componentId: component.id, pin: "2" }));
      } else if (component.type === "button" && component.buttonClosed) {
        union(endpointKey({ componentId: component.id, pin: "1" }), endpointKey({ componentId: component.id, pin: "2" }));
      } else if (component.type === "currentProbe") {
        union(endpointKey({ componentId: component.id, pin: "IN" }), endpointKey({ componentId: component.id, pin: "OUT" }));
      }
    });

    // EDA-style named terminals join distant areas without a long visual wire.
    // Only terminals with the same normalized label are electrically merged.
    var namedTerminals = new Map();
    schematicState.components.forEach(function (component) {
      if (component.type !== "netTerminal") return;
      var label = normalizeSignalName(component.value);
      if (!label) return;
      var key = endpointKey({ componentId: component.id, pin: "NET" });
      if (namedTerminals.has(label)) union(namedTerminals.get(label), key);
      else namedTerminals.set(label, key);
    });

    var groups = new Map();
    parents.forEach(function (_, key) {
      var root = find(key);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(key);
    });

    var endpointToNet = Object.create(null);
    var netById = new Map();
    var nets = [];
    Array.from(groups.values()).sort(function (left, right) { return left[0].localeCompare(right[0]); }).forEach(function (keys, index) {
      var net = {
        id: "net-" + (index + 1),
        endpoints: keys.map(function (key) {
          var separator = key.indexOf(":");
          return { componentId: key.slice(0, separator), pin: key.slice(separator + 1) };
        }),
        labels: Array.from(new Set(keys.map(function (key) {
          var separator = key.indexOf(":");
          var component = schematicState.components.get(key.slice(0, separator));
          return component && component.type === "netTerminal" ? component.value : "";
        }).filter(Boolean))),
        drivers: [],
        pwmDrivers: [],
        analogDrivers: [],
        level: null,
        voltage: null,
        floating: true,
        conflict: false,
        analogConflict: false
      };
      keys.forEach(function (key) { endpointToNet[key] = net.id; });
      nets.push(net);
      netById.set(net.id, net);
    });

    function addAnalogDriver(endpoint, voltage, kind) {
      var numericVoltage = Number(voltage);
      if (!Number.isFinite(numericVoltage)) return;
      var netId = endpointToNet[endpointKey(endpoint)];
      var net = netById.get(netId);
      if (!net) return;
      net.analogDrivers.push({ componentId: endpoint.componentId, pin: endpoint.pin, kind: kind, voltage: numericVoltage });
    }

    function addDriver(endpoint, level, kind, voltage, pwm) {
      var normalizedLevel = normalizeDriveLevel(level);
      if (normalizedLevel == null) return;
      var netId = endpointToNet[endpointKey(endpoint)];
      var net = netById.get(netId);
      if (!net) return;
      net.drivers.push({ componentId: endpoint.componentId, pin: endpoint.pin, kind: kind, level: normalizedLevel });
      if (pwm) net.pwmDrivers.push({ componentId: endpoint.componentId, pin: endpoint.pin, pwm: Object.assign({}, pwm) });
      if (voltage != null) addAnalogDriver(endpoint, voltage, kind);
    }

    schematicState.components.forEach(function (component) {
      if (component.type === "vcc") {
        var supplyVoltage = parseVoltageValue(component.value, 3.3);
        addDriver({ componentId: component.id, pin: "VCC" }, 1, "vcc", supplyVoltage);
      } else if (component.type === "ground") addDriver({ componentId: component.id, pin: "GND" }, 0, "ground", 0);
      else if (component.type === "adcSource") {
        addDriver({ componentId: component.id, pin: "GND" }, 0, "adc-source-ground", 0);
        addAnalogDriver({ componentId: component.id, pin: "AO" }, component.adcVoltage, "adc-source");
      } else if (component.type === "uartSender") {
        addDriver({ componentId: component.id, pin: "GND" }, 0, "uart-source-ground", 0);
        addDriver({ componentId: component.id, pin: "TX" }, 1, "uart-source-idle", 3.3);
      }
      else if (component.type === "mcu") {
        componentDefinitions.mcu.pins.forEach(function (pin) {
          var physical = normalizeMcuPinName(pin.name);
          if (!physical || !schematicState.mcuDrives.has(physical)) return;
           var pwm = schematicState.mcuPwm.get(physical);
           var drive = pwm ? (pwm.active && Number(pwm.dutyCycle) > 0 ? 1 : 0) : schematicState.mcuDrives.get(physical);
           addDriver({ componentId: component.id, pin: physical }, drive, pwm ? "mcu-pwm" : "mcu-gpio", drive ? 3.3 : 0, pwm);
        });
      }
    });

    function solveNets() {
      nets.forEach(function (net) {
        var hasHigh = net.drivers.some(function (driver) { return driver.level === 1; });
        var hasLow = net.drivers.some(function (driver) { return driver.level === 0; });
        net.floating = !hasHigh && !hasLow && !net.analogDrivers.length;
        net.conflict = hasHigh && hasLow;
        net.level = net.conflict || (!hasHigh && !hasLow) ? null : (hasHigh ? 1 : 0);
        var voltages = net.analogDrivers.map(function (driver) { return driver.voltage; }).filter(Number.isFinite);
        if (!voltages.length) {
          net.voltage = null;
          net.analogConflict = false;
        } else {
          var minimum = Math.min.apply(Math, voltages);
          var maximum = Math.max.apply(Math, voltages);
          net.analogConflict = maximum - minimum > 0.05;
          net.voltage = net.analogConflict ? null : voltages.reduce(function (sum, item) { return sum + item; }, 0) / voltages.length;
        }
      });
    }

    solveNets();

    var compiled = {
      nets: nets,
      endpointToNet: endpointToNet,
      netById: netById,
      leds: [],
      oleds: [],
      spiDisplays: [],
      lightSensors: [],
      peripherals: [],
      generatedAtTick: schematicState.tick
    };

    updatePeripheralConnections(compiled);
    schematicState.components.forEach(function (component) {
      if (component.type === "lightSensor") {
        var device = componentDevice(component);
        if (!device) return;
        var analogVoltage = device.sampleAnalog();
        var digitalLevel = device.sampleDigital();
        if (analogVoltage != null) addAnalogDriver({ componentId: component.id, pin: "AO" }, analogVoltage, "light-sensor-ao");
        if (digitalLevel != null) {
          var state = device.getState();
          var digitalVoltage = digitalLevel ? state.power.vccLevel : state.power.gndLevel;
          addDriver({ componentId: component.id, pin: "DO" }, digitalLevel, "light-sensor-do", digitalVoltage);
        }
        return;
      }
      if (!catalogDefinition(component.type)) return;
      var catalogDevice = componentDevice(component);
      var catalogState = catalogDevice && catalogDevice.getState();
      var properties = catalogState && (catalogState.properties || component.peripheralProperties) || component.peripheralProperties || {};
      if (component.type === "mosfet") {
        var gateNet = netForEndpoint(compiled, { componentId: component.id, pin: "G" });
        var drainNet = netForEndpoint(compiled, { componentId: component.id, pin: "D" });
        var sourceNet = netForEndpoint(compiled, { componentId: component.id, pin: "S" });
        var gateVoltage = gateNet && !gateNet.analogConflict ? gateNet.voltage : null;
        var sourceVoltage = sourceNet && !sourceNet.analogConflict ? sourceNet.voltage : null;
        var gateThreshold = clampNumber(Number(properties.gateThresholdV) || 2, 0.5, 5);
        component.mosfetOn = gateVoltage != null && sourceVoltage != null && gateVoltage - sourceVoltage >= gateThreshold;
        if (component.mosfetOn && drainNet && sourceNet && !sourceNet.conflict && !sourceNet.analogConflict) {
          if (sourceNet.level != null) addDriver({ componentId: component.id, pin: "D" }, sourceNet.level, "mosfet-channel", sourceNet.voltage);
          else if (sourceNet.voltage != null) addAnalogDriver({ componentId: component.id, pin: "D" }, sourceNet.voltage, "mosfet-channel");
        }
        return;
      }
      var power = catalogState && catalogState.power;
      if (component.type === "dcDcConverter") {
        var enableNet = netForEndpoint(compiled, { componentId: component.id, pin: "EN" });
        var enabled = Number(properties.enabled) !== 0;
        if (enableNet && netHasExternalEndpoint(enableNet, component.id) && enableNet.level === 0) enabled = false;
        component.converterEnabled = Boolean(enabled && power && power.powered);
        if (component.converterEnabled) {
          var converterGround = power.gndLevel == null ? 0 : power.gndLevel;
          addAnalogDriver({ componentId: component.id, pin: "VOUT" }, converterGround + clampNumber(Number(properties.outputVoltageV) || 5, 0.8, 24), "dc-dc-output");
        }
        return;
      }
      if (!power || !power.powered) return;
      var lowVoltage = power.gndLevel == null ? 0 : power.gndLevel;
      var highVoltage = power.vccLevel == null ? lowVoltage + 3.3 : power.vccLevel;
      if (component.type === "potentiometer") {
        addAnalogDriver({ componentId: component.id, pin: "AO" }, lowVoltage + (highVoltage - lowVoltage) * clampNumber(Number(properties.percent) || 0, 0, 100) / 100, "potentiometer");
      } else if (component.type === "pir") {
        var motion = Number(properties.motion) ? 1 : 0;
        addDriver({ componentId: component.id, pin: "OUT" }, motion, "pir", motion ? highVoltage : lowVoltage);
      } else if (component.type === "mq2") {
        var gasRatio = clampNumber(Number(properties.ppm) || 0, 0, 10000) / 10000;
        addAnalogDriver({ componentId: component.id, pin: "AO" }, lowVoltage + (highVoltage - lowVoltage) * gasRatio, "mq2-ao");
        var gasTriggered = Number(properties.ppm) >= Number(properties.thresholdPpm) ? 1 : 0;
        addDriver({ componentId: component.id, pin: "DO" }, gasTriggered, "mq2-do", gasTriggered ? highVoltage : lowVoltage);
      } else if (component.type === "joystick") {
        addAnalogDriver({ componentId: component.id, pin: "VRX" }, lowVoltage + (highVoltage - lowVoltage) * clampNumber(Number(properties.xPercent) || 0, 0, 100) / 100, "joystick-x");
        addAnalogDriver({ componentId: component.id, pin: "VRY" }, lowVoltage + (highVoltage - lowVoltage) * clampNumber(Number(properties.yPercent) || 0, 0, 100) / 100, "joystick-y");
        var joystickLevel = Number(properties.pressed) ? 0 : 1;
        addDriver({ componentId: component.id, pin: "SW" }, joystickLevel, "joystick-switch", joystickLevel ? highVoltage : lowVoltage);
      } else if (component.type === "rotaryEncoder") {
        var quadrature = [[0, 0], [0, 1], [1, 1], [1, 0]];
        var position = Math.round(Number(properties.position) || 0);
        var phase = quadrature[((position % 4) + 4) % 4];
        addDriver({ componentId: component.id, pin: "A" }, phase[0], "encoder-a", phase[0] ? highVoltage : lowVoltage);
        addDriver({ componentId: component.id, pin: "B" }, phase[1], "encoder-b", phase[1] ? highVoltage : lowVoltage);
        var encoderSwitch = Number(properties.pressed) ? 0 : 1;
        addDriver({ componentId: component.id, pin: "SW" }, encoderSwitch, "encoder-switch", encoderSwitch ? highVoltage : lowVoltage);
      }
    });
    solveNets();
    updatePeripheralConnections(compiled);
    compiled.powerReport = solvePowerSystem(compiled);
    updatePeripheralConnections(compiled);

    schematicState.components.forEach(function (component) {
      if (component.type === "led") {
        var anode = netForEndpoint(compiled, { componentId: component.id, pin: "A" });
        var cathode = netForEndpoint(compiled, { componentId: component.id, pin: "K" });
        var electrical = ledElectricalState(anode, cathode, component);
        var pwm = pwmForNet(compiled, anode) || pwmForNet(compiled, cathode);
        compiled.leds.push({
          componentId: component.id,
          ref: component.ref,
          anodeNet: anode ? anode.id : null,
          cathodeNet: cathode ? cathode.id : null,
          on: electrical.on,
          state: electrical.state,
          pwm: pwm ? Object.assign({}, pwm) : null
        });
      } else if (component.type === "oled") {
        var oledDevice = componentDevice(component);
        compiled.oleds.push({ componentId: component.id, ref: component.ref, state: oledDevice ? oledDevice.getState() : null });
      } else if (component.type === "spiDisplay") {
        var spiDisplayDevice = componentDevice(component);
        compiled.spiDisplays.push({ componentId: component.id, ref: component.ref, state: spiDisplayDevice ? spiDisplayDevice.getState() : null });
      } else if (component.type === "lightSensor") {
        var sensorDevice = componentDevice(component);
        compiled.lightSensors.push({ componentId: component.id, ref: component.ref, state: sensorDevice ? sensorDevice.getState() : null });
      } else if (catalogDefinition(component.type)) {
        var catalogDevice = componentDevice(component);
        compiled.peripherals.push({ componentId: component.id, ref: component.ref, type: component.type, state: catalogDevice ? catalogDevice.getState() : null });
      }
    });
    schematicState.compiledNetlist = compiled;
    if (schematicState.initialized) updatePowerVisuals(compiled.powerReport);
    return compiled;
  }

  function peripheralRecords(source) {
    if (Array.isArray(source)) return source.filter(Boolean);
    if (!source || typeof source !== "object") return [];
    return Object.keys(source).map(function (key) {
      var value = source[key];
      return value && typeof value === "object" ? Object.assign({ handle: value.handle || key }, value) : null;
    }).filter(Boolean);
  }

  function modelI2cs() {
    return peripheralRecords(schematicState.projectModel && schematicState.projectModel.i2cs);
  }

  function modelAdcs() {
    return peripheralRecords(schematicState.projectModel && schematicState.projectModel.adcs);
  }

  function modelSpis() {
    return peripheralRecords(schematicState.projectModel && schematicState.projectModel.spis);
  }

  function modelTimers() {
    return peripheralRecords(schematicState.projectModel && schematicState.projectModel.timers);
  }

  function netHasMcuPin(net, pin) {
    var physical = normalizeMcuPinName(pin);
    if (!net || !physical) return false;
    return net.endpoints.some(function (endpoint) {
      var component = schematicState.components.get(endpoint.componentId);
      return component && component.type === "mcu" && normalizeMcuPinName(endpoint.pin) === physical;
    });
  }

  function netHasExternalEndpoint(net, componentId) {
    return Boolean(net && net.endpoints.some(function (endpoint) { return endpoint.componentId !== componentId; }));
  }

  function sameConnection(left, right) {
    var keys = ["powered", "busConnected", "bindingValid", "vccLevel", "gndLevel", "sclPin", "sdaPin", "sckPin", "mosiPin", "misoPin", "selected", "dataMode", "reason", "vccConnected", "gndConnected", "aoConnected", "doConnected", "aoPin", "doPin", "vccNet", "gndNet", "dataConnected", "triggerConnected", "echoConnected", "pwmConnected", "signalConnected", "clkConnected", "dioConnected", "dataPin", "triggerPin", "echoPin", "pwmPin", "signalPin", "clkPin", "dioPin", "timer", "channel"];
    return keys.every(function (key) { return (left && left[key]) === (right && right[key]); });
  }

  function externalMcuPinOnNet(net, componentId) {
    var endpoint = net && net.endpoints.find(function (candidate) {
      var owner = schematicState.components.get(candidate.componentId);
      return candidate.componentId !== componentId && owner && owner.type === "mcu";
    });
    return endpoint ? normalizeMcuPinName(endpoint.pin) : "";
  }

  function catalogPeripheralConnection(component, compiled) {
    var definition = catalogDefinition(component.type);
    var pins = definition ? definition.pins : [];
    var connection = { bindingValid: true, reason: "" };
    var roleFields = {
      data: ["dataConnected", "dataPin"],
      trigger: ["triggerConnected", "triggerPin"],
      echo: ["echoConnected", "echoPin"],
      pwm: ["pwmConnected", "pwmPin"],
      signal: ["signalConnected", "signalPin"],
      interrupt: ["signalConnected", "signalPin"],
      clk: ["clkConnected", "clkPin"],
      dio: ["dioConnected", "dioPin"],
      analog: ["dataConnected", "dataPin"],
      analog2: ["dioConnected", "dioPin"]
    };
    var vccPin = pins.find(function (pin) { return pin.role === "power"; });
    var gndPin = pins.find(function (pin) { return pin.role === "ground"; });
    var vccNet = vccPin ? netForEndpoint(compiled, { componentId: component.id, pin: vccPin.name }) : null;
    var gndNet = gndPin ? netForEndpoint(compiled, { componentId: component.id, pin: gndPin.name }) : null;
    connection.vccConnected = vccPin ? netHasExternalEndpoint(vccNet, component.id) : true;
    connection.gndConnected = gndPin ? netHasExternalEndpoint(gndNet, component.id) : true;
    connection.vccLevel = vccPin && vccNet && !vccNet.analogConflict ? vccNet.voltage : (definition.catalog.nominalVoltage || 3.3);
    connection.gndLevel = gndPin && gndNet && !gndNet.analogConflict ? gndNet.voltage : 0;
    connection.vccNet = vccNet && vccNet.id || "";
    connection.gndNet = gndNet && gndNet.id || "";
    connection.powered = connection.vccConnected && connection.gndConnected;
    pins.forEach(function (pin) {
      var fields = roleFields[pin.role];
      if (!fields) return;
      var net = netForEndpoint(compiled, { componentId: component.id, pin: pin.name });
      var connected = netHasExternalEndpoint(net, component.id);
      connection[fields[0]] = Boolean(connection[fields[0]] || connected);
      if (!connection[fields[1]]) connection[fields[1]] = externalMcuPinOnNet(net, component.id);
    });
    connection.busConnected = Boolean((connection.clkConnected && connection.dioConnected) || connection.dataConnected || connection.signalConnected || connection.pwmConnected || (connection.triggerConnected && connection.echoConnected));
    if (!connection.powered) connection.reason = "power-disconnected";
    else if (!connection.busConnected && component.type !== "rotaryEncoder") connection.reason = "signal-disconnected";
    return connection;
  }

  function setDeviceConnectionIfChanged(device, connection) {
    if (!device || typeof device.setConnection !== "function") return false;
    var previous = typeof device.getState === "function" ? device.getState().connection : null;
    if (sameConnection(previous, connection)) return false;
    device.setConnection(connection);
    return true;
  }

  function updatePeripheralConnections(compiled) {
    if (!compiled) return;
    var i2cs = modelI2cs();
    var spis = modelSpis();
    schematicState.components.forEach(function (component) {
      if (component.type === "oled") {
        var oled = componentDevice(component);
        if (!oled) return;
        var vccNet = netForEndpoint(compiled, { componentId: component.id, pin: "VCC" });
        var gndNet = netForEndpoint(compiled, { componentId: component.id, pin: "GND" });
        var sclNet = netForEndpoint(compiled, { componentId: component.id, pin: "SCL" });
        var sdaNet = netForEndpoint(compiled, { componentId: component.id, pin: "SDA" });
        var binding = i2cs.find(function (i2c) {
          return netHasMcuPin(sclNet, i2c.sclPin) && netHasMcuPin(sdaNet, i2c.sdaPin);
        }) || null;
        var vccLevel = vccNet && !vccNet.analogConflict ? vccNet.voltage : null;
        var gndLevel = gndNet && !gndNet.analogConflict ? gndNet.voltage : null;
        var rail = vccLevel != null && gndLevel != null ? vccLevel - gndLevel : 0;
        var powered = netHasExternalEndpoint(vccNet, component.id) && netHasExternalEndpoint(gndNet, component.id) && rail >= 2.4 && rail <= 5.5;
        var busConnected = netHasExternalEndpoint(sclNet, component.id) && netHasExternalEndpoint(sdaNet, component.id);
        component.i2cBinding = binding ? {
          handle: binding.handle || "",
          instance: binding.instance || "",
          sclPin: binding.sclPin || "",
          sdaPin: binding.sdaPin || ""
        } : null;
        var changed = setDeviceConnectionIfChanged(oled, {
          powered: powered,
          busConnected: busConnected,
          bindingValid: Boolean(binding),
          vccLevel: vccLevel,
          gndLevel: gndLevel,
          sclPin: binding && binding.sclPin || "",
          sdaPin: binding && binding.sdaPin || "",
          reason: !powered ? "power" : (!busConnected ? "bus-disconnected" : (!binding ? "ioc-pin-mismatch" : ""))
        });
        if (changed) updateOledVisual(component);
      } else if (component.type === "spiDisplay") {
        var spiScreen = componentDevice(component);
        if (!spiScreen) return;
        var spiVccNet = netForEndpoint(compiled, { componentId: component.id, pin: "VCC" });
        var spiGndNet = netForEndpoint(compiled, { componentId: component.id, pin: "GND" });
        var sckNet = netForEndpoint(compiled, { componentId: component.id, pin: "SCK" });
        var mosiNet = netForEndpoint(compiled, { componentId: component.id, pin: "MOSI" });
        var csNet = netForEndpoint(compiled, { componentId: component.id, pin: "CS" });
        var dcNet = netForEndpoint(compiled, { componentId: component.id, pin: "DC" });
        var spiBinding = spis.find(function (spi) {
          return netHasMcuPin(sckNet, spi.sckPin) && netHasMcuPin(mosiNet, spi.mosiPin);
        }) || null;
        var spiVcc = spiVccNet && !spiVccNet.analogConflict ? spiVccNet.voltage : null;
        var spiGnd = spiGndNet && !spiGndNet.analogConflict ? spiGndNet.voltage : null;
        var spiRail = spiVcc != null && spiGnd != null ? spiVcc - spiGnd : 0;
        var spiPowered = netHasExternalEndpoint(spiVccNet, component.id) && netHasExternalEndpoint(spiGndNet, component.id) && spiRail >= 2.4 && spiRail <= 5.5;
        var spiBusConnected = netHasExternalEndpoint(sckNet, component.id) && netHasExternalEndpoint(mosiNet, component.id);
        var csLevel = csNet && !csNet.conflict ? csNet.level : null;
        var dcLevel = dcNet && !dcNet.conflict ? dcNet.level : null;
        component.spiBinding = spiBinding ? {
          handle: spiBinding.handle || "",
          instance: spiBinding.instance || "",
          sckPin: spiBinding.sckPin || "",
          mosiPin: spiBinding.mosiPin || "",
          misoPin: spiBinding.misoPin || ""
        } : null;
        var spiChanged = setDeviceConnectionIfChanged(spiScreen, {
          powered: spiPowered,
          busConnected: spiBusConnected,
          bindingValid: Boolean(spiBinding),
          selected: csLevel === 0,
          dataMode: dcLevel === 1,
          vccLevel: spiVcc,
          gndLevel: spiGnd,
          sckPin: spiBinding && spiBinding.sckPin || "",
          mosiPin: spiBinding && spiBinding.mosiPin || "",
          misoPin: spiBinding && spiBinding.misoPin || "",
          reason: !spiPowered ? "power" : (!spiBusConnected ? "bus-disconnected" : (!spiBinding ? "ioc-pin-mismatch" : (csLevel !== 0 ? "chip-not-selected" : "")))
        });
        if (spiChanged) updateSpiDisplayVisual(component);
      } else if (component.type === "lightSensor") {
        var sensor = componentDevice(component);
        if (!sensor) return;
        var sensorVccNet = netForEndpoint(compiled, { componentId: component.id, pin: "VCC" });
        var sensorGndNet = netForEndpoint(compiled, { componentId: component.id, pin: "GND" });
        var aoNet = netForEndpoint(compiled, { componentId: component.id, pin: "AO" });
        var doNet = netForEndpoint(compiled, { componentId: component.id, pin: "DO" });
        var sensorVcc = sensorVccNet && !sensorVccNet.analogConflict ? sensorVccNet.voltage : null;
        var sensorGnd = sensorGndNet && !sensorGndNet.analogConflict ? sensorGndNet.voltage : null;
        var vccConnected = netHasExternalEndpoint(sensorVccNet, component.id);
        var gndConnected = netHasExternalEndpoint(sensorGndNet, component.id);
        var sensorChanged = setDeviceConnectionIfChanged(sensor, {
          powered: vccConnected && gndConnected,
          vccConnected: vccConnected,
          gndConnected: gndConnected,
          aoConnected: netHasExternalEndpoint(aoNet, component.id),
          doConnected: netHasExternalEndpoint(doNet, component.id),
          bindingValid: true,
          vccLevel: sensorVcc,
          gndLevel: sensorGnd,
          vccNet: sensorVccNet && sensorVccNet.id || "",
          gndNet: sensorGndNet && sensorGndNet.id || "",
          aoPin: aoNet && aoNet.endpoints.find(function (endpoint) { return endpoint.componentId !== component.id && schematicState.components.get(endpoint.componentId) && schematicState.components.get(endpoint.componentId).type === "mcu"; })?.pin || "",
          doPin: doNet && doNet.endpoints.find(function (endpoint) { return endpoint.componentId !== component.id && schematicState.components.get(endpoint.componentId) && schematicState.components.get(endpoint.componentId).type === "mcu"; })?.pin || "",
          reason: !vccConnected || !gndConnected ? "power-disconnected" : ""
        });
        if (sensorChanged) updateLightSensorVisual(component);
      } else if (catalogDefinition(component.type)) {
        var catalogPeripheral = componentDevice(component);
        if (!catalogPeripheral) return;
        var catalogChanged = setDeviceConnectionIfChanged(catalogPeripheral, catalogPeripheralConnection(component, compiled));
        if (catalogChanged) updateCatalogVisual(component);
      }
    });
  }

  function netForEndpoint(netlist, endpoint) {
    if (!netlist || !endpoint) return null;
    var netId = netlist.endpointToNet[endpointKey(endpoint)];
    return netlist.netById.get(netId) || null;
  }

  function ledForwardVoltage(component) {
    var text = String(component && component.value || "").toUpperCase();
    var explicit = text.match(/(\d+(?:\.\d+)?)\s*V(?:F|WD)?\b/);
    if (explicit) return clampNumber(Number(explicit[1]), 1.2, 4.2);
    if (/BLUE|WHITE|紫|蓝|白/.test(text)) return 3.0;
    if (/GREEN|绿/.test(text)) return 2.2;
    if (/YELLOW|AMBER|ORANGE|黄|橙/.test(text)) return 2.0;
    return 1.9;
  }

  function ledElectricalState(anode, cathode, component) {
    var anodeVoltage = anode && Number.isFinite(anode.voltage) ? Number(anode.voltage) : (anode && anode.level != null ? (anode.level ? 3.3 : 0) : null);
    var cathodeVoltage = cathode && Number.isFinite(cathode.voltage) ? Number(cathode.voltage) : (cathode && cathode.level != null ? (cathode.level ? 3.3 : 0) : null);
    var forwardVoltage = ledForwardVoltage(component);
    var voltageDrop = anodeVoltage != null && cathodeVoltage != null ? anodeVoltage - cathodeVoltage : null;
    var on = Boolean(
      anode && cathode && anode.id !== cathode.id &&
      !anode.floating && !cathode.floating && !anode.conflict && !cathode.conflict &&
      voltageDrop != null && voltageDrop >= forwardVoltage - 0.05
    );
    var state = on ? "forward-biased" : (
      !anode || !cathode || anode.floating || cathode.floating ? "floating" :
        (anode.conflict || cathode.conflict ? "conflict" : (voltageDrop != null && voltageDrop < -0.05 ? "reverse-biased" : "off"))
    );
    return { on: on, state: state, voltageV: voltageDrop, forwardVoltageV: forwardVoltage };
  }

  function driveMcuPin(pin, level, options) {
    options = options && typeof options === "object" ? options : {};
    var physical = resolveMcuPinName(pin);
    if (!physical || !componentDefinitions.mcu.pins.some(function (candidate) { return candidate.name === physical; })) return false;
    var normalizedLevel = normalizeDriveLevel(level);
    if (normalizedLevel == null) {
      schematicState.mcuDrives.delete(physical);
      schematicState.signals.delete(physical);
    } else {
      schematicState.mcuDrives.set(physical, normalizedLevel);
      schematicState.signals.set(physical, Boolean(normalizedLevel));
    }
    schematicState.mcuPwm.delete(physical);
    schematicState.compiledNetlist = null;
    if (schematicState.initialized) {
      if (options.render !== false) renderWires();
      document.dispatchEvent(new CustomEvent("alice:schematic-signal", { detail: { name: physical, value: normalizedLevel, highImpedance: normalizedLevel == null } }));
    }
    return normalizedLevel;
  }

  function driveMcuPwm(input) {
    var event = input && typeof input === "object" ? input : {};
    var timer = findModelTimer(event.instance || event.timer || event.handle);
    var channelNumber = Number(event.channel) || Number(String(event.channelExpression || event.channelName || "").match(/(?:CHANNEL_|CH)?(\d+)/i)?.[1]) || 1;
    var channel = timer && Array.isArray(timer.channels) ? timer.channels.find(function (item) { return Number(item.channelNumber) === channelNumber; }) : null;
    var physical = resolveMcuPinName(event.pin || channel && channel.pin);
    if (!physical) return false;
    var dutyCycle = clampNumber(Number(event.active === false ? 0 : event.dutyCycle), 0, 1);
    var record = {
      pin: physical,
      timer: timer && timer.handle || event.timer || event.handle || "",
      instance: timer && timer.instance || event.instance || "",
      channel: channelNumber,
      active: event.active !== false,
      compare: Number(event.compare) || 0,
      period: Number(event.period) || 0,
      dutyCycle: dutyCycle,
      dutyPercent: dutyCycle * 100,
      frequencyHz: Number(event.frequencyHz != null ? event.frequencyHz : timer && timer.frequencyHz) || 0,
      timeMs: Number(event.timeMs != null ? event.timeMs : event.time) || schematicState.time
    };
    schematicState.mcuPwm.set(physical, record);
    schematicState.mcuDrives.set(physical, dutyCycle > 0 ? 1 : 0);
    schematicState.signals.set(physical, dutyCycle > 0);
    schematicState.compiledNetlist = null;
    if (schematicState.initialized) {
      if (event.render !== false) renderWires();
      document.dispatchEvent(new CustomEvent("alice:schematic-pwm", { detail: Object.assign({}, record) }));
    }
    return Object.assign({}, record);
  }

  function pwmSampleLevel(record, timeMs) {
    if (!record || record.active === false) return 0;
    var duty = clampNumber(Number(record.dutyCycle) || 0, 0, 1);
    if (duty <= 0) return 0;
    if (duty >= 1) return 1;
    var frequency = Number(record.frequencyHz) || 0;
    if (frequency <= 0) return duty >= 0.5 ? 1 : 0;
    var phase = ((Math.max(0, Number(timeMs) || 0) / 1000) * frequency) % 1;
    return phase < duty ? 1 : 0;
  }

  function sampleMcuPin(pin) {
    var physical = resolveMcuPinName(pin);
    var pwm = schematicState.mcuPwm.get(physical);
    if (pwm) return pwmSampleLevel(pwm, schematicState.time);
    var endpoint = findMcuPinEndpoint(physical);
    if (!endpoint) return null;
    var net = netForEndpoint(compileNetlist(), endpoint);
    if (!net || net.conflict || net.floating) return null;
    if (net.level != null) return net.level;
    return net.voltage == null || net.analogConflict ? null : (net.voltage >= 1.65 ? 1 : 0);
  }

  function sampleAnalogMcuPin(pin) {
    var physical = resolveMcuPinName(pin);
    var pwm = schematicState.mcuPwm.get(physical);
    if (pwm) {
      var duty = pwm.active === false ? 0 : clampNumber(Number(pwm.dutyCycle) || 0, 0, 1);
      return 3.3 * duty;
    }
    var endpoint = findMcuPinEndpoint(physical);
    if (!endpoint) return null;
    var net = netForEndpoint(compileNetlist(), endpoint);
    if (!net || net.conflict || net.analogConflict || net.floating) return null;
    if (net.voltage != null) return net.voltage;
    return net.level == null ? null : (net.level ? 3.3 : 0);
  }

  function peripheralMatches(descriptor, reference) {
    var requested = String(reference && typeof reference === "object" ? (reference.instance || reference.handle || reference.i2c || reference.spi || reference.adc || reference.timer || "") : (reference || "")).replace(/^&/, "").toUpperCase();
    if (!requested) return true;
    return [descriptor && descriptor.instance, descriptor && descriptor.handle].some(function (value) {
      return String(value || "").replace(/^&/, "").toUpperCase() === requested;
    });
  }

  function findModelI2c(reference) {
    return modelI2cs().find(function (descriptor) { return peripheralMatches(descriptor, reference); }) || null;
  }

  function findModelAdc(reference) {
    return modelAdcs().find(function (descriptor) { return peripheralMatches(descriptor, reference); }) || null;
  }

  function findModelSpi(reference) {
    return modelSpis().find(function (descriptor) { return peripheralMatches(descriptor, reference); }) || null;
  }

  function findModelTimer(reference) {
    return modelTimers().find(function (descriptor) { return peripheralMatches(descriptor, reference); }) || null;
  }

  function normalizeI2cAddress(value) {
    var numeric = typeof value === "string" && /^0x/i.test(value.trim()) ? parseInt(value, 16) : Number(value);
    if (!Number.isFinite(numeric)) return null;
    numeric = Math.floor(numeric);
    if (numeric > 0x77) numeric = numeric >> 1;
    return normalizeOledAddress(numeric);
  }

  function i2cBytes(value) {
    if (window.AliceOledDevice && typeof window.AliceOledDevice.normalizeBytes === "function") return window.AliceOledDevice.normalizeBytes(value);
    if (Array.isArray(value)) return value.map(function (item) { return Number(item) & 0xff; });
    return value == null ? [] : [Number(value) & 0xff];
  }

  function writeOledPayload(device, control, payload) {
    var bytes = i2cBytes(payload);
    if ((Number(control) & 0x40) !== 0) return device.data(bytes);
    return device.command(bytes);
  }

  function deliverOledI2c(device, event) {
    var bytes = i2cBytes(event.bytes != null ? event.bytes : (event.buffer != null ? event.buffer : event.data));
    if (event.memoryAddress != null) {
      return writeOledPayload(device, Number(event.memoryAddress) & 0xff, bytes);
    }
    if (event.controlByte != null) return writeOledPayload(device, event.controlByte, bytes);
    var consumed = 0;
    var index = 0;
    while (index < bytes.length) {
      var control = bytes[index];
      if ((control & 0x3f) !== 0) {
        consumed += device.data(bytes.slice(index));
        break;
      }
      index += 1;
      var continuation = Boolean(control & 0x80);
      var payload = continuation ? bytes.slice(index, index + 1) : bytes.slice(index);
      consumed += writeOledPayload(device, control, payload);
      index += payload.length;
      if (!continuation) break;
    }
    return consumed;
  }

  function handleI2cTransmission(event) {
    var transaction = event && typeof event === "object" ? event : {};
    var descriptor = findModelI2c(transaction.instance || transaction.i2c || transaction.handle);
    var address = normalizeI2cAddress(transaction.deviceAddress != null ? transaction.deviceAddress : transaction.address);
    var accepted = [];
    compileNetlist();
    schematicState.components.forEach(function (component) {
      if (component.type !== "oled") return;
      var device = componentDevice(component);
      var state = device && device.getState();
      var bindingMatches = descriptor && component.i2cBinding && peripheralMatches(descriptor, component.i2cBinding.instance || component.i2cBinding.handle);
      if (!device || !state || !state.connection.powered || !state.connection.busConnected || !state.connection.bindingValid || !bindingMatches) return;
      if (address != null && !device.accepts(address)) return;
      var byteCount = deliverOledI2c(device, transaction);
      updateOledVisual(component);
      accepted.push({ componentId: component.id, ref: component.ref, address: device.address, byteCount: byteCount });
    });
    return {
      accepted: accepted.length > 0,
      targetCount: accepted.length,
      targets: accepted,
      instance: descriptor && descriptor.instance || transaction.instance || "",
      address: address
    };
  }

  function handleSpiTransmission(input) {
    var event = input && typeof input === "object" ? input : {};
    var descriptor = findModelSpi(event.instance || event.spi || event.handle);
    var accepted = [];
    var bytes = i2cBytes(event.bytes != null ? event.bytes : (event.buffer != null ? event.buffer : event.data));
    compileNetlist();
    schematicState.components.forEach(function (component) {
      if (component.type !== "spiDisplay") return;
      var device = componentDevice(component);
      var state = device && device.getState();
      var bindingMatches = descriptor && component.spiBinding && peripheralMatches(descriptor, component.spiBinding.instance || component.spiBinding.handle);
      if (!device || !state || !state.connection.powered || !state.connection.busConnected || !state.connection.bindingValid || !state.connection.selected || !bindingMatches) return;
      var byteCount = device.transmit(bytes, Boolean(state.connection.dataMode));
      updateSpiDisplayVisual(component);
      accepted.push({ componentId: component.id, ref: component.ref, byteCount: byteCount, dataMode: Boolean(state.connection.dataMode) });
    });
    return {
      accepted: accepted.length > 0,
      targetCount: accepted.length,
      targets: accepted,
      instance: descriptor && descriptor.instance || event.instance || "",
      handle: descriptor && descriptor.handle || event.handle || "",
      byteCount: bytes.length
    };
  }

  function adcChannelPin(descriptor, options) {
    var config = options && typeof options === "object" ? options : {};
    var direct = normalizeMcuPinName(config.pin || config.physicalPin);
    if (direct) return direct;
    var channels = descriptor && Array.isArray(descriptor.channels) ? descriptor.channels.slice() : [];
    if (config.channel != null) {
      var requested = String(config.channel).toUpperCase();
      var selected = channels.find(function (channel) {
        return String(channel.channel || channel.channelNumber || "").toUpperCase() === requested || String(channel.channelNumber) === requested;
      });
      if (selected) return normalizeMcuPinName(selected.pin);
    }
    channels.sort(function (left, right) {
      function order(channel) {
        var rank = Number(channel && channel.rank);
        if (Number.isFinite(rank) && rank > 0) return rank;
        var slot = Number(channel && channel.slot);
        if (Number.isFinite(slot) && slot > 0) return slot;
        return Number.POSITIVE_INFINITY;
      }
      var leftOrder = order(left);
      var rightOrder = order(right);
      if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
      var leftNumber = Number(left && left.channelNumber);
      var rightNumber = Number(right && right.channelNumber);
      if (!Number.isFinite(leftNumber)) leftNumber = Number.POSITIVE_INFINITY;
      if (!Number.isFinite(rightNumber)) rightNumber = Number.POSITIVE_INFINITY;
      return leftNumber - rightNumber;
    });
    return normalizeMcuPinName(channels[0] && channels[0].pin || descriptor && descriptor.pin);
  }

  function sampleAdc(reference, options) {
    var descriptor = findModelAdc(reference);
    var config = options && typeof options === "object" ? options : {};
    var pin = adcChannelPin(descriptor, config) || normalizeMcuPinName(typeof reference === "string" ? reference : "");
    var voltage = sampleAnalogMcuPin(pin);
    var bits = clampNumber(Math.round(Number(config.bits || config.adcBits) || 12), 1, 24);
    var referenceVoltage = Math.max(0.1, Number(config.referenceVoltage || config.adcReferenceVoltage) || 3.3);
    var maximum = Math.pow(2, bits) - 1;
    var value = voltage == null ? null : Math.round(clampNumber(voltage / referenceVoltage, 0, 1) * maximum);
    return {
      value: value,
      raw: value,
      voltage: voltage,
      pin: pin,
      bits: bits,
      referenceVoltage: referenceVoltage,
      connected: voltage != null,
      instance: descriptor && descriptor.instance || "",
      handle: descriptor && descriptor.handle || ""
    };
  }

  function timerChannelSignal(event) {
    var timer = String(event && (event.timer || event.handle || event.instance) || "").replace(/^&/, "").toUpperCase();
    var timerMatch = timer.match(/(?:HTIM|TIM)(\d+)/);
    var channelText = String(event && (event.channelName || event.channelExpression || event.channel) || "").toUpperCase();
    var channelMatch = channelText.match(/(?:CHANNEL_|CH)?(\d+)/);
    if (!timerMatch || !channelMatch) return "";
    return "TIM" + timerMatch[1] + "_CH" + channelMatch[1];
  }

  function mcuSignalForPin(pinName) {
    var physical = normalizeMcuPinName(pinName);
    var pin = componentDefinitions.mcu.pins.find(function (candidate) { return normalizeMcuPinName(candidate.name) === physical; });
    return String(pin && (pin.signal || pin.mode || pin.label) || "").toUpperCase();
  }

  function peripheralEventMatches(component, event, candidatesOfType) {
    var state = componentDevice(component).getState();
    var connection = state.connection || {};
    var pairs = [
      ["dataPin", "dataPin"], ["triggerPin", "triggerPin"], ["trigPin", "triggerPin"], ["echoPin", "echoPin"],
      ["pwmPin", "pwmPin"], ["signalPin", "signalPin"], ["clkPin", "clkPin"], ["dioPin", "dioPin"]
    ];
    var compared = false;
    for (var index = 0; index < pairs.length; index += 1) {
      var requested = normalizeMcuPinName(event[pairs[index][0]]);
      if (!requested) continue;
      compared = true;
      if (normalizeMcuPinName(connection[pairs[index][1]]) !== requested) return false;
    }
    var timerSignal = timerChannelSignal(event);
    if (timerSignal) {
      compared = true;
      var connectedPin = connection.pwmPin || connection.signalPin;
      if (mcuSignalForPin(connectedPin).indexOf(timerSignal) < 0) return false;
    }
    return compared || candidatesOfType.length === 1;
  }

  function handlePeripheralOperation(input) {
    var event = input && typeof input === "object" ? input : {};
    var type = String(event.peripheralType || event.type || "");
    var action = String(event.action || event.operation || "").toLowerCase();
    var candidates = Array.from(schematicState.components.values()).filter(function (component) { return component.type === type; });
    compileNetlist();
    var targets = [];
    var result = null;
    candidates.forEach(function (component) {
      var device = componentDevice(component);
      if (!device || !peripheralEventMatches(component, event, candidates)) return;
      var state = device.getState();
      if (!state.ready && type !== "rotaryEncoder") return;
      var targetResult = null;
      if (type === "dht11" && action.indexOf("read") >= 0 && typeof device.read === "function") targetResult = device.read();
      else if (type === "hcsr04" && action.indexOf("measure") >= 0 && typeof device.measure === "function") targetResult = device.measure();
      else if (type === "sg90" && action.indexOf("angle") >= 0 && typeof device.setAngle === "function") targetResult = { angle: device.setAngle(event.angle) };
      else if (type === "buzzer" && action.indexOf("stop") >= 0 && typeof device.stop === "function") targetResult = { active: !device.stop() };
      else if (type === "buzzer" && typeof device.setTone === "function") targetResult = { active: device.setTone(event.frequencyHz, event.dutyPermille == null ? 500 : event.dutyPermille) };
      else if (type === "tm1637" && action.indexOf("brightness") >= 0 && typeof device.setBrightness === "function") targetResult = { brightness: device.setBrightness(event.brightness, event.enabled) };
      else if (type === "tm1637" && action.indexOf("clear") >= 0 && typeof device.clear === "function") { device.clear(); targetResult = { text: "    " }; }
      else if (type === "tm1637" && typeof device.displayNumber === "function") targetResult = { text: device.displayNumber(event.value, event.leadingZero, event.colon) };
      else if (typeof device.apply === "function") targetResult = device.apply(action, event);
      if (targetResult == null) return;
      result = result == null ? targetResult : result;
      targets.push({ componentId: component.id, ref: component.ref, type: type, result: targetResult });
      updateCatalogVisual(component);
    });
    return { accepted: targets.length > 0, targetCount: targets.length, targets: targets, result: result };
  }

  function firmwareInputSnapshot() {
    var compiled = compileNetlist();
    // compileNetlist refreshes device power, bus and MCU-pin bindings. Keep the
    // Worker snapshot intentionally compact; framebuffers and UI-only fields
    // never cross the thread boundary.
    var snapshot = { i2c: [], spi: [], peripherals: [] };
    schematicState.components.forEach(function (component) {
      var device = componentDevice(component);
      if (!device || typeof device.getState !== "function") return;
      var state = device.getState();
      var connection = state && state.connection || {};
      if (component.type === "oled") {
        snapshot.i2c.push({
          componentId: component.id,
          instance: component.i2cBinding && component.i2cBinding.instance || "",
          handle: component.i2cBinding && component.i2cBinding.handle || "",
          address: Number(device.address != null ? device.address : component.oledAddress),
          ready: Boolean(connection.powered && connection.busConnected && connection.bindingValid)
        });
        return;
      }
      if (component.type === "spiDisplay") {
        var csNet = netForEndpoint(compiled, { componentId: component.id, pin: "CS" });
        var dcNet = netForEndpoint(compiled, { componentId: component.id, pin: "DC" });
        snapshot.spi.push({
          componentId: component.id,
          instance: component.spiBinding && component.spiBinding.instance || "",
          handle: component.spiBinding && component.spiBinding.handle || "",
          csPin: externalMcuPinOnNet(csNet, component.id),
          dcPin: externalMcuPinOnNet(dcNet, component.id),
          selected: Boolean(connection.selected),
          dataMode: Boolean(connection.dataMode),
          ready: Boolean(connection.powered && connection.busConnected && connection.bindingValid)
        });
        return;
      }
      if (!catalogDefinition(component.type)) return;
      snapshot.peripherals.push({
        componentId: component.id,
        type: component.type,
        ready: Boolean(state.ready),
        connection: {
          dataPin: connection.dataPin || "",
          triggerPin: connection.triggerPin || "",
          echoPin: connection.echoPin || "",
          pwmPin: connection.pwmPin || "",
          signalPin: connection.signalPin || "",
          clkPin: connection.clkPin || "",
          dioPin: connection.dioPin || ""
        },
        state: {
          temperatureC: state.temperatureC,
          humidityPercent: state.humidityPercent,
          distanceCm: state.distanceCm,
          distanceMm: state.distanceMm,
          echoPulseUs: state.echoPulseUs,
          angle: state.angle,
          active: state.active,
          frequencyHz: state.frequencyHz,
          dutyPermille: state.dutyPermille,
          brightness: state.brightness,
          enabled: state.enabled,
          text: state.text,
          properties: state.properties && Object.assign({}, state.properties)
        }
      });
    });
    return snapshot;
  }

  function inferSignal(endpoint) {
    var found = getPinDefinition(endpoint);
    if (!found) return "";
    if (found.component.type === "vcc") return "VCC";
    if (found.component.type === "ground") return "GND";
    var direct = normalizeSignalName(found.pin.name);
    if (direct === "VCC" || direct === "GND" || found.component.type === "mcu") return direct;

    var connected = schematicState.wires.find(function (wire) {
      return sameEndpoint(wire.from, endpoint) || sameEndpoint(wire.to, endpoint);
    });
    if (connected && connected.signal) return connected.signal;

    if (found.component.type === "resistor" || found.component.type === "button") {
      var acrossPassive = schematicState.wires.find(function (wire) {
        return wire.from.componentId === endpoint.componentId || wire.to.componentId === endpoint.componentId;
      });
      if (acrossPassive && acrossPassive.signal) return acrossPassive.signal;
    }
    return "";
  }

  function createWire(from, to, signal, options) {
    if (signal && typeof signal === "object") {
      options = signal;
      signal = "";
    }
    var config = options || {};
    if (!getPinDefinition(from) || !getPinDefinition(to) || sameEndpoint(from, to)) return null;
    var duplicate = schematicState.wires.find(function (wire) {
      return (sameEndpoint(wire.from, from) && sameEndpoint(wire.to, to)) ||
        (sameEndpoint(wire.from, to) && sameEndpoint(wire.to, from));
    });
    if (duplicate) return duplicate;

    var wireId = config.id ? String(config.id) : "";
    if (!wireId) {
      do {
        schematicState.wireCounter += 1;
        wireId = "wire-" + schematicState.wireCounter;
      } while (schematicState.wires.some(function (wire) { return wire.id === wireId; }));
    }
    var start = getPinPoint(from);
    var end = getPinPoint(to);
    var wire = {
      id: wireId,
      from: { componentId: from.componentId, pin: from.pin },
      to: { componentId: to.componentId, pin: to.pin },
      // Kept only as a human-readable net hint. `compileNetlist()` is the sole
      // electrical source of truth.
      signal: normalizeSignalName(signal || inferSignal(from) || inferSignal(to)),
      route: routeIsOrthogonal(config.route) ? cloneRoute(config.route) : createOrthogonalRoute(start, end),
      autoGenerated: Boolean(config.autoGenerated),
      autoSource: config.autoSource ? String(config.autoSource) : "",
      autoKey: config.autoKey ? String(config.autoKey) : ""
    };
    schematicState.wires.push(wire);
    renderWires();
    return wire;
  }

  function pointWithStub(point, distance) {
    if (point.side === "left") return { x: point.x - distance, y: point.y };
    if (point.side === "right") return { x: point.x + distance, y: point.y };
    if (point.side === "top") return { x: point.x, y: point.y - distance };
    return { x: point.x, y: point.y + distance };
  }

  function clonePoint(point) {
    return { x: Number(point.x), y: Number(point.y) };
  }

  function cloneRoute(route) {
    return Array.isArray(route) ? route.map(clonePoint) : [];
  }

  function samePoint(first, second) {
    return Boolean(first && second && first.x === second.x && first.y === second.y);
  }

  function segmentOrientation(first, second) {
    if (!first || !second || samePoint(first, second)) return null;
    if (first.y === second.y) return "horizontal";
    if (first.x === second.x) return "vertical";
    return null;
  }

  function clampRoutePoint(point) {
    return {
      x: clampNumber(Number(point.x) || 0, 0, WORLD_WIDTH),
      y: clampNumber(Number(point.y) || 0, 0, WORLD_HEIGHT)
    };
  }

  function cleanOrthogonalRoute(route) {
    var compact = [];
    (Array.isArray(route) ? route : []).forEach(function (point) {
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return;
      var next = clampRoutePoint(point);
      if (!compact.length || !samePoint(compact[compact.length - 1], next)) compact.push(next);
    });

    var changed = true;
    while (changed && compact.length > 2) {
      changed = false;
      for (var index = 1; index < compact.length - 1; index += 1) {
        var before = compact[index - 1];
        var current = compact[index];
        var after = compact[index + 1];
        if ((before.x === current.x && current.x === after.x) ||
          (before.y === current.y && current.y === after.y)) {
          compact.splice(index, 1);
          changed = true;
          break;
        }
      }
    }
    return compact;
  }

  function routeIsOrthogonal(route) {
    if (!Array.isArray(route) || route.length < 2) return false;
    for (var index = 0; index < route.length; index += 1) {
      if (!route[index] || !Number.isFinite(Number(route[index].x)) || !Number.isFinite(Number(route[index].y))) return false;
      if (index && !samePoint(route[index - 1], route[index]) && !segmentOrientation(route[index - 1], route[index])) return false;
    }
    return true;
  }

  function createOrthogonalRoute(start, end) {
    if (!start || !end) return [];
    var startStub = pointWithStub(start, WIRE_STUB);
    var endStub = pointWithStub(end, WIRE_STUB);
    var horizontalStart = start.side === "left" || start.side === "right";
    var horizontalEnd = end.side === "left" || end.side === "right";
    var points = [clonePoint(start), startStub];

    if (horizontalStart && horizontalEnd) {
      var middleX = snapToGrid((startStub.x + endStub.x) / 2);
      points.push({ x: middleX, y: startStub.y }, { x: middleX, y: endStub.y });
    } else if (!horizontalStart && !horizontalEnd) {
      var middleY = snapToGrid((startStub.y + endStub.y) / 2);
      points.push({ x: startStub.x, y: middleY }, { x: endStub.x, y: middleY });
    } else if (horizontalStart) {
      points.push({ x: endStub.x, y: startStub.y });
    } else {
      points.push({ x: startStub.x, y: endStub.y });
    }
    points.push(endStub, clonePoint(end));
    return cleanOrthogonalRoute(points);
  }

  function routeToPath(route) {
    if (!Array.isArray(route) || route.length < 2) return "";
    var commands = ["M", route[0].x, route[0].y];
    for (var index = 1; index < route.length; index += 1) {
      commands.push("L", route[index].x, route[index].y);
    }
    return commands.join(" ");
  }

  function orthogonalPath(start, end) {
    return routeToPath(createOrthogonalRoute(start, end));
  }

  function syncRouteEndpoint(route, endpoint, atStart) {
    if (!route.length || !endpoint) return route;
    var endpointIndex = atStart ? 0 : route.length - 1;
    var neighborIndex = atStart ? 1 : route.length - 2;
    var previousEndpoint = clonePoint(route[endpointIndex]);
    var nextEndpoint = clampRoutePoint(endpoint);
    if (samePoint(previousEndpoint, nextEndpoint)) return route;

    if (route.length < 2) return [nextEndpoint];
    var orientation = segmentOrientation(previousEndpoint, route[neighborIndex]);
    if (!orientation) orientation = endpoint.side === "left" || endpoint.side === "right" ? "horizontal" : "vertical";
    route[endpointIndex] = nextEndpoint;

    if (route.length === 2) {
      var other = route[neighborIndex];
      if (orientation === "horizontal" && other.y !== nextEndpoint.y) {
        var horizontalCorner = { x: other.x, y: nextEndpoint.y };
        if (atStart) route.splice(1, 0, horizontalCorner);
        else route.splice(route.length - 1, 0, horizontalCorner);
      } else if (orientation === "vertical" && other.x !== nextEndpoint.x) {
        var verticalCorner = { x: nextEndpoint.x, y: other.y };
        if (atStart) route.splice(1, 0, verticalCorner);
        else route.splice(route.length - 1, 0, verticalCorner);
      }
      return route;
    }

    if (orientation === "horizontal") route[neighborIndex].y = nextEndpoint.y;
    else route[neighborIndex].x = nextEndpoint.x;
    return route;
  }

  function endpointDirectionMatches(endpoint, neighbor) {
    if (!endpoint || !neighbor) return false;
    if (endpoint.side === "left") return neighbor.y === endpoint.y && neighbor.x <= endpoint.x;
    if (endpoint.side === "right") return neighbor.y === endpoint.y && neighbor.x >= endpoint.x;
    if (endpoint.side === "top") return neighbor.x === endpoint.x && neighbor.y <= endpoint.y;
    return neighbor.x === endpoint.x && neighbor.y >= endpoint.y;
  }

  function enforceEndpointDirection(route, endpoint, atStart) {
    if (!endpoint || route.length < 2) return route;
    var neighborIndex = atStart ? 1 : route.length - 2;
    var neighbor = route[neighborIndex];
    if (endpointDirectionMatches(endpoint, neighbor)) return route;

    var horizontal = endpoint.side === "left" || endpoint.side === "right";
    var rawEscape = pointWithStub(endpoint, WIRE_STUB);
    var escape = horizontal
      ? clampRoutePoint({ x: snapToGrid(rawEscape.x), y: endpoint.y })
      : clampRoutePoint({ x: endpoint.x, y: snapToGrid(rawEscape.y) });
    if (samePoint(escape, endpoint)) {
      if (horizontal) escape.x = clampNumber(endpoint.x + (endpoint.side === "left" ? -GRID_SIZE : GRID_SIZE), 0, WORLD_WIDTH);
      else escape.y = clampNumber(endpoint.y + (endpoint.side === "top" ? -GRID_SIZE : GRID_SIZE), 0, WORLD_HEIGHT);
    }
    var bridge = horizontal
      ? { x: escape.x, y: neighbor.y }
      : { x: neighbor.x, y: escape.y };
    if (atStart) route.splice(1, 0, escape, bridge);
    else route.splice(route.length - 1, 0, bridge, escape);
    return cleanOrthogonalRoute(route);
  }

  function ensureWireRoute(wire) {
    var start = getPinPoint(wire.from);
    var end = getPinPoint(wire.to);
    if (!start || !end) return [];
    var route = routeIsOrthogonal(wire.route) ? cleanOrthogonalRoute(wire.route) : createOrthogonalRoute(start, end);
    route = syncRouteEndpoint(route, start, true);
    route = syncRouteEndpoint(route, end, false);
    route = enforceEndpointDirection(route, start, true);
    route = enforceEndpointDirection(route, end, false);
    wire.route = cleanOrthogonalRoute(route);
    if (wire.route.length < 2) wire.route = createOrthogonalRoute(start, end);
    return wire.route;
  }

  function findWire(wireId) {
    return schematicState.wires.find(function (wire) { return wire.id === wireId; }) || null;
  }

  function endpointEscapePoint(endpoint, neighbor) {
    var orientation = segmentOrientation(endpoint, neighbor);
    if (!orientation) return clonePoint(endpoint);
    if (orientation === "horizontal") {
      var horizontalDirection = neighbor.x >= endpoint.x ? 1 : -1;
      var escapeX = snapToGrid(endpoint.x + horizontalDirection * WIRE_STUB);
      if (escapeX === endpoint.x) escapeX += horizontalDirection * GRID_SIZE;
      return clampRoutePoint({ x: escapeX, y: endpoint.y });
    }
    var verticalDirection = neighbor.y >= endpoint.y ? 1 : -1;
    var escapeY = snapToGrid(endpoint.y + verticalDirection * WIRE_STUB);
    if (escapeY === endpoint.y) escapeY += verticalDirection * GRID_SIZE;
    return clampRoutePoint({ x: endpoint.x, y: escapeY });
  }

  function routeForSegmentDrag(originalRoute, segmentIndex, targetPoint) {
    var route = cloneRoute(originalRoute);
    var first = route[segmentIndex];
    var second = route[segmentIndex + 1];
    var orientation = segmentOrientation(first, second);
    if (!orientation) return route;
    var target = clampRoutePoint(targetPoint);
    var lastSegmentIndex = route.length - 2;

    if (route.length === 2) {
      var startEscape = endpointEscapePoint(first, second);
      var endEscape = endpointEscapePoint(second, first);
      if (orientation === "horizontal") {
        return cleanOrthogonalRoute([
          first,
          startEscape,
          { x: startEscape.x, y: target.y },
          { x: endEscape.x, y: target.y },
          endEscape,
          second
        ]);
      }
      return cleanOrthogonalRoute([
        first,
        startEscape,
        { x: target.x, y: startEscape.y },
        { x: target.x, y: endEscape.y },
        endEscape,
        second
      ]);
    }

    if (orientation === "horizontal") {
      if (segmentIndex === 0) {
        var horizontalStartEscape = endpointEscapePoint(first, second);
        route = [
          first,
          horizontalStartEscape,
          { x: horizontalStartEscape.x, y: target.y },
          { x: second.x, y: target.y }
        ].concat(route.slice(2));
      } else if (segmentIndex === lastSegmentIndex) {
        var horizontalEndEscape = endpointEscapePoint(second, first);
        route = route.slice(0, segmentIndex).concat([
          { x: first.x, y: target.y },
          { x: horizontalEndEscape.x, y: target.y },
          horizontalEndEscape,
          second
        ]);
      } else {
        route[segmentIndex].y = target.y;
        route[segmentIndex + 1].y = target.y;
      }
    } else if (segmentIndex === 0) {
      var verticalStartEscape = endpointEscapePoint(first, second);
      route = [
        first,
        verticalStartEscape,
        { x: target.x, y: verticalStartEscape.y },
        { x: target.x, y: second.y }
      ].concat(route.slice(2));
    } else if (segmentIndex === lastSegmentIndex) {
      var verticalEndEscape = endpointEscapePoint(second, first);
      route = route.slice(0, segmentIndex).concat([
        { x: target.x, y: first.y },
        { x: target.x, y: verticalEndEscape.y },
        verticalEndEscape,
        second
      ]);
    } else {
      route[segmentIndex].x = target.x;
      route[segmentIndex + 1].x = target.x;
    }
    return cleanOrthogonalRoute(route);
  }

  function routeForBendDrag(originalRoute, pointIndex, targetPoint) {
    var route = cloneRoute(originalRoute);
    if (pointIndex <= 0 || pointIndex >= route.length - 1) return route;
    var incoming = segmentOrientation(route[pointIndex - 1], route[pointIndex]);
    var outgoing = segmentOrientation(route[pointIndex], route[pointIndex + 1]);
    if (!incoming || !outgoing || incoming === outgoing) return route;
    var target = clampRoutePoint(targetPoint);
    var prefix = route.slice(0, pointIndex);
    var suffix = route.slice(pointIndex + 1);

    if (prefix.length === 1) {
      var start = prefix[0];
      var startEscape = endpointEscapePoint(start, route[pointIndex]);
      var startBridge = incoming === "horizontal"
        ? { x: startEscape.x, y: target.y }
        : { x: target.x, y: startEscape.y };
      prefix = [start, startEscape, startBridge];
    } else if (incoming === "horizontal") {
      prefix[prefix.length - 1].y = target.y;
    } else {
      prefix[prefix.length - 1].x = target.x;
    }

    if (suffix.length === 1) {
      var end = suffix[0];
      var endEscape = endpointEscapePoint(end, route[pointIndex]);
      var endBridge = outgoing === "horizontal"
        ? { x: endEscape.x, y: target.y }
        : { x: target.x, y: endEscape.y };
      suffix = [endBridge, endEscape, end];
    } else if (outgoing === "horizontal") {
      suffix[0].y = target.y;
    } else {
      suffix[0].x = target.x;
    }

    return cleanOrthogonalRoute(prefix.concat([target], suffix));
  }

  function insertWireBend(wire, segmentIndex, targetPoint) {
    if (!wire || !Number.isInteger(segmentIndex)) return false;
    var route = cloneRoute(ensureWireRoute(wire));
    if (segmentIndex < 0 || segmentIndex >= route.length - 1) return false;
    var first = route[segmentIndex];
    var second = route[segmentIndex + 1];
    var orientation = segmentOrientation(first, second);
    if (!orientation) return false;
    var point = clampRoutePoint(targetPoint || first);
    var inset = GRID_SIZE;
    var offset = GRID_SIZE * 2;
    var inserted;

    if (orientation === "horizontal") {
      var minimumX = Math.min(first.x, second.x);
      var maximumX = Math.max(first.x, second.x);
      if (maximumX - minimumX < GRID_SIZE * 4) return false;
      var centerX = clampNumber(snapToGrid(point.x), minimumX + inset, maximumX - inset);
      var firstX = clampNumber(centerX - inset, minimumX + inset, maximumX - inset);
      var secondX = clampNumber(centerX + inset, minimumX + inset, maximumX - inset);
      if (secondX <= firstX) return false;
      var bendY = snapToGrid(first.y + (first.y + offset <= WORLD_HEIGHT ? offset : -offset));
      if (bendY === first.y || bendY < 0 || bendY > WORLD_HEIGHT) return false;
      var entryX = first.x <= second.x ? firstX : secondX;
      var exitX = first.x <= second.x ? secondX : firstX;
      inserted = [{ x: entryX, y: first.y }, { x: entryX, y: bendY }, { x: exitX, y: bendY }, { x: exitX, y: first.y }];
    } else {
      var minimumY = Math.min(first.y, second.y);
      var maximumY = Math.max(first.y, second.y);
      if (maximumY - minimumY < GRID_SIZE * 4) return false;
      var centerY = clampNumber(snapToGrid(point.y), minimumY + inset, maximumY - inset);
      var firstY = clampNumber(centerY - inset, minimumY + inset, maximumY - inset);
      var secondY = clampNumber(centerY + inset, minimumY + inset, maximumY - inset);
      if (secondY <= firstY) return false;
      var bendX = snapToGrid(first.x + (first.x + offset <= WORLD_WIDTH ? offset : -offset));
      if (bendX === first.x || bendX < 0 || bendX > WORLD_WIDTH) return false;
      var entryY = first.y <= second.y ? firstY : secondY;
      var exitY = first.y <= second.y ? secondY : firstY;
      inserted = [{ x: first.x, y: entryY }, { x: bendX, y: entryY }, { x: bendX, y: exitY }, { x: first.x, y: exitY }];
    }
    wire.route = cleanOrthogonalRoute(route.slice(0, segmentIndex + 1).concat(inserted, route.slice(segmentIndex + 1)));
    return routeIsOrthogonal(wire.route) ? cloneRoute(wire.route) : false;
  }

  function removeWireBend(wire, pointIndex) {
    if (!wire || !Number.isInteger(pointIndex)) return false;
    var route = cloneRoute(ensureWireRoute(wire));
    if (!routeHasBendAt(route, pointIndex)) return false;
    var previous = route[pointIndex - 1];
    var current = route[pointIndex];
    var next = route[pointIndex + 1];
    var alternate = { x: previous.x, y: next.y };
    if (samePoint(alternate, current) || samePoint(alternate, previous) || samePoint(alternate, next)) alternate = { x: next.x, y: previous.y };
    var replacement = samePoint(alternate, previous) || samePoint(alternate, next) ? [] : [alternate];
    var candidate = cleanOrthogonalRoute(route.slice(0, pointIndex).concat(replacement, route.slice(pointIndex + 1)));
    if (!routeIsOrthogonal(candidate)) return false;
    wire.route = candidate;
    ensureWireRoute(wire);
    return cloneRoute(wire.route);
  }

  function routeHasBendAt(route, pointIndex) {
    if (!route || pointIndex <= 0 || pointIndex >= route.length - 1) return false;
    var incoming = segmentOrientation(route[pointIndex - 1], route[pointIndex]);
    var outgoing = segmentOrientation(route[pointIndex], route[pointIndex + 1]);
    return Boolean(incoming && outgoing && incoming !== outgoing);
  }

  function isWireHigh(wire, netlist) {
    var net = netForEndpoint(netlist || compileNetlist(), wire.from);
    return Boolean(net && !net.conflict && net.level === 1);
  }

  function createSvgPath(className, pathData) {
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", className);
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "none");
    return path;
  }

  function updateConnectedPins() {
    schematicState.componentElements.forEach(function (element) {
      element.querySelectorAll(".component-pin.connected").forEach(function (pin) { pin.classList.remove("connected"); });
    });
    schematicState.wires.forEach(function (wire) {
      [wire.from, wire.to].forEach(function (endpoint) {
        var component = schematicState.componentElements.get(endpoint.componentId);
        if (!component) return;
        var pin = component.querySelector('.component-pin[data-pin="' + endpoint.pin + '"]');
        if (pin) pin.classList.add("connected");
      });
    });
  }

  function pwmForNet(netlist, startNet) {
    if (!netlist || !startNet) return null;
    var adjacency = new Map();
    function connect(left, right) {
      if (!left || !right || left === right) return;
      if (!adjacency.has(left)) adjacency.set(left, []);
      if (!adjacency.has(right)) adjacency.set(right, []);
      adjacency.get(left).push(right);
      adjacency.get(right).push(left);
    }
    schematicState.components.forEach(function (component) {
      if (component.type !== "resistor" && component.type !== "currentProbe") return;
      var leftPin = component.type === "resistor" ? "1" : "IN";
      var rightPin = component.type === "resistor" ? "2" : "OUT";
      connect(
        netlist.endpointToNet[endpointKey({ componentId: component.id, pin: leftPin })],
        netlist.endpointToNet[endpointKey({ componentId: component.id, pin: rightPin })]
      );
    });
    var queue = [startNet.id];
    var visited = new Set();
    var matches = [];
    while (queue.length) {
      var netId = queue.shift();
      if (visited.has(netId)) continue;
      visited.add(netId);
      var net = netlist.netById.get(netId);
      if (net) {
        net.endpoints.forEach(function (endpoint) {
          var component = schematicState.components.get(endpoint.componentId);
          if (!component || component.type !== "mcu") return;
          var physical = resolveMcuPinName(endpoint.pin);
          var pwm = schematicState.mcuPwm.get(physical);
          if (pwm) matches.push(pwm);
        });
      }
      (adjacency.get(netId) || []).forEach(function (next) { if (!visited.has(next)) queue.push(next); });
    }
    matches.sort(function (left, right) { return Number(right.timeMs || 0) - Number(left.timeMs || 0); });
    return matches[0] || null;
  }

  function ensurePwmBadge(element, pwm) {
    if (!element) return;
    var badge = element.querySelector(".component-pwm-badge");
    if (!pwm) {
      if (badge) badge.remove();
      element.classList.remove("pwm-driven");
      element.style.removeProperty("--pwm-duty");
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "component-pwm-badge";
      element.appendChild(badge);
    }
    var frequency = Number(pwm.frequencyHz) > 0 ? " · " + (Number(pwm.frequencyHz) >= 1000 ? (Number(pwm.frequencyHz) / 1000).toFixed(2) + " kHz" : Number(pwm.frequencyHz).toFixed(1) + " Hz") : "";
    badge.textContent = "PWM " + Number(pwm.dutyPercent || 0).toFixed(1) + "%" + frequency;
    badge.title = (pwm.instance || pwm.timer || "TIM") + " CH" + pwm.channel + " · compare " + pwm.compare + " / period " + pwm.period;
    element.classList.add("pwm-driven");
    element.style.setProperty("--pwm-duty", String(clampNumber(Number(pwm.dutyCycle) || 0, 0, 1)));
  }

  function componentPwm(component, netlist) {
    var definition = componentDefinitions[component.type];
    if (!definition || component.type === "mcu") return null;
    var ignored = /^(?:VCC|VDD|VIN|GND|VSS|VSSA|VDDA|VBAT|NRST)$/i;
    for (var index = 0; index < definition.pins.length; index += 1) {
      var pin = definition.pins[index];
      if (ignored.test(pin.name)) continue;
      var net = netForEndpoint(netlist, { componentId: component.id, pin: pin.name });
      var pwm = pwmForNet(netlist, net);
      if (pwm) return pwm;
    }
    return null;
  }

  function updatePwmVisuals(netlist) {
    var compiled = netlist || compileNetlist();
    schematicState.components.forEach(function (component) {
      if (["mcu", "vcc", "ground", "netTerminal", "resistor", "capacitor", "currentProbe", "voltageProbe", "led"].indexOf(component.type) >= 0) return;
      var element = schematicState.componentElements.get(component.id);
      var pwm = componentPwm(component, compiled);
      ensurePwmBadge(element, pwm);
      if (!pwm || !catalogDefinition(component.type)) return;
      var device = componentDevice(component);
      if (component.type === "sg90" && device && typeof device.setAngle === "function" && pwm.frequencyHz > 0) {
        var pulseMs = pwm.dutyCycle / pwm.frequencyHz * 1000;
        device.setAngle(clampNumber((pulseMs - 1) * 180, 0, 180));
        updateCatalogVisual(component, element);
      } else if (component.type === "buzzer" && device) {
        if (pwm.active && pwm.dutyCycle > 0 && typeof device.setTone === "function") device.setTone(pwm.frequencyHz, Math.round(pwm.dutyCycle * 1000));
        else if (typeof device.stop === "function") device.stop();
        updateCatalogVisual(component, element);
      }
    });
  }

  function updateLedStates(netlist) {
    var compiled = netlist || compileNetlist();
    schematicState.components.forEach(function (component) {
      if (component.type !== "led") return;
      var element = schematicState.componentElements.get(component.id);
      if (!element) return;
      var anode = netForEndpoint(compiled, { componentId: component.id, pin: "A" });
      var cathode = netForEndpoint(compiled, { componentId: component.id, pin: "K" });
      var electrical = ledElectricalState(anode, cathode, component);
      var anodePwm = pwmForNet(compiled, anode);
      var cathodePwm = pwmForNet(compiled, cathode);
      var pwm = anodePwm || cathodePwm;
      var effectiveDuty = pwm ? (anodePwm ? pwm.dutyCycle : 1 - pwm.dutyCycle) : (electrical.on ? 1 : 0);
      var isOn = pwm ? Boolean(pwm.active && effectiveDuty > 0.0001 && anode && cathode && !anode.conflict && !cathode.conflict) : electrical.on;
      element.classList.toggle("is-on", isOn);
      element.classList.toggle("on", isOn);
      element.dataset.electricalState = electrical.state;
      applyLedLensStyle(component, element, isOn, effectiveDuty);
      ensurePwmBadge(element, pwm);
      element.setAttribute("aria-label", componentDefinitions.led.title + " " + component.ref + "，数值 " + component.value + "，方向 " + component.rotation + " 度" + (pwm ? "，PWM 占空比 " + pwm.dutyPercent.toFixed(1) + "%" : (isOn ? "，已点亮" : "，熄灭")));
    });
  }

  function probeConnectionCount(componentId, pinName) {
    return schematicState.wires.reduce(function (count, wire) {
      return count + (sameEndpoint(wire.from, { componentId: componentId, pin: pinName }) || sameEndpoint(wire.to, { componentId: componentId, pin: pinName }) ? 1 : 0);
    }, 0);
  }

  function voltageProbeState(component, netlist) {
    var net = netForEndpoint(netlist, { componentId: component.id, pin: "TIP" });
    if (!probeConnectionCount(component.id, "TIP") || !net || net.floating) return { value: null, text: "— V", status: "探针悬空", code: "floating" };
    if (net.conflict || net.analogConflict) return { value: null, text: "— V", status: "网络冲突", code: "conflict" };
    var voltage = net.voltage;
    if (voltage == null && net.level != null) voltage = net.level ? 3.3 : 0;
    if (!Number.isFinite(voltage)) return { value: null, text: "— V", status: "无参考电压", code: "unknown" };
    return { value: voltage, text: voltage.toFixed(3) + " V", status: "相对 GND", code: "measured", netId: net.id };
  }

  function parseResistanceValue(value) {
    var text = String(value == null ? "" : value).trim().toUpperCase().replace(/OHMS?|Ω/g, "R").replace(/\s+/g, "");
    if (!text || /DNP|NC|OPEN/.test(text)) return null;
    var embedded = text.match(/^(\d+)([RKM])(\d+)$/);
    if (embedded) {
      var embeddedScale = embedded[2] === "M" ? 1000000 : (embedded[2] === "K" ? 1000 : 1);
      return Number(embedded[1] + "." + embedded[3]) * embeddedScale;
    }
    var match = text.match(/^(\d*\.?\d+)([RKM]?)/);
    if (!match) return null;
    var scale = match[2] === "M" ? 1000000 : (match[2] === "K" ? 1000 : 1);
    var resistance = Number(match[1]) * scale;
    return Number.isFinite(resistance) && resistance >= 0 ? resistance : null;
  }

  function solveLinearSystem(matrix, values) {
    var size = matrix.length;
    var augmented = matrix.map(function (row, index) { return row.slice().concat([values[index]]); });
    for (var column = 0; column < size; column += 1) {
      var pivot = column;
      for (var row = column + 1; row < size; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
      }
      if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
      if (pivot !== column) {
        var swap = augmented[pivot];
        augmented[pivot] = augmented[column];
        augmented[column] = swap;
      }
      var divisor = augmented[column][column];
      for (var item = column; item <= size; item += 1) augmented[column][item] /= divisor;
      for (var targetRow = 0; targetRow < size; targetRow += 1) {
        if (targetRow === column) continue;
        var factor = augmented[targetRow][column];
        if (Math.abs(factor) < 1e-15) continue;
        for (var targetColumn = column; targetColumn <= size; targetColumn += 1) {
          augmented[targetRow][targetColumn] -= factor * augmented[column][targetColumn];
        }
      }
    }
    return augmented.map(function (row) { return row[size]; });
  }

  function parsePowerRatingValue(value, fallback) {
    var text = String(value == null ? "" : value).replace(/,/g, "");
    var matches = Array.from(text.matchAll(/(\d*\.?\d+)\s*(mW|W)\b/gi));
    if (!matches.length) return fallback == null ? null : Number(fallback);
    var match = matches[matches.length - 1];
    var watts = Number(match[1]) * (String(match[2]).toLowerCase() === "mw" ? 0.001 : 1);
    return Number.isFinite(watts) && watts > 0 ? watts : (fallback == null ? null : Number(fallback));
  }

  function parseCurrentRatingValue(value, fallback) {
    var text = String(value == null ? "" : value).replace(/,/g, "");
    var matches = Array.from(text.matchAll(/(\d*\.?\d+)\s*(mA|A)\b/gi));
    if (!matches.length) return fallback == null ? null : Number(fallback);
    var match = matches[matches.length - 1];
    var amps = Number(match[1]) * (String(match[2]).toLowerCase() === "ma" ? 0.001 : 1);
    return Number.isFinite(amps) && amps > 0 ? amps : (fallback == null ? null : Number(fallback));
  }

  function powerUtilization(powerW, ratingW) {
    return ratingW > 0 ? Math.max(0, powerW) / ratingW * 100 : null;
  }

  function solvePowerSystem(netlist) {
    var compiled = netlist || { nets: [], endpointToNet: Object.create(null), netById: new Map() };
    var knownVoltages = new Map();
    (compiled.nets || []).forEach(function (net) {
      if (!net.conflict && !net.analogConflict && Number.isFinite(net.voltage)) knownVoltages.set(net.id, Number(net.voltage));
    });

    var resistors = [];
    schematicState.components.forEach(function (component) {
      component.powerState = null;
      if (component.type !== "resistor") return;
      var resistance = parseResistanceValue(component.value);
      var left = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "1" })];
      var right = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "2" })];
      if (!left || !right || left === right || resistance == null || resistance <= 1e-9) return;
      resistors.push({ component: component, left: left, right: right, resistance: resistance });
    });

    var fixedVoltages = new Map(knownVoltages);
    var ledBranches = [];
    schematicState.components.forEach(function (component) {
      if (component.type !== "led") return;
      var anode = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "A" })];
      var cathode = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "K" })];
      if (!anode || !cathode || anode === cathode) return;
      ledBranches.push({
        component: component,
        anode: anode,
        cathode: cathode,
        forwardVoltage: ledForwardVoltage(component),
        dynamicResistance: 5
      });
    });

    var activeResistors = [];
    function solveNetwork(activeLeds) {
      var adjacency = new Map();
      function connect(left, right) {
        if (!adjacency.has(left)) adjacency.set(left, []);
        if (!adjacency.has(right)) adjacency.set(right, []);
        adjacency.get(left).push(right);
        adjacency.get(right).push(left);
      }
      resistors.forEach(function (resistor) { connect(resistor.left, resistor.right); });
      activeLeds.forEach(function (led) { connect(led.anode, led.cathode); });
      var activeNodes = new Set(fixedVoltages.keys());
      var pending = Array.from(activeNodes);
      while (pending.length) {
        var node = pending.shift();
        (adjacency.get(node) || []).forEach(function (neighbor) {
          if (activeNodes.has(neighbor)) return;
          activeNodes.add(neighbor);
          pending.push(neighbor);
        });
      }
      activeResistors = resistors.filter(function (resistor) { return activeNodes.has(resistor.left) && activeNodes.has(resistor.right); });
      var unknownNodes = Array.from(activeNodes).filter(function (node) { return !fixedVoltages.has(node); });
      var solved = new Map(fixedVoltages);
      if (!unknownNodes.length) return solved;
      var nodeIndexes = new Map(unknownNodes.map(function (node, index) { return [node, index]; }));
      var matrix = Array.from({ length: unknownNodes.length }, function () { return Array(unknownNodes.length).fill(0); });
      var values = Array(unknownNodes.length).fill(0);
      function stamp(node, other, conductance, offset) {
        if (!nodeIndexes.has(node)) return;
        var row = nodeIndexes.get(node);
        matrix[row][row] += conductance;
        if (nodeIndexes.has(other)) matrix[row][nodeIndexes.get(other)] -= conductance;
        else if (fixedVoltages.has(other)) values[row] += conductance * fixedVoltages.get(other);
        values[row] += Number(offset) || 0;
      }
      activeResistors.forEach(function (resistor) {
        var conductance = 1 / resistor.resistance;
        stamp(resistor.left, resistor.right, conductance, 0);
        stamp(resistor.right, resistor.left, conductance, 0);
      });
      activeLeds.forEach(function (led) {
        var conductance = 1 / led.dynamicResistance;
        stamp(led.anode, led.cathode, conductance, conductance * led.forwardVoltage);
        stamp(led.cathode, led.anode, conductance, -conductance * led.forwardVoltage);
      });
      var solution = solveLinearSystem(matrix, values);
      if (solution) unknownNodes.forEach(function (node, index) {
        if (Number.isFinite(solution[index])) solved.set(node, solution[index]);
      });
      return solved;
    }

    knownVoltages = solveNetwork([]);
    var activeLeds = schematicState.powerCalculationEnabled ? ledBranches.filter(function (led) {
      return knownVoltages.has(led.anode) && knownVoltages.has(led.cathode) &&
        knownVoltages.get(led.anode) - knownVoltages.get(led.cathode) > led.forwardVoltage + 0.01;
    }) : [];
    if (activeLeds.length) knownVoltages = solveNetwork(activeLeds);

    knownVoltages.forEach(function (voltage, netId) {
      var net = compiled.netById.get(netId);
      if (!net || net.analogConflict || net.conflict) return;
      net.voltage = voltage;
      net.floating = false;
    });

    if (!schematicState.powerCalculationEnabled) {
      return {
        ok: true,
        enabled: false,
        mode: "voltage-only",
        engine: "AliceSIM voltage-only network",
        generatedAtTick: schematicState.tick,
        components: [],
        alerts: [],
        overloadCount: 0,
        totalResistorPowerW: 0,
        totalSourcePowerW: 0
      };
    }

    var netLoadCurrent = new Map();
    function addNetLoad(netId, currentA) {
      if (!netId || !Number.isFinite(currentA)) return;
      netLoadCurrent.set(netId, (netLoadCurrent.get(netId) || 0) + currentA);
    }
    var componentRecords = [];
    activeResistors.forEach(function (resistor) {
      if (!knownVoltages.has(resistor.left) || !knownVoltages.has(resistor.right)) return;
      var leftVoltage = knownVoltages.get(resistor.left);
      var rightVoltage = knownVoltages.get(resistor.right);
      var current = (leftVoltage - rightVoltage) / resistor.resistance;
      var voltageDrop = leftVoltage - rightVoltage;
      var power = current * current * resistor.resistance;
      var rating = parsePowerRatingValue(resistor.component.value, 0.25);
      var overload = power > rating * 1.000001;
      var state = {
        componentId: resistor.component.id,
        ref: resistor.component.ref,
        type: "resistor",
        voltageV: voltageDrop,
        currentA: current,
        powerW: power,
        ratingW: rating,
        overload: overload,
        utilizationPercent: powerUtilization(power, rating),
        reason: overload ? "电阻耗散功率超过额定值" : "额定范围内"
      };
      resistor.component.powerState = state;
      componentRecords.push(state);
      addNetLoad(resistor.left, current);
      addNetLoad(resistor.right, -current);
    });

    ledBranches.forEach(function (led) {
      var anodeVoltage = knownVoltages.get(led.anode);
      var cathodeVoltage = knownVoltages.get(led.cathode);
      var voltageDrop = Number.isFinite(anodeVoltage) && Number.isFinite(cathodeVoltage) ? anodeVoltage - cathodeVoltage : 0;
      var active = activeLeds.indexOf(led) >= 0 && voltageDrop > led.forwardVoltage;
      var current = active ? Math.max(0, (voltageDrop - led.forwardVoltage) / led.dynamicResistance) : 0;
      var currentRating = parseCurrentRatingValue(led.component.value, 0.02);
      var rating = parsePowerRatingValue(led.component.value, led.forwardVoltage * currentRating);
      var power = Math.max(0, voltageDrop * current);
      var overload = current > currentRating * 1.000001 || power > rating * 1.000001;
      var state = {
        componentId: led.component.id,
        ref: led.component.ref,
        type: "led",
        voltageV: voltageDrop,
        forwardVoltageV: led.forwardVoltage,
        currentA: current,
        powerW: power,
        ratingW: rating,
        currentRatingA: currentRating,
        overload: overload,
        utilizationPercent: Math.max(powerUtilization(power, rating) || 0, currentRating > 0 ? current / currentRating * 100 : 0),
        reason: !active ? "LED 未达到正向导通电压" : (overload ? "LED 电流或功率超过额定值" : "LED 正向导通")
      };
      led.component.powerState = state;
      componentRecords.push(state);
      addNetLoad(led.anode, current);
      addNetLoad(led.cathode, -current);
    });

    var converterInputLoads = new Map();
    schematicState.components.forEach(function (component) {
      if (component.type !== "dcDcConverter") return;
      var properties = component.peripheralProperties || {};
      var inputNet = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "VIN" })];
      var groundNet = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "GND" })];
      var outputNet = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "VOUT" })];
      var inputVoltage = knownVoltages.has(inputNet) ? knownVoltages.get(inputNet) - (knownVoltages.get(groundNet) || 0) : 0;
      var outputVoltage = knownVoltages.has(outputNet) ? knownVoltages.get(outputNet) - (knownVoltages.get(groundNet) || 0) : 0;
      var enabled = Boolean(component.converterEnabled && outputVoltage > 0);
      var outputCurrent = enabled ? Math.max(0, netLoadCurrent.get(outputNet) || 0) : 0;
      var outputPower = Math.max(0, outputVoltage * outputCurrent);
      var maxCurrent = clampNumber(Number(properties.maxOutputCurrentA) || 2, 0.05, 10);
      var efficiency = clampNumber(Number(properties.efficiencyPercent) || 90, 50, 99) / 100;
      var quiescentCurrent = enabled ? clampNumber(Number(properties.quiescentCurrentMa) || 0, 0, 100) / 1000 : 0;
      var inputPower = enabled && inputVoltage > 0 ? outputPower / efficiency + inputVoltage * quiescentCurrent : 0;
      var inputCurrent = inputVoltage > 0 ? inputPower / inputVoltage : 0;
      var rating = Math.max(0.001, Math.abs(outputVoltage) * maxCurrent);
      var overload = enabled && outputCurrent > maxCurrent * 1.000001;
      var state = {
        componentId: component.id,
        ref: component.ref,
        type: "dcDcConverter",
        enabled: enabled,
        inputVoltageV: inputVoltage,
        outputVoltageV: outputVoltage,
        inputCurrentA: inputCurrent,
        outputCurrentA: outputCurrent,
        inputPowerW: inputPower,
        outputPowerW: outputPower,
        efficiencyPercent: efficiency * 100,
        voltageV: outputVoltage,
        currentA: outputCurrent,
        powerW: outputPower,
        ratingW: rating,
        currentRatingA: maxCurrent,
        overload: overload,
        utilizationPercent: maxCurrent > 0 ? outputCurrent / maxCurrent * 100 : null,
        reason: !enabled ? "未使能或输入未供电" : (overload ? "转换器输出电流超过额定值" : "输出正常")
      };
      component.powerState = state;
      componentRecords.push(state);
      if (inputNet && inputCurrent > 0) converterInputLoads.set(inputNet, (converterInputLoads.get(inputNet) || 0) + inputCurrent);
    });

    schematicState.components.forEach(function (component) {
      if (component.type !== "mcu") return;
      var pinCurrents = [];
      componentDefinitions.mcu.pins.forEach(function (pin) {
        var physical = normalizeMcuPinName(pin.name);
        if (!physical || !schematicState.mcuDrives.has(physical)) return;
        var netId = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: physical })];
        if (!netId) return;
        var signedLoad = Number(netLoadCurrent.get(netId) || 0);
        var drive = schematicState.mcuDrives.get(physical);
        var current = drive ? Math.max(0, signedLoad) : Math.max(0, -signedLoad);
        pinCurrents.push({ pin: physical, currentA: current, drive: drive });
      });
      if (!pinCurrents.length) return;
      var totalCurrent = pinCurrents.reduce(function (sum, pin) { return sum + pin.currentA; }, 0);
      var maximumPinCurrent = pinCurrents.reduce(function (maximum, pin) { return Math.max(maximum, pin.currentA); }, 0);
      var totalCurrentRating = Math.min(0.12, Math.max(0.02, pinCurrents.length * 0.02));
      var power = 3.3 * totalCurrent;
      var rating = 3.3 * totalCurrentRating;
      var overload = maximumPinCurrent > 0.0200001 || totalCurrent > totalCurrentRating * 1.000001;
      var state = {
        componentId: component.id,
        ref: component.ref,
        type: "mcu",
        voltageV: 3.3,
        currentA: totalCurrent,
        powerW: power,
        ratingW: rating,
        currentRatingA: totalCurrentRating,
        maximumPinCurrentA: maximumPinCurrent,
        pins: pinCurrents,
        overload: overload,
        utilizationPercent: totalCurrentRating > 0 ? totalCurrent / totalCurrentRating * 100 : 0,
        reason: overload ? "GPIO 单脚 20 mA 或 MCU GPIO 总电流超限" : "GPIO 输出负载正常"
      };
      component.powerState = state;
      componentRecords.push(state);
    });

    var sourceCountByNet = new Map();
    schematicState.components.forEach(function (component) {
      if (component.type !== "vcc") return;
      var netId = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "VCC" })];
      if (netId) sourceCountByNet.set(netId, (sourceCountByNet.get(netId) || 0) + 1);
    });
    schematicState.components.forEach(function (component) {
      if (component.type !== "vcc") return;
      var netId = compiled.endpointToNet[endpointKey({ componentId: component.id, pin: "VCC" })];
      var voltage = knownVoltages.get(netId);
      if (!Number.isFinite(voltage)) voltage = parseVoltageValue(component.value, 3.3);
      var totalCurrent = Math.max(0, (netLoadCurrent.get(netId) || 0) + (converterInputLoads.get(netId) || 0));
      var current = totalCurrent / Math.max(1, sourceCountByNet.get(netId) || 1);
      var power = Math.abs(voltage) * current;
      var currentRating = parseCurrentRatingValue(component.value, 1);
      var rating = parsePowerRatingValue(component.value, Math.abs(voltage) * currentRating);
      var overload = current > currentRating * 1.000001 || power > rating * 1.000001;
      var state = {
        componentId: component.id,
        ref: component.ref,
        type: "vcc",
        voltageV: voltage,
        currentA: current,
        powerW: power,
        ratingW: rating,
        currentRatingA: currentRating,
        overload: overload,
        utilizationPercent: Math.max(powerUtilization(power, rating) || 0, currentRating > 0 ? current / currentRating * 100 : 0),
        reason: overload ? "电源输出功率或电流超过额定值" : "输出正常"
      };
      component.powerState = state;
      componentRecords.push(state);
    });

    var alerts = componentRecords.filter(function (record) { return record.overload; });
    return {
      ok: true,
      enabled: true,
      mode: "power",
      engine: "AliceSIM resistive DC power",
      generatedAtTick: schematicState.tick,
      components: componentRecords,
      alerts: alerts,
      overloadCount: alerts.length,
      totalResistorPowerW: componentRecords.filter(function (record) { return record.type === "resistor"; }).reduce(function (sum, record) { return sum + record.powerW; }, 0),
      totalSourcePowerW: componentRecords.filter(function (record) { return record.type === "vcc" || record.type === "mcu"; }).reduce(function (sum, record) { return sum + record.powerW; }, 0)
    };
  }

  function formatPower(powerW) {
    var value = Math.abs(Number(powerW) || 0);
    if (value >= 1) return value.toFixed(2) + " W";
    if (value >= 0.001) return (value * 1000).toFixed(value >= 0.1 ? 1 : 2) + " mW";
    return (value * 1000000).toFixed(1) + " µW";
  }

  function updatePowerVisuals(report) {
    var powerReport = report || { components: [], alerts: [] };
    var byId = new Map((powerReport.components || []).map(function (record) { return [record.componentId, record]; }));
    schematicState.componentElements.forEach(function (element, componentId) {
      var record = byId.get(componentId);
      element.classList.toggle("power-monitored", Boolean(record));
      element.classList.toggle("power-overload", Boolean(record && record.overload));
      var badge = element.querySelector(".component-power-badge");
      if (!record) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "component-power-badge";
        element.appendChild(badge);
      }
      badge.textContent = formatPower(record.powerW) + " / " + formatPower(record.ratingW);
      badge.title = record.ref + " · " + record.reason + " · " + (Number(record.utilizationPercent) || 0).toFixed(1) + "%";
      var component = schematicState.components.get(componentId);
      if (component && component.type === "dcDcConverter") updateCatalogVisual(component, element);
    });
    var alertNode = document.getElementById("powerAlert");
    if (!alertNode && schematicNodes.viewport) {
      alertNode = document.createElement("div");
      alertNode.id = "powerAlert";
      alertNode.className = "power-alert";
      alertNode.hidden = true;
      schematicNodes.viewport.appendChild(alertNode);
    }
    var alerts = powerReport.alerts || [];
    if (alertNode) {
      alertNode.hidden = !alerts.length;
      alertNode.textContent = alerts.length ? "⚠ 功率超限 · " + alerts.map(function (record) {
        return record.ref + " " + formatPower(record.powerW) + " / " + formatPower(record.ratingW) + "（" + Math.round(record.utilizationPercent || 0) + "%）";
      }).join(" · ") : "";
    }
    var fingerprint = alerts.map(function (record) { return record.componentId + ":" + record.powerW.toFixed(6); }).join("|");
    if (fingerprint !== schematicState.powerAlertFingerprint) {
      schematicState.powerAlertFingerprint = fingerprint;
      if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("alice:power-alert", { detail: { report: powerReport, alerts: alerts } }));
      }
    }
  }

  function solveCurrentProbeDc(component, netlist) {
    var parents = new Map();
    function ensure(key) {
      if (!parents.has(key)) parents.set(key, key);
      return key;
    }
    function find(key) {
      ensure(key);
      var parent = parents.get(key);
      if (parent !== key) {
        parent = find(parent);
        parents.set(key, parent);
      }
      return parent;
    }
    function union(left, right) {
      var leftRoot = find(left);
      var rightRoot = find(right);
      if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
    }

    schematicState.components.forEach(function (candidate) {
      var definition = componentDefinitions[candidate.type];
      if (!definition) return;
      definition.pins.forEach(function (pin) { ensure(endpointKey({ componentId: candidate.id, pin: pin.name })); });
    });
    schematicState.wires.forEach(function (wire) { union(endpointKey(wire.from), endpointKey(wire.to)); });

    var terminals = new Map();
    schematicState.components.forEach(function (candidate) {
      if (candidate.type === "netTerminal") {
        var label = normalizeSignalName(candidate.value);
        var terminalKey = endpointKey({ componentId: candidate.id, pin: "NET" });
        if (label && terminals.has(label)) union(terminals.get(label), terminalKey);
        else if (label) terminals.set(label, terminalKey);
      } else if (candidate.type === "currentProbe" && candidate.id !== component.id) {
        union(endpointKey({ componentId: candidate.id, pin: "IN" }), endpointKey({ componentId: candidate.id, pin: "OUT" }));
      } else if (candidate.type === "resistor") {
        var shortResistance = parseResistanceValue(candidate.value);
        if (shortResistance != null && shortResistance <= 1e-9) {
          union(endpointKey({ componentId: candidate.id, pin: "1" }), endpointKey({ componentId: candidate.id, pin: "2" }));
        }
      }
    });

    var inputRoot = find(endpointKey({ componentId: component.id, pin: "IN" }));
    var outputRoot = find(endpointKey({ componentId: component.id, pin: "OUT" }));
    if (inputRoot === outputRoot) return null;

    var knownVoltages = new Map();
    var voltageConflict = false;
    (netlist.nets || []).forEach(function (net) {
      (net.analogDrivers || []).forEach(function (driver) {
        if (!Number.isFinite(driver.voltage)) return;
        var root = find(endpointKey(driver));
        var voltage = Number(driver.voltage);
        if (knownVoltages.has(root) && Math.abs(knownVoltages.get(root) - voltage) > 0.05) voltageConflict = true;
        else knownVoltages.set(root, voltage);
      });
    });
    if (voltageConflict) return null;

    var resistors = [];
    schematicState.components.forEach(function (candidate) {
      if (candidate.type !== "resistor") return;
      var resistance = parseResistanceValue(candidate.value);
      if (resistance == null || resistance <= 1e-9) return;
      var left = find(endpointKey({ componentId: candidate.id, pin: "1" }));
      var right = find(endpointKey({ componentId: candidate.id, pin: "2" }));
      if (left === right) return;
      resistors.push({ left: left, right: right, resistance: resistance });
    });
    if (!resistors.length || !knownVoltages.size) return null;

    var resistorAdjacency = new Map();
    resistors.forEach(function (resistor) {
      if (!resistorAdjacency.has(resistor.left)) resistorAdjacency.set(resistor.left, []);
      if (!resistorAdjacency.has(resistor.right)) resistorAdjacency.set(resistor.right, []);
      resistorAdjacency.get(resistor.left).push(resistor.right);
      resistorAdjacency.get(resistor.right).push(resistor.left);
    });
    var activeNodes = new Set([inputRoot, outputRoot]);
    var pendingNodes = [inputRoot, outputRoot];
    while (pendingNodes.length) {
      var activeNode = pendingNodes.shift();
      (resistorAdjacency.get(activeNode) || []).forEach(function (neighbor) {
        if (activeNodes.has(neighbor)) return;
        activeNodes.add(neighbor);
        pendingNodes.push(neighbor);
      });
    }
    resistors = resistors.filter(function (resistor) { return activeNodes.has(resistor.left) && activeNodes.has(resistor.right); });
    if (!resistors.length) return null;

    var unknownNodes = Array.from(activeNodes).filter(function (node) { return !knownVoltages.has(node); });
    var nodeIndexes = new Map(unknownNodes.map(function (node, index) { return [node, index]; }));
    var currentIndex = unknownNodes.length;
    var size = currentIndex + 1;
    var matrix = Array.from({ length: size }, function () { return Array(size).fill(0); });
    var values = Array(size).fill(0);

    function stampConductance(node, other, conductance) {
      if (!nodeIndexes.has(node)) return;
      var row = nodeIndexes.get(node);
      matrix[row][row] += conductance;
      if (nodeIndexes.has(other)) matrix[row][nodeIndexes.get(other)] -= conductance;
      else if (knownVoltages.has(other)) values[row] += conductance * knownVoltages.get(other);
    }
    resistors.forEach(function (resistor) {
      var conductance = 1 / resistor.resistance;
      stampConductance(resistor.left, resistor.right, conductance);
      stampConductance(resistor.right, resistor.left, conductance);
    });

    if (nodeIndexes.has(inputRoot)) matrix[nodeIndexes.get(inputRoot)][currentIndex] += 1;
    if (nodeIndexes.has(outputRoot)) matrix[nodeIndexes.get(outputRoot)][currentIndex] -= 1;
    if (nodeIndexes.has(inputRoot)) matrix[currentIndex][nodeIndexes.get(inputRoot)] += 1;
    else values[currentIndex] -= knownVoltages.get(inputRoot) || 0;
    if (nodeIndexes.has(outputRoot)) matrix[currentIndex][nodeIndexes.get(outputRoot)] -= 1;
    else values[currentIndex] += knownVoltages.get(outputRoot) || 0;

    var solution = solveLinearSystem(matrix, values);
    if (!solution || !Number.isFinite(solution[currentIndex])) return null;
    var current = solution[currentIndex];
    var magnitude = Math.abs(current);
    var text = magnitude >= 1 ? current.toFixed(3) + " A" : (magnitude >= 0.001 ? (current * 1000).toFixed(2) + " mA" : (current * 1000000).toFixed(1) + " µA");
    return { value: current, text: text, status: "直流支路实算", code: "measured", method: "resistive-mna" };
  }

  function currentProbeState(component, netlist) {
    if (!schematicState.powerCalculationEnabled) return { value: null, text: "— A", status: "仅电压模式", code: "disabled" };
    var inputConnected = probeConnectionCount(component.id, "IN") > 0;
    var outputConnected = probeConnectionCount(component.id, "OUT") > 0;
    var net = netForEndpoint(netlist, { componentId: component.id, pin: "IN" });
    if (!inputConnected || !outputConnected) return { value: 0, text: "0.000 A", status: "支路开路", code: "open" };
    var measurement = solveCurrentProbeDc(component, netlist);
    if (measurement) return measurement;
    if (!net || net.floating) return { value: null, text: "— A", status: "支路悬空", code: "floating" };
    if (net.conflict || net.analogConflict) return { value: null, text: "— A", status: "网络冲突", code: "conflict" };
    return { value: null, text: "— A", status: "超出直流电阻模型", code: "unsupported", netId: net.id };
  }

  function measurementProbeState(component, netlist) {
    if (!component) return null;
    var compiled = netlist || compileNetlist();
    if (component.type === "voltageProbe") return voltageProbeState(component, compiled);
    if (component.type === "currentProbe") return currentProbeState(component, compiled);
    return null;
  }

  function spiceCircuitFingerprint(circuit) {
    return JSON.stringify({
      components: (circuit.components || []).map(function (component) {
        return {
          id: component.id,
          type: component.type,
          value: component.value,
          peripheralProperties: component.peripheralProperties || null
        };
      }),
      wires: (circuit.wires || []).map(function (wire) { return [wire.from.componentId, wire.from.pin, wire.to.componentId, wire.to.pin]; })
    });
  }

  function requestSpiceProbeValidation(force) {
    if (typeof window.fetch !== "function") return Promise.resolve(null);
    var hasProbe = Array.from(schematicState.components.values()).some(function (component) {
      return component.type === "voltageProbe" || (schematicState.powerCalculationEnabled && component.type === "currentProbe");
    });
    if (!hasProbe) return Promise.resolve(null);
    var circuit = exportCircuit();
    var fingerprint = spiceCircuitFingerprint(circuit);
    if (!force && fingerprint === spiceValidationState.requestedFingerprint) return Promise.resolve(null);
    spiceValidationState.requestedFingerprint = fingerprint;
    spiceValidationState.appliedFingerprint = "";
    spiceValidationState.results.clear();
    var requestId = ++spiceValidationState.requestId;
    return window.fetch("/api/spice-solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ circuit: circuit })
    }).then(function (response) {
      if (!response.ok) throw new Error("PySpice HTTP " + response.status);
      return response.json();
    }).then(function (payload) {
      if (requestId !== spiceValidationState.requestId || !payload || payload.ok !== true) return null;
      Object.keys(payload.voltageProbes || {}).forEach(function (componentId) {
        var reading = payload.voltageProbes[componentId];
        spiceValidationState.results.set(componentId, { value: Number(reading.value), text: reading.text, status: "PySpice · 直流工作点", code: "measured", engine: payload.engine });
      });
      Object.keys(schematicState.powerCalculationEnabled ? (payload.currentProbes || {}) : {}).forEach(function (componentId) {
        var reading = payload.currentProbes[componentId];
        spiceValidationState.results.set(componentId, { value: Number(reading.value), text: reading.text, status: "PySpice · 直流工作点", code: "measured", engine: payload.engine });
      });
      spiceValidationState.engine = payload.engine || "PySpice";
      spiceValidationState.appliedFingerprint = fingerprint;
      updateMeasurementProbeStates(compileNetlist());
      return payload;
    }).catch(function () {
      if (requestId === spiceValidationState.requestId) spiceValidationState.appliedFingerprint = "";
      return null;
    });
  }

  function scheduleSpiceProbeValidation() {
    if (typeof window.fetch !== "function") return;
    if (spiceValidationState.timer) return;
    spiceValidationState.timer = window.setTimeout(function () {
      spiceValidationState.timer = null;
      requestSpiceProbeValidation(false);
    }, 260);
  }

  function updateMeasurementProbeStates(netlist) {
    schematicState.components.forEach(function (component) {
      if (component.type !== "voltageProbe" && component.type !== "currentProbe") return;
      var state = measurementProbeState(component, netlist);
      if (!state) return;
      if ((component.type === "voltageProbe" || schematicState.powerCalculationEnabled) && spiceValidationState.appliedFingerprint === spiceValidationState.requestedFingerprint && spiceValidationState.results.has(component.id)) {
        state = spiceValidationState.results.get(component.id);
      }
      component.measurement = state.value;
      component.measurementStatus = state.code;
      component.value = state.text;
      var element = schematicState.componentElements.get(component.id);
      if (!element) return;
      element.dataset.measurementStatus = state.code;
      var readout = element.querySelector(".measurement-probe-readout");
      var status = element.querySelector(".measurement-probe-status");
      var captionValue = element.querySelector(".component-value");
      if (readout) readout.textContent = state.text;
      if (status) status.textContent = state.status;
      if (captionValue) captionValue.textContent = state.text;
      element.setAttribute("aria-label", componentDefinitions[component.type].title + " " + component.ref + "，读数 " + state.text + "，" + state.status);
    });
  }

  function renderWires() {
    if (!schematicNodes.wires) return;
    var netlist = compileNetlist();
    schematicNodes.wires.replaceChildren();
    schematicNodes.wires.setAttribute("viewBox", "0 0 " + WORLD_WIDTH + " " + WORLD_HEIGHT);
    schematicNodes.wires.setAttribute("width", String(WORLD_WIDTH));
    schematicNodes.wires.setAttribute("height", String(WORLD_HEIGHT));

    var wireInteraction = schematicState.interaction &&
      (schematicState.interaction.kind === "drag-wire-segment" || schematicState.interaction.kind === "drag-wire-bend")
      ? schematicState.interaction
      : null;
    schematicNodes.wires.classList.toggle("wire-editing", Boolean(wireInteraction));
    schematicNodes.wires.classList.toggle("dragging", Boolean(wireInteraction && wireInteraction.moved));
    if (wireInteraction && wireInteraction.orientation) schematicNodes.wires.dataset.orientation = wireInteraction.orientation;
    else delete schematicNodes.wires.dataset.orientation;

    schematicState.wires.forEach(function (wire) {
      var route = ensureWireRoute(wire);
      if (route.length < 2) return;
      var pathData = routeToPath(route);
      var wireNet = netForEndpoint(netlist, wire.from);
      var high = isWireHigh(wire, netlist);
      var selected = Boolean(schematicState.selection && schematicState.selection.kind === "wire" && schematicState.selection.id === wire.id);
      var editing = Boolean(wireInteraction && wireInteraction.wireId === wire.id);
      var visible = createSvgPath("schematic-wire wire", pathData);
      visible.dataset.wireId = wire.id;
      visible.dataset.signal = wire.signal || "";
      visible.dataset.net = wireNet ? wireNet.id : "";
      if (wireNet && wireNet.voltage != null) visible.dataset.voltage = wireNet.voltage.toFixed(3);
      visible.style.pointerEvents = "none";
      if (high) visible.classList.add("active", "signal-high", "high");
      if (wireNet && wireNet.voltage != null && wireNet.level == null) visible.classList.add("signal-analog", "analog");
      if (wireNet && (wireNet.conflict || wireNet.analogConflict)) visible.classList.add("signal-conflict", "conflict");
      if (wireNet && wireNet.floating) visible.classList.add("signal-floating", "floating");
      if (selected) visible.classList.add("selected");
      if (editing) visible.classList.add("wire-editing");
      if (editing && wireInteraction.moved) visible.classList.add("dragging");
      schematicNodes.wires.appendChild(visible);

      for (var segmentIndex = 0; segmentIndex < route.length - 1; segmentIndex += 1) {
        var orientation = segmentOrientation(route[segmentIndex], route[segmentIndex + 1]);
        if (!orientation) continue;
        var segmentPath = routeToPath([route[segmentIndex], route[segmentIndex + 1]]);
        var hit = createSvgPath("wire-hit wire-segment-hit", segmentPath);
        hit.dataset.wireId = wire.id;
        hit.dataset.segmentIndex = String(segmentIndex);
        hit.dataset.orientation = orientation;
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", "12");
        hit.setAttribute("vector-effect", "non-scaling-stroke");
        hit.setAttribute("tabindex", "0");
        hit.setAttribute("role", "button");
        hit.setAttribute("aria-label", (orientation === "horizontal" ? "水平" : "垂直") + "导线段，拖动以移动，双击增加拐点");
        hit.setAttribute("title", "拖动线段调整走线 · 双击增加拐点");
        hit.style.stroke = "transparent";
        hit.style.strokeWidth = "12px";
        hit.style.pointerEvents = "stroke";
        if (editing && wireInteraction.kind === "drag-wire-segment" && wireInteraction.segmentIndex === segmentIndex) hit.classList.add("dragging");
        schematicNodes.wires.appendChild(hit);
      }

      if (selected) {
        for (var pointIndex = 1; pointIndex < route.length - 1; pointIndex += 1) {
          if (!routeHasBendAt(route, pointIndex)) continue;
          var handleHit = document.createElementNS(SVG_NS, "rect");
          handleHit.setAttribute("class", "wire-bend-hit");
          handleHit.setAttribute("x", String(route[pointIndex].x - 4));
          handleHit.setAttribute("y", String(route[pointIndex].y - 4));
          handleHit.setAttribute("width", "8");
          handleHit.setAttribute("height", "8");
          handleHit.setAttribute("fill", "transparent");
          handleHit.setAttribute("stroke", "transparent");
          handleHit.setAttribute("stroke-width", "10");
          handleHit.setAttribute("vector-effect", "non-scaling-stroke");
          handleHit.setAttribute("aria-label", "导线拐点，拖动调整，双击删除");
          handleHit.setAttribute("title", "拖动拐点调整走线 · 双击删除拐点");
          handleHit.dataset.wireId = wire.id;
          handleHit.dataset.pointIndex = String(pointIndex);
          schematicNodes.wires.appendChild(handleHit);

          var handle = document.createElementNS(SVG_NS, "rect");
          handle.setAttribute("class", "wire-bend-handle");
          handle.setAttribute("x", String(route[pointIndex].x - 4));
          handle.setAttribute("y", String(route[pointIndex].y - 4));
          handle.setAttribute("width", "8");
          handle.setAttribute("height", "8");
          handle.setAttribute("tabindex", "0");
          handle.setAttribute("role", "button");
          handle.setAttribute("aria-label", "导线拐点，拖动调整，双击删除");
          handle.setAttribute("title", "拖动拐点调整走线 · 双击删除拐点");
          handle.dataset.wireId = wire.id;
          handle.dataset.pointIndex = String(pointIndex);
          if (editing && wireInteraction.kind === "drag-wire-bend" && wireInteraction.pointIndex === pointIndex) handle.classList.add("active", "dragging");
          schematicNodes.wires.appendChild(handle);
        }
      }
    });

    if (schematicState.wireStart && schematicState.previewPoint) {
      var previewStart = getPinPoint(schematicState.wireStart);
      if (previewStart) {
        var previewEnd = {
          x: schematicState.previewPoint.x,
          y: schematicState.previewPoint.y,
          side: Math.abs(schematicState.previewPoint.x - previewStart.x) > Math.abs(schematicState.previewPoint.y - previewStart.y)
            ? (schematicState.previewPoint.x >= previewStart.x ? "left" : "right")
            : (schematicState.previewPoint.y >= previewStart.y ? "top" : "bottom")
        };
        var preview = createSvgPath("schematic-wire wire wire-preview", orthogonalPath(previewStart, previewEnd));
        preview.style.pointerEvents = "none";
        schematicNodes.wires.appendChild(preview);
      }
    }

    updateConnectedPins();
    updateLedStates(netlist);
    updatePwmVisuals(netlist);
    updateMeasurementProbeStates(netlist);
    scheduleSpiceProbeValidation();
  }

  function seedInitialCircuit() {
    if (schematicState.components.size) return;
    var mcu = createComponentModel("mcu", 80, 95, { autoGenerated: true, autoSource: "system", autoKey: "mcu" });
    var power = createComponentModel("vcc", 133, 25, { autoGenerated: true, autoSource: "system", autoKey: "mcu-vdd" });
    var systemWireOptions = { autoGenerated: true, autoSource: "system", autoKey: "mcu-vdd" };

    createWire({ componentId: power.id, pin: "VCC" }, { componentId: mcu.id, pin: "VDD" }, "VCC", systemWireOptions);
  }

  function removeAutoGenerated(source) {
    var removedIds = new Set();
    var removedWireIds = new Set();
    schematicState.components.forEach(function (component) {
      if (!component.autoGenerated || (source && component.autoSource !== source)) return;
      removedIds.add(component.id);
      var element = schematicState.componentElements.get(component.id);
      if (element) element.remove();
      schematicState.componentElements.delete(component.id);
      schematicState.devices.delete(component.id);
      schematicState.components.delete(component.id);
    });
    schematicState.wires = schematicState.wires.filter(function (wire) {
      var remove = removedIds.has(wire.from.componentId) || removedIds.has(wire.to.componentId) ||
        (wire.autoGenerated && (!source || wire.autoSource === source));
      if (remove) removedWireIds.add(wire.id);
      return !remove;
    });
    if (schematicState.selection && (removedIds.has(schematicState.selection.id) || removedWireIds.has(schematicState.selection.id))) schematicState.selection = null;
    if (schematicState.wireStart && removedIds.has(schematicState.wireStart.componentId)) {
      schematicState.wireStart = null;
      schematicState.previewPoint = null;
    }
    if (schematicState.editingComponentId && removedIds.has(schematicState.editingComponentId)) closeComponentProperties(false);
    schematicState.compiledNetlist = null;
    return removedIds.size;
  }

  function isDefaultProjectModel(model, outputs) {
    if (model && (model.isDefault === true || model.defaultProject === true)) return true;
    if (model && (model.isDefault === false || model.defaultProject === false)) return false;
    var name = String(model && (model.projectName || model.name || model.project && model.project.name) || "");
    if (/BLUEPILL[_\s-]*BLINKY/i.test(name)) return true;
    return Boolean(!name && outputs.length === 1 && outputs[0].pin === "PC13" && /BUILTIN/i.test(outputs[0].label));
  }

  function createAutoOutputCircuit(output, index, total) {
    var mcuEndpoint = findMcuPinEndpoint(output.pin);
    if (!mcuEndpoint) return null;
    var usableTop = 38;
    var usableBottom = WORLD_HEIGHT - 48;
    var centerY = total <= 1
      ? Math.round((usableTop + usableBottom) / 2)
      : Math.round(usableTop + (usableBottom - usableTop) * index / Math.max(1, total - 1));
    centerY = snapToGrid(centerY);
    var resistor = createComponentModel("resistor", 342, centerY - 26, {
      value: "330 Ω",
      autoGenerated: true,
      autoSource: "firmware-output",
      autoKey: output.pin + ":resistor",
      codeLabel: output.label
    });
    var led = createComponentModel("led", 500, centerY - 32, {
      value: output.colorDescriptor.name + " LED",
      autoGenerated: true,
      autoSource: "firmware-output",
      autoKey: output.pin + ":led",
      codeLabel: output.label,
      ledColor: output.colorDescriptor.name
    });
    var ground = createComponentModel("ground", 650, Math.min(WORLD_HEIGHT - componentDefinitions.ground.height, centerY + 22), {
      autoGenerated: true,
      autoSource: "firmware-output",
      autoKey: output.pin + ":ground",
      codeLabel: output.label
    });
    var options = { autoGenerated: true, autoSource: "firmware-output", autoKey: output.pin };
    createWire(mcuEndpoint, { componentId: resistor.id, pin: "1" }, output.pin, options);
    createWire({ componentId: resistor.id, pin: "2" }, { componentId: led.id, pin: "A" }, output.pin, options);
    createWire({ componentId: led.id, pin: "K" }, { componentId: ground.id, pin: "GND" }, "GND", options);
    return { pin: output.pin, resistorId: resistor.id, ledId: led.id, groundId: ground.id };
  }

  function validateFirmware(model) {
    var input = model && typeof model === "object" ? model : {};
    var pins = normalizeProjectPins(input);
    var outputs = normalizeFirmwareOutputs(input, pins);
    var mergedPins = mergeOutputPins(pins, outputs);
    var mcu = String(input.mcu || input.device || input.part || componentDefinitions.mcu.value || "STM32F103C8T6").trim();
    var errors = [];
    var warnings = [];
    var issues = [];
    function addIssue(severity, code, message) {
      issues.push({ severity: severity, code: code, message: message });
      (severity === "error" ? errors : warnings).push(message);
    }
    if (mcu && !/^STM32F103C8/i.test(mcu.replace(/[^A-Z0-9]/gi, ""))) {
      addIssue("error", "UNSUPPORTED_MCU", "当前电路执行模型仅支持 STM32F103C8T6，收到 " + mcu);
    }
    var declaredPins = new Set(pins.map(function (pin) { return pin.name || pin.base; }));
    if (declaredPins.size) {
      outputs.forEach(function (output) {
        if (!declaredPins.has(output.pin)) addIssue("warning", "OUTPUT_NOT_IN_IOC", output.label + " 使用 " + output.pin + "，但该脚未出现在 IOC pins 中；已作为代码输出脚补入模块");
      });
    }
    if (!mergedPins.length) addIssue("warning", "NO_IO_PINS", "模型没有提供可显示的 IO 引脚");
    return {
      valid: errors.length === 0,
      mcu: mcu || "STM32F103C8T6",
      pins: mergedPins,
      outputs: outputs,
      errors: errors,
      warnings: warnings,
      issues: issues
    };
  }

  function applyProjectModel(model) {
    var report = validateFirmware(model);
    var defaultProject = isDefaultProjectModel(model || {}, report.outputs);
    cancelActiveInteraction(true);
    schematicState.wireStart = null;
    schematicState.previewPoint = null;
    schematicState.projectModel = model && typeof model === "object" ? model : {};
    schematicState.firmwareOutputs = report.outputs.slice();
    schematicState.mcuDrives.clear();
    schematicState.mcuPwm.clear();
    schematicState.signals.clear();
    schematicState.signals.set("VCC", true);
    schematicState.signals.set("GND", false);

    removeAutoGenerated("firmware-output");
    if (!defaultProject) removeAutoGenerated("demo-pc13");

    var configurationResult = setMcuConfiguration({
      mcu: report.mcu,
      configuredPins: report.pins
    });

    var generated = [];
    var keepBundledDemo = defaultProject && report.outputs.length === 1 && report.outputs[0].pin === "PC13";
    if (!keepBundledDemo) {
      removeAutoGenerated("demo-pc13");
      report.outputs.forEach(function (output, index) {
        var circuit = createAutoOutputCircuit(output, index, report.outputs.length);
        if (circuit) generated.push(circuit);
      });
    }

    report.outputs.forEach(function (output) {
      if (output.initialLevel == null) return;
      schematicState.mcuDrives.set(output.pin, output.initialLevel);
      schematicState.signals.set(output.pin, Boolean(output.initialLevel));
    });
    schematicState.compiledNetlist = null;
    if (schematicState.initialized) {
      updateComponentActionState();
      renderWires();
      setStatus("工程电路已同步 · " + report.pins.length + " 个 IO · " + report.outputs.length + " 个代码输出");
      if (!schematicState.userView) requestAnimationFrame(function () { fitToContent(false); });
    }
    return Object.assign(report, {
      applied: true,
      defaultProject: defaultProject,
      generated: generated,
      configuration: configurationResult
    });
  }

  function selectedComponentModel() {
    if (!schematicState.selection || schematicState.selection.kind !== "component") return null;
    return schematicState.components.get(schematicState.selection.id) || null;
  }

  function updateComponentActionState() {
    var hasComponent = Boolean(selectedComponentModel());
    if (schematicNodes.rotateButton) schematicNodes.rotateButton.disabled = !hasComponent;
    if (schematicNodes.propertiesButton) schematicNodes.propertiesButton.disabled = !hasComponent;
  }

  function emitSchematicChange(kind, component) {
    if (!schematicState.initialized || !component) return;
    document.dispatchEvent(new CustomEvent("alice:schematic-change", {
      detail: {
        kind: kind,
        componentId: component.id,
        rotation: component.rotation,
        value: component.value
      }
    }));
  }

  function pinSideEscapePoint(endpoint) {
    var rawEscape = pointWithStub(endpoint, WIRE_STUB);
    var horizontal = endpoint.side === "left" || endpoint.side === "right";
    var escape = horizontal
      ? clampRoutePoint({ x: snapToGrid(rawEscape.x), y: endpoint.y })
      : clampRoutePoint({ x: endpoint.x, y: snapToGrid(rawEscape.y) });
    if (samePoint(escape, endpoint)) {
      if (horizontal) escape.x = clampNumber(endpoint.x + (endpoint.side === "left" ? -GRID_SIZE : GRID_SIZE), 0, WORLD_WIDTH);
      else escape.y = clampNumber(endpoint.y + (endpoint.side === "top" ? -GRID_SIZE : GRID_SIZE), 0, WORLD_HEIGHT);
    }
    return escape;
  }

  function clearWireRotationConnections(wire) {
    if (wire) delete wire.rotationConnections;
  }

  function clearRotationConnectionsForComponent(componentId) {
    schematicState.wires.forEach(function (wire) {
      if (wire.from.componentId === componentId || wire.to.componentId === componentId) clearWireRotationConnections(wire);
    });
  }

  function prepareComponentRotationConnections(componentId) {
    var prepared = [];
    schematicState.wires.forEach(function (wire) {
      var atStart = wire.from.componentId === componentId;
      var atEnd = wire.to.componentId === componentId;
      if (!atStart && !atEnd) return;
      var endpoint = atStart ? wire.from : wire.to;
      var key = endpointKey(endpoint);
      if (!wire.rotationConnections) wire.rotationConnections = {};
      Object.keys(wire.rotationConnections).forEach(function (candidate) {
        if (candidate !== key) delete wire.rotationConnections[candidate];
      });
      var connection = wire.rotationConnections[key];
      if (!connection) {
        var route = cloneRoute(ensureWireRoute(wire));
        var anchorIndex;
        if (atStart) anchorIndex = route.length >= 4 ? 2 : Math.min(1, route.length - 1);
        else anchorIndex = route.length >= 4 ? route.length - 3 : Math.max(0, route.length - 2);
        connection = {
          atStart: atStart,
          fixedRoute: atStart ? cloneRoute(route.slice(anchorIndex)) : cloneRoute(route.slice(0, anchorIndex + 1))
        };
        wire.rotationConnections[key] = connection;
      }
      prepared.push({ wire: wire, endpoint: endpoint, connection: connection });
    });
    return prepared;
  }

  function rebuildRotationConnection(item) {
    var endpointPoint = getPinPoint(item.endpoint);
    var fixedRoute = cloneRoute(item.connection.fixedRoute);
    if (!endpointPoint || !fixedRoute.length) return;
    var escape = pinSideEscapePoint(endpointPoint);
    if (item.connection.atStart) {
      var startAnchor = fixedRoute[0];
      var startHorizontal = endpointPoint.side === "left" || endpointPoint.side === "right";
      var startBridge = startHorizontal
        ? { x: escape.x, y: startAnchor.y }
        : { x: startAnchor.x, y: escape.y };
      item.wire.route = cleanOrthogonalRoute([endpointPoint, escape, startBridge].concat(fixedRoute));
    } else {
      var endAnchor = fixedRoute[fixedRoute.length - 1];
      var endHorizontal = endpointPoint.side === "left" || endpointPoint.side === "right";
      var endBridge = endHorizontal
        ? { x: escape.x, y: endAnchor.y }
        : { x: endAnchor.x, y: escape.y };
      item.wire.route = cleanOrthogonalRoute(fixedRoute.concat([endBridge, escape, endpointPoint]));
    }
  }

  function setComponentRotation(component, nextRotation, announce) {
    if (!component) return false;
    var normalized = normalizeRotation(nextRotation);
    if (normalized === normalizeRotation(component.rotation)) return false;
    cancelActiveInteraction(true);
    var rotationConnections = prepareComponentRotationConnections(component.id);
    var centerX = component.x + component.width / 2;
    var centerY = component.y + component.height / 2;
    var size = componentSizeForRotation(componentDefinitions[component.type], normalized);
    component.rotation = normalized;
    component.width = size.width;
    component.height = size.height;
    var position = clampComponentPosition(component, centerX - size.width / 2, centerY - size.height / 2);
    component.x = position.x;
    component.y = position.y;
    renderComponent(component);
    rotationConnections.forEach(rebuildRotationConnection);
    renderWires();
    updateComponentActionState();
    emitSchematicChange("rotate-component", component);
    if (announce !== false) setStatus("已旋转 " + component.ref + " · " + normalized + "° · R 可继续旋转");
    return true;
  }

  function rotateSelectedComponent(delta) {
    var component = selectedComponentModel();
    if (!component) {
      setStatus("请先选择要旋转的部件");
      return false;
    }
    return setComponentRotation(component, component.rotation + (delta == null ? 90 : delta), true);
  }

  function applyCatalogProperties(component, properties, announce, persistChange) {
    if (!component || !catalogDefinition(component.type)) return false;
    var normalized = normalizeCatalogProperties(component.type, properties);
    var previous = JSON.stringify(component.peripheralProperties || {});
    component.peripheralProperties = normalized;
    component.value = formatCatalogValue(component.type, normalized);
    var device = componentDevice(component);
    if (device) {
      if (component.type === "dht11" && typeof device.setEnvironment === "function") device.setEnvironment(normalized.temperatureC, normalized.humidityPercent);
      else if (component.type === "hcsr04" && typeof device.setDistanceCm === "function") device.setDistanceCm(normalized.distanceCm);
      else if (component.type === "sg90" && typeof device.setAngle === "function") device.setAngle(normalized.angle);
      else if (component.type === "buzzer" && typeof device.setTone === "function") device.setTone(normalized.frequencyHz, normalized.dutyPermille);
      else if (component.type === "tm1637") {
        if (typeof device.displayNumber === "function") device.displayNumber(normalized.displayValue, false, false);
        if (typeof device.setBrightness === "function") device.setBrightness(normalized.brightness, true);
      } else if (typeof device.setProperties === "function") device.setProperties(normalized);
    }
    var element = schematicState.componentElements.get(component.id);
    var valueElement = element && element.querySelector(".component-value");
    if (valueElement) valueElement.textContent = component.value;
    if (element) element.setAttribute("aria-label", componentDefinitions[component.type].title + " " + component.ref + "，数值 " + component.value + "，方向 " + component.rotation + " 度");
    updateCatalogVisual(component, element);
    var changed = previous !== JSON.stringify(normalized);
    if (changed) {
      schematicState.compiledNetlist = null;
      renderWires();
      if (persistChange !== false) emitSchematicChange("update-peripheral-properties", component);
      if (announce !== false) setStatus("已更新 " + component.ref + " · " + component.value);
    }
    return changed;
  }

  function applyLightLevel(component, lux, announce, persistChange) {
    if (!component || component.type !== "lightSensor") return false;
    var normalized = normalizeLuxValue(lux, component.lux);
    var changed = normalized !== component.lux;
    component.lux = normalized;
    component.value = Math.round(normalized) + " lux";
    var device = componentDevice(component);
    if (device && typeof device.setLux === "function") device.setLux(normalized);
    var element = schematicState.componentElements.get(component.id);
    var valueElement = element && element.querySelector(".component-value");
    if (valueElement) valueElement.textContent = component.value;
    if (element) element.setAttribute("aria-label", componentDefinitions[component.type].title + " " + component.ref + "，数值 " + component.value + "，方向 " + component.rotation + " 度");
    schematicState.compiledNetlist = null;
    renderWires();
    updateLightSensorVisual(component, element);
    if (changed && persistChange !== false) emitSchematicChange("update-light-level", component);
    if (changed && announce !== false) setStatus("已更新 " + component.ref + " · " + component.value);
    return normalized;
  }

  function applyAdcSourceSettings(component, settings, announce, persistChange) {
    if (!component || component.type !== "adcSource") return false;
    var source = settings || {};
    var reference = clampNumber(Number(source.referenceVoltage == null ? component.adcReferenceVoltage : source.referenceVoltage), 0.1, 100);
    var bits = clampNumber(Math.round(Number(source.bits == null ? component.adcBits : source.bits)), 1, 24);
    var voltage = normalizeAdcSourceVoltage(source.voltage == null ? component.adcVoltage : source.voltage, component.adcVoltage, reference);
    var previous = [component.adcVoltage, component.adcReferenceVoltage, component.adcBits].join("|");
    component.adcReferenceVoltage = reference;
    component.adcBits = bits;
    component.adcVoltage = voltage;
    component.value = formatAdcSourceValue(voltage);
    var element = schematicState.componentElements.get(component.id);
    var valueElement = element && element.querySelector(".component-value");
    if (valueElement) valueElement.textContent = component.value;
    if (element) element.setAttribute("aria-label", componentDefinitions[component.type].title + " " + component.ref + "，数值 " + component.value + "，方向 " + component.rotation + " 度");
    updateAdcSourceVisual(component, element);
    var changed = previous !== [component.adcVoltage, component.adcReferenceVoltage, component.adcBits].join("|");
    if (changed) {
      schematicState.compiledNetlist = null;
      renderWires();
      if (persistChange !== false) emitSchematicChange("update-adc-source", component);
      if (announce !== false) setStatus("已更新 " + component.ref + " · " + component.value + " · ADC " + adcSourceRaw(component));
    }
    return changed;
  }

  function applyAdcSourceVoltage(component, voltage, announce, persistChange) {
    if (!component || component.type !== "adcSource") return false;
    applyAdcSourceSettings(component, { voltage: voltage }, announce, persistChange);
    return component.adcVoltage;
  }

  function applyUartSenderSettings(component, settings, announce, persistChange) {
    if (!component || component.type !== "uartSender") return false;
    var source = settings || {};
    var payload = String(source.payload == null ? component.uartPayload : source.payload).slice(0, 512);
    var condition = normalizeUartSenderCondition(source.condition == null ? component.uartCondition : source.condition);
    var delayMs = clampNumber(Number(source.delayMs == null ? component.uartDelayMs : source.delayMs), 0, 3600000);
    var previous = [component.uartPayload, component.uartCondition, component.uartDelayMs].join("|");
    component.uartPayload = payload;
    component.uartCondition = condition;
    component.uartDelayMs = delayMs;
    component.uartRuntime = { sent: false, previousTrigger: 0, dueAt: null, lastSentAt: null, count: 0, error: "" };
    component.value = formatUartSenderValue(component);
    var element = schematicState.componentElements.get(component.id);
    var valueElement = element && element.querySelector(".component-value");
    if (valueElement) valueElement.textContent = component.value;
    updateUartSenderVisual(component, element);
    var changed = previous !== [component.uartPayload, component.uartCondition, component.uartDelayMs].join("|");
    if (changed && persistChange !== false) emitSchematicChange("update-uart-sender", component);
    if (changed && announce !== false) setStatus("已更新 " + component.ref + " · " + component.value);
    return changed;
  }

  function getAutomationTargets() {
    var targets = [];
    schematicState.components.forEach(function (component) {
      if (component.type === "adcSource") {
        targets.push({
          id: component.id + ":voltage",
          componentId: component.id,
          ref: component.ref,
          type: component.type,
          key: "voltage",
          label: component.ref + " · ADC 采集电压",
          min: 0,
          max: component.adcReferenceVoltage,
          step: 0.001,
          unit: "V",
          value: component.adcVoltage
        });
        return;
      }
      if (component.type === "lightSensor") {
        targets.push({
          id: component.id + ":lux",
          componentId: component.id,
          ref: component.ref,
          type: component.type,
          key: "lux",
          label: component.ref + " · 光敏照度",
          min: 0,
          max: 100000,
          step: 10,
          unit: "lux",
          value: component.lux
        });
        return;
      }
      var definition = catalogDefinition(component.type);
      var allowedKeys = AUTOMATABLE_CATALOG_CONTROLS[component.type];
      if (!definition || !allowedKeys) return;
      (definition.controls || []).forEach(function (control) {
        if (allowedKeys.indexOf(control.key) < 0) return;
        targets.push({
          id: component.id + ":" + control.key,
          componentId: component.id,
          ref: component.ref,
          type: component.type,
          key: control.key,
          label: component.ref + " · " + definition.title + " / " + control.label,
          min: Number(control.min),
          max: Number(control.max),
          step: Number(control.step) || 1,
          unit: String(control.unit || ""),
          value: Number(component.peripheralProperties && component.peripheralProperties[control.key] != null ? component.peripheralProperties[control.key] : control.value)
        });
      });
    });
    return targets.sort(function (left, right) { return left.label.localeCompare(right.label, "zh-CN"); });
  }

  function applyAutomationValue(targetId, value) {
    var text = String(targetId || "");
    var separator = text.lastIndexOf(":");
    if (separator <= 0) return false;
    var component = schematicState.components.get(text.slice(0, separator));
    var key = text.slice(separator + 1);
    if (!component) return false;
    if (component.type === "adcSource" && key === "voltage") return applyAdcSourceVoltage(component, value, false, false);
    if (component.type === "lightSensor" && key === "lux") return applyLightLevel(component, value, false, false);
    var definition = catalogDefinition(component.type);
    var allowedKeys = AUTOMATABLE_CATALOG_CONTROLS[component.type] || [];
    var control = definition && (definition.controls || []).find(function (candidate) { return candidate.key === key; });
    if (!control || allowedKeys.indexOf(key) < 0) return false;
    var properties = Object.assign({}, component.peripheralProperties || {});
    properties[key] = clampNumber(Number(value), Number(control.min), Number(control.max));
    applyCatalogProperties(component, properties, false, false);
    return Number(component.peripheralProperties[key]);
  }

  function updateComponentValue(component, nextValue, announce) {
    if (!component) return false;
    var value = String(nextValue == null ? "" : nextValue).trim();
    if (!value || value === component.value) return false;
    if (component.type === "netTerminal") {
      value = normalizeNetLabel(value);
      if (!value || value === component.value) return false;
    }
    component.value = value;
    var device = componentDevice(component);
    if (component.type === "oled") {
      component.oledAddress = oledAddressFromValue(value, component.oledAddress);
      if (device && typeof device.setAddress === "function") device.setAddress(component.oledAddress);
    } else if (component.type === "button") {
      component.buttonClosed = /^(?:ON|CLOSED|1)$/i.test(value);
      component.value = component.buttonClosed ? "ON" : "OFF";
      value = component.value;
    } else if (component.type === "lightSensor") {
      component.lux = normalizeLuxValue(value, component.lux);
      component.value = Math.round(component.lux) + " lux";
      value = component.value;
      if (device && typeof device.setLux === "function") device.setLux(component.lux);
    } else if (catalogDefinition(component.type)) {
      component.value = formatCatalogValue(component.type, component.peripheralProperties);
      value = component.value;
    }
    var element = schematicState.componentElements.get(component.id);
    if (element) {
      var valueElement = element.querySelector(".component-value");
      if (valueElement) valueElement.textContent = value;
      var netLabelElement = element.querySelector(".net-terminal-symbol-label");
      if (netLabelElement) netLabelElement.textContent = value;
      element.setAttribute("aria-label", componentDefinitions[component.type].title + " " + component.ref + "，数值 " + value + "，方向 " + component.rotation + " 度");
    }
    updateLedStates();
    updateOledVisual(component, element);
    updateLightSensorVisual(component, element);
    updateCatalogVisual(component, element);
    schematicState.compiledNetlist = null;
    renderWires();
    emitSchematicChange("update-component-value", component);
    if (announce !== false) setStatus("已更新 " + component.ref + " · " + value);
    return true;
  }

  function setButtonClosed(component, closed, announce) {
    if (!component || component.type !== "button") return false;
    component.buttonClosed = Boolean(closed);
    component.value = component.buttonClosed ? "ON" : "OFF";
    schematicState.compiledNetlist = null;
    if (schematicState.initialized) {
      renderComponent(component);
      renderWires();
      emitSchematicChange("toggle-switch", component);
      if (announce !== false) setStatus(component.ref + " · " + (component.buttonClosed ? "ON · 已导通" : "OFF · 已断开"));
    }
    return component.buttonClosed;
  }

  function componentValuePlaceholder(type) {
    if (type === "resistor") return "例如 1 kΩ、4K7、0R 或 DNP";
    if (type === "capacitor") return "例如 100 nF、10uF / 16V";
    if (type === "led") return "例如 RED 5mm、GREEN LED";
    if (type === "button") return "ON 或 OFF";
    if (type === "vcc") return "例如 +3V3、+5V";
    if (type === "ground") return "例如 0V、AGND";
    if (type === "netTerminal") return "例如 SENSOR_OUT、I2C1_SCL、MOTOR_PWM";
    if (type === "oled") return "SSD1306 · 0x3C";
    if (type === "adcSource") return "例如 1.650 V";
    if (type === "uartSender") return "条件与延时由下方设置";
    if (type === "lightSensor") return "例如 500 lux";
    if (catalogDefinition(type)) return formatCatalogValue(type, normalizeCatalogProperties(type, {}));
    return "输入元件数值、型号或说明";
  }

  function renderAdvancedProperties(component) {
    var container = schematicNodes.componentAdvancedProperties;
    if (!container) return;
    container.replaceChildren();
    container.hidden = component.type !== "oled" && component.type !== "spiDisplay" && component.type !== "adcSource" && component.type !== "uartSender" && component.type !== "lightSensor" && !catalogDefinition(component.type);
    if (component.type === "oled") {
      container.innerHTML = '<label class="component-property-field"><span>I²C 地址（7 位）</span><input id="componentOledAddressInput" type="text" inputmode="text" maxlength="4" value="0x' + component.oledAddress.toString(16).toUpperCase().padStart(2, "0") + '" /></label><div class="component-property-readout">只有 VCC/GND 正确供电、SCL/SDA 与 IOC 中同一 I²C 实例匹配时，HAL 写入才会显示。</div>';
      return;
    }
    if (component.type === "spiDisplay") {
      container.innerHTML = '<div class="component-property-readout">ST7735 · 160×128 · RGB565。连接 VCC/GND、SCK/MOSI，并用 CS 低电平选中、DC 区分命令与数据；HAL_SPI_Transmit 会实时写入屏幕。</div>';
      return;
    }
    if (component.type === "adcSource") {
      container.innerHTML = '<div class="component-property-range-row"><label><span>采集电压</span><input id="componentAdcVoltageRange" type="range" min="0" max="' + component.adcReferenceVoltage + '" step="0.001" value="' + component.adcVoltage + '" /></label><input id="componentAdcVoltageInput" type="number" min="0" max="' + component.adcReferenceVoltage + '" step="0.001" value="' + component.adcVoltage + '" /><b>V</b></div>' +
        '<div class="component-property-grid"><label><span>参考电压 VREF</span><input id="componentAdcReferenceInput" type="number" min="0.1" max="100" step="0.1" value="' + component.adcReferenceVoltage + '" /></label><label><span>ADC 分辨率</span><input id="componentAdcBitsInput" type="number" min="1" max="24" step="1" value="' + component.adcBits + '" /></label></div>' +
        '<div class="component-property-readout">AO 输出真实模拟电压；当前采样值 ADC ' + adcSourceRaw(component) + '，可在传感器包络线中连续扫描。</div>';
      return;
    }
    if (component.type === "uartSender") {
      container.innerHTML = '<label class="component-property-field"><span>发送内容（支持 \\r、\\n、\\xNN）</span><textarea id="componentUartPayloadInput" maxlength="512" rows="4"></textarea></label>' +
        '<div class="component-property-grid"><label><span>触发条件</span><select id="componentUartConditionInput"><option value="startup">仿真启动后</option><option value="rising">TRIG 上升沿</option><option value="high">TRIG 高电平</option><option value="periodic">周期发送</option></select></label><label><span>条件满足后延时</span><input id="componentUartDelayInput" type="number" min="0" max="3600000" step="1" value="' + component.uartDelayMs + '" /></label></div>' +
        '<div class="component-property-readout">TX 接 MCU 的 UART RX；启动/周期模式不要求 TRIG，触发模式按统一仿真时间戳延时发送。</div>';
      container.querySelector("#componentUartPayloadInput").value = component.uartPayload;
      container.querySelector("#componentUartConditionInput").value = component.uartCondition;
      return;
    }
    if (component.type === "lightSensor") {
      container.innerHTML = '<div class="component-property-range-row"><label><span>环境照度</span><input id="componentLuxRange" type="range" min="0" max="100000" step="10" value="' + component.lux + '" /></label><input id="componentLuxInput" type="number" min="0" max="100000" step="10" value="' + component.lux + '" /><b>lux</b></div>' +
        '<div class="component-property-range-row"><label><span>DO 触发阈值</span><input id="componentThresholdRange" type="range" min="0" max="100000" step="10" value="' + component.thresholdLux + '" /></label><input id="componentThresholdInput" type="number" min="0" max="100000" step="10" value="' + component.thresholdLux + '" /><b>lux</b></div>' +
        '<div class="component-property-readout">AO 按 0–100000 lux 线性输出 0–VCC；DO 在照度达到阈值时输出高电平。</div>';
      return;
    }
    if (catalogDefinition(component.type)) {
      var controls = catalogDefinition(component.type).controls || [];
      container.innerHTML = controls.map(function (control) {
        var value = component.peripheralProperties && component.peripheralProperties[control.key];
        var safeKey = String(control.key).replace(/[^A-Za-z0-9_-]/g, "");
        return '<div class="component-property-range-row"><label><span>' + control.label + '</span><input id="componentCatalogRange_' + safeKey + '" data-property-key="' + safeKey + '" data-peer-id="componentCatalogInput_' + safeKey + '" type="range" min="' + control.min + '" max="' + control.max + '" step="' + control.step + '" value="' + value + '" /></label><input id="componentCatalogInput_' + safeKey + '" data-property-key="' + safeKey + '" data-peer-id="componentCatalogRange_' + safeKey + '" type="number" min="' + control.min + '" max="' + control.max + '" step="' + control.step + '" value="' + value + '" /><b>' + (control.unit || "") + '</b></div>';
      }).join("") + '<div class="component-property-readout">' + catalogDefinition(component.type).title + ' · ' + (catalogDefinition(component.type).bus || "GPIO") + ' · 参数会随电路文件保存。</div>';
    }
  }

  function syncAdvancedPropertyInput(event) {
    var target = event.target;
    if (!target || !schematicNodes.componentAdvancedProperties || !schematicNodes.componentAdvancedProperties.contains(target)) return;
    var pairs = {
      componentAdcVoltageRange: "componentAdcVoltageInput",
      componentAdcVoltageInput: "componentAdcVoltageRange",
      componentLuxRange: "componentLuxInput",
      componentLuxInput: "componentLuxRange",
      componentThresholdRange: "componentThresholdInput",
      componentThresholdInput: "componentThresholdRange"
    };
    var peer = pairs[target.id] && schematicNodes.propertiesModal.querySelector("#" + pairs[target.id]);
    if (!peer && target.dataset && target.dataset.peerId) peer = schematicNodes.propertiesModal.querySelector("#" + target.dataset.peerId);
    if (peer) peer.value = target.value;
    if (target.id === "componentAdcReferenceInput") {
      var reference = clampNumber(Number(target.value) || 3.3, 0.1, 100);
      var voltageRange = schematicNodes.propertiesModal.querySelector("#componentAdcVoltageRange");
      var voltageInput = schematicNodes.propertiesModal.querySelector("#componentAdcVoltageInput");
      [voltageRange, voltageInput].forEach(function (input) {
        if (!input) return;
        input.max = String(reference);
        if (Number(input.value) > reference) input.value = String(reference);
      });
    }
  }

  function closeComponentProperties(restoreFocus) {
    var modal = schematicNodes.propertiesModal;
    var componentId = schematicState.editingComponentId;
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    schematicState.editingComponentId = null;
    if (restoreFocus !== false && componentId) {
      setTimeout(function () {
        var element = schematicState.componentElements.get(componentId);
        if (element) element.focus({ preventScroll: true });
      }, 0);
    }
  }

  function validateComponentValue(value) {
    if (!value) return "数值不能为空。";
    if (value.length > 48) return "数值最多允许 48 个字符。";
    if (/[\u0000-\u001f\u007f]/.test(value)) return "数值中不能包含控制字符。";
    return "";
  }

  function saveComponentProperties() {
    var component = schematicState.components.get(schematicState.editingComponentId);
    if (!component || !schematicNodes.propertiesModal) return false;
    var valueInput = schematicNodes.componentValueInput;
    var value = String(valueInput.value || "").trim();
    var thresholdChanged = false;
    var catalogProperties = null;
    var adcSettings = null;
    var uartSettings = null;
    if (component.type === "adcSource") {
      var adcVoltage = Number(schematicNodes.propertiesModal.querySelector("#componentAdcVoltageInput")?.value);
      var adcReference = Number(schematicNodes.propertiesModal.querySelector("#componentAdcReferenceInput")?.value);
      var adcBits = Number(schematicNodes.propertiesModal.querySelector("#componentAdcBitsInput")?.value);
      if (!Number.isFinite(adcReference) || adcReference < 0.1 || adcReference > 100 || !Number.isInteger(adcBits) || adcBits < 1 || adcBits > 24 || !Number.isFinite(adcVoltage) || adcVoltage < 0 || adcVoltage > adcReference) {
        schematicNodes.componentPropertiesError.textContent = "采集电压必须位于 0–VREF，VREF 为 0.1–100 V，ADC 分辨率为 1–24 位整数。";
        schematicNodes.componentPropertiesError.hidden = false;
        return false;
      }
      adcSettings = { voltage: adcVoltage, referenceVoltage: adcReference, bits: adcBits };
      value = formatAdcSourceValue(adcVoltage);
    } else if (component.type === "uartSender") {
      var uartPayload = String(schematicNodes.propertiesModal.querySelector("#componentUartPayloadInput")?.value || "");
      var uartCondition = normalizeUartSenderCondition(schematicNodes.propertiesModal.querySelector("#componentUartConditionInput")?.value);
      var uartDelay = Number(schematicNodes.propertiesModal.querySelector("#componentUartDelayInput")?.value);
      if (!uartPayload.length || uartPayload.length > 512 || !Number.isFinite(uartDelay) || uartDelay < 0 || uartDelay > 3600000) {
        schematicNodes.componentPropertiesError.textContent = "发送内容不能为空且最多 512 字符；延时必须位于 0–3600000 ms。";
        schematicNodes.componentPropertiesError.hidden = false;
        return false;
      }
      uartSettings = { payload: uartPayload, condition: uartCondition, delayMs: uartDelay };
      value = uartSenderConditionLabel(uartCondition) + " · " + Math.round(uartDelay) + " ms";
    } else if (component.type === "oled") {
      var addressText = String(schematicNodes.propertiesModal.querySelector("#componentOledAddressInput")?.value || "").trim();
      var addressNumber = /^0x[0-9a-f]+$/i.test(addressText) ? parseInt(addressText, 16) : Number(addressText);
      if (!Number.isFinite(addressNumber) || addressNumber < 0x03 || addressNumber > 0x77) {
        schematicNodes.componentPropertiesError.textContent = "OLED 地址必须是 0x03–0x77 范围内的 7 位 I²C 地址。";
        schematicNodes.componentPropertiesError.hidden = false;
        return false;
      }
      value = "SSD1306 · 0x" + Math.floor(addressNumber).toString(16).toUpperCase().padStart(2, "0");
    } else if (component.type === "lightSensor") {
      var luxInput = schematicNodes.propertiesModal.querySelector("#componentLuxInput");
      var thresholdInput = schematicNodes.propertiesModal.querySelector("#componentThresholdInput");
      var lux = Number(luxInput && luxInput.value);
      var threshold = Number(thresholdInput && thresholdInput.value);
      if (!Number.isFinite(lux) || lux < 0 || lux > 100000 || !Number.isFinite(threshold) || threshold < 0 || threshold > 100000) {
        schematicNodes.componentPropertiesError.textContent = "照度和阈值必须位于 0–100000 lux。";
        schematicNodes.componentPropertiesError.hidden = false;
        return false;
      }
      value = Math.round(lux) + " lux";
      threshold = Math.round(threshold);
      thresholdChanged = threshold !== component.thresholdLux;
      component.thresholdLux = threshold;
      var sensorDevice = componentDevice(component);
      if (sensorDevice && typeof sensorDevice.setThresholdLux === "function") sensorDevice.setThresholdLux(threshold);
    } else if (catalogDefinition(component.type)) {
      catalogProperties = {};
      var controls = catalogDefinition(component.type).controls || [];
      for (var catalogIndex = 0; catalogIndex < controls.length; catalogIndex += 1) {
        var control = controls[catalogIndex];
        var catalogInput = schematicNodes.propertiesModal.querySelector('[data-property-key="' + control.key + '"][type="number"]');
        var catalogValue = Number(catalogInput && catalogInput.value);
        if (!Number.isFinite(catalogValue) || catalogValue < Number(control.min) || catalogValue > Number(control.max)) {
          schematicNodes.componentPropertiesError.textContent = control.label + " 必须位于 " + control.min + "–" + control.max + (control.unit ? " " + control.unit : "") + "。";
          schematicNodes.componentPropertiesError.hidden = false;
          if (catalogInput) catalogInput.focus();
          return false;
        }
        catalogProperties[control.key] = catalogValue;
      }
      value = formatCatalogValue(component.type, catalogProperties);
    }
    var errorMessage = validateComponentValue(value);
    if (!errorMessage && component.type === "netTerminal" && !normalizeNetLabel(value)) {
      errorMessage = "网络名称只能包含字母、数字、下划线及 . / : + -，并且不能以符号开头。";
    }
    schematicNodes.componentPropertiesError.textContent = errorMessage;
    schematicNodes.componentPropertiesError.hidden = !errorMessage;
    valueInput.setAttribute("aria-invalid", errorMessage ? "true" : "false");
    if (errorMessage) {
      valueInput.focus();
      return false;
    }

    var requestedRotation = normalizeRotation(schematicNodes.componentRotationSelect.value);
    var valueChanged = adcSettings ? applyAdcSourceSettings(component, adcSettings, false) : (uartSettings ? applyUartSenderSettings(component, uartSettings, false) : (catalogProperties ? applyCatalogProperties(component, catalogProperties, false) : updateComponentValue(component, value, false)));
    var rotationChanged = setComponentRotation(component, requestedRotation, false);
    if (thresholdChanged) {
      schematicState.compiledNetlist = null;
      renderWires();
      updateLightSensorVisual(component);
      emitSchematicChange("update-component-threshold", component);
    }
    closeComponentProperties(true);
    setStatus("已更新 " + component.ref + " · " + component.value + " · " + component.rotation + "°");
    if (!valueChanged && !rotationChanged && !thresholdChanged) setStatus(component.ref + " 属性未更改");
    return true;
  }

  function ensureComponentPropertiesModal() {
    if (schematicNodes.propertiesModal && schematicNodes.propertiesModal.isConnected) return schematicNodes.propertiesModal;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop component-properties-backdrop";
    backdrop.id = "componentPropertiesModal";
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.innerHTML = '<div class="modal component-properties-modal" role="dialog" aria-modal="true" aria-labelledby="componentPropertiesTitle" aria-describedby="componentPropertiesDescription">' +
      '<button class="modal-close" id="componentPropertiesClose" type="button" aria-label="关闭">×</button>' +
      '<span class="modal-eyebrow">SCHEMATIC COMPONENT</span>' +
      '<h2 id="componentPropertiesTitle">部件属性</h2>' +
      '<p id="componentPropertiesDescription">修改元件数值或选择精确方向。</p>' +
      '<form id="componentPropertiesForm" class="component-properties-form" novalidate>' +
        '<div class="component-property-grid">' +
          '<label><span>参考标号</span><input id="componentReferenceInput" type="text" readonly /></label>' +
          '<label><span>部件类型</span><input id="componentTypeInput" type="text" readonly /></label>' +
        '</div>' +
        '<label class="component-property-field"><span>数值 / 型号</span><input id="componentValueInput" type="text" maxlength="48" autocomplete="off" autofocus /></label>' +
        '<div id="componentAdvancedProperties" class="component-property-advanced" hidden></div>' +
        '<label class="component-property-field"><span>方向</span><select id="componentRotationSelect"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>' +
        '<div class="component-property-note">支持 EDA 常用写法，例如 4K7、0R、100 nF、DNP 或具体器件型号。</div>' +
        '<div class="component-property-error" id="componentPropertiesError" aria-live="polite" hidden></div>' +
        '<div class="component-property-actions"><button id="componentPropertiesCancel" class="ui-action-secondary" type="button">取消</button><button id="componentPropertiesSave" class="modal-primary" type="submit">应用</button></div>' +
      '</form>' +
    '</div>';

    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop || event.target.closest("#componentPropertiesClose, #componentPropertiesCancel")) {
        event.preventDefault();
        closeComponentProperties(true);
      }
    });
    backdrop.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeComponentProperties(true);
        return;
      }
      if (event.key !== "Tab") return;
      var focusable = Array.from(backdrop.querySelectorAll("input:not([disabled]), select:not([disabled]), button:not([disabled])"));
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    backdrop.querySelector("#componentPropertiesForm").addEventListener("submit", function (event) {
      event.preventDefault();
      saveComponentProperties();
    });
    backdrop.querySelector("#componentAdvancedProperties").addEventListener("input", syncAdvancedPropertyInput);

    var portal = document.fullscreenElement || document.body;
    portal.appendChild(backdrop);
    schematicNodes.propertiesModal = backdrop;
    schematicNodes.componentValueInput = backdrop.querySelector("#componentValueInput");
    schematicNodes.componentAdvancedProperties = backdrop.querySelector("#componentAdvancedProperties");
    schematicNodes.componentRotationSelect = backdrop.querySelector("#componentRotationSelect");
    schematicNodes.componentPropertiesError = backdrop.querySelector("#componentPropertiesError");
    return backdrop;
  }

  function openComponentProperties(componentId) {
    var component = schematicState.components.get(componentId || (selectedComponentModel() && selectedComponentModel().id));
    if (!component) {
      setStatus("请先选择要编辑的部件");
      return false;
    }
    cancelActiveInteraction(false);
    selectEntity("component", component.id);
    var modal = ensureComponentPropertiesModal();
    var portal = document.fullscreenElement || document.body;
    if (modal.parentElement !== portal) portal.appendChild(modal);
    schematicState.editingComponentId = component.id;
    modal.querySelector("#componentReferenceInput").value = component.ref;
    modal.querySelector("#componentTypeInput").value = componentDefinitions[component.type].title;
    schematicNodes.componentValueInput.value = component.value;
    schematicNodes.componentValueInput.placeholder = componentValuePlaceholder(component.type);
    schematicNodes.componentValueInput.readOnly = component.type === "oled" || component.type === "spiDisplay" || component.type === "adcSource" || component.type === "uartSender" || component.type === "lightSensor" || component.type === "voltageProbe" || component.type === "currentProbe" || Boolean(catalogDefinition(component.type));
    schematicNodes.componentValueInput.setAttribute("aria-invalid", "false");
    renderAdvancedProperties(component);
    schematicNodes.componentRotationSelect.value = String(normalizeRotation(component.rotation));
    schematicNodes.componentPropertiesError.textContent = "";
    schematicNodes.componentPropertiesError.hidden = true;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(function () {
      var preferred = modal.querySelector("#componentOledAddressInput, #componentAdcVoltageInput, #componentUartPayloadInput, #componentLuxInput, [data-property-key][type=number]");
      (preferred || schematicNodes.componentValueInput).focus();
      if (preferred && typeof preferred.select === "function") preferred.select();
      else schematicNodes.componentValueInput.select();
    });
    return true;
  }

  function selectEntity(kind, id) {
    schematicState.selection = kind && id ? { kind: kind, id: id } : null;
    schematicState.componentElements.forEach(function (element, componentId) {
      var isSelected = Boolean(schematicState.selection && schematicState.selection.kind === "component" && schematicState.selection.id === componentId);
      element.classList.toggle("selected", isSelected);
      element.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
    updateComponentActionState();
    renderWires();
  }

  function setStatus(message) {
    if (schematicNodes.status) schematicNodes.status.textContent = message;
  }

  function cancelWire() {
    schematicState.wireStart = null;
    schematicState.previewPoint = null;
    schematicState.componentElements.forEach(function (element) {
      element.querySelectorAll(".component-pin.wire-start").forEach(function (pin) { pin.classList.remove("wire-start"); });
    });
    renderWires();
  }

  function setTool(tool) {
    if (tool !== "select" && tool !== "wire" && tool !== "pan") return;
    cancelActiveInteraction(true);
    schematicState.tool = tool;
    cancelWire();
    document.querySelectorAll("[data-schematic-tool]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.schematicTool === tool);
      button.setAttribute("aria-pressed", button.dataset.schematicTool === tool ? "true" : "false");
    });
    if (schematicNodes.viewport) schematicNodes.viewport.dataset.tool = tool;
    if (tool === "wire") setStatus("导线工具 · 依次点击两个元件端点");
    else if (tool === "pan") setStatus("平移工具 · 拖动画布改变视图");
    else setStatus("选择工具 · 拖动导线调整 · 双击线段增加拐点 · 双击方块删除");
  }

  function applyViewTransform() {
    if (!schematicNodes.world) return;
    schematicNodes.world.style.transformOrigin = "0 0";
    schematicNodes.world.style.transform = "translate(" + schematicState.panX + "px, " + schematicState.panY + "px) scale(" + schematicState.zoom + ")";
    schematicNodes.world.style.setProperty("--schematic-label-scale", String(clampNumber(1 / schematicState.zoom, 1, 2.4)));
    schematicNodes.world.style.setProperty("--schematic-detail-scale", String(clampNumber(1 / schematicState.zoom, 1, 1.65)));
    if (schematicNodes.zoom) schematicNodes.zoom.textContent = Math.round(schematicState.zoom * 100) + "%";
  }

  function clientToWorld(clientX, clientY) {
    if (!schematicNodes.world) return { x: 0, y: 0 };
    var rectangle = schematicNodes.world.getBoundingClientRect();
    return {
      x: (clientX - rectangle.left) / schematicState.zoom,
      y: (clientY - rectangle.top) / schematicState.zoom
    };
  }

  function zoomAt(nextZoom, clientX, clientY, markUserView) {
    if (!schematicNodes.viewport || !schematicNodes.world) return;
    var newZoom = clampNumber(nextZoom, 0.25, 2.4);
    var viewportRectangle = schematicNodes.viewport.getBoundingClientRect();
    var anchorX = clientX == null ? viewportRectangle.left + viewportRectangle.width / 2 : clientX;
    var anchorY = clientY == null ? viewportRectangle.top + viewportRectangle.height / 2 : clientY;
    var worldPoint = clientToWorld(anchorX, anchorY);
    schematicState.zoom = newZoom;
    schematicState.panX = anchorX - viewportRectangle.left - schematicNodes.world.offsetLeft - worldPoint.x * newZoom;
    schematicState.panY = anchorY - viewportRectangle.top - schematicNodes.world.offsetTop - worldPoint.y * newZoom;
    if (markUserView !== false) schematicState.userView = true;
    applyViewTransform();
  }

  function fitToContent(markUserView) {
    if (!schematicNodes.viewport || !schematicNodes.world || !schematicState.components.size) return;
    var minX = WORLD_WIDTH;
    var minY = WORLD_HEIGHT;
    var maxX = 0;
    var maxY = 0;
    schematicState.components.forEach(function (component) {
      minX = Math.min(minX, component.x);
      minY = Math.min(minY, component.y);
      maxX = Math.max(maxX, component.x + component.width);
      maxY = Math.max(maxY, component.y + component.height);
    });
    var margin = 34;
    minX = Math.max(0, minX - margin);
    minY = Math.max(0, minY - margin);
    maxX = Math.min(WORLD_WIDTH, maxX + margin);
    maxY = Math.min(WORLD_HEIGHT, maxY + margin);
    var viewportWidth = Math.max(120, schematicNodes.viewport.clientWidth - 34);
    var viewportHeight = Math.max(100, schematicNodes.viewport.clientHeight - 34);
    var nextZoom = clampNumber(Math.min(viewportWidth / (maxX - minX), viewportHeight / (maxY - minY)), 0.25, 1.5);
    schematicState.zoom = nextZoom;
    schematicState.panX = schematicNodes.viewport.clientWidth / 2 - schematicNodes.world.offsetLeft - ((minX + maxX) / 2) * nextZoom;
    schematicState.panY = schematicNodes.viewport.clientHeight / 2 - schematicNodes.world.offsetTop - ((minY + maxY) / 2) * nextZoom;
    schematicState.userView = markUserView !== false;
    applyViewTransform();
  }

  function endpointFromPin(pinElement) {
    return { componentId: pinElement.dataset.componentId, pin: pinElement.dataset.pin };
  }

  function handleWirePin(pinElement) {
    var endpoint = endpointFromPin(pinElement);
    if (!schematicState.wireStart) {
      schematicState.wireStart = endpoint;
      schematicState.previewPoint = getPinPoint(endpoint);
      pinElement.classList.add("wire-start");
      setStatus("起点 " + pinElement.title + " · 请选择终点");
      renderWires();
      return;
    }
    if (sameEndpoint(schematicState.wireStart, endpoint)) {
      cancelWire();
      setStatus("已取消导线");
      return;
    }
    var wire = createWire(schematicState.wireStart, endpoint);
    cancelWire();
    if (wire) {
      selectEntity("wire", wire.id);
      setStatus("导线已连接 · " + (wire.signal || "未命名网络"));
    }
  }

  function deleteSelection() {
    var selection = schematicState.selection;
    if (!selection) return false;
    var removedComponent = selection.kind === "component" ? schematicState.components.get(selection.id) : null;
    if (schematicState.editingComponentId === selection.id) closeComponentProperties(false);
    cancelActiveInteraction(false);
    if (selection.kind === "wire") {
      schematicState.wires = schematicState.wires.filter(function (wire) { return wire.id !== selection.id; });
    } else {
      var element = schematicState.componentElements.get(selection.id);
      if (element) element.remove();
      schematicState.componentElements.delete(selection.id);
      schematicState.devices.delete(selection.id);
      schematicState.components.delete(selection.id);
      schematicState.wires = schematicState.wires.filter(function (wire) {
        return wire.from.componentId !== selection.id && wire.to.componentId !== selection.id;
      });
      if (schematicState.wireStart && schematicState.wireStart.componentId === selection.id) cancelWire();
    }
    schematicState.selection = null;
    updateComponentActionState();
    renderWires();
    if (removedComponent) emitSchematicChange("delete-component", removedComponent);
    setStatus("已删除选中对象");
    return true;
  }

  function findFreeComponentPosition(definition, desiredX, desiredY) {
    var candidates = [];
    var maximumX = Math.max(0, WORLD_WIDTH - definition.width);
    var maximumY = Math.max(0, WORLD_HEIGHT - definition.height);
    for (var y = 10; y <= maximumY; y += GRID_SIZE * 2) {
      for (var x = 10; x <= maximumX; x += GRID_SIZE * 2) {
        candidates.push({ x: x, y: y, distance: Math.pow(x - desiredX, 2) + Math.pow(y - desiredY, 2) });
      }
    }
    candidates.sort(function (left, right) { return left.distance - right.distance; });
    var margin = 8;
    return candidates.find(function (candidate) {
      var clear = true;
      schematicState.components.forEach(function (component) {
        if (!clear) return;
        var separated = candidate.x + definition.width + margin <= component.x ||
          component.x + component.width + margin <= candidate.x ||
          candidate.y + definition.height + margin <= component.y ||
          component.y + component.height + margin <= candidate.y;
        if (!separated) clear = false;
      });
      return clear;
    }) || {
      x: snapToGrid(clampNumber(desiredX, 0, maximumX)),
      y: snapToGrid(clampNumber(desiredY, 0, maximumY))
    };
  }

  function addLibraryComponent(type) {
    var definition = componentDefinitions[type];
    if (!definition || type === "mcu") return null;
    var viewportRectangle = schematicNodes.viewport.getBoundingClientRect();
    var center = clientToWorld(viewportRectangle.left + viewportRectangle.width / 2, viewportRectangle.top + viewportRectangle.height / 2);
    var stagger = (schematicState.addOffset % 5) * GRID_SIZE;
    schematicState.addOffset += 1;
    var placement = findFreeComponentPosition(definition, center.x - definition.width / 2 + stagger, center.y - definition.height / 2 + stagger);
    var component = createComponentModel(type, placement.x, placement.y);
    selectEntity("component", component.id);
    setTool("select");
    selectEntity("component", component.id);
    emitSchematicChange("add-component", component);
    setStatus("已添加 " + component.ref + " · 拖动到目标位置");
    return component;
  }

  function isWireDragInteraction(interaction) {
    return Boolean(interaction && (interaction.kind === "drag-wire-segment" || interaction.kind === "drag-wire-bend"));
  }

  function capturePointer(pointerId) {
    if (!schematicNodes.viewport || !schematicNodes.viewport.setPointerCapture) return;
    try { schematicNodes.viewport.setPointerCapture(pointerId); } catch (error) { /* Pointer capture is an enhancement. */ }
  }

  function releasePointer(pointerId) {
    if (!schematicNodes.viewport || !schematicNodes.viewport.releasePointerCapture) return;
    try {
      if (!schematicNodes.viewport.hasPointerCapture || schematicNodes.viewport.hasPointerCapture(pointerId)) {
        schematicNodes.viewport.releasePointerCapture(pointerId);
      }
    } catch (error) { /* The pointer may already have been released by the browser. */ }
  }

  function cancelActiveInteraction(restoreWire) {
    var interaction = schematicState.interaction;
    if (!interaction) return false;
    if (interaction.kind === "drag-component") {
      var componentElement = schematicState.componentElements.get(interaction.componentId);
      if (componentElement) componentElement.classList.remove("dragging");
    }
    if (interaction.kind === "pan" && schematicNodes.viewport) schematicNodes.viewport.classList.remove("is-panning");
    if (restoreWire !== false && isWireDragInteraction(interaction)) {
      var wire = findWire(interaction.wireId);
      if (wire) wire.route = cloneRoute(interaction.originalRoute);
    }
    releasePointer(interaction.pointerId);
    schematicState.interaction = null;
    if (isWireDragInteraction(interaction)) renderWires();
    return true;
  }

  function beginWireSegmentDrag(event, hitElement) {
    var wire = findWire(hitElement.dataset.wireId);
    var segmentIndex = Number(hitElement.dataset.segmentIndex);
    if (!wire || !Number.isInteger(segmentIndex)) return;
    clearWireRotationConnections(wire);
    selectEntity("wire", wire.id);
    var route = cloneRoute(ensureWireRoute(wire));
    if (segmentIndex < 0 || segmentIndex >= route.length - 1) return;
    var orientation = segmentOrientation(route[segmentIndex], route[segmentIndex + 1]);
    if (!orientation) return;
    schematicState.interaction = {
      kind: "drag-wire-segment",
      pointerId: event.pointerId,
      wireId: wire.id,
      segmentIndex: segmentIndex,
      orientation: orientation,
      originalRoute: route,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorld: clientToWorld(event.clientX, event.clientY),
      moved: false
    };
    capturePointer(event.pointerId);
    renderWires();
    setStatus((orientation === "horizontal" ? "上下" : "左右") + "拖动线段 · 网格吸附 · Esc 取消");
  }

  function beginWireBendDrag(event, handleElement) {
    var wire = findWire(handleElement.dataset.wireId);
    var pointIndex = Number(handleElement.dataset.pointIndex);
    if (!wire || !Number.isInteger(pointIndex)) return;
    clearWireRotationConnections(wire);
    selectEntity("wire", wire.id);
    var route = cloneRoute(ensureWireRoute(wire));
    if (!routeHasBendAt(route, pointIndex)) return;
    schematicState.interaction = {
      kind: "drag-wire-bend",
      pointerId: event.pointerId,
      wireId: wire.id,
      pointIndex: pointIndex,
      orientation: "bend",
      originalRoute: route,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorld: clientToWorld(event.clientX, event.clientY),
      moved: false
    };
    capturePointer(event.pointerId);
    renderWires();
    setStatus("拖动拐点重新布线 · 保持正交 · Esc 取消");
  }

  function beginComponentDrag(event, componentElement) {
    var component = schematicState.components.get(componentElement.dataset.componentId);
    if (!component) return;
    clearRotationConnectionsForComponent(component.id);
    var point = clientToWorld(event.clientX, event.clientY);
    schematicState.interaction = {
      kind: "drag-component",
      pointerId: event.pointerId,
      componentId: component.id,
      offsetX: point.x - component.x,
      offsetY: point.y - component.y
    };
    capturePointer(event.pointerId);
    componentElement.classList.add("dragging");
    setStatus("移动 " + component.ref + " · X " + Math.round(component.x) + "  Y " + Math.round(component.y));
  }

  function beginPan(event) {
    schematicState.interaction = {
      kind: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: schematicState.panX,
      panY: schematicState.panY
    };
    capturePointer(event.pointerId);
    schematicState.userView = true;
    schematicNodes.viewport.classList.add("is-panning");
    setStatus("平移视图");
  }

  function handlePointerMove(event) {
    var interaction = schematicState.interaction;
    if (interaction && interaction.pointerId === event.pointerId) {
      if (isWireDragInteraction(interaction)) {
        var wire = findWire(interaction.wireId);
        if (!wire) {
          cancelActiveInteraction(false);
          return;
        }
        var rawWirePoint = clientToWorld(event.clientX, event.clientY);
        var dragDistance = interaction.kind === "drag-wire-segment"
          ? (interaction.orientation === "horizontal"
            ? Math.abs(event.clientY - interaction.startClientY)
            : Math.abs(event.clientX - interaction.startClientX))
          : Math.hypot(event.clientX - interaction.startClientX, event.clientY - interaction.startClientY);
        if (!interaction.moved) {
          if (dragDistance < 2) {
            event.preventDefault();
            return;
          }
          interaction.moved = true;
        }
        var originalPoint = interaction.originalRoute[interaction.kind === "drag-wire-segment" ? interaction.segmentIndex : interaction.pointIndex];
        var wirePoint = interaction.kind === "drag-wire-segment"
          ? {
            x: interaction.orientation === "vertical" ? originalPoint.x + snapToGrid(rawWirePoint.x - interaction.startWorld.x) : originalPoint.x,
            y: interaction.orientation === "horizontal" ? originalPoint.y + snapToGrid(rawWirePoint.y - interaction.startWorld.y) : originalPoint.y
          }
          : {
            x: originalPoint.x + snapToGrid(rawWirePoint.x - interaction.startWorld.x),
            y: originalPoint.y + snapToGrid(rawWirePoint.y - interaction.startWorld.y)
          };
        wire.route = interaction.kind === "drag-wire-segment"
          ? routeForSegmentDrag(interaction.originalRoute, interaction.segmentIndex, wirePoint)
          : routeForBendDrag(interaction.originalRoute, interaction.pointIndex, wirePoint);
        renderWires();
        var snapped = clampRoutePoint(wirePoint);
        setStatus((interaction.kind === "drag-wire-segment" ? "移动导线段" : "移动导线拐点") + " · X " + snapped.x + "  Y " + snapped.y + " · Esc 取消");
        event.preventDefault();
        return;
      }
      if (interaction.kind === "drag-component") {
        var component = schematicState.components.get(interaction.componentId);
        if (!component) return;
        var point = clientToWorld(event.clientX, event.clientY);
        component.x = snapToGrid(clampNumber(point.x - interaction.offsetX, 0, WORLD_WIDTH - component.width));
        component.y = snapToGrid(clampNumber(point.y - interaction.offsetY, 0, WORLD_HEIGHT - component.height));
        updateComponentElement(component);
        renderWires();
        setStatus("移动 " + component.ref + " · X " + component.x + "  Y " + component.y);
        event.preventDefault();
        return;
      }
      if (interaction.kind === "pan") {
        schematicState.panX = interaction.panX + event.clientX - interaction.startX;
        schematicState.panY = interaction.panY + event.clientY - interaction.startY;
        applyViewTransform();
        event.preventDefault();
        return;
      }
    }

    if (schematicState.wireStart && schematicNodes.viewport) {
      var previewPoint = clientToWorld(event.clientX, event.clientY);
      schematicState.previewPoint = {
        x: snapToGrid(clampNumber(previewPoint.x, 0, WORLD_WIDTH)),
        y: snapToGrid(clampNumber(previewPoint.y, 0, WORLD_HEIGHT))
      };
      renderWires();
    }
  }

  function handlePointerUp(event) {
    var interaction = schematicState.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (isWireDragInteraction(interaction)) {
      var wire = findWire(interaction.wireId);
      var cancelled = event.type === "pointercancel";
      if (wire) {
        wire.route = cancelled ? cloneRoute(interaction.originalRoute) : cleanOrthogonalRoute(ensureWireRoute(wire));
      }
      releasePointer(interaction.pointerId);
      schematicState.interaction = null;
      renderWires();
      setStatus(cancelled ? "导线移动已取消" : (interaction.moved ? "导线已重新布线 · 拖动线段或拐点可继续调整" : "已选择导线 · 拖动线段或拐点，Delete 删除"));
      return;
    }
    if (interaction.kind === "drag-component") {
      var element = schematicState.componentElements.get(interaction.componentId);
      if (element) element.classList.remove("dragging");
      var component = schematicState.components.get(interaction.componentId);
      if (component) setStatus("已选择 " + component.ref + " · R 旋转 · F2 修改数值");
    }
    if (interaction.kind === "pan" && schematicNodes.viewport) schematicNodes.viewport.classList.remove("is-panning");
    releasePointer(interaction.pointerId);
    schematicState.interaction = null;
  }

  function updateTickUi() {
    if (schematicNodes.tickCount) schematicNodes.tickCount.textContent = String(schematicState.tick);
    if (schematicNodes.sampleCount) schematicNodes.sampleCount.textContent = schematicState.tick + " ticks";
    if (schematicNodes.circuitTime) schematicNodes.circuitTime.textContent = schematicState.time.toFixed(3) + " ms";
  }

  function setSignal(name, value) {
    var signal = normalizeSignalName(name);
    if (!signal) return false;
    if (signal === "VCC" || signal === "GND") return signal === "VCC";
    var physical = resolveMcuPinName(signal);
    if (physical) return driveMcuPin(physical, value);
    var high = toLogicValue(value);
    // Named peripheral signals remain observable for compatibility, but they do
    // not drive electrical nets without a concrete MCU pin mapping.
    schematicState.signals.set(signal, high);
    renderWires();
    if (schematicState.initialized) {
      document.dispatchEvent(new CustomEvent("alice:schematic-signal", { detail: { name: signal, value: high } }));
    }
    return high;
  }

  function modelUarts() {
    return peripheralRecords(schematicState.projectModel && schematicState.projectModel.uarts);
  }

  function decodeUartSenderPayload(value) {
    return String(value == null ? "" : value).replace(/\\x([0-9a-f]{2})|\\r|\\n|\\t|\\\\/gi, function (match, hexadecimal) {
      if (hexadecimal) return String.fromCharCode(parseInt(hexadecimal, 16));
      if (match === "\\r") return "\r";
      if (match === "\\n") return "\n";
      if (match === "\\t") return "\t";
      return "\\";
    });
  }

  function uartSenderBinding(component, compiled) {
    var txNet = netForEndpoint(compiled, { componentId: component.id, pin: "TX" });
    return modelUarts().find(function (uart) { return netHasMcuPin(txNet, uart.rxPin); }) || null;
  }

  function sendFromUartComponent(component, compiled, timeMs) {
    var runtime = component.uartRuntime || (component.uartRuntime = { sent: false, previousTrigger: 0, dueAt: null, lastSentAt: null, count: 0, error: "" });
    var binding = uartSenderBinding(component, compiled);
    if (!binding) {
      runtime.error = "TX 未连接到已配置 UART RX";
      updateUartSenderVisual(component);
      return false;
    }
    try {
      var payload = decodeUartSenderPayload(component.uartPayload);
      if (!window.AliceHalSimulator || typeof window.AliceHalSimulator.enqueueSerial !== "function") throw new Error("串口仿真尚未构建");
      window.AliceHalSimulator.enqueueSerial(payload, binding.instance || binding.handle);
      runtime.error = "";
      runtime.sent = true;
      runtime.lastSentAt = timeMs;
      runtime.count += 1;
      updateUartSenderVisual(component);
      if (schematicState.initialized) document.dispatchEvent(new CustomEvent("alice:uart-source-send", { detail: {
        componentId: component.id,
        ref: component.ref,
        instance: binding.instance || binding.handle || "UART",
        text: payload,
        configuredText: component.uartPayload,
        timeMs: timeMs,
        count: runtime.count
      } }));
      return true;
    } catch (error) {
      runtime.error = error && error.message || "串口发送失败";
      updateUartSenderVisual(component);
      return false;
    }
  }

  function processUartSenders(timeMs) {
    if (!schematicState.components.size) return;
    var compiled = compileNetlist();
    schematicState.components.forEach(function (component) {
      if (component.type !== "uartSender") return;
      var runtime = component.uartRuntime || (component.uartRuntime = { sent: false, previousTrigger: 0, dueAt: null, lastSentAt: null, count: 0, error: "" });
      var condition = normalizeUartSenderCondition(component.uartCondition);
      var delay = Math.max(0, Number(component.uartDelayMs) || 0);
      var triggerNet = netForEndpoint(compiled, { componentId: component.id, pin: "TRIG" });
      var trigger = triggerNet && !triggerNet.conflict && triggerNet.level === 1 ? 1 : 0;
      if (condition === "startup") {
        if (!runtime.sent && runtime.dueAt == null) runtime.dueAt = delay;
      } else if (condition === "periodic") {
        if (runtime.dueAt == null) runtime.dueAt = delay;
      } else if (condition === "rising") {
        if (trigger && !runtime.previousTrigger) runtime.dueAt = timeMs + delay;
      } else if (condition === "high") {
        if (!trigger) {
          runtime.sent = false;
          runtime.dueAt = null;
        } else if (!runtime.sent && runtime.dueAt == null) runtime.dueAt = timeMs + delay;
      }
      runtime.previousTrigger = trigger;
      if (runtime.dueAt == null || timeMs + 1e-9 < runtime.dueAt) return;
      var sent = sendFromUartComponent(component, compiled, timeMs);
      if (condition === "periodic") {
        var interval = Math.max(1, delay);
        runtime.dueAt += interval;
        while (runtime.dueAt <= timeMs) runtime.dueAt += interval;
      } else runtime.dueAt = null;
      if (!sent && condition === "startup") runtime.sent = false;
    });
  }

  function tickSimulation(time, tickNumber, options) {
    if (time && typeof time === "object") {
      options = time;
      tickNumber = time.tick;
      time = time.time;
    }
    options = options && typeof options === "object" ? options : {};
    var numericTime = Number(time);
    var numericTick = Number(tickNumber);
    if (Number.isFinite(numericTime)) schematicState.time = Math.max(0, numericTime);
    if (Number.isFinite(numericTick)) schematicState.tick = Math.max(0, Math.floor(numericTick));
    else schematicState.tick += 1;
    // PWM is time-dependent even when its compare register is unchanged.
    // Rebuild the netlist so digital samples follow the configured carrier.
    if (schematicState.mcuPwm.size) schematicState.compiledNetlist = null;
    processUartSenders(schematicState.time);
    if (options.render !== false) {
      updateTickUi();
      if (schematicNodes.mcuState) schematicNodes.mcuState.textContent = "RUNNING";
      if (schematicNodes.recordDot) schematicNodes.recordDot.classList.add("active");
      renderWires();
    }
    return { time: schematicState.time, tick: schematicState.tick };
  }

  function resetSimulation() {
    schematicState.signals.clear();
    schematicState.signals.set("VCC", true);
    schematicState.signals.set("GND", false);
    schematicState.mcuDrives.clear();
    schematicState.mcuPwm.clear();
    schematicState.components.forEach(function (component) {
      var device = componentDevice(component);
      if (component.type === "oled" && device && typeof device.reset === "function") {
        device.reset({ address: component.oledAddress });
        updateOledVisual(component);
      } else if (component.type === "spiDisplay" && device && typeof device.reset === "function") {
        device.reset();
        updateSpiDisplayVisual(component);
      } else if (component.type === "uartSender") {
        component.uartRuntime = { sent: false, previousTrigger: 0, dueAt: null, lastSentAt: null, count: 0, error: "" };
        updateUartSenderVisual(component);
      }
    });
    schematicState.firmwareOutputs.forEach(function (output) {
      if (output.initialLevel == null) return;
      schematicState.mcuDrives.set(output.pin, output.initialLevel);
      schematicState.signals.set(output.pin, Boolean(output.initialLevel));
    });
    schematicState.compiledNetlist = null;
    schematicState.time = 0;
    schematicState.tick = 0;
    cancelActiveInteraction(false);
    cancelWire();
    updateTickUi();
    if (schematicNodes.mcuState) schematicNodes.mcuState.textContent = "IDLE";
    if (schematicNodes.recordDot) schematicNodes.recordDot.classList.remove("active");
    if (schematicNodes.cpuLoad) schematicNodes.cpuLoad.textContent = "0.0%";
    renderWires();
    if (schematicState.initialized) document.dispatchEvent(new CustomEvent("alice:schematic-reset"));
    return true;
  }

  function circuitFormatError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function requireCircuitRecord(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw circuitFormatError("INVALID_RECORD", label + " must be an object.");
    }
    return value;
  }

  function circuitText(value, label, maximumLength, allowEmpty) {
    if (typeof value !== "string") throw circuitFormatError("INVALID_TEXT", label + " must be text.");
    if (!allowEmpty && !value.trim()) throw circuitFormatError("EMPTY_TEXT", label + " cannot be empty.");
    if (value.length > maximumLength) throw circuitFormatError("TEXT_TOO_LONG", label + " is too long.");
    if (/[\u0000-\u001f\u007f]/.test(value)) throw circuitFormatError("CONTROL_CHARACTER", label + " contains a control character.");
    return value;
  }

  function circuitIdentifier(value, label) {
    var identifier = circuitText(value, label, 96, false).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(identifier)) {
      throw circuitFormatError("INVALID_IDENTIFIER", label + " contains unsupported characters.");
    }
    return identifier;
  }

  function circuitNumber(value, label, minimum, maximum, fallback) {
    if (value == null && fallback != null) return fallback;
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) throw circuitFormatError("INVALID_NUMBER", label + " must be a finite number.");
    if (numeric < minimum || numeric > maximum) throw circuitFormatError("NUMBER_OUT_OF_RANGE", label + " is outside the supported range.");
    return numeric;
  }

  function circuitBoolean(value, label, fallback) {
    if (value == null) return Boolean(fallback);
    if (typeof value !== "boolean") throw circuitFormatError("INVALID_BOOLEAN", label + " must be true or false.");
    return value;
  }

  function normalizeCircuitAddress(value, fallback) {
    if (value == null) return normalizeOledAddress(fallback);
    var numeric = typeof value === "string" && /^0x[0-9a-f]+$/i.test(value.trim()) ? parseInt(value, 16) : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0x03 || numeric > 0x77) {
      throw circuitFormatError("INVALID_OLED_ADDRESS", "OLED address must be a 7-bit I2C address from 0x03 to 0x77.");
    }
    return Math.floor(numeric);
  }

  function normalizeSavedComponent(input, index) {
    var source = requireCircuitRecord(input, "components[" + index + "]");
    var id = circuitIdentifier(source.id, "components[" + index + "].id");
    var type = circuitText(source.type, "components[" + index + "].type", 32, false).trim();
    if (!Object.prototype.hasOwnProperty.call(componentDefinitions, type)) {
      throw circuitFormatError("UNSUPPORTED_COMPONENT", "Unsupported component type: " + type);
    }
    var rawRotation = circuitNumber(source.rotation, "components[" + index + "].rotation", -360000, 360000, 0);
    if (Math.abs(rawRotation / 90 - Math.round(rawRotation / 90)) > 0.000001) {
      throw circuitFormatError("INVALID_ROTATION", "Component rotation must use 90 degree steps.");
    }
    var component = {
      id: id,
      type: type,
      ref: circuitText(source.ref, "components[" + index + "].ref", 64, false).trim(),
      value: circuitText(source.value, "components[" + index + "].value", 256, false),
      x: circuitNumber(source.x, "components[" + index + "].x", 0, WORLD_WIDTH, 0),
      y: circuitNumber(source.y, "components[" + index + "].y", 0, WORLD_HEIGHT, 0),
      rotation: normalizeRotation(rawRotation),
      autoGenerated: circuitBoolean(source.autoGenerated, "components[" + index + "].autoGenerated", false),
      autoSource: source.autoSource == null ? "" : circuitText(source.autoSource, "components[" + index + "].autoSource", 96, true),
      autoKey: source.autoKey == null ? "" : circuitText(source.autoKey, "components[" + index + "].autoKey", 128, true),
      codeLabel: source.codeLabel == null ? "" : circuitText(source.codeLabel, "components[" + index + "].codeLabel", 128, true),
      ledColor: source.ledColor == null ? "" : circuitText(source.ledColor, "components[" + index + "].ledColor", 32, true)
    };
    if (type === "button") {
      component.buttonClosed = circuitBoolean(source.buttonClosed, "components[" + index + "].buttonClosed", /^(?:ON|CLOSED|1)$/i.test(component.value));
      component.value = component.buttonClosed ? "ON" : "OFF";
    }
    if (type === "netTerminal") {
      component.value = normalizeNetLabel(component.value);
      if (!component.value) throw circuitFormatError("INVALID_NET_LABEL", "Network terminal label is invalid.");
    }
    if (type === "oled") {
      component.oledAddress = normalizeCircuitAddress(source.oledAddress, oledAddressFromValue(component.value, 0x3c));
    } else if (type === "adcSource") {
      component.adcReferenceVoltage = circuitNumber(source.adcReferenceVoltage, "components[" + index + "].adcReferenceVoltage", 0.1, 100, 3.3);
      component.adcBits = Math.round(circuitNumber(source.adcBits, "components[" + index + "].adcBits", 1, 24, 12));
      component.adcVoltage = circuitNumber(source.adcVoltage, "components[" + index + "].adcVoltage", 0, component.adcReferenceVoltage, normalizeAdcSourceVoltage(component.value, component.adcReferenceVoltage / 2, component.adcReferenceVoltage));
      component.value = formatAdcSourceValue(component.adcVoltage);
    } else if (type === "uartSender") {
      component.uartPayload = source.uartPayload == null ? "Hello from AliceSIM\\r\\n" : circuitText(source.uartPayload, "components[" + index + "].uartPayload", 512, false);
      component.uartCondition = normalizeUartSenderCondition(source.uartCondition);
      component.uartDelayMs = circuitNumber(source.uartDelayMs, "components[" + index + "].uartDelayMs", 0, 3600000, 1000);
      component.value = uartSenderConditionLabel(component.uartCondition) + " · " + Math.round(component.uartDelayMs) + " ms";
    } else if (type === "lightSensor") {
      component.lux = circuitNumber(source.lux, "components[" + index + "].lux", 0, 100000, normalizeLuxValue(component.value, 500));
      component.thresholdLux = circuitNumber(source.thresholdLux, "components[" + index + "].thresholdLux", 0, 100000, 1000);
      component.adcBits = Math.round(circuitNumber(source.adcBits, "components[" + index + "].adcBits", 1, 24, 12));
      component.adcReferenceVoltage = circuitNumber(source.adcReferenceVoltage, "components[" + index + "].adcReferenceVoltage", 0.1, 100, 3.3);
      component.supplyVoltage = circuitNumber(source.supplyVoltage, "components[" + index + "].supplyVoltage", 0.1, 100, 3.3);
      component.minOperatingVoltage = circuitNumber(source.minOperatingVoltage, "components[" + index + "].minOperatingVoltage", 0.1, 100, 2.4);
      component.maxOperatingVoltage = circuitNumber(source.maxOperatingVoltage, "components[" + index + "].maxOperatingVoltage", 0.1, 100, 5.5);
      if (component.maxOperatingVoltage < component.minOperatingVoltage) {
        throw circuitFormatError("INVALID_SENSOR_VOLTAGE", "Light sensor maximum operating voltage cannot be below its minimum.");
      }
      component.sensorGamma = circuitNumber(source.sensorGamma == null ? source.gamma : source.sensorGamma, "components[" + index + "].sensorGamma", 0.05, 10, 1);
      component.analogInverted = circuitBoolean(source.analogInverted, "components[" + index + "].analogInverted", false);
      component.digitalActiveLow = circuitBoolean(source.digitalActiveLow, "components[" + index + "].digitalActiveLow", false);
      component.value = Math.round(component.lux) + " lux";
    } else if (catalogDefinition(type)) {
      var savedProperties = source.peripheralProperties == null ? (source.properties == null ? {} : requireCircuitRecord(source.properties, "components[" + index + "].properties")) : requireCircuitRecord(source.peripheralProperties, "components[" + index + "].peripheralProperties");
      component.peripheralProperties = {};
      (catalogDefinition(type).controls || []).forEach(function (control) {
        component.peripheralProperties[control.key] = circuitNumber(savedProperties[control.key], "components[" + index + "].peripheralProperties." + control.key, Number(control.min), Number(control.max), Number(control.value) || 0);
      });
      component.value = formatCatalogValue(type, component.peripheralProperties);
    }
    return component;
  }

  function normalizeSavedEndpoint(input, label) {
    var source = requireCircuitRecord(input, label);
    return {
      componentId: circuitIdentifier(source.componentId, label + ".componentId"),
      pin: circuitText(source.pin, label + ".pin", 64, false).trim()
    };
  }

  function normalizeSavedRoute(input, label) {
    if (!Array.isArray(input) || input.length < 2 || input.length > MAX_WIRE_ROUTE_POINTS) {
      throw circuitFormatError("INVALID_ROUTE", label + " must contain 2 to " + MAX_WIRE_ROUTE_POINTS + " points.");
    }
    var route = input.map(function (item, index) {
      var point = requireCircuitRecord(item, label + "[" + index + "]");
      return {
        x: circuitNumber(point.x, label + "[" + index + "].x", 0, WORLD_WIDTH, 0),
        y: circuitNumber(point.y, label + "[" + index + "].y", 0, WORLD_HEIGHT, 0)
      };
    });
    if (!routeIsOrthogonal(route)) throw circuitFormatError("NON_ORTHOGONAL_ROUTE", label + " must contain only horizontal and vertical segments.");
    return route;
  }

  function normalizeSavedWire(input, index) {
    var source = requireCircuitRecord(input, "wires[" + index + "]");
    return {
      id: circuitIdentifier(source.id, "wires[" + index + "].id"),
      from: normalizeSavedEndpoint(source.from, "wires[" + index + "].from"),
      to: normalizeSavedEndpoint(source.to, "wires[" + index + "].to"),
      signal: source.signal == null ? "" : normalizeSignalName(circuitText(source.signal, "wires[" + index + "].signal", 128, true)),
      route: normalizeSavedRoute(source.route, "wires[" + index + "].route"),
      autoGenerated: circuitBoolean(source.autoGenerated, "wires[" + index + "].autoGenerated", false),
      autoSource: source.autoSource == null ? "" : circuitText(source.autoSource, "wires[" + index + "].autoSource", 96, true),
      autoKey: source.autoKey == null ? "" : circuitText(source.autoKey, "wires[" + index + "].autoKey", 128, true)
    };
  }

  function parseCircuitSource(input) {
    if (typeof input !== "string") return requireCircuitRecord(input, "Circuit document");
    if (input.length > MAX_CIRCUIT_JSON_LENGTH) throw circuitFormatError("CIRCUIT_TOO_LARGE", "Circuit file is too large.");
    try {
      return requireCircuitRecord(JSON.parse(input), "Circuit document");
    } catch (error) {
      if (error && error.code) throw error;
      throw circuitFormatError("INVALID_JSON", "Circuit file is not valid JSON: " + error.message);
    }
  }

  function normalizeCircuitDocument(input) {
    var source = parseCircuitSource(input);
    if (Number(source.schemaVersion) !== CIRCUIT_SCHEMA_VERSION) {
      throw circuitFormatError("UNSUPPORTED_SCHEMA", "Unsupported AliceSIM circuit schema version.");
    }
    if (source.kind !== CIRCUIT_KIND) throw circuitFormatError("INVALID_KIND", "This file is not an AliceSIM circuit.");
    var mcu = circuitText(source.mcu, "mcu", 96, false).trim();
    if (!Array.isArray(source.components) || source.components.length > MAX_CIRCUIT_COMPONENTS) {
      throw circuitFormatError("INVALID_COMPONENTS", "components must be an array with at most " + MAX_CIRCUIT_COMPONENTS + " entries.");
    }
    if (!Array.isArray(source.wires) || source.wires.length > MAX_CIRCUIT_WIRES) {
      throw circuitFormatError("INVALID_WIRES", "wires must be an array with at most " + MAX_CIRCUIT_WIRES + " entries.");
    }
    var viewSource = source.view == null ? {} : requireCircuitRecord(source.view, "view");
    var view = {
      zoom: circuitNumber(viewSource.zoom, "view.zoom", 0.25, 2.4, 1),
      panX: circuitNumber(viewSource.panX, "view.panX", -100000, 100000, 0),
      panY: circuitNumber(viewSource.panY, "view.panY", -100000, 100000, 0),
      userView: circuitBoolean(viewSource.userView, "view.userView", true)
    };
    var componentIds = new Set();
    var components = source.components.map(function (item, index) {
      var component = normalizeSavedComponent(item, index);
      if (componentIds.has(component.id)) throw circuitFormatError("DUPLICATE_COMPONENT_ID", "Duplicate component id: " + component.id);
      componentIds.add(component.id);
      return component;
    });
    if (components.filter(function (component) { return component.type === "mcu"; }).length > 1) {
      throw circuitFormatError("MULTIPLE_MCU_COMPONENTS", "An AliceSIM circuit can contain at most one MCU module.");
    }
    var componentsById = new Map(components.map(function (component) { return [component.id, component]; }));
    var wireIds = new Set();
    var endpointPairs = new Set();
    var wires = source.wires.map(function (item, index) {
      var wire = normalizeSavedWire(item, index);
      if (wireIds.has(wire.id)) throw circuitFormatError("DUPLICATE_WIRE_ID", "Duplicate wire id: " + wire.id);
      wireIds.add(wire.id);
      var fromComponent = componentsById.get(wire.from.componentId);
      var toComponent = componentsById.get(wire.to.componentId);
      if (!fromComponent || !toComponent) throw circuitFormatError("MISSING_WIRE_COMPONENT", "Wire " + wire.id + " references a missing component.");
      if (sameEndpoint(wire.from, wire.to)) throw circuitFormatError("SELF_WIRE", "Wire " + wire.id + " connects an endpoint to itself.");
      [
        { endpoint: wire.from, component: fromComponent },
        { endpoint: wire.to, component: toComponent }
      ].forEach(function (entry) {
        if (entry.component.type === "mcu") return;
        var definition = componentDefinitions[entry.component.type];
        if (!definition.pins.some(function (pin) { return pin.name === entry.endpoint.pin; })) {
          throw circuitFormatError("INVALID_COMPONENT_PIN", "Wire " + wire.id + " references an unknown " + entry.component.type + " pin: " + entry.endpoint.pin);
        }
      });
      var fromKey = endpointKey(wire.from);
      var toKey = endpointKey(wire.to);
      var pairKey = fromKey < toKey ? fromKey + "|" + toKey : toKey + "|" + fromKey;
      if (endpointPairs.has(pairKey)) throw circuitFormatError("DUPLICATE_WIRE", "Duplicate connection in wire " + wire.id + ".");
      endpointPairs.add(pairKey);
      return wire;
    });
    return {
      schemaVersion: CIRCUIT_SCHEMA_VERSION,
      kind: CIRCUIT_KIND,
      mcu: mcu,
      components: components,
      wires: wires,
      view: view
    };
  }

  function exportComponent(component) {
    var exported = {
      id: component.id,
      type: component.type,
      ref: component.ref,
      value: component.value,
      x: component.x,
      y: component.y,
      rotation: normalizeRotation(component.rotation),
      autoGenerated: Boolean(component.autoGenerated),
      autoSource: component.autoSource || "",
      autoKey: component.autoKey || "",
      codeLabel: component.codeLabel || "",
      ledColor: component.ledColor || ""
    };
    if (component.type === "voltageProbe" || component.type === "currentProbe") exported.value = componentDefinitions[component.type].value;
    if (component.type === "button") {
      exported.buttonClosed = Boolean(component.buttonClosed);
      exported.value = exported.buttonClosed ? "ON" : "OFF";
    }
    if (component.type === "oled") {
      exported.oledAddress = normalizeOledAddress(component.oledAddress);
    } else if (component.type === "adcSource") {
      exported.adcVoltage = normalizeAdcSourceVoltage(component.adcVoltage, 1.65, component.adcReferenceVoltage);
      exported.adcReferenceVoltage = Math.max(0.1, Number(component.adcReferenceVoltage) || 3.3);
      exported.adcBits = clampNumber(Math.round(Number(component.adcBits) || 12), 1, 24);
      exported.value = formatAdcSourceValue(exported.adcVoltage);
    } else if (component.type === "uartSender") {
      exported.uartPayload = String(component.uartPayload || "").slice(0, 512);
      exported.uartCondition = normalizeUartSenderCondition(component.uartCondition);
      exported.uartDelayMs = clampNumber(Number(component.uartDelayMs) || 0, 0, 3600000);
      exported.value = formatUartSenderValue(component);
    } else if (component.type === "lightSensor") {
      exported.lux = normalizeLuxValue(component.lux, 500);
      exported.thresholdLux = normalizeLuxValue(component.thresholdLux, 1000);
      exported.adcBits = clampNumber(Math.round(Number(component.adcBits) || 12), 1, 24);
      exported.adcReferenceVoltage = Math.max(0.1, Number(component.adcReferenceVoltage) || 3.3);
      exported.supplyVoltage = Math.max(0.1, Number(component.supplyVoltage) || 3.3);
      exported.minOperatingVoltage = Math.max(0.1, Number(component.minOperatingVoltage) || 2.4);
      exported.maxOperatingVoltage = Math.max(exported.minOperatingVoltage, Number(component.maxOperatingVoltage) || 5.5);
      exported.sensorGamma = clampNumber(Number(component.sensorGamma) || 1, 0.05, 10);
      exported.analogInverted = Boolean(component.analogInverted);
      exported.digitalActiveLow = Boolean(component.digitalActiveLow);
    } else if (catalogDefinition(component.type)) {
      exported.peripheralProperties = Object.assign({}, normalizeCatalogProperties(component.type, component.peripheralProperties));
    }
    return exported;
  }

  function exportCircuit() {
    return {
      schemaVersion: CIRCUIT_SCHEMA_VERSION,
      kind: CIRCUIT_KIND,
      mcu: String(componentDefinitions.mcu.value || "STM32F103C8T6"),
      components: Array.from(schematicState.components.values()).map(exportComponent),
      wires: schematicState.wires.map(function (wire) {
        return {
          id: wire.id,
          from: { componentId: wire.from.componentId, pin: wire.from.pin },
          to: { componentId: wire.to.componentId, pin: wire.to.pin },
          signal: wire.signal || "",
          route: cloneRoute(ensureWireRoute(wire)),
          autoGenerated: Boolean(wire.autoGenerated),
          autoSource: wire.autoSource || "",
          autoKey: wire.autoKey || ""
        };
      }),
      view: {
        zoom: schematicState.zoom,
        panX: schematicState.panX,
        panY: schematicState.panY,
        userView: Boolean(schematicState.userView)
      }
    };
  }

  function serializeCircuit(payload, spacing) {
    var source = payload;
    var indentation = spacing;
    if (typeof payload === "number" && spacing == null) {
      indentation = payload;
      source = null;
    }
    if (source == null) source = exportCircuit();
    var normalized = normalizeCircuitDocument(source);
    var spaces = indentation == null ? 2 : clampNumber(Math.round(Number(indentation) || 0), 0, 10);
    return JSON.stringify(normalized, null, spaces);
  }

  function circuitFilename(filename) {
    var value = String(filename == null ? "AliceSIM-circuit" : filename).trim();
    value = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "");
    if (!value) value = "AliceSIM-circuit";
    if (!value.toLowerCase().endsWith(CIRCUIT_FILE_EXTENSION)) value += CIRCUIT_FILE_EXTENSION;
    return value;
  }

  function downloadCircuit(filename) {
    var content = serializeCircuit();
    var resolvedFilename = circuitFilename(filename);
    if (typeof Blob !== "function" || !window.URL || typeof window.URL.createObjectURL !== "function" || !document.body) {
      return { ok: false, code: "DOWNLOAD_UNAVAILABLE", error: "This browser cannot download circuit files.", filename: resolvedFilename, content: content };
    }
    var blob = new Blob([content], { type: "application/json;charset=utf-8" });
    var url = window.URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = resolvedFilename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
    var detail = { filename: resolvedFilename, bytes: blob.size, schemaVersion: CIRCUIT_SCHEMA_VERSION };
    if (schematicState.initialized) document.dispatchEvent(new CustomEvent("alice:schematic-saved", { detail: detail }));
    return Object.assign({ ok: true }, detail);
  }

  function reusableComponentId(name) {
    var slug = String(name || "component").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    return slug || "component";
  }

  function circuitContentBounds(circuit) {
    var components = circuit && Array.isArray(circuit.components) ? circuit.components : [];
    if (!components.length) return { x: 0, y: 0, width: 0, height: 0 };
    var minimumX = WORLD_WIDTH;
    var minimumY = WORLD_HEIGHT;
    var maximumX = 0;
    var maximumY = 0;
    components.forEach(function (component) {
      var definition = componentDefinitions[component.type];
      var size = definition ? componentSizeForRotation(definition, component.rotation) : { width: 0, height: 0 };
      minimumX = Math.min(minimumX, component.x);
      minimumY = Math.min(minimumY, component.y);
      maximumX = Math.max(maximumX, component.x + size.width);
      maximumY = Math.max(maximumY, component.y + size.height);
    });
    return {
      x: Math.round(minimumX),
      y: Math.round(minimumY),
      width: Math.max(0, Math.round(maximumX - minimumX)),
      height: Math.max(0, Math.round(maximumY - minimumY))
    };
  }

  function componentPortRole(label, net) {
    var normalized = normalizeSignalName(label);
    if (/(^|_)(GND|VSS|AGND|DGND|0V)($|_)/.test(normalized)) return "ground";
    if (/(^|_)(VCC|VDD|VIN|VBAT|POWER|3V3|5V|12V|24V)($|_)/.test(normalized)) return "power";
    var roles = new Set();
    (net && net.endpoints || []).forEach(function (endpoint) {
      var found = getPinDefinition(endpoint);
      if (found && found.pin && found.pin.role) roles.add(found.pin.role);
    });
    if (roles.has("ground")) return "ground";
    if (roles.has("power")) return "power";
    if (roles.has("analog") || roles.has("analog2")) return "analog";
    return "signal";
  }

  function extractReusableComponentPorts(circuit) {
    var compiled = schematicState.compiledNetlist || compileNetlist();
    var groups = new Map();
    (circuit.components || []).forEach(function (component) {
      if (component.type !== "netTerminal") return;
      var name = normalizeNetLabel(component.value);
      var electricalKey = normalizeSignalName(name);
      if (!name || !electricalKey) return;
      if (!groups.has(electricalKey)) groups.set(electricalKey, { name: name, terminalIds: [] });
      groups.get(electricalKey).terminalIds.push(component.id);
    });
    return Array.from(groups.values()).sort(function (left, right) { return left.name.localeCompare(right.name); }).map(function (group, index) {
      var name = group.name;
      var terminalIds = group.terminalIds;
      var netId = compiled.endpointToNet[terminalIds[0] + ":NET"];
      var net = compiled.netById.get(netId);
      var drivenInternally = Boolean(net && (net.drivers || []).concat(net.analogDrivers || []).some(function (driver) {
        return terminalIds.indexOf(driver.componentId) < 0;
      }));
      var role = componentPortRole(name, net);
      return {
        id: "port-" + (index + 1),
        name: name,
        role: role,
        direction: drivenInternally ? "output" : (role === "power" || role === "ground" ? "input" : "bidirectional"),
        terminalIds: terminalIds.slice().sort()
      };
    });
  }

  function exportComponentPackage(options) {
    var config = options && typeof options === "object" ? options : {};
    var circuit = normalizeCircuitDocument(exportCircuit());
    var name = String(config.name || "Untitled Component").trim() || "Untitled Component";
    var prefix = String(config.prefix || "MOD").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 8) || "MOD";
    var version = String(config.version || "1.0.0").trim() || "1.0.0";
    var description = String(config.description || "").trim().slice(0, 500);
    var ports = extractReusableComponentPorts(circuit);
    return {
      schemaVersion: COMPONENT_SCHEMA_VERSION,
      kind: COMPONENT_KIND,
      component: {
        id: reusableComponentId(config.id || name),
        name: name.slice(0, 96),
        prefix: prefix,
        version: version.slice(0, 32),
        description: description,
        ports: ports,
        bounds: circuitContentBounds(circuit),
        componentCount: circuit.components.length,
        wireCount: circuit.wires.length
      },
      circuit: circuit
    };
  }

  function parseComponentPackageSource(input) {
    if (typeof input !== "string") return requireCircuitRecord(input, "Component package");
    if (input.length > MAX_CIRCUIT_JSON_LENGTH) throw circuitFormatError("COMPONENT_TOO_LARGE", "Component package is too large.");
    try {
      return requireCircuitRecord(JSON.parse(input), "Component package");
    } catch (error) {
      if (error && error.code) throw error;
      throw circuitFormatError("INVALID_COMPONENT_JSON", "Component package is not valid JSON: " + error.message);
    }
  }

  function normalizeComponentPackage(input) {
    var source = parseComponentPackageSource(input);
    if (Number(source.schemaVersion) !== COMPONENT_SCHEMA_VERSION) throw circuitFormatError("UNSUPPORTED_COMPONENT_SCHEMA", "Unsupported AliceSIM component schema version.");
    if (source.kind !== COMPONENT_KIND) throw circuitFormatError("INVALID_COMPONENT_KIND", "This file is not an AliceSIM component package.");
    var metadata = requireCircuitRecord(source.component, "component");
    var circuit = normalizeCircuitDocument(source.circuit);
    var id = circuitText(metadata.id, "component.id", 96, false).trim();
    var name = circuitText(metadata.name, "component.name", 96, false).trim();
    var prefix = circuitText(metadata.prefix, "component.prefix", 8, false).trim().toUpperCase();
    var version = circuitText(metadata.version, "component.version", 32, false).trim();
    var description = metadata.description == null ? "" : circuitText(metadata.description, "component.description", 500, true).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw circuitFormatError("INVALID_COMPONENT_ID", "component.id must use lowercase letters, numbers and hyphens.");
    if (!/^[A-Z][A-Z0-9_]{0,7}$/.test(prefix)) throw circuitFormatError("INVALID_COMPONENT_PREFIX", "component.prefix must start with a letter and contain at most 8 uppercase characters.");
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw circuitFormatError("INVALID_COMPONENT_VERSION", "component.version must use semantic version format, for example 1.0.0.");
    if (!Array.isArray(metadata.ports) || metadata.ports.length > 256) throw circuitFormatError("INVALID_COMPONENT_PORTS", "component.ports must be an array with at most 256 entries.");
    var terminals = new Map(circuit.components.filter(function (component) { return component.type === "netTerminal"; }).map(function (component) {
      return [component.id, normalizeNetLabel(component.value)];
    }));
    var portIds = new Set();
    var portNames = new Set();
    var ports = metadata.ports.map(function (item, index) {
      var port = requireCircuitRecord(item, "component.ports[" + index + "]");
      var portId = circuitIdentifier(port.id, "component.ports[" + index + "].id");
      var portName = normalizeNetLabel(circuitText(port.name, "component.ports[" + index + "].name", 96, false));
      if (!portName) throw circuitFormatError("INVALID_COMPONENT_PORT_NAME", "Component port name is invalid.");
      var role = circuitText(port.role, "component.ports[" + index + "].role", 24, false).trim();
      var direction = circuitText(port.direction, "component.ports[" + index + "].direction", 24, false).trim();
      if (portIds.has(portId)) throw circuitFormatError("DUPLICATE_COMPONENT_PORT_ID", "Duplicate component port id: " + portId);
      if (portNames.has(portName)) throw circuitFormatError("DUPLICATE_COMPONENT_PORT_NAME", "Duplicate component port name: " + portName);
      if (["power", "ground", "analog", "signal"].indexOf(role) < 0) throw circuitFormatError("INVALID_COMPONENT_PORT_ROLE", "Unsupported component port role: " + role);
      if (["input", "output", "bidirectional"].indexOf(direction) < 0) throw circuitFormatError("INVALID_COMPONENT_PORT_DIRECTION", "Unsupported component port direction: " + direction);
      if (!Array.isArray(port.terminalIds) || !port.terminalIds.length) throw circuitFormatError("MISSING_COMPONENT_TERMINALS", "Each component port must reference at least one network terminal.");
      var terminalIds = port.terminalIds.map(function (terminalId, terminalIndex) {
        var normalizedId = circuitIdentifier(terminalId, "component.ports[" + index + "].terminalIds[" + terminalIndex + "]");
        if (!terminals.has(normalizedId)) throw circuitFormatError("UNKNOWN_COMPONENT_TERMINAL", "Component port references an unknown network terminal: " + normalizedId);
        if (terminals.get(normalizedId) !== portName) throw circuitFormatError("COMPONENT_PORT_LABEL_MISMATCH", "Component port name does not match terminal " + normalizedId + ".");
        return normalizedId;
      });
      portIds.add(portId);
      portNames.add(portName);
      return { id: portId, name: portName, role: role, direction: direction, terminalIds: Array.from(new Set(terminalIds)).sort() };
    });
    return {
      schemaVersion: COMPONENT_SCHEMA_VERSION,
      kind: COMPONENT_KIND,
      component: {
        id: id,
        name: name,
        prefix: prefix,
        version: version,
        description: description,
        ports: ports,
        bounds: circuitContentBounds(circuit),
        componentCount: circuit.components.length,
        wireCount: circuit.wires.length
      },
      circuit: circuit
    };
  }

  function serializeComponentPackage(payload, spacing) {
    var source = payload;
    var indentation = spacing;
    if (typeof payload === "number" && spacing == null) {
      indentation = payload;
      source = null;
    }
    if (source == null) source = exportComponentPackage();
    var normalized = normalizeComponentPackage(source);
    var spaces = indentation == null ? 2 : clampNumber(Math.round(Number(indentation) || 0), 0, 10);
    return JSON.stringify(normalized, null, spaces);
  }

  function componentPackageFilename(filename) {
    var value = String(filename == null ? "AliceSIM-component" : filename).trim();
    value = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "");
    if (!value) value = "AliceSIM-component";
    if (!value.toLowerCase().endsWith(COMPONENT_FILE_EXTENSION)) value += COMPONENT_FILE_EXTENSION;
    return value;
  }

  function downloadComponentPackage(filename, options) {
    var payload = exportComponentPackage(options);
    var content = serializeComponentPackage(payload);
    var resolvedFilename = componentPackageFilename(filename || payload.component.name);
    if (typeof Blob !== "function" || !window.URL || typeof window.URL.createObjectURL !== "function" || !document.body) {
      return { ok: false, code: "DOWNLOAD_UNAVAILABLE", error: "This browser cannot download component packages.", filename: resolvedFilename, content: content, component: payload.component };
    }
    var blob = new Blob([content], { type: "application/json;charset=utf-8" });
    var url = window.URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = resolvedFilename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
    var detail = { filename: resolvedFilename, bytes: blob.size, schemaVersion: COMPONENT_SCHEMA_VERSION, component: payload.component };
    if (schematicState.initialized) document.dispatchEvent(new CustomEvent("alice:component-saved", { detail: detail }));
    return Object.assign({ ok: true, content: content }, detail);
  }

  function inspectComponentPackage(input) {
    try {
      var payload = normalizeComponentPackage(input);
      return { ok: true, schemaVersion: payload.schemaVersion, kind: payload.kind, component: payload.component, circuit: payload.circuit };
    } catch (error) {
      return { ok: false, code: error && error.code || "INVALID_COMPONENT_PACKAGE", error: error && error.message || String(error) };
    }
  }

  function prepareCircuitImport(documentModel) {
    var existingMcuComponents = Array.from(schematicState.components.values()).filter(function (component) { return component.type === "mcu"; });
    var savedMcu = documentModel.components.find(function (component) { return component.type === "mcu"; }) || null;
    var targetMcu = null;
    if (savedMcu) {
      targetMcu = existingMcuComponents.find(function (component) { return component.id === savedMcu.id; }) || existingMcuComponents[0] || null;
    }
    var protectedMcuIds = new Set(existingMcuComponents.map(function (component) { return component.id; }));
    documentModel.components.forEach(function (component) {
      if (component.type !== "mcu" && protectedMcuIds.has(component.id)) {
        throw circuitFormatError("PROTECTED_MCU_ID", "Component id " + component.id + " is reserved by the IOC-controlled MCU module.");
      }
    });
    var componentIdMap = new Map();
    documentModel.components.forEach(function (component) { componentIdMap.set(component.id, component.id); });
    if (savedMcu && targetMcu) componentIdMap.set(savedMcu.id, targetMcu.id);
    var componentsById = new Map(documentModel.components.map(function (component) { return [component.id, component]; }));
    var warnings = [];
    var skippedWires = [];
    var plannedWires = [];
    var mappedPairs = new Set();
    var activeMcu = String(componentDefinitions.mcu.value || "STM32F103C8T6");
    var savedMcuMatchesActive = normalizeSignalName(documentModel.mcu) === normalizeSignalName(activeMcu);
    var activeProjectPins = normalizeProjectPins(schematicState.projectModel || {});
    var deferMatchingMcuPinValidation = savedMcuMatchesActive && activeProjectPins.length === 0;
    documentModel.wires.forEach(function (wire) {
      var incompatiblePins = [];
      [wire.from, wire.to].forEach(function (endpoint) {
        var component = componentsById.get(endpoint.componentId);
        var definition = componentDefinitions[component.type];
        if (component.type !== "mcu" || definition.pins.some(function (pin) { return pin.name === endpoint.pin; })) return;
        if (deferMatchingMcuPinValidation && isStm32F103C8GpioPin(endpoint.pin)) return;
        incompatiblePins.push(endpoint.pin);
      });
      if (incompatiblePins.length) {
        var message = "Skipped wire " + wire.id + " because IOC does not expose MCU pin " + incompatiblePins.join(", ") + ".";
        warnings.push(message);
        skippedWires.push({ id: wire.id, reason: "ioc-pin-unavailable", pins: incompatiblePins.slice() });
        return;
      }
      var mapped = Object.assign({}, wire, {
        from: { componentId: componentIdMap.get(wire.from.componentId), pin: wire.from.pin },
        to: { componentId: componentIdMap.get(wire.to.componentId), pin: wire.to.pin },
        route: cloneRoute(wire.route)
      });
      var fromKey = endpointKey(mapped.from);
      var toKey = endpointKey(mapped.to);
      var pairKey = fromKey < toKey ? fromKey + "|" + toKey : toKey + "|" + fromKey;
      if (mappedPairs.has(pairKey)) throw circuitFormatError("DUPLICATE_MAPPED_WIRE", "Multiple saved wires map to the same protected MCU connection.");
      mappedPairs.add(pairKey);
      plannedWires.push(mapped);
    });
    if (documentModel.mcu !== activeMcu) warnings.push("Saved MCU " + documentModel.mcu + " was not applied; the active IOC MCU remains " + activeMcu + ".");
    return {
      model: documentModel,
      savedMcu: savedMcu,
      targetMcu: targetMcu,
      componentIdMap: componentIdMap,
      wires: plannedWires,
      warnings: warnings,
      skippedWires: skippedWires
    };
  }

  function clearCircuitForImport() {
    cancelActiveInteraction(false);
    schematicState.wireStart = null;
    schematicState.previewPoint = null;
    if (schematicState.editingComponentId) closeComponentProperties(false);
    schematicState.components.forEach(function (component) {
      if (component.type === "mcu") return;
      var element = schematicState.componentElements.get(component.id);
      if (element) element.remove();
      schematicState.componentElements.delete(component.id);
      schematicState.components.delete(component.id);
    });
    schematicState.devices.clear();
    schematicState.wires = [];
    schematicState.selection = null;
    schematicState.interaction = null;
    schematicState.compiledNetlist = null;
    schematicState.addOffset = 0;
  }

  function applySavedMcuComponent(component, saved) {
    var definition = componentDefinitions.mcu;
    component.rotation = normalizeRotation(saved.rotation);
    var size = componentSizeForRotation(definition, component.rotation);
    component.width = size.width;
    component.height = size.height;
    component.x = snapToGrid(clampNumber(saved.x, 0, WORLD_WIDTH - size.width));
    component.y = snapToGrid(clampNumber(saved.y, 0, WORLD_HEIGHT - size.height));
    component.ref = saved.ref;
    component.value = definition.value;
    if (schematicState.initialized) renderComponent(component);
    return component;
  }

  function createSavedComponent(saved) {
    return createComponentModel(saved.type, saved.x, saved.y, {
      id: saved.id,
      rotation: saved.rotation,
      ref: saved.ref,
      value: saved.value,
      autoGenerated: saved.autoGenerated,
      autoSource: saved.autoSource,
      autoKey: saved.autoKey,
      codeLabel: saved.codeLabel,
      ledColor: saved.ledColor,
      buttonClosed: saved.buttonClosed,
      oledAddress: saved.oledAddress,
      adcVoltage: saved.adcVoltage,
      adcBits: saved.adcBits,
      adcReferenceVoltage: saved.adcReferenceVoltage,
      uartPayload: saved.uartPayload,
      uartCondition: saved.uartCondition,
      uartDelayMs: saved.uartDelayMs,
      lux: saved.lux,
      thresholdLux: saved.thresholdLux,
      supplyVoltage: saved.supplyVoltage,
      minOperatingVoltage: saved.minOperatingVoltage,
      maxOperatingVoltage: saved.maxOperatingVoltage,
      sensorGamma: saved.sensorGamma,
      analogInverted: saved.analogInverted,
      digitalActiveLow: saved.digitalActiveLow
      ,peripheralProperties: saved.peripheralProperties
    });
  }

  function rebuildCircuitCounters() {
    schematicState.componentCounter = 0;
    schematicState.wireCounter = 0;
    Object.keys(referenceCounters).forEach(function (type) { referenceCounters[type] = 0; });
    schematicState.components.forEach(function (component) {
      var idMatch = String(component.id || "").match(/^component-(\d+)$/i);
      if (idMatch) schematicState.componentCounter = Math.max(schematicState.componentCounter, Number(idMatch[1]));
      var definition = componentDefinitions[component.type];
      if (!definition) return;
      var escapedPrefix = definition.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var referenceMatch = String(component.ref || "").match(new RegExp("^" + escapedPrefix + "(\\d+)$", "i"));
      if (referenceMatch) referenceCounters[component.type] = Math.max(referenceCounters[component.type], Number(referenceMatch[1]));
    });
    schematicState.wires.forEach(function (wire) {
      var match = String(wire.id || "").match(/^wire-(\d+)$/i);
      if (match) schematicState.wireCounter = Math.max(schematicState.wireCounter, Number(match[1]));
    });
  }

  function importCircuit(input) {
    var plan;
    try {
      plan = prepareCircuitImport(normalizeCircuitDocument(input));
    } catch (error) {
      var failure = {
        ok: false,
        code: error && error.code || "CIRCUIT_IMPORT_FAILED",
        error: error && error.message || "Unable to load circuit."
      };
      if (schematicState.initialized) document.dispatchEvent(new CustomEvent("alice:schematic-load-error", { detail: failure }));
      return failure;
    }

    clearCircuitForImport();
    var restoredMcu = plan.targetMcu;
    if (plan.savedMcu) {
      if (!restoredMcu) {
        restoredMcu = createComponentModel("mcu", plan.savedMcu.x, plan.savedMcu.y, {
          id: plan.savedMcu.id,
          rotation: plan.savedMcu.rotation,
          ref: plan.savedMcu.ref,
          value: componentDefinitions.mcu.value,
          autoGenerated: true,
          autoSource: "system",
          autoKey: "mcu"
        });
      }
      applySavedMcuComponent(restoredMcu, plan.savedMcu);
    }
    plan.model.components.forEach(function (component) {
      if (component.type !== "mcu") createSavedComponent(component);
    });
    plan.wires.forEach(function (wire) {
      schematicState.wires.push({
        id: wire.id,
        from: { componentId: wire.from.componentId, pin: wire.from.pin },
        to: { componentId: wire.to.componentId, pin: wire.to.pin },
        signal: wire.signal,
        route: cloneRoute(wire.route),
        autoGenerated: Boolean(wire.autoGenerated),
        autoSource: wire.autoSource || "",
        autoKey: wire.autoKey || ""
      });
    });
    rebuildCircuitCounters();
    resetSimulation();
    schematicState.zoom = plan.model.view.zoom;
    schematicState.panX = plan.model.view.panX;
    schematicState.panY = plan.model.view.panY;
    schematicState.userView = plan.model.view.userView;
    applyViewTransform();
    updateComponentActionState();
    renderWires();
    var result = {
      ok: true,
      schemaVersion: CIRCUIT_SCHEMA_VERSION,
      kind: CIRCUIT_KIND,
      componentCount: plan.model.components.length,
      wireCount: plan.wires.length,
      skippedWireCount: plan.skippedWires.length,
      skippedWires: plan.skippedWires,
      warnings: plan.warnings
    };
    if (schematicState.initialized) {
      setStatus("电路已加载 · " + result.componentCount + " 个元件 · " + result.wireCount + " 根导线" + (result.skippedWireCount ? " · 跳过 " + result.skippedWireCount + " 根不兼容导线" : ""));
      document.dispatchEvent(new CustomEvent("alice:schematic-loaded", { detail: result }));
      document.dispatchEvent(new CustomEvent("alice:schematic-change", { detail: Object.assign({ kind: "load-circuit" }, result) }));
    }
    return result;
  }

  function bindEvents() {
    document.querySelectorAll("[data-schematic-tool]").forEach(function (button) {
      button.addEventListener("click", function () { setTool(button.dataset.schematicTool); });
    });

    document.querySelectorAll("[data-component-type]").forEach(function (button) {
      button.addEventListener("click", function () { addLibraryComponent(button.dataset.componentType); });
    });

    schematicNodes.components.addEventListener("pointerdown", function (event) {
      var pin = event.target.closest(".component-pin");
      if (pin && schematicState.tool === "wire") {
        event.preventDefault();
        event.stopPropagation();
        handleWirePin(pin);
        return;
      }
      var componentElement = event.target.closest(".schematic-component");
      if (!componentElement || schematicState.tool !== "select" || event.button !== 0) return;
      event.preventDefault();
      selectEntity("component", componentElement.dataset.componentId);
      beginComponentDrag(event, componentElement);
    });

    schematicNodes.components.addEventListener("dblclick", function (event) {
      var componentElement = event.target.closest(".schematic-component");
      if (!componentElement || schematicState.tool !== "select") return;
      event.preventDefault();
      event.stopPropagation();
      var component = schematicState.components.get(componentElement.dataset.componentId);
      if (component && component.type === "button") setButtonClosed(component, !component.buttonClosed, true);
      else openComponentProperties(componentElement.dataset.componentId);
    });

    schematicNodes.wires.addEventListener("pointerdown", function (event) {
      if (schematicState.tool !== "select" || event.button !== 0) return;
      var bendHandle = event.target.closest(".wire-bend-handle, .wire-bend-hit");
      var hit = event.target.closest(".wire-segment-hit");
      if (!bendHandle && !hit) return;
      event.preventDefault();
      event.stopPropagation();
      if (bendHandle) beginWireBendDrag(event, bendHandle);
      else beginWireSegmentDrag(event, hit);
    });

    schematicNodes.wires.addEventListener("dblclick", function (event) {
      if (schematicState.tool !== "select" || event.button !== 0) return;
      var bendHandle = event.target.closest(".wire-bend-handle, .wire-bend-hit");
      var hit = event.target.closest(".wire-segment-hit");
      if (!bendHandle && !hit) return;
      event.preventDefault();
      event.stopPropagation();
      cancelActiveInteraction(false);
      var wire = findWire((bendHandle || hit).dataset.wireId);
      if (!wire) return;
      selectEntity("wire", wire.id);
      if (bendHandle) {
        var removed = removeWireBend(wire, Number(bendHandle.dataset.pointIndex));
        renderWires();
        setStatus(removed ? "已删除导线拐点 · 路径保持正交" : "该拐点不能继续简化");
        return;
      }
      var added = insertWireBend(wire, Number(hit.dataset.segmentIndex), clientToWorld(event.clientX, event.clientY));
      renderWires();
      setStatus(added
        ? "已增加导线拐点 · 拖动方块调整 · 双击方块删除"
        : "线段空间不足，放大或拖长线段后再增加拐点");
    });

    schematicNodes.viewport.addEventListener("pointerdown", function (event) {
      if (event.defaultPrevented) return;
      if (schematicState.tool === "pan" || event.button === 1 || event.button === 2) {
        event.preventDefault();
        beginPan(event);
        return;
      }
      if (schematicState.tool === "select" && !event.target.closest(".schematic-component") && !event.target.closest(".wire-hit") && !event.target.closest(".wire-bend-handle, .wire-bend-hit")) {
        selectEntity(null, null);
      }
    });

    schematicNodes.viewport.addEventListener("contextmenu", function (event) {
      // Right-drag is reserved for viewport navigation, so suppress the
      // browser menu even if the pointer was released without moving.
      event.preventDefault();
    });

    schematicNodes.viewport.addEventListener("wheel", function (event) {
      event.preventDefault();
      var factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(schematicState.zoom * factor, event.clientX, event.clientY, true);
    }, { passive: false });

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    document.addEventListener("keydown", function (event) {
      var target = event.target;
      if (target && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      if ((event.key === "Delete" || event.key === "Backspace") && schematicState.selection) {
        event.preventDefault();
        deleteSelection();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "r" && selectedComponentModel()) {
        event.preventDefault();
        rotateSelectedComponent(90);
      } else if ((event.key === " " || event.key === "Enter") && selectedComponentModel() && selectedComponentModel().type === "button") {
        event.preventDefault();
        setButtonClosed(selectedComponentModel(), !selectedComponentModel().buttonClosed, true);
      } else if ((event.key === "F2" || (event.key === "Enter" && target && target.closest && target.closest(".schematic-component"))) && selectedComponentModel()) {
        event.preventDefault();
        openComponentProperties(selectedComponentModel().id);
      } else if (event.key === "Escape") {
        if (isWireDragInteraction(schematicState.interaction)) {
          event.preventDefault();
          cancelActiveInteraction(true);
          setStatus("导线移动已取消 · 路径已恢复");
          return;
        }
        cancelActiveInteraction(false);
        cancelWire();
        selectEntity(null, null);
        setStatus("操作已取消");
      }
    });

    if (schematicNodes.zoomIn) schematicNodes.zoomIn.addEventListener("click", function () { zoomAt(schematicState.zoom * 1.2); });
    if (schematicNodes.zoomOut) schematicNodes.zoomOut.addEventListener("click", function () { zoomAt(schematicState.zoom / 1.2); });
    if (schematicNodes.fit) schematicNodes.fit.addEventListener("click", function () { fitToContent(true); });
    if (schematicNodes.showComponentLabels) schematicNodes.showComponentLabels.addEventListener("change", function (event) {
      setComponentLabelsVisible(event.target.checked, true);
    });
    if (schematicNodes.rotateButton) schematicNodes.rotateButton.addEventListener("click", function () { rotateSelectedComponent(90); });
    if (schematicNodes.propertiesButton) schematicNodes.propertiesButton.addEventListener("click", function () { openComponentProperties(); });
    if (schematicNodes.deleteButton) schematicNodes.deleteButton.addEventListener("click", deleteSelection);
    if (schematicNodes.resetButton) schematicNodes.resetButton.addEventListener("click", function () {
      if (!window.AliceHalSimulator) queueMicrotask(resetSimulation);
    });

    if (window.ResizeObserver) {
      var resizeObserver = new ResizeObserver(function () {
        if (!schematicState.userView) fitToContent(false);
      });
      resizeObserver.observe(schematicNodes.viewport);
    }
  }

  function initializeSchematic() {
    if (schematicState.initialized) return true;
    schematicNodes.viewport = document.getElementById("schematicViewport");
    schematicNodes.world = document.getElementById("schematicWorld");
    schematicNodes.components = document.getElementById("schematicComponents");
    schematicNodes.wires = document.getElementById("wireLayer");
    if (!schematicNodes.viewport || !schematicNodes.world || !schematicNodes.components || !schematicNodes.wires) return false;

    schematicNodes.zoom = document.getElementById("schematicZoom");
    schematicNodes.status = document.getElementById("wireStatus");
    schematicNodes.zoomIn = document.getElementById("zoomIn");
    schematicNodes.zoomOut = document.getElementById("zoomOut");
    schematicNodes.fit = document.getElementById("fitSchematic");
    schematicNodes.showComponentLabels = document.getElementById("showComponentLabels");
    schematicNodes.rotateButton = document.getElementById("rotateComponent");
    schematicNodes.propertiesButton = document.getElementById("editComponentValue");
    schematicNodes.deleteButton = document.getElementById("deleteComponent");
    schematicNodes.resetButton = document.getElementById("resetButton");
    schematicNodes.tickCount = document.getElementById("tickCount");
    schematicNodes.sampleCount = document.getElementById("sampleCount");
    schematicNodes.circuitTime = document.getElementById("circuitTime");
    schematicNodes.cpuLoad = document.getElementById("cpuLoad");
    schematicNodes.mcuState = document.getElementById("mcuState");
    schematicNodes.recordDot = document.querySelector(".schematic-timeline .record-dot");
    var powerToggle = document.getElementById("powerCalculationToggle");
    schematicState.powerCalculationEnabled = !powerToggle || powerToggle.checked;
    schematicState.showComponentLabels = readComponentLabelsPreference();
    applyComponentLabelsVisibility();

    schematicNodes.world.style.width = WORLD_WIDTH + "px";
    schematicNodes.world.style.height = WORLD_HEIGHT + "px";
    schematicNodes.components.style.width = WORLD_WIDTH + "px";
    schematicNodes.components.style.height = WORLD_HEIGHT + "px";
    schematicNodes.wires.style.width = WORLD_WIDTH + "px";
    schematicNodes.wires.style.height = WORLD_HEIGHT + "px";
    var topRuler = schematicNodes.viewport.querySelector(".ruler-top");
    var leftRuler = schematicNodes.viewport.querySelector(".ruler-left");
    function populateRuler(node, maximum, axis) {
      if (!node) return;
      node.textContent = "";
      var count = Math.ceil(maximum / 50);
      for (var index = 0; index < count; index += 1) {
        var marker = document.createElement("span");
        marker.textContent = String(index * 50);
        node.appendChild(marker);
      }
      node.style[axis === "x" ? "gridTemplateColumns" : "gridTemplateRows"] = "repeat(" + count + ", 50px)";
    }
    populateRuler(topRuler, WORLD_WIDTH, "x");
    populateRuler(leftRuler, WORLD_HEIGHT, "y");
    schematicNodes.viewport.setAttribute("tabindex", "0");
    schematicNodes.viewport.setAttribute("aria-label", "Proteus 风格原理图编辑画布");
    schematicState.initialized = true;

    seedInitialCircuit();
    bindEvents();
    setTool("select");
    updateComponentActionState();
    updateTickUi();
    renderWires();
    requestAnimationFrame(function () { fitToContent(false); });
    return true;
  }

  var publicApi = {
    setSignal: setSignal,
    compileNetlist: compileNetlist,
    driveMcuPin: driveMcuPin,
    driveMcuPwm: driveMcuPwm,
    sampleMcuPin: sampleMcuPin,
    sampleAnalogMcuPin: sampleAnalogMcuPin,
    sampleProbe: function (componentId) {
      var component = schematicState.components.get(componentId);
      var state = measurementProbeState(component, compileNetlist());
      return state ? Object.assign({ componentId: component.id, type: component.type }, state) : null;
    },
    getPowerReport: function () {
      var compiled = compileNetlist();
      return compiled.powerReport || { ok: false, components: [], alerts: [], overloadCount: 0 };
    },
    setPowerCalculationEnabled: function (enabled) {
      schematicState.powerCalculationEnabled = enabled !== false;
      schematicState.compiledNetlist = null;
      spiceValidationState.results.clear();
      spiceValidationState.appliedFingerprint = "";
      if (schematicState.initialized) renderWires();
      return schematicState.powerCalculationEnabled;
    },
    isPowerCalculationEnabled: function () { return schematicState.powerCalculationEnabled; },
    validateWithPySpice: function () { return requestSpiceProbeValidation(true); },
    sampleAdc: sampleAdc,
    handleI2cTransmission: handleI2cTransmission,
    onI2cTx: handleI2cTransmission,
    handleSpiTransmission: handleSpiTransmission,
    onSpiTx: handleSpiTransmission,
    handlePeripheralOperation: handlePeripheralOperation,
    getFirmwareInputSnapshot: firmwareInputSnapshot,
    validateFirmware: validateFirmware,
    applyProjectModel: applyProjectModel,
    tick: tickSimulation,
    reset: resetSimulation,
    renderWires: renderWires,
    insertWireBend: function (wireId, segmentIndex, point) {
      var wire = findWire(wireId);
      var route = insertWireBend(wire, Number(segmentIndex), point);
      if (route && schematicState.initialized) renderWires();
      return route;
    },
    removeWireBend: function (wireId, pointIndex) {
      var wire = findWire(wireId);
      var route = removeWireBend(wire, Number(pointIndex));
      if (route && schematicState.initialized) renderWires();
      return route;
    },
    exportCircuit: exportCircuit,
    serializeCircuit: serializeCircuit,
    downloadCircuit: downloadCircuit,
    importCircuit: importCircuit,
    exportComponentPackage: exportComponentPackage,
    serializeComponentPackage: serializeComponentPackage,
    downloadComponentPackage: downloadComponentPackage,
    inspectComponentPackage: inspectComponentPackage,
    addComponent: addLibraryComponent,
    setMcuConfiguration: setMcuConfiguration,
    setTool: setTool,
    setComponentLabelsVisible: setComponentLabelsVisible,
    // Keep the previous API name as an alias for integrations that only hid names.
    setComponentNamesVisible: setComponentLabelsVisible,
    rotateComponent: function (componentId, delta) {
      var component = schematicState.components.get(componentId);
      return component ? setComponentRotation(component, component.rotation + (delta == null ? 90 : delta), true) : false;
    },
    setComponentValue: function (componentId, value) {
      return updateComponentValue(schematicState.components.get(componentId), value, true);
    },
    setButtonClosed: function (componentId, closed) {
      return setButtonClosed(schematicState.components.get(componentId), closed, true);
    },
    setLightLevel: function (componentId, lux) {
      var component = schematicState.components.get(componentId);
      return applyLightLevel(component, lux, true, true);
    },
    setAdcSourceVoltage: function (componentId, voltage) {
      return applyAdcSourceVoltage(schematicState.components.get(componentId), voltage, true, true);
    },
    setUartSender: function (componentId, settings) {
      return applyUartSenderSettings(schematicState.components.get(componentId), settings, true, true);
    },
    triggerUartSender: function (componentId) {
      var component = schematicState.components.get(componentId);
      return component && component.type === "uartSender" ? sendFromUartComponent(component, compileNetlist(), schematicState.time) : false;
    },
    setPeripheralProperties: function (componentId, properties) {
      return applyCatalogProperties(schematicState.components.get(componentId), properties, true);
    },
    getAutomationTargets: getAutomationTargets,
    applyAutomationValue: applyAutomationValue,
    openComponentProperties: openComponentProperties,
    fit: function () { fitToContent(true); },
    getState: function () {
      return {
        tool: schematicState.tool,
        zoom: schematicState.zoom,
        time: schematicState.time,
        tick: schematicState.tick,
        showComponentLabels: schematicState.showComponentLabels,
        showComponentNames: schematicState.showComponentLabels,
        signals: Object.fromEntries(schematicState.signals),
        mcuDrives: Object.fromEntries(schematicState.mcuDrives),
        mcuPwm: Object.fromEntries(schematicState.mcuPwm),
        firmwareOutputs: schematicState.firmwareOutputs.map(function (output) {
          return { pin: output.pin, physicalPin: output.pin, label: output.label, aliases: (output.aliases || []).slice(), color: output.colorDescriptor.name, initialLevel: output.initialLevel };
        }),
        components: Array.from(schematicState.components.values()).map(function (component) {
          var copy = Object.assign({}, component);
          var device = componentDevice(component);
          if (device && typeof device.getState === "function") copy.deviceState = device.getState({ framebuffer: component.type === "oled" });
          return copy;
        }),
        wires: schematicState.wires.map(function (wire) {
          return {
            id: wire.id,
            from: Object.assign({}, wire.from),
            to: Object.assign({}, wire.to),
            signal: wire.signal,
            autoGenerated: Boolean(wire.autoGenerated),
            autoSource: wire.autoSource || "",
            autoKey: wire.autoKey || "",
            route: cloneRoute(ensureWireRoute(wire))
          };
        })
      };
    }
  };

  window.AliceSchematic = publicApi;
  window.addEventListener("alice:ioc-viewer-loaded", function (event) {
    var configuration = event && event.detail && event.detail.model;
    if (!configuration && window.AliceIocViewer && typeof window.AliceIocViewer.getData === "function") {
      configuration = window.AliceIocViewer.getData();
    }
    if (configuration) applyProjectModel(configuration);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeSchematic, { once: true });
  else initializeSchematic();
}());
