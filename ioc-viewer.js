(function () {
  "use strict";

  var PACKAGE_PINS = [
    "VBAT", "PC13", "PC14", "PC15", "PD0", "PD1", "NRST", "VSSA", "VDDA", "PA0", "PA1", "PA2",
    "PA3", "VSS", "VDD", "PA4", "PA5", "PA6", "PA7", "PB0", "PB1", "PB2", "PB10", "PB11",
    "VSS", "VDD", "PB12", "PB13", "PB14", "PB15", "PA8", "PA9", "PA10", "PA11", "PA12", "PA13",
    "VSS", "VDD", "PA14", "PA15", "PB3", "PB4", "PB5", "PB6", "PB7", "BOOT0", "PB8", "PB9"
  ];

  var FALLBACK_IOC = [
    "#MicroXplorer Configuration settings - do not modify",
    "File.Version=6",
    "KeepUserPlacement=false",
    "Mcu.CPN=STM32F103C8T6",
    "Mcu.Family=STM32F1",
    "Mcu.IP0=NVIC",
    "Mcu.IP1=RCC",
    "Mcu.IP2=SYS",
    "Mcu.IPNb=3",
    "Mcu.Name=STM32F103C8Tx",
    "Mcu.Package=LQFP48",
    "Mcu.Pin0=PA13",
    "Mcu.Pin1=PA14",
    "Mcu.PinsNb=2",
    "Mcu.UserConstants=",
    "Mcu.UserName=STM32F103C8Tx",
    "PA13.Mode=Serial_Wire",
    "PA13.Signal=SYS_JTMS-SWDIO",
    "PA14.Mode=Serial_Wire",
    "PA14.Signal=SYS_JTCK-SWCLK",
    "RCC.AHBFreq_Value=8000000",
    "RCC.APB1CLKDivider=RCC_HCLK_DIV1",
    "RCC.APB1Freq_Value=8000000",
    "RCC.APB2CLKDivider=RCC_HCLK_DIV1",
    "RCC.APB2Freq_Value=8000000",
    "RCC.FCLKCortexFreq_Value=8000000",
    "RCC.HCLKFreq_Value=8000000",
    "RCC.HSI_VALUE=8000000",
    "RCC.SYSCLKFreq_VALUE=8000000",
    "RCC.SYSCLKSource=RCC_SYSCLKSOURCE_HSI",
    "ProjectManager.ProjectName=STM32_Empty",
    "ProjectManager.ToolChain=Makefile",
    "board=custom",
    "isbadioc=false"
  ].join("\n");

  var viewer = null;
  var activeView = "overview";
  var currentModel = null;
  var loadSequence = 0;
  var noticeTimer = 0;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  function normalizePinName(value) {
    var match = String(value || "").match(/^P[A-Z]\d+/i);
    return match ? match[0].toUpperCase() : String(value || "");
  }

  function isPinKey(key) {
    return /^(?:P[A-Z]\d+(?:-[^.]+)?|VP_[^.]+)\./i.test(key);
  }

  function frequencyText(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return value || "—";
    if (Math.abs(number) >= 1000000) {
      var mhz = number / 1000000;
      return (Number.isInteger(mhz) ? mhz : mhz.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")) + " MHz";
    }
    if (Math.abs(number) >= 1000) {
      var khz = number / 1000;
      return (Number.isInteger(khz) ? khz : khz.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")) + " kHz";
    }
    return number + " Hz";
  }

  function displayValue(key, value) {
    if (/Freq|Frequency|_VALUE$|Freq_Value|HSE_VALUE|LSE_VALUE/i.test(key) && /^-?\d+(?:\.\d+)?$/.test(value)) {
      return frequencyText(value);
    }
    if (value === "") return "—";
    return value;
  }

  function pinType(name, signal) {
    if (/^(?:VDD|VDDA|VBAT)$/i.test(name)) return "power";
    if (/^(?:VSS|VSSA)$/i.test(name)) return "ground";
    if (/USART|UART/i.test(signal)) return "uart";
    if (/ADC|DAC|ANALOG/i.test(signal)) return "analog";
    if (/RCC|OSC|SYS|SWD|JT|NRST|BOOT/i.test((signal || "") + " " + name)) return "system";
    if (signal) return "gpio";
    return "unused";
  }

  function parseIoc(text, fileName) {
    var rawText = String(text || "").replace(/^\uFEFF/, "");
    var lines = rawText.split(/\r?\n/);
    var values = Object.create(null);
    var entries = [];
    var comments = [];

    lines.forEach(function (line, lineIndex) {
      var trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.charAt(0) === "#") {
        comments.push({ line: lineIndex + 1, text: line });
        return;
      }
      var equal = line.indexOf("=");
      if (equal < 1) {
        entries.push({ key: line.trim(), value: "", line: lineIndex + 1, malformed: true });
        return;
      }
      var key = line.slice(0, equal).trim();
      var value = line.slice(equal + 1).trim();
      values[key] = value;
      entries.push({ key: key, value: value, line: lineIndex + 1 });
    });

    var configuredPinNames = Object.keys(values)
      .filter(function (key) { return /^Mcu\.Pin\d+$/.test(key); })
      .sort(function (a, b) { return Number(a.slice(7)) - Number(b.slice(7)); })
      .map(function (key) { return values[key]; })
      .filter(Boolean);

    var configuredPins = configuredPinNames.map(function (pinId, index) {
      var prefix = pinId + ".";
      var config = {};
      entries.forEach(function (entry) {
        if (entry.key.indexOf(prefix) === 0) config[entry.key.slice(prefix.length)] = entry.value;
      });
      return {
        order: index + 1,
        id: pinId,
        base: normalizePinName(pinId),
        signal: config.Signal || "",
        mode: config.Mode || "",
        label: config.GPIO_Label || config.UserLabel || "",
        locked: String(config.Locked).toLowerCase() === "true",
        config: config
      };
    });

    var configuredByBase = new Map();
    configuredPins.forEach(function (pin) {
      if (!configuredByBase.has(pin.base)) configuredByBase.set(pin.base, pin);
    });

    var physicalPins = PACKAGE_PINS.map(function (name, index) {
      var assignment = configuredByBase.get(name) || null;
      var signal = assignment ? assignment.signal : "";
      if (!signal && /^(?:VDD|VDDA|VBAT)$/i.test(name)) signal = "POWER";
      if (!signal && /^(?:VSS|VSSA)$/i.test(name)) signal = "GROUND";
      return {
        number: index + 1,
        name: name,
        signal: signal,
        mode: assignment ? assignment.mode : "",
        label: assignment ? assignment.label : "",
        locked: assignment ? assignment.locked : false,
        id: assignment ? assignment.id : name,
        type: pinType(name, signal),
        configured: Boolean(assignment) || /^(?:VDD|VDDA|VBAT|VSS|VSSA)$/i.test(name)
      };
    });

    var packageBases = new Set(PACKAGE_PINS);
    var extraPins = configuredPins.filter(function (pin) { return !packageBases.has(pin.base); });

    var ips = Object.keys(values)
      .filter(function (key) { return /^Mcu\.IP\d+$/.test(key); })
      .sort(function (a, b) { return Number(a.slice(6)) - Number(b.slice(6)); })
      .map(function (key) { return values[key]; })
      .filter(Boolean);

    var reservedPrefixes = new Set(["Mcu", "ProjectManager", "File"]);
    var peripheralNames = ips.slice();
    entries.forEach(function (entry) {
      if (isPinKey(entry.key)) return;
      var dot = entry.key.indexOf(".");
      if (dot < 1) return;
      var prefix = entry.key.slice(0, dot);
      if (reservedPrefixes.has(prefix)) return;
      if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) return;
      if (peripheralNames.indexOf(prefix) < 0) peripheralNames.push(prefix);
    });

    var peripheralGroups = peripheralNames.map(function (name) {
      return {
        name: name,
        entries: entries.filter(function (entry) { return entry.key.indexOf(name + ".") === 0; })
      };
    });

    var clockEntries = entries.filter(function (entry) { return entry.key.indexOf("RCC.") === 0; });
    var projectEntries = entries.filter(function (entry) {
      return entry.key.indexOf("ProjectManager.") === 0 || entry.key.indexOf("File.") === 0 ||
        entry.key === "KeepUserPlacement" || entry.key === "board" || entry.key === "isbadioc";
    });
    var mcuEntries = entries.filter(function (entry) { return entry.key.indexOf("Mcu.") === 0; });

    return {
      fileName: fileName || "STM32CubeMX.ioc",
      rawText: rawText,
      lines: lines,
      comments: comments,
      entries: entries,
      values: values,
      mcuEntries: mcuEntries,
      projectEntries: projectEntries,
      configuredPins: configuredPins,
      physicalPins: physicalPins,
      extraPins: extraPins,
      clockEntries: clockEntries,
      peripherals: peripheralGroups,
      ips: ips,
      mcu: values["Mcu.CPN"] || values["Mcu.Name"] || "Unknown STM32",
      deviceName: values["Mcu.Name"] || values["Mcu.UserName"] || "—",
      family: values["Mcu.Family"] || "—",
      packageName: values["Mcu.Package"] || "—",
      projectName: values["ProjectManager.ProjectName"] || String(fileName || "Project").replace(/\.ioc$/i, ""),
      toolchain: values["ProjectManager.ToolChain"] || "—",
      valid: String(values.isbadioc || "false").toLowerCase() !== "true"
    };
  }

  function addStyles() {
    if (document.getElementById("alice-ioc-viewer-styles")) return;
    var style = document.createElement("style");
    style.id = "alice-ioc-viewer-styles";
    style.textContent = `
      .pinout-view.ioc-readonly-view{container:iocviewer / inline-size;overflow:hidden;color:#242424;background:#fff!important}
      .ioc-reader{height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:#f3f3f3}
      .ioc-reader *{box-sizing:border-box}
      .ioc-toolbar{flex:0 0 58px;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 14px;border-bottom:1px solid #c8c8c8;background:#fafafa}
      .ioc-title{min-width:0;display:flex;align-items:center;gap:10px}
      .ioc-file-icon{position:relative;width:30px;height:34px;flex:0 0 auto;display:grid;place-items:center;border:1px solid #8a8886;background:#fff;color:#0f6cbd;font-size:9px;font-weight:700}
      .ioc-file-icon::after{content:\"\";position:absolute;right:-1px;top:-1px;border-left:8px solid transparent;border-bottom:8px solid #c7e0f4}
      .ioc-title-copy{min-width:0;display:flex;flex-direction:column;gap:3px}
      .ioc-title-copy strong{overflow:hidden;color:#242424;font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
      .ioc-title-copy span{overflow:hidden;color:#616161;font:9px Consolas,'Cascadia Mono',monospace;text-overflow:ellipsis;white-space:nowrap}
      .ioc-toolbar-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}
      .ioc-readonly-badge{height:24px;display:flex;align-items:center;gap:5px;padding:0 8px;border:1px solid #a8a8a8;background:#f3f3f3;color:#424242;font-size:9px;font-weight:600}
      .ioc-readonly-badge::before{content:\"🔒\";font-size:9px}
      .ioc-toolbar button,.ioc-raw-tools button{height:27px;padding:0 10px;border:1px solid #8a8886;border-radius:0;color:#242424;background:#fff;font-size:9px}
      .ioc-toolbar button:hover,.ioc-raw-tools button:hover{border-color:#0f6cbd;background:#f5faff}
      .ioc-toolbar button.primary{border-color:#0f6cbd;color:#fff;background:#0f6cbd}.ioc-toolbar button.primary:hover{background:#115ea3}
      .ioc-layout{flex:1;min-width:0;min-height:0;display:grid;grid-template-columns:154px minmax(0,1fr)}
      .ioc-nav{min-height:0;display:flex;flex-direction:column;padding:10px 7px;border-right:1px solid #c8c8c8;background:#f7f7f7;overflow:auto}
      .ioc-source-card{margin:0 2px 9px;padding:9px;border:1px solid #d6d6d6;background:#fff}
      .ioc-source-card span{display:block;margin-bottom:4px;color:#616161;font-size:8px;text-transform:uppercase}
      .ioc-source-card strong{display:block;overflow:hidden;color:#242424;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
      .ioc-source-card small{display:block;margin-top:3px;color:#616161;font-size:8px}
      .ioc-nav>button{position:relative;width:100%;height:34px;display:flex;align-items:center;gap:8px;padding:0 8px;border:0;color:#323130;background:transparent;text-align:left;font-size:10px}
      .ioc-nav>button:hover{background:#e9e9e9}.ioc-nav>button.active{color:#0f6cbd;background:#e5f1fb;font-weight:600}
      .ioc-nav>button.active::before{content:\"\";position:absolute;left:0;top:5px;bottom:5px;width:3px;background:#0f6cbd}
      .ioc-nav-icon{width:18px;color:#616161;text-align:center;font-size:12px}.ioc-nav>button.active .ioc-nav-icon{color:#0f6cbd}
      .ioc-nav-count{margin-left:auto;min-width:20px;padding:1px 4px;border:1px solid #d6d6d6;background:#fff;color:#616161;font:8px Consolas,monospace;text-align:center}
      .ioc-readonly-note{margin:auto 2px 0;padding:8px;border-top:1px solid #d6d6d6;color:#616161;font-size:8px;line-height:1.45}
      .ioc-main{min-width:0;min-height:0;overflow:auto;background:#fff;scrollbar-color:#c8c8c8 #f5f5f5;scrollbar-width:thin}
      .ioc-page{display:none;min-height:100%;padding:14px}.ioc-page.active{display:block}
      .ioc-page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e1e1e1}
      .ioc-page-heading h2{margin:0;color:#242424;font-size:15px;font-weight:600}.ioc-page-heading p{margin:4px 0 0;color:#616161;font-size:9px;line-height:1.45}
      .ioc-page-heading>span{padding:4px 7px;border:1px solid #c8c8c8;background:#fafafa;color:#616161;font:8px Consolas,monospace;white-space:nowrap}
      .ioc-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(105px,1fr));gap:8px;margin-bottom:12px}
      .ioc-stat{min-width:0;padding:10px;border:1px solid #d6d6d6;border-top:3px solid #0f6cbd;background:#fff}
      .ioc-stat:nth-child(2){border-top-color:#107c10}.ioc-stat:nth-child(3){border-top-color:#038387}.ioc-stat:nth-child(4){border-top-color:#8764b8}
      .ioc-stat span{display:block;color:#616161;font-size:8px;text-transform:uppercase}.ioc-stat strong{display:block;margin-top:5px;overflow:hidden;color:#242424;font-size:15px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.ioc-stat small{display:block;margin-top:3px;color:#616161;font-size:8px}
      .ioc-overview-grid{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:10px}
      .ioc-panel{min-width:0;border:1px solid #d6d6d6;background:#fff}.ioc-panel.full{grid-column:1/-1}
      .ioc-panel-title{height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border-bottom:1px solid #d6d6d6;background:#f7f7f7;color:#242424;font-size:10px;font-weight:600}
      .ioc-panel-title small{color:#616161;font-size:8px;font-weight:400}
      .ioc-kv{display:grid;grid-template-columns:minmax(115px,.8fr) minmax(130px,1.2fr);min-height:30px;border-bottom:1px solid #ededed}.ioc-kv:last-child{border-bottom:0}
      .ioc-kv dt,.ioc-kv dd{min-width:0;margin:0;padding:7px 9px;font-size:9px;line-height:1.45}.ioc-kv dt{color:#616161;background:#fafafa}.ioc-kv dd{overflow-wrap:anywhere;color:#242424;font-family:Consolas,'Cascadia Mono',monospace}
      .ioc-health{display:grid;gap:7px;padding:10px}.ioc-health-row{display:flex;align-items:center;gap:8px;color:#424242;font-size:9px}.ioc-health-row i{width:16px;height:16px;display:grid;place-items:center;border:1px solid #9fd89f;border-radius:50%;background:#f1faf1;color:#107c10;font-style:normal;font-size:9px}.ioc-health-row.warn i{border-color:#f2c8a0;background:#fff4ce;color:#8a5d00}
      .ioc-pin-layout{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,370px),1fr));align-items:start;gap:12px}
      .ioc-package-card,.ioc-table-card{min-width:0;border:1px solid #d6d6d6;background:#fff}
      .ioc-card-head{height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border-bottom:1px solid #d6d6d6;background:#f7f7f7;color:#242424;font-size:10px;font-weight:600}.ioc-card-head span{color:#616161;font:8px Consolas,monospace;font-weight:400}
      .ioc-package-stage{position:relative;width:min(100%,460px);aspect-ratio:1.21;margin:8px auto;background-image:linear-gradient(#f0f0f0 1px,transparent 1px),linear-gradient(90deg,#f0f0f0 1px,transparent 1px);background-size:14px 14px;overflow:hidden}
      .ioc-chip-body{position:absolute;left:29%;top:25%;width:42%;height:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px solid #424242;background:#303030;color:#fff;box-shadow:inset 0 0 0 5px #262626,0 2px 5px rgba(0,0,0,.22)}
      .ioc-chip-body::before{content:\"\";position:absolute;left:9px;top:9px;width:5px;height:5px;border:1px solid #d0d0d0;border-radius:50%}.ioc-chip-body b{font-size:18px}.ioc-chip-body strong{margin-top:8px;font:10px Consolas,monospace}.ioc-chip-body small{margin-top:4px;color:#d0d0d0;font-size:7px}
      .ioc-package-side{position:absolute;display:flex}.ioc-package-side.left,.ioc-package-side.right{top:25%;width:29%;height:50%;flex-direction:column}.ioc-package-side.left{left:0}.ioc-package-side.right{right:0}.ioc-package-side.top,.ioc-package-side.bottom{left:29%;width:42%;height:25%}.ioc-package-side.top{top:0}.ioc-package-side.bottom{bottom:0}
      .ioc-package-pin{position:relative;min-width:0;min-height:0;display:flex;color:#707070;font:clamp(5px,.8cqi,7px) Consolas,monospace}.ioc-package-pin.configured{font-weight:600}.ioc-package-pin .lead{flex:0 0 auto;border:1px solid #a19f9d;background:#d8d8d8}.ioc-package-pin .pin-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ioc-package-side.left .ioc-package-pin,.ioc-package-side.right .ioc-package-pin{height:8.333%;align-items:center;gap:3px}.ioc-package-side.left .ioc-package-pin{justify-content:flex-end}.ioc-package-side.right .ioc-package-pin{flex-direction:row-reverse;justify-content:flex-end}.ioc-package-side.left .lead,.ioc-package-side.right .lead{width:25%;height:4px}
      .ioc-package-side.top .ioc-package-pin,.ioc-package-side.bottom .ioc-package-pin{width:8.333%;height:100%;align-items:center;gap:2px;writing-mode:vertical-rl}.ioc-package-side.top .ioc-package-pin{flex-direction:column-reverse}.ioc-package-side.bottom .ioc-package-pin{flex-direction:column}.ioc-package-side.top .lead,.ioc-package-side.bottom .lead{width:4px;height:26%}
      .ioc-package-pin.power,.ioc-package-pin.ground{color:#a4262c}.ioc-package-pin.power .lead,.ioc-package-pin.ground .lead{border-color:#a4262c;background:#fde7e9}.ioc-package-pin.system{color:#5c2e91}.ioc-package-pin.system .lead{border-color:#5c2e91;background:#eadcf8}.ioc-package-pin.uart{color:#006666}.ioc-package-pin.uart .lead{border-color:#038387;background:#d7f4f2}.ioc-package-pin.gpio{color:#107c10}.ioc-package-pin.gpio .lead{border-color:#107c10;background:#dff6dd}.ioc-package-pin.analog{color:#986f0b}.ioc-package-pin.analog .lead{border-color:#c19c00;background:#fff4ce}
      .ioc-pin-legend{display:flex;flex-wrap:wrap;gap:10px;padding:8px 10px;border-top:1px solid #ededed;color:#616161;font-size:8px}.ioc-pin-legend span{display:flex;align-items:center;gap:4px}.ioc-pin-legend i{width:8px;height:8px;border:1px solid #a19f9d;background:#d8d8d8}.ioc-pin-legend i.gpio{border-color:#107c10;background:#dff6dd}.ioc-pin-legend i.uart{border-color:#038387;background:#d7f4f2}.ioc-pin-legend i.system{border-color:#5c2e91;background:#eadcf8}.ioc-pin-legend i.power{border-color:#a4262c;background:#fde7e9}
      .ioc-table-wrap{max-height:520px;overflow:auto}.ioc-table{width:100%;border-collapse:collapse;font-size:8px}.ioc-table th{position:sticky;z-index:1;top:0;padding:7px 8px;border-bottom:1px solid #c8c8c8;color:#424242;background:#f3f3f3;text-align:left;font-weight:600;white-space:nowrap}.ioc-table td{padding:7px 8px;border-bottom:1px solid #ededed;color:#323130;vertical-align:top}.ioc-table tbody tr:hover{background:#f5faff}.ioc-table code{color:#242424;font:8px Consolas,monospace;overflow-wrap:anywhere}.ioc-table .muted{color:#8a8886}.ioc-signal{display:inline-block;padding:2px 5px;border:1px solid #c8c8c8;background:#fafafa;white-space:nowrap}.ioc-lock{color:#5c2e91}
      .ioc-clock-grid{display:grid;grid-template-columns:repeat(4,minmax(105px,1fr));gap:8px;margin-bottom:12px}.ioc-clock-tile{padding:10px;border:1px solid #d6d6d6;background:#fff}.ioc-clock-tile span{display:block;color:#616161;font-size:8px}.ioc-clock-tile strong{display:block;margin-top:5px;color:#0f6cbd;font:14px Consolas,monospace}
      .ioc-clock-flow{display:flex;align-items:stretch;justify-content:center;gap:6px;margin-bottom:12px;padding:12px;border:1px solid #d6d6d6;background-image:radial-gradient(#d8d8d8 .8px,transparent .8px);background-size:14px 14px;overflow:auto}.ioc-clock-node{min-width:105px;padding:9px;border:1px solid #8a8886;background:#fff;text-align:center}.ioc-clock-node b{display:block;color:#242424;font-size:9px}.ioc-clock-node span{display:block;margin-top:4px;color:#0f6cbd;font:11px Consolas,monospace}.ioc-clock-arrow{display:grid;place-items:center;color:#0f6cbd;font-size:17px}
      .ioc-peripheral-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px}.ioc-peripheral{border:1px solid #d6d6d6;background:#fff}.ioc-peripheral summary{height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;cursor:pointer;list-style:none;background:#f7f7f7}.ioc-peripheral summary::-webkit-details-marker{display:none}.ioc-peripheral summary::before{content:\"+\";width:15px;color:#0f6cbd;font-size:14px}.ioc-peripheral[open] summary::before{content:\"−\"}.ioc-peripheral summary strong{font-size:10px}.ioc-peripheral summary span{margin-left:auto;color:#107c10;font-size:8px}.ioc-peripheral .ioc-kv{grid-template-columns:minmax(100px,.85fr) minmax(120px,1.15fr)}
      .ioc-empty{padding:28px;border:1px dashed #c8c8c8;color:#616161;background:#fafafa;text-align:center;font-size:10px}
      .ioc-raw-tools{display:flex;align-items:center;gap:6px;margin-bottom:8px}.ioc-raw-search{height:29px;min-width:180px;flex:1;padding:0 9px;border:1px solid #8a8886;outline:0;color:#242424;background:#fff;font:9px Consolas,monospace}.ioc-raw-search:focus{border-color:#0f6cbd;box-shadow:inset 0 0 0 1px #0f6cbd}
      .ioc-raw-view{border:1px solid #c8c8c8;background:#fbfbfb;overflow:auto}.ioc-raw-line{min-height:20px;display:grid;grid-template-columns:42px minmax(max-content,1fr);font:9px/20px Consolas,'Cascadia Mono',monospace}.ioc-raw-line:hover{background:#f0f6fc}.ioc-raw-line>span{padding-right:8px;border-right:1px solid #e1e1e1;color:#8a8886;background:#f3f3f3;text-align:right;user-select:none}.ioc-raw-line>code{padding:0 9px;color:#242424;white-space:pre}.ioc-raw-line.comment>code{color:#107c10}.ioc-raw-line.blank>code{color:#a19f9d}
      .ioc-loading{height:100%;display:grid;place-items:center;color:#616161;background:#fff}.ioc-loading div{text-align:center}.ioc-loading i{display:block;width:25px;height:25px;margin:0 auto 9px;border:2px solid #c8c8c8;border-top-color:#0f6cbd;border-radius:50%;animation:iocSpin .8s linear infinite}.ioc-loading strong{display:block;color:#242424;font-size:11px}.ioc-loading span{display:block;margin-top:4px;font-size:9px}@keyframes iocSpin{to{transform:rotate(360deg)}}
      .ioc-status.valid{color:#107c10}.ioc-status.invalid{color:#a4262c}
      @container iocviewer (max-width:720px){.ioc-summary-grid,.ioc-clock-grid{grid-template-columns:repeat(2,minmax(105px,1fr))}.ioc-overview-grid{grid-template-columns:1fr}.ioc-panel.full{grid-column:auto}.ioc-toolbar-actions .ioc-readonly-badge,.ioc-toolbar-actions button:not(.primary){display:none}}
      @container iocviewer (max-width:540px){.ioc-layout{grid-template-columns:1fr;grid-template-rows:39px minmax(0,1fr)}.ioc-nav{display:flex;flex-direction:row;gap:2px;padding:3px;border-right:0;border-bottom:1px solid #c8c8c8;overflow-x:auto}.ioc-nav>button{width:auto;min-width:max-content;height:31px;padding:0 8px}.ioc-nav>button.active::before{left:5px;right:5px;top:auto;bottom:0;width:auto;height:2px}.ioc-source-card,.ioc-readonly-note,.ioc-nav-count{display:none}.ioc-page{padding:10px}.ioc-title-copy span{display:none}.ioc-toolbar{padding-inline:9px}.ioc-package-pin .pin-label{display:none}}
    `;
    document.head.appendChild(style);
  }

  function buildShell(section) {
    section.classList.add("ioc-readonly-view");
    section.innerHTML = `
      <div class="ioc-reader">
        <header class="ioc-toolbar">
          <div class="ioc-title">
            <span class="ioc-file-icon">IOC</span>
            <div class="ioc-title-copy"><strong id="iocViewerFile">正在加载配置…</strong><span id="iocViewerMeta">STM32CubeMX configuration</span></div>
          </div>
          <div class="ioc-toolbar-actions">
            <span class="ioc-readonly-badge">只读</span>
            <button type="button" id="iocCopySummary">复制摘要</button>
            <button type="button" class="primary" id="iocOpenFile">打开 IOC</button>
          </div>
        </header>
        <div class="ioc-layout">
          <nav class="ioc-nav" aria-label="IOC 信息分类">
            <div class="ioc-source-card"><span>当前来源</span><strong id="iocSourceName">STM32_Empty.ioc</strong><small id="iocSourceStatus">空白配置</small></div>
            <button type="button" class="active" data-ioc-page="overview"><span class="ioc-nav-icon">▦</span>概览<span class="ioc-nav-count">—</span></button>
            <button type="button" data-ioc-page="pins"><span class="ioc-nav-icon">⌗</span>引脚<span class="ioc-nav-count">0</span></button>
            <button type="button" data-ioc-page="clocks"><span class="ioc-nav-icon">◷</span>时钟<span class="ioc-nav-count">0</span></button>
            <button type="button" data-ioc-page="peripherals"><span class="ioc-nav-icon">▤</span>外设<span class="ioc-nav-count">0</span></button>
            <button type="button" data-ioc-page="project"><span class="ioc-nav-icon">◇</span>MCU / 项目<span class="ioc-nav-count">0</span></button>
            <button type="button" data-ioc-page="raw"><span class="ioc-nav-icon">≡</span>原始 IOC<span class="ioc-nav-count">0</span></button>
            <div class="ioc-readonly-note">此页面仅展示导入的 IOC 快照，不提供引脚或参数编辑。</div>
          </nav>
          <main class="ioc-main" id="iocViewerMain"><div class="ioc-loading"><div><i></i><strong>读取完整 IOC</strong><span>正在解析 MCU、引脚、时钟与外设</span></div></div></main>
        </div>
      </div>`;

    viewer = {
      section: section,
      main: section.querySelector("#iocViewerMain"),
      file: section.querySelector("#iocViewerFile"),
      meta: section.querySelector("#iocViewerMeta"),
      source: section.querySelector("#iocSourceName"),
      status: section.querySelector("#iocSourceStatus"),
      nav: Array.prototype.slice.call(section.querySelectorAll("[data-ioc-page]")),
      copy: section.querySelector("#iocCopySummary"),
      open: section.querySelector("#iocOpenFile")
    };

    viewer.nav.forEach(function (button) {
      button.addEventListener("click", function () { switchPage(button.dataset.iocPage); });
    });
    viewer.open.addEventListener("click", function () {
      var input = document.getElementById("iocInput");
      if (!input) return;
      input.value = "";
      input.click();
    });
    viewer.copy.addEventListener("click", function () {
      if (!currentModel) return;
      copyText(summaryText(currentModel))
        .then(function () { showNotice("摘要已复制"); })
        .catch(function () { showNotice("复制失败"); });
    });
  }

  function showLoading(fileName) {
    currentModel = null;
    if (!viewer) return;
    viewer.file.textContent = fileName || "正在加载配置…";
    viewer.meta.textContent = "正在清空旧状态并读取新 IOC";
    viewer.source.textContent = fileName || "IOC configuration";
    viewer.status.textContent = "解析中…";
    viewer.main.innerHTML = '<div class="ioc-loading"><div><i></i><strong>读取完整 IOC</strong><span>旧配置已清空，正在建立新的只读快照</span></div></div>';
    viewer.nav.forEach(function (button) {
      var count = button.querySelector(".ioc-nav-count");
      if (count) count.textContent = button.dataset.iocPage === "overview" ? "—" : "0";
    });
  }

  function keyValueRows(entries, stripPrefix) {
    if (!entries.length) return '<div class="ioc-empty">此分类没有配置项</div>';
    return entries.map(function (entry) {
      var key = stripPrefix && entry.key.indexOf(stripPrefix + ".") === 0
        ? entry.key.slice(stripPrefix.length + 1)
        : entry.key;
      return '<div class="ioc-kv"><dt>' + escapeHtml(key) + '</dt><dd title="' + escapeHtml(entry.value) + '">' +
        escapeHtml(displayValue(entry.key, entry.value)) + '</dd></div>';
    }).join("");
  }

  function overviewHtml(model) {
    var values = model.values;
    var sysclk = frequencyText(values["RCC.SYSCLKFreq_VALUE"] || values["RCC.HCLKFreq_Value"] || "0");
    var validClass = model.valid ? "valid" : "invalid";
    var validLabel = model.valid ? "CubeMX 配置有效" : "CubeMX 标记配置异常";
    var deviceRows = [
      ["订货型号", model.mcu], ["设备名称", model.deviceName], ["系列", model.family], ["封装", model.packageName],
      ["配置引脚", values["Mcu.PinsNb"] || model.configuredPins.length], ["启用 IP", values["Mcu.IPNb"] || model.ips.length]
    ];
    var projectRows = [
      ["项目名称", model.projectName], ["工具链", model.toolchain], ["IOC 文件版本", values["File.Version"] || "—"],
      ["板级定义", values.board || "—"], ["保持用户布局", values.KeepUserPlacement || "—"], ["用户常量", values["Mcu.UserConstants"] || "—"]
    ];
    function rows(items) {
      return items.map(function (item) {
        return '<div class="ioc-kv"><dt>' + escapeHtml(item[0]) + '</dt><dd>' + escapeHtml(item[1]) + '</dd></div>';
      }).join("");
    }
    return `
      <section class="ioc-page" data-ioc-content="overview">
        <div class="ioc-page-heading"><div><h2>IOC 配置概览</h2><p>STM32CubeMX 文件的只读快照；所有原始字段均保留在“原始 IOC”页。</p></div><span class="ioc-status ${validClass}">${escapeHtml(validLabel)}</span></div>
        <div class="ioc-summary-grid">
          <div class="ioc-stat"><span>MCU</span><strong>${escapeHtml(model.mcu)}</strong><small>${escapeHtml(model.packageName)}</small></div>
          <div class="ioc-stat"><span>Configured pins</span><strong>${model.configuredPins.length}</strong><small>共 ${model.physicalPins.length} 个封装引脚</small></div>
          <div class="ioc-stat"><span>System clock</span><strong>${escapeHtml(sysclk)}</strong><small>${escapeHtml(values["RCC.SYSCLKSource"] || "未声明时钟源")}</small></div>
          <div class="ioc-stat"><span>Raw entries</span><strong>${model.entries.length}</strong><small>${model.lines.length} 行原始文本</small></div>
        </div>
        <div class="ioc-overview-grid">
          <div class="ioc-panel"><div class="ioc-panel-title">MCU 标识 <small>Mcu.*</small></div>${rows(deviceRows)}</div>
          <div class="ioc-panel"><div class="ioc-panel-title">项目摘要 <small>ProjectManager.*</small></div>${rows(projectRows)}</div>
          <div class="ioc-panel full"><div class="ioc-panel-title">完整性检查 <small>read only</small></div><div class="ioc-health">
            <div class="ioc-health-row${model.valid ? "" : " warn"}"><i>${model.valid ? "✓" : "!"}</i>${escapeHtml(validLabel)}</div>
            <div class="ioc-health-row"><i>✓</i>已解析 ${model.entries.length} 个 key=value 配置项，未进行可写转换</div>
            <div class="ioc-health-row"><i>✓</i>已识别 ${model.configuredPins.length} 个配置引脚和 ${model.peripherals.length} 个外设配置组</div>
            <div class="ioc-health-row"><i>✓</i>原始文本逐行保留，可用于核对 CubeMX 未分类字段</div>
          </div></div>
        </div>
      </section>`;
  }

  function packageSideHtml(pins, side) {
    return '<div class="ioc-package-side ' + side + '">' + pins.map(function (pin) {
      var title = pin.number + " " + pin.name + (pin.signal ? " — " + pin.signal : " — 未配置");
      var label = pin.number + " " + pin.name;
      return '<div class="ioc-package-pin ' + pin.type + (pin.configured ? " configured" : "") + '" title="' + escapeHtml(title) + '">' +
        (side === "left" || side === "top" ? '<span class="pin-label">' + escapeHtml(label) + '</span><i class="lead"></i>' : '<i class="lead"></i><span class="pin-label">' + escapeHtml(label) + '</span>') +
        '</div>';
    }).join("") + '</div>';
  }

  function pinRowsHtml(model) {
    var rows = model.physicalPins.map(function (pin) {
      return {
        number: pin.number,
        name: pin.name,
        id: pin.id,
        signal: pin.signal,
        mode: pin.mode,
        label: pin.label,
        locked: pin.locked
      };
    });
    model.extraPins.forEach(function (pin) {
      rows.push({ number: "—", name: pin.base || pin.id, id: pin.id, signal: pin.signal, mode: pin.mode, label: pin.label, locked: pin.locked });
    });
    return rows.map(function (pin) {
      return '<tr><td><code>' + escapeHtml(pin.number) + '</code></td><td><code title="' + escapeHtml(pin.id) + '">' + escapeHtml(pin.name) + '</code></td>' +
        '<td>' + (pin.signal ? '<span class="ioc-signal">' + escapeHtml(pin.signal) + '</span>' : '<span class="muted">未配置</span>') + '</td>' +
        '<td><code>' + escapeHtml(pin.mode || "—") + '</code></td><td>' + escapeHtml(pin.label || "—") + '</td><td>' +
        (pin.locked ? '<span class="ioc-lock">🔒 true</span>' : '<span class="muted">—</span>') + '</td></tr>';
    }).join("");
  }

  function pinsHtml(model) {
    var pins = model.physicalPins;
    return `
      <section class="ioc-page" data-ioc-content="pins">
        <div class="ioc-page-heading"><div><h2>引脚分配</h2><p>封装与信号均为只读；此处不提供点击修改、Reset 或 Generate 操作。</p></div><span>${model.configuredPins.length} configured / ${pins.length} package pins</span></div>
        <div class="ioc-pin-layout">
          <div class="ioc-package-card"><div class="ioc-card-head">${escapeHtml(model.packageName)} 封装图 <span>${escapeHtml(model.mcu)}</span></div>
            <div class="ioc-package-stage">
              ${packageSideHtml(pins.slice(0, 12), "left")}
              ${packageSideHtml(pins.slice(12, 24), "bottom")}
              ${packageSideHtml(pins.slice(24, 36), "right")}
              ${packageSideHtml(pins.slice(36, 48), "top")}
              <div class="ioc-chip-body"><b>ST</b><strong>${escapeHtml(model.deviceName)}</strong><small>${escapeHtml(model.packageName)} · ARM Cortex-M3</small></div>
            </div>
            <div class="ioc-pin-legend"><span><i class="gpio"></i>GPIO</span><span><i class="uart"></i>USART</span><span><i class="system"></i>System / RCC</span><span><i class="power"></i>Power / GND</span><span><i></i>Unassigned</span></div>
          </div>
          <div class="ioc-table-card"><div class="ioc-card-head">全部引脚与信号 <span>只读</span></div><div class="ioc-table-wrap"><table class="ioc-table"><thead><tr><th>#</th><th>Pin</th><th>Signal</th><th>Mode</th><th>Label</th><th>Locked</th></tr></thead><tbody>${pinRowsHtml(model)}</tbody></table></div></div>
        </div>
      </section>`;
  }

  function clockValue(model, keys) {
    for (var index = 0; index < keys.length; index += 1) {
      if (model.values[keys[index]]) return frequencyText(model.values[keys[index]]);
    }
    return "—";
  }

  function clocksHtml(model) {
    var values = model.values;
    var tree = window.AliceClockTree?.fromValues?.(values) || {};
    var format = window.AliceClockTree?.formatFrequency || function (value) { return frequencyText(value || "0"); };
    var sourceName = tree.source === "PLLCLK" ? tree.pllSource : tree.source || "CLOCK";
    var sourceFrequency = sourceName === "HSE" ? tree.hse : tree.hsi;
    var pllMul = tree.pllMultiplier ? "×" + tree.pllMultiplier : "BYPASS";
    return `
      <section class="ioc-page" data-ioc-content="clocks">
        <div class="ioc-page-heading"><div><h2>时钟配置</h2><p>从 RCC.* 字段提取的频率、分频与时钟源；下方表格保留全部 RCC 配置。</p></div><span>${model.clockEntries.length} RCC entries</span></div>
        <div class="ioc-clock-grid">
          <div class="ioc-clock-tile"><span>SYSCLK</span><strong>${escapeHtml(format(tree.sysclk))}</strong></div><div class="ioc-clock-tile"><span>HCLK / AHB</span><strong>${escapeHtml(format(tree.hclk))}</strong></div>
          <div class="ioc-clock-tile"><span>PCLK1 / APB1 · TIM ${escapeHtml(format(tree.timerPclk1))}</span><strong>${escapeHtml(format(tree.pclk1))}</strong></div><div class="ioc-clock-tile"><span>PCLK2 / APB2 · TIM ${escapeHtml(format(tree.timerPclk2))}</span><strong>${escapeHtml(format(tree.pclk2))}</strong></div>
        </div>
        <div class="ioc-clock-flow"><div class="ioc-clock-node"><b>${escapeHtml(sourceName)}</b><span>${escapeHtml(format(sourceFrequency))}</span></div><div class="ioc-clock-arrow">→</div><div class="ioc-clock-node"><b>PLL ${escapeHtml(pllMul)}</b><span>${escapeHtml(format(tree.pll))}</span></div><div class="ioc-clock-arrow">→</div><div class="ioc-clock-node"><b>SYSCLK · ${escapeHtml(tree.source || "—")}</b><span>${escapeHtml(format(tree.sysclk))}</span></div><div class="ioc-clock-arrow">→</div><div class="ioc-clock-node"><b>AHB ÷ ${escapeHtml(tree.ahbDivider || 1)}</b><span>${escapeHtml(format(tree.hclk))}</span></div></div>
        <div class="ioc-panel"><div class="ioc-panel-title">全部 RCC 字段 <small>原值与格式化频率</small></div>${keyValueRows(model.clockEntries, "RCC")}</div>
      </section>`;
  }

  function peripheralsHtml(model) {
    var cards = model.peripherals.map(function (group, index) {
      var rows = group.entries.length ? keyValueRows(group.entries, group.name) : '<div class="ioc-empty">IOC 声明了此 IP，但没有独立参数字段</div>';
      return '<details class="ioc-peripheral"' + (index < 2 ? " open" : "") + '><summary><strong>' + escapeHtml(group.name) + '</strong><span>ENABLED · ' + group.entries.length + ' fields</span></summary>' + rows + '</details>';
    }).join("");
    return `
      <section class="ioc-page" data-ioc-content="peripherals">
        <div class="ioc-page-heading"><div><h2>外设与 IP</h2><p>依据 Mcu.IP* 和 IOC 前缀分组展示；展开卡片可核对每个原始参数。</p></div><span>${model.peripherals.length} groups</span></div>
        <div class="ioc-peripheral-list">${cards || '<div class="ioc-empty">IOC 中没有启用外设</div>'}</div>
      </section>`;
  }

  function projectHtml(model) {
    var combined = model.mcuEntries.concat(model.projectEntries).sort(function (a, b) { return naturalCompare(a.key, b.key); });
    return `
      <section class="ioc-page" data-ioc-content="project">
        <div class="ioc-page-heading"><div><h2>MCU 与项目设置</h2><p>完整展示 Mcu.*、ProjectManager.*、文件版本和板级标记。</p></div><span>${combined.length} fields</span></div>
        <div class="ioc-overview-grid">
          <div class="ioc-panel"><div class="ioc-panel-title">MCU 配置 <small>${model.mcuEntries.length} fields</small></div>${keyValueRows(model.mcuEntries, "Mcu")}</div>
          <div class="ioc-panel"><div class="ioc-panel-title">项目与生成设置 <small>${model.projectEntries.length} fields</small></div>${keyValueRows(model.projectEntries, null)}</div>
        </div>
      </section>`;
  }

  function rawLinesHtml(model, query) {
    var needle = String(query || "").trim().toLowerCase();
    var found = 0;
    var html = model.lines.map(function (line, index) {
      if (needle && line.toLowerCase().indexOf(needle) < 0) return "";
      found += 1;
      var trimmed = line.trim();
      var kind = trimmed.charAt(0) === "#" ? " comment" : (!trimmed ? " blank" : "");
      return '<div class="ioc-raw-line' + kind + '"><span>' + (index + 1) + '</span><code>' + escapeHtml(line || " ") + '</code></div>';
    }).join("");
    return html || '<div class="ioc-empty">没有匹配 “' + escapeHtml(query) + '” 的原始行</div>';
  }

  function rawHtml(model) {
    return `
      <section class="ioc-page" data-ioc-content="raw">
        <div class="ioc-page-heading"><div><h2>原始 IOC 全文</h2><p>按原始行号展示未经改写的文件内容，确保所有 key=value 均可核对。</p></div><span>${model.lines.length} lines · ${model.entries.length} entries</span></div>
        <div class="ioc-raw-tools"><input class="ioc-raw-search" id="iocRawSearch" type="search" placeholder="筛选 key 或 value（不会修改文件）" aria-label="筛选原始 IOC"><button type="button" id="iocCopyRaw">复制全文</button></div>
        <div class="ioc-raw-view" id="iocRawView">${rawLinesHtml(model, "")}</div>
      </section>`;
  }

  function renderModel(model) {
    currentModel = model;
    viewer.file.textContent = model.fileName;
    viewer.meta.textContent = model.mcu + " · " + model.packageName + " · " + model.entries.length + " entries";
    viewer.source.textContent = model.fileName;
    viewer.status.textContent = model.valid ? "完整配置 · 校验正常" : "完整配置 · CubeMX 标记异常";

    var counts = {
      overview: "—",
      pins: model.configuredPins.length,
      clocks: model.clockEntries.length,
      peripherals: model.peripherals.length,
      project: model.mcuEntries.length + model.projectEntries.length,
      raw: model.entries.length
    };
    viewer.nav.forEach(function (button) {
      var count = button.querySelector(".ioc-nav-count");
      if (count) count.textContent = counts[button.dataset.iocPage];
    });

    viewer.main.innerHTML = overviewHtml(model) + pinsHtml(model) + clocksHtml(model) + peripheralsHtml(model) + projectHtml(model) + rawHtml(model);
    var rawSearch = viewer.main.querySelector("#iocRawSearch");
    var rawView = viewer.main.querySelector("#iocRawView");
    rawSearch?.addEventListener("input", function () { rawView.innerHTML = rawLinesHtml(model, rawSearch.value); });
    viewer.main.querySelector("#iocCopyRaw")?.addEventListener("click", function () {
      copyText(model.rawText)
        .then(function () { showNotice("IOC 全文已复制"); })
        .catch(function () { showNotice("复制失败"); });
    });
    switchPage(activeView, false);

    window.dispatchEvent(new CustomEvent("alice:ioc-viewer-loaded", {
      detail: { fileName: model.fileName, mcu: model.mcu, entries: model.entries.length, pins: model.configuredPins.length, clockTree: window.AliceClockTree?.fromValues?.(model.values) || null }
    }));
  }

  function switchPage(name, scrollTop) {
    if (!viewer) return;
    var valid = ["overview", "pins", "clocks", "peripherals", "project", "raw"];
    activeView = valid.indexOf(name) >= 0 ? name : "overview";
    viewer.nav.forEach(function (button) { button.classList.toggle("active", button.dataset.iocPage === activeView); });
    viewer.main.querySelectorAll("[data-ioc-content]").forEach(function (page) {
      page.classList.toggle("active", page.dataset.iocContent === activeView);
    });
    if (scrollTop !== false) viewer.main.scrollTop = 0;
  }

  function summaryText(model) {
    return [
      "AliceSIM IOC 只读摘要",
      "文件: " + model.fileName,
      "项目: " + model.projectName,
      "MCU: " + model.mcu,
      "设备: " + model.deviceName,
      "系列 / 封装: " + model.family + " / " + model.packageName,
      "配置引脚: " + model.configuredPins.length,
      "外设组: " + model.peripherals.map(function (group) { return group.name; }).join(", "),
      "SYSCLK: " + (window.AliceClockTree?.formatFrequency?.(window.AliceClockTree.fromValues(model.values).sysclk) || frequencyText(model.values["RCC.SYSCLKFreq_VALUE"] || "0")),
      "工具链: " + model.toolchain,
      "配置项: " + model.entries.length,
      "状态: " + (model.valid ? "有效" : "CubeMX 标记异常")
    ].join("\n");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.readOnly = true;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        resolve();
      } catch (error) { reject(error); }
    });
  }

  function showNotice(message) {
    if (!viewer) return;
    clearTimeout(noticeTimer);
    var original = currentModel ? (currentModel.valid ? "完整配置 · 校验正常" : "完整配置 · CubeMX 标记异常") : "";
    viewer.status.textContent = message;
    noticeTimer = setTimeout(function () { if (viewer) viewer.status.textContent = original; }, 1600);
  }

  function loadText(text, fileName, options) {
    options = options || {};
    if (!viewer) return null;
    if (options.sequence != null && options.sequence !== loadSequence) return null;
    var model = parseIoc(text, fileName);
    renderModel(model);
    return model;
  }

  function readFile(file) {
    if (!file || !/\.ioc$/i.test(file.name || "")) return Promise.resolve(null);
    var sequence = ++loadSequence;
    showLoading(file.name);
    var reading = typeof file.text === "function"
      ? file.text()
      : new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || "")); };
        reader.onerror = function () { reject(reader.error || new Error("IOC read failed")); };
        reader.readAsText(file);
      });
    return reading.then(function (text) {
      return loadText(text, file.name, { sequence: sequence });
    }).catch(function () {
      if (sequence !== loadSequence) return null;
      viewer.main.innerHTML = '<div class="ioc-empty">无法读取此 IOC 文件，请重新选择。</div>';
      viewer.status.textContent = "读取失败";
      return null;
    });
  }

  function loadDefault() {
    var sequence = ++loadSequence;
    showLoading("STM32_Empty.ioc");
    loadText(FALLBACK_IOC, "STM32_Empty.ioc", { sequence: sequence });
  }

  function openViewerTab() {
    var tab = document.querySelector('.work-tab[data-tab="pinout"]');
    if (!tab) return;
    tab.hidden = false;
    tab.style.display = "";
    tab.click();
  }

  function init() {
    var section = document.querySelector('.pinout-view[data-view-tab="pinout"]');
    if (!section) return;
    addStyles();
    buildShell(section);

    var tab = document.querySelector('.work-tab[data-tab="pinout"]');
    if (tab) {
      var symbol = tab.querySelector(".tab-symbol");
      var close = tab.querySelector("small");
      tab.replaceChildren(symbol || document.createTextNode("▦"), document.createTextNode(" IOC 配置（只读）"), close || document.createTextNode("×"));
    }

    var input = document.getElementById("iocInput");
    input?.addEventListener("change", function (event) {
      var file = event.target.files?.[0];
      readFile(file);
      setTimeout(function () { event.target.value = ""; }, 0);
    });
    document.getElementById("viewIocConfig")?.addEventListener("click", openViewerTab);
    window.addEventListener("drop", function (event) { readFile(event.dataTransfer?.files?.[0]); });

    document.addEventListener("click", function (event) {
      var row = event.target.closest?.(".tree-row.file[data-file]");
      if (!row || !/\.ioc$/i.test(row.dataset.file || "")) return;
      if (row.classList.contains("alice-project-file") && row.dataset.path) return;
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll(".tree-row.file").forEach(function (item) { item.classList.toggle("selected", item === row); });
      openViewerTab();
    }, true);

    window.AliceIocViewer = Object.freeze({
      load: function (text, fileName) {
        var sequence = ++loadSequence;
        showLoading(fileName || "Imported.ioc");
        return loadText(text, fileName || "Imported.ioc", { sequence: sequence });
      },
      loadFile: readFile,
      open: openViewerTab,
      show: switchPage,
      getData: function () { return currentModel; },
      getRaw: function () { return currentModel ? currentModel.rawText : ""; }
    });

    loadDefault();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}());
