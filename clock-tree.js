(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AliceClockTree = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizedKey(value) {
    return String(value || "").toLowerCase().replace(/_/g, "");
  }

  function indexValues(values) {
    var result = Object.create(null);
    Object.keys(values || {}).forEach(function (key) { result[normalizedKey(key)] = values[key]; });
    return result;
  }

  function valueOf(index, keys) {
    for (var position = 0; position < keys.length; position += 1) {
      var key = normalizedKey(keys[position]);
      if (Object.prototype.hasOwnProperty.call(index, key) && index[key] !== "") return index[key];
    }
    return null;
  }

  function frequency(value) {
    if (value == null || value === "") return null;
    var text = String(value).trim().replace(/[_']/g, "");
    var match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(GHZ|MHZ|KHZ|HZ)?$/i);
    if (!match) return null;
    var number = Number(match[1]);
    if (!Number.isFinite(number)) return null;
    var scale = { GHZ: 1e9, MHZ: 1e6, KHZ: 1e3, HZ: 1 }[String(match[2] || "HZ").toUpperCase()] || 1;
    return number * scale;
  }

  function divider(value, fallback) {
    var text = String(value == null ? "" : value).toUpperCase();
    var match = text.match(/(?:DIV|_)(\d+)$/) || text.match(/^([0-9]+)$/);
    var number = match ? Number(match[1]) : Number(fallback);
    return Number.isFinite(number) && number > 0 ? number : 1;
  }

  function pllMultiplier(value) {
    var text = String(value == null ? "" : value).toUpperCase();
    var match = text.match(/(?:MUL|PLLN|_)(\d+)(?:_|$)/) || text.match(/^([0-9]+)$/);
    var number = match ? Number(match[1]) : null;
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function defaultHsi(values) {
    var identity = String(values["Mcu.Family"] || values["Mcu.Name"] || values["Mcu.CPN"] || "").toUpperCase();
    if (/STM32(?:H5|H7)/.test(identity)) return 64000000;
    if (/STM32(?:F1|F2|L1)/.test(identity)) return 8000000;
    return 16000000;
  }

  function formatFrequency(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "—";
    if (numeric >= 1e9) return (numeric / 1e9).toLocaleString("zh-CN", { maximumFractionDigits: 3 }) + " GHz";
    if (numeric >= 1e6) return (numeric / 1e6).toLocaleString("zh-CN", { maximumFractionDigits: 3 }) + " MHz";
    if (numeric >= 1e3) return (numeric / 1e3).toLocaleString("zh-CN", { maximumFractionDigits: 3 }) + " kHz";
    return Math.round(numeric).toLocaleString("zh-CN") + " Hz";
  }

  function fromValues(values) {
    var sourceValues = values || {};
    var index = indexValues(sourceValues);
    var hsi = frequency(valueOf(index, ["RCC.HSI_VALUE", "RCC.HSIFreq_Value"])) || defaultHsi(sourceValues);
    var hse = frequency(valueOf(index, ["RCC.HSE_VALUE", "RCC.HSEFreq_Value"]));
    var pllDirect = frequency(valueOf(index, ["RCC.PLLCLKFreq_Value", "RCC.PLL1PClockFreq_Value", "RCC.PLL1QClockFreq_Value"]));
    var sysDirect = frequency(valueOf(index, ["RCC.SYSCLKFreq_VALUE", "RCC.SYSCLKFreq_Value"]));
    var hclkDirect = frequency(valueOf(index, ["RCC.HCLKFreq_Value", "RCC.AHBFreq_Value"]));
    var pclk1Direct = frequency(valueOf(index, ["RCC.APB1Freq_Value", "RCC.PCLK1Freq_Value"]));
    var pclk2Direct = frequency(valueOf(index, ["RCC.APB2Freq_Value", "RCC.PCLK2Freq_Value"]));
    var sourceText = String(valueOf(index, ["RCC.SYSCLKSource", "RCC.SYSCLKSourceVirtual"]) || "RCC_SYSCLKSOURCE_HSI").toUpperCase();
    var pllSourceText = String(valueOf(index, ["RCC.PLLSourceVirtual", "RCC.PLLSource"]) || "RCC_PLLSOURCE_HSI").toUpperCase();
    var pllSource = pllSourceText.indexOf("HSE") >= 0 ? hse : hsi;
    var prediv = divider(valueOf(index, ["RCC.HSEPredivValue", "RCC.PREDIV1", "RCC.PLLM"]), 1);
    var multiplier = pllMultiplier(valueOf(index, ["RCC.PLLMul", "RCC.PLLN"]));
    var pllOutputDivider = divider(valueOf(index, ["RCC.PLLP", "RCC.PLLR"]), 1);
    var pll = pllDirect || (pllSource && multiplier ? pllSource / prediv * multiplier / pllOutputDivider : null);
    var source = sourceText.indexOf("PLL") >= 0 ? "PLLCLK" : sourceText.indexOf("HSE") >= 0 ? "HSE" : "HSI";
    var sysclk = sysDirect || (source === "PLLCLK" ? pll : source === "HSE" ? hse : hsi);
    var ahbDivider = divider(valueOf(index, ["RCC.AHBCLKDivider", "RCC.SYSCLKDivider"]), 1);
    var apb1Divider = divider(valueOf(index, ["RCC.APB1CLKDivider", "RCC.HCLK1Divider"]), 1);
    var apb2Divider = divider(valueOf(index, ["RCC.APB2CLKDivider", "RCC.HCLK2Divider"]), 1);
    var hclk = hclkDirect || (sysclk ? sysclk / ahbDivider : null);
    var pclk1 = pclk1Direct || (hclk ? hclk / apb1Divider : null);
    var pclk2 = pclk2Direct || (hclk ? hclk / apb2Divider : null);
    var timerPclk1 = pclk1 ? pclk1 * (apb1Divider === 1 ? 1 : 2) : null;
    var timerPclk2 = pclk2 ? pclk2 * (apb2Divider === 1 ? 1 : 2) : null;
    var directCount = [pllDirect, sysDirect, hclkDirect, pclk1Direct, pclk2Direct].filter(Boolean).length;
    var hasRcc = Object.keys(sourceValues).some(function (key) { return /^RCC\./i.test(key); });
    var issues = [];
    if (!hasRcc) issues.push("IOC 未声明 RCC 时钟字段，使用 MCU 复位 HSI 时钟");
    if (source === "HSE" && !hse) issues.push("SYSCLK 选择 HSE，但 IOC 未声明 HSE 频率");
    if (source === "PLLCLK" && !pll) issues.push("SYSCLK 选择 PLL，但无法解析 PLL 输出频率");
    return {
      hsi: hsi,
      hse: hse,
      pll: pll,
      sysclk: sysclk,
      hclk: hclk,
      pclk1: pclk1,
      pclk2: pclk2,
      timerPclk1: timerPclk1,
      timerPclk2: timerPclk2,
      source: source,
      pllSource: pllSourceText.indexOf("HSE") >= 0 ? "HSE" : "HSI",
      pllMultiplier: multiplier,
      pllPredivider: prediv,
      ahbDivider: ahbDivider,
      apb1Divider: apb1Divider,
      apb2Divider: apb2Divider,
      confidence: !hasRcc ? "reset-default" : directCount >= 3 ? "ioc-direct" : "derived",
      issues: issues,
      valid: Boolean(sysclk && hclk && pclk1 && pclk2 && !issues.some(function (issue) { return /无法解析|未声明 HSE/.test(issue); }))
    };
  }

  function fromText(text) {
    var values = {};
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var separator = line.indexOf("=");
      if (separator <= 0 || /^\s*#/.test(line)) return;
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    });
    return fromValues(values);
  }

  return Object.freeze({ fromValues: fromValues, fromText: fromText, formatFrequency: formatFrequency, frequency: frequency, divider: divider });
}));
