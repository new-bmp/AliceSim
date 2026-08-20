(function (root) {
  "use strict";

  var currentModel = null;
  var runtime = null;
  var tracePin = "";
  var tracePins = [];
  var traceChannels = [];
  var traceSamples = [];
  var traceSamplesByPin = Object.create(null);
  var lastUartActivityMs = -Infinity;
  var uartActiveUntilMs = -Infinity;
  var MAX_TRACE_SAMPLES = 720;
  var workerBridge = null;
  var workerState = null;
  var workerRequestId = 0;
  var SIM_MODEL_REQUEST_ATTEMPTS = 2;
  var SIM_MODEL_RETRY_DELAY_MS = 180;

  function workerInputs() {
    var inputs = { gpio: {}, adc: {}, i2c: [], spi: [], peripherals: [] };
    if (!root.AliceSchematic) return inputs;
    var pins = currentModel && currentModel.pins || {};
    Object.keys(pins).forEach(function (key) {
      var physical = pins[key] && (pins[key].physicalPin || pins[key].pin) || key;
      if (!/^P[A-Z]\d+$/.test(String(physical))) return;
      var value = typeof root.AliceSchematic.sampleMcuPin === "function" ? root.AliceSchematic.sampleMcuPin(physical) : null;
      inputs.gpio[String(physical).toUpperCase()] = value;
    });
    modelAdcs(currentModel).forEach(function (adc) {
      var instance = adc.instance || adc.handle || "";
      var channels = Array.isArray(adc.channels) ? adc.channels : [];
      channels.forEach(function (channel) {
        var sample = typeof root.AliceSchematic.sampleAdc === "function"
          ? root.AliceSchematic.sampleAdc(instance, { pin: channel.pin, channel: channel.channel })
          : { value: null, raw: null, voltage: null, connected: false };
        var key = [String(instance), String(channel.channel || ""), String(channel.pin || "")].join("|");
        inputs.adc[key] = sample;
      });
      var primary = primaryAdcChannel(adc);
      if (primary) {
        var primarySample = inputs.adc[[String(instance), String(primary.channel || ""), String(primary.pin || "")].join("|")];
        inputs.adc[[String(instance), "", ""].join("|")] = primarySample;
      }
    });
    if (typeof root.AliceSchematic.getFirmwareInputSnapshot === "function") {
      var peripheralInputs = root.AliceSchematic.getFirmwareInputSnapshot() || {};
      inputs.i2c = Array.isArray(peripheralInputs.i2c) ? peripheralInputs.i2c : [];
      inputs.spi = Array.isArray(peripheralInputs.spi) ? peripheralInputs.spi : [];
      inputs.peripherals = Array.isArray(peripheralInputs.peripherals) ? peripheralInputs.peripherals : [];
    }
    return inputs;
  }

  function handleWorkerEvent(kind, event) {
    var payload = event || {};
    if (kind === "gpio") {
      var gpioPin = String(payload.pin || payload.physicalPin || "").toUpperCase();
      if (root.AliceSchematic && typeof root.AliceSchematic.driveMcuPin === "function") root.AliceSchematic.driveMcuPin(gpioPin, payload.value, { render: false, source: "firmware-worker" });
      if (tracePins.indexOf(gpioPin) >= 0) appendTraceSample(gpioPin, Number(payload.timeMs != null ? payload.timeMs : payload.time) || 0, payload.value);
      dispatch("alice:firmware-gpio", payload);
      return;
    }
    if (kind === "gpio-read") { dispatch("alice:firmware-gpio-read", payload); return; }
    if (kind === "pwm") {
      var timer = findTimer(currentModel, payload.instance || payload.timer || payload.handle);
      var channel = timer && Array.isArray(timer.channels) ? timer.channels.find(function (item) { return Number(item.channelNumber) === Number(payload.channel); }) : null;
      var pwmEvent = Object.assign({}, payload, timer ? { instance: timer.instance || payload.instance, handle: timer.handle || payload.handle, timerClockHz: timer.clockHz, frequencyHz: payload.frequencyHz != null ? payload.frequencyHz : timer.frequencyHz, pin: payload.pin || channel && channel.pin || "", render: false } : { render: false });
      var pwmResult = root.AliceSchematic && typeof root.AliceSchematic.driveMcuPwm === "function" ? root.AliceSchematic.driveMcuPwm(pwmEvent) : false;
      pwmEvent.result = pwmResult;
      dispatch("alice:firmware-pwm", pwmEvent);
      return;
    }
    if (kind === "uart-tx") {
      var uart = findUart(currentModel, payload.instance || payload.uart || payload.handle, false);
      var uartEvent = Object.assign({}, payload, uart ? { instance: uart.instance || payload.instance, handle: uart.handle, baudRate: uart.baudRate, txPin: uart.txPin, rxPin: uart.rxPin, frame: uart.frame } : {});
      var txTime = Number(payload.timeMs != null ? payload.timeMs : payload.time) || 0;
      markUartActivity(txTime, uart, Array.isArray(payload.bytes) ? payload.bytes.length : String(payload.text || "").length);
      if (uart && uart.txPin && root.AliceSchematic && typeof root.AliceSchematic.driveMcuPin === "function") root.AliceSchematic.driveMcuPin(uart.txPin, 1, { render: false, source: "uart-worker" });
      dispatch("alice:firmware-uart-tx", uartEvent);
      return;
    }
    if (kind === "i2c-tx") {
      var i2c = findI2c(currentModel, payload.instance || payload.i2c || payload.handle);
      var i2cEvent = Object.assign({}, payload, i2c ? { instance: i2c.instance || payload.instance, handle: i2c.handle || payload.handle, sclPin: i2c.sclPin, sdaPin: i2c.sdaPin, clockSpeed: i2c.clockSpeed, addressBits: i2c.addressBits } : {});
      i2cEvent.result = root.AliceSchematic && typeof root.AliceSchematic.handleI2cTransmission === "function" ? root.AliceSchematic.handleI2cTransmission(i2cEvent) : { accepted: false, targetCount: 0, reason: "schematic-unavailable" };
      dispatch("alice:firmware-i2c-tx", i2cEvent);
      return;
    }
    if (kind === "spi-tx") {
      var spi = findSpi(currentModel, payload.instance || payload.spi || payload.handle);
      var spiEvent = Object.assign({}, payload, spi ? { instance: spi.instance || payload.instance, handle: spi.handle || payload.handle, sckPin: spi.sckPin, mosiPin: spi.mosiPin, misoPin: spi.misoPin, mode: spi.mode, dataSize: spi.dataSize, clockPolarity: spi.clockPolarity, clockPhase: spi.clockPhase } : {});
      spiEvent.result = root.AliceSchematic && typeof root.AliceSchematic.handleSpiTransmission === "function" ? root.AliceSchematic.handleSpiTransmission(spiEvent) : { accepted: false, targetCount: 0, reason: "schematic-unavailable" };
      dispatch("alice:firmware-spi-tx", spiEvent);
      return;
    }
    if (kind === "peripheral") {
      var peripheralType = String(payload && (payload.peripheralType || payload.type) || "").toLowerCase();
      var peripheralEvent = Object.assign({}, payload, { peripheralType: peripheralType });
      peripheralEvent.result = root.AliceSchematic && typeof root.AliceSchematic.handlePeripheralOperation === "function" ? root.AliceSchematic.handlePeripheralOperation(peripheralEvent) : { accepted: false, targetCount: 0, targets: [], result: null, reason: "schematic-unavailable" };
      dispatch("alice:firmware-peripheral", peripheralEvent);
      return;
    }
    dispatch("alice:firmware-" + kind, payload);
  }

  function compressTrace(samples) {
    if (root.AliceSimulationAccel && typeof root.AliceSimulationAccel.compressTrace === "function") {
      return root.AliceSimulationAccel.compressTrace(samples, MAX_TRACE_SAMPLES);
    }
    return Array.isArray(samples) ? samples.slice() : [];
  }

  function createWorkerBridge() {
    if (typeof root.Worker !== "function" || !root.location || !root.location.href) return null;
    var url;
    try { url = new URL("./firmware-worker.js?v=20260820.2", root.location.href); } catch (_) { return null; }
    var worker;
    try { worker = new root.Worker(url.href); } catch (_) { return null; }
    var pending = new Map();
    var failedError = null;

    function rejectPending(error) {
      pending.forEach(function (request) {
        root.clearTimeout(request.timer);
        request.reject(error);
      });
      pending.clear();
    }

    function failBridge(error) {
      if (failedError) return;
      failedError = error instanceof Error ? error : new Error(String(error || "固件 Worker 已停止"));
      rejectPending(failedError);
      try { worker.terminate(); } catch (_) {}
    }

    function request(message, updateState, timeoutMs) {
      if (failedError) return Promise.reject(failedError);
      return new Promise(function (resolve, reject) {
        var id = ++workerRequestId;
        var timer = root.setTimeout(function () {
          failBridge(new Error("固件 Worker 响应超时"));
        }, Math.max(1000, Number(timeoutMs) || 15000));
        pending.set(id, { resolve: resolve, reject: reject, updateState: Boolean(updateState), timer: timer });
        try {
          worker.postMessage(Object.assign({ id: id }, message));
        } catch (error) {
          root.clearTimeout(timer);
          pending.delete(id);
          failBridge(error);
          reject(failedError || error);
        }
      });
    }

    worker.onmessage = function (message) {
      var data = message && message.data || {};
      if (data.type === "event") { handleWorkerEvent(data.kind, data.detail); return; }
      if (data.type !== "result") return;
      var request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      root.clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else {
        if (request.updateState) {
          workerState = data.value;
          if (workerState && typeof workerState === "object") handleWorkerEvent("state", workerState);
        }
        request.resolve(data.value);
      }
    };
    worker.onerror = function (event) {
      failBridge(new Error(event && event.message || "固件 Worker 已停止"));
    }
    return {
      worker: worker,
      init: function (model) { return request({ command: "init", model: model }, true); },
      sync: function (inputs) { return request({ command: "sync", inputs: inputs }, false); },
      step: function (inputs, deltaMs) { return request({ command: "step", inputs: inputs, deltaMs: deltaMs }, true); },
      call: function (method) {
        return request({ command: "call", method: method, args: Array.prototype.slice.call(arguments, 1) }, true);
      },
      terminate: function () {
        failBridge(new Error("固件 Worker 已关闭"));
      }
    };
  }

  function editorElement() {
    return document.getElementById("codeEditor");
  }

  function workspacePayload() {
    var editor = editorElement();
    var workspace = root.AliceProjectWorkspace;
    if (workspace && typeof workspace.createClangPayload === "function") {
      var state = typeof workspace.getState === "function" ? workspace.getState() : null;
      var activePath = state && state.activePath || editor && editor.dataset.aliceProjectPath || "";
      var payload = workspace.createClangPayload({
        all: true,
        activePath: activePath,
        activeCode: editor ? editor.value : ""
      });
      if (payload) return payload;
    }

    var filename = editor && editor.dataset.aliceProjectPath || "main.c";
    var files = {};
    files[filename] = editor ? editor.value : "";
    var iocText = root.AliceIocViewer && typeof root.AliceIocViewer.getRaw === "function"
      ? root.AliceIocViewer.getRaw()
      : "";
    if (iocText) files["AliceSIM.ioc"] = iocText;
    return {
      files: files,
      activePath: filename,
      targets: [filename],
      includeDirs: ["."],
      defines: ["USE_HAL_DRIVER", "STM32F103xB"],
      all: true,
      filename: filename,
      code: files[filename]
    };
  }

  function simulationPayload(payload) {
    var source = payload || {};
    var inputFiles = source.files && typeof source.files === "object" ? source.files : {};
    var files = {};
    Object.keys(inputFiles).forEach(function (path) {
      var normalized = String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
      if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inc|ioc)$/i.test(normalized)) return;
      if (/^Drivers\/(?:CMSIS\/|STM32[^/]*_HAL_Driver\/)/i.test(normalized)) return;
      files[normalized] = inputFiles[path];
    });
    if (!Object.keys(files).length) files = inputFiles;
    var targets = Array.isArray(source.targets)
      ? source.targets.map(function (path) { return String(path || "").replace(/\\/g, "/").replace(/^\.\//, ""); }).filter(function (path) { return Object.prototype.hasOwnProperty.call(files, path); })
      : [];
    var activePath = String(source.activePath || source.filename || "").replace(/\\/g, "/").replace(/^\.\//, "");
    return Object.assign({}, source, {
      files: files,
      targets: targets.length ? targets : (activePath && Object.prototype.hasOwnProperty.call(files, activePath) ? [activePath] : []),
      activePath: activePath,
      filename: activePath || source.filename || "main.c",
      code: activePath && files[activePath] != null ? files[activePath] : source.code
    });
  }

  function retryDelay(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }

  function backendOrigin() {
    return root.location && root.location.origin ? root.location.origin : "AliceSIM local backend";
  }

  async function requestSimulationModel(payload) {
    var requestPayload = simulationPayload(payload);
    var body = JSON.stringify(requestPayload);
    var lastError = null;
    for (var attempt = 0; attempt < SIM_MODEL_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        var response = await fetch("/api/sim-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          cache: "no-store"
        });
        var result;
        try {
          result = await response.json();
        } catch (parseError) {
          if (response.ok) throw parseError;
          result = {};
        }
        if (!response.ok) {
          var responseError = new Error(result.detail || result.message || ("HAL 仿真模型构建失败 · HTTP " + response.status));
          responseError.aliceHttpStatus = response.status;
          throw responseError;
        }
        return result;
      } catch (error) {
        if (error && error.aliceHttpStatus) throw error;
        lastError = error;
        if (attempt + 1 < SIM_MODEL_REQUEST_ATTEMPTS) {
          await retryDelay(SIM_MODEL_RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }
    var detail = lastError && lastError.message ? "（" + lastError.message + "）" : "";
    throw new Error("AliceSIM 后端连接中断，自动重试仍未成功。请确认 " + backendOrigin() + " 正在运行并刷新页面" + detail);
  }

  function normalizeDiagnostic(item) {
    return {
      file: item && item.file || item && item.source && item.source.file || "",
      severity: item && item.severity === "error" ? "error" : "warning",
      line: Math.max(1, Number(item && item.line || item && item.source && item.source.line || 1)),
      column: Math.max(1, Number(item && item.column || item && item.source && item.source.column || 1)),
      message: String(item && item.message || "HAL 仿真模型无法解析此操作"),
      source: "Alice HAL VM",
      code: item && item.code || "SIM_MODEL"
    };
  }

  function modelOutputs(model) {
    return Object.values(model && model.outputs || {}).filter(function (output) {
      return output && /^P[A-Z]\d+$/.test(String(output.physicalPin || ""));
    });
  }

  function modelUarts(model) {
    return Object.values(model && model.uarts || {}).filter(Boolean);
  }

  function modelI2cs(model) {
    return Object.values(model && model.i2cs || {}).filter(Boolean);
  }

  function modelSpis(model) {
    return Object.values(model && model.spis || {}).filter(Boolean);
  }

  function modelAdcs(model) {
    return Object.values(model && model.adcs || {}).filter(Boolean);
  }

  function modelDmas(model) {
    return Object.values(model && model.dmas || {}).filter(Boolean);
  }

  function modelTimers(model) {
    return Object.values(model && model.timers || {}).filter(Boolean);
  }

  function uartIdentity(uart) {
    return String(uart && (uart.instance || uart.handle) || "");
  }

  function uartCanReceive(uart) {
    return Boolean(uart && Array.isArray(uart.receiveCalls) && uart.receiveCalls.length);
  }

  function findUart(model, reference, requireReceive) {
    var uarts = modelUarts(model);
    var requested = String(reference || "").replace(/^&/, "").toUpperCase();
    var selected = requested ? uarts.find(function (uart) {
      return [uart.instance, uart.handle].some(function (value) {
        return String(value || "").replace(/^&/, "").toUpperCase() === requested;
      });
    }) : null;
    if (!selected) selected = uarts.find(function (uart) { return !requireReceive || uartCanReceive(uart); }) || null;
    if (selected && requireReceive && !uartCanReceive(selected)) return null;
    return selected;
  }

  function findPeripheral(records, reference) {
    var requested = String(reference || "").replace(/^&/, "").toUpperCase();
    return (requested ? records.find(function (descriptor) {
      return [descriptor.instance, descriptor.handle].some(function (value) {
        return String(value || "").replace(/^&/, "").toUpperCase() === requested;
      });
    }) : records[0]) || null;
  }

  function findI2c(model, reference) {
    return findPeripheral(modelI2cs(model), reference);
  }

  function findSpi(model, reference) {
    return findPeripheral(modelSpis(model), reference);
  }

  function findAdc(model, reference) {
    return findPeripheral(modelAdcs(model), reference);
  }

  function adcChannelOrder(channel) {
    var rank = Number(channel && channel.rank);
    if (Number.isFinite(rank) && rank > 0) return rank;
    var slot = Number(channel && channel.slot);
    if (Number.isFinite(slot) && slot > 0) return slot;
    return Number.POSITIVE_INFINITY;
  }

  function primaryAdcChannel(adc) {
    if (!adc || !Array.isArray(adc.channels)) return null;
    return adc.channels.slice().sort(function (left, right) {
      var leftOrder = adcChannelOrder(left);
      var rightOrder = adcChannelOrder(right);
      if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
      var leftNumber = Number(left && left.channelNumber);
      var rightNumber = Number(right && right.channelNumber);
      if (!Number.isFinite(leftNumber)) leftNumber = Number.POSITIVE_INFINITY;
      if (!Number.isFinite(rightNumber)) rightNumber = Number.POSITIVE_INFINITY;
      return leftNumber - rightNumber;
    })[0] || null;
  }

  function findTimer(model, reference) {
    return findPeripheral(modelTimers(model), reference);
  }

  function chooseTracePin(model) {
    var outputs = modelOutputs(model);
    if (outputs.length) return outputs[0].physicalPin;
    var pins = Object.keys(model && model.pins || {});
    return pins.find(function (pin) { return /^P[A-Z]\d+$/.test(pin); }) || "";
  }

  function traceChannelLabel(pin, descriptor) {
    var aliases = descriptor && Array.isArray(descriptor.aliases) ? descriptor.aliases : [];
    return String(aliases[0] || descriptor && (descriptor.label || descriptor.iocSignal || descriptor.signal) || pin || "GPIO");
  }

  function collectTraceChannels(model) {
    var channels = [];
    var seen = Object.create(null);
    function add(pin, label, source) {
      var physical = String(pin || "").toUpperCase();
      if (!/^P[A-Z]\d+$/.test(physical) || seen[physical]) return;
      seen[physical] = true;
      channels.push({ pin: physical, label: String(label || physical), source: source || "GPIO" });
    }
    modelOutputs(model).forEach(function (output) { add(output.physicalPin, output.aliases && output.aliases[0] || output.iocSignal || "GPIO", "GPIO"); });
    modelUarts(model).forEach(function (uart) {
      add(uart.txPin, String(uart.instance || uart.handle || "UART") + " TX", "UART");
      add(uart.rxPin, String(uart.instance || uart.handle || "UART") + " RX", "UART");
    });
    Object.keys(model && model.pins || {}).forEach(function (key) {
      var descriptor = model.pins[key] || {};
      var physical = descriptor.physicalPin || descriptor.pin || key;
      add(physical, traceChannelLabel(physical, descriptor), descriptor.iocSignal || descriptor.signal || descriptor.mode || "GPIO");
    });
    return channels;
  }

  function clearTraceSamples() {
    traceSamples = [];
    traceSamplesByPin = Object.create(null);
    tracePins.forEach(function (pin) { traceSamplesByPin[pin] = []; });
  }

  function setTracePinsInternal(pins, clearSamples) {
    var requested = Array.isArray(pins) ? pins : [];
    var available = Object.create(null);
    traceChannels.forEach(function (channel) { available[channel.pin] = true; });
    var next = [];
    requested.forEach(function (pin) {
      var normalized = String(pin || "").toUpperCase();
      if (available[normalized] && next.indexOf(normalized) < 0 && next.length < 4) next.push(normalized);
    });
    if (!next.length && traceChannels.length) next.push(traceChannels[0].pin);
    tracePins = next;
    tracePin = tracePins[0] || "";
    if (clearSamples) clearTraceSamples();
    else tracePins.forEach(function (pin) { if (!traceSamplesByPin[pin]) traceSamplesByPin[pin] = []; });
    traceSamples = tracePin && traceSamplesByPin[tracePin] ? traceSamplesByPin[tracePin] : [];
    return tracePins.slice();
  }

  function traceValue(pin) {
    var gpio = runtimeGpioState();
    if (Object.prototype.hasOwnProperty.call(gpio, pin)) return Boolean(gpio[pin]);
    var sample = root.AliceSchematic && typeof root.AliceSchematic.sampleMcuPin === "function"
      ? root.AliceSchematic.sampleMcuPin(pin)
      : null;
    return sample == null ? false : Boolean(sample);
  }

  function runtimeGpioState() {
    if (!runtime || typeof runtime.getState !== "function") return {};
    var state = runtime.getState() || {};
    return state.gpio || state.pins || {};
  }

  function recordTrace(timeMs) {
    if (!tracePins.length) return;
    tracePins.forEach(function (pin) { appendTraceSample(pin, Number(timeMs) || 0, traceValue(pin)); });
  }

  function appendTraceSample(pin, timeMs, value) {
    var samples = traceSamplesByPin[pin] || (traceSamplesByPin[pin] = []);
    var previous = samples[samples.length - 1];
    if (previous && previous.timeMs === timeMs && previous.value === Boolean(value)) return;
    samples.push({ timeMs: timeMs, value: Boolean(value) });
    if (samples.length > MAX_TRACE_SAMPLES) samples.splice(0, samples.length - MAX_TRACE_SAMPLES);
    if (pin === tracePin) traceSamples = samples;
  }

  function uartFrameDurationMs(uart, byteCount) {
    var baudRate = Number(uart && uart.baudRate);
    if (!Number.isFinite(baudRate) || baudRate <= 0) return 0;
    var frame = uart.frame || {};
    var bits = 1 + (Number(frame.dataBits) || 8) + (String(frame.parity || "none").toLowerCase() === "none" ? 0 : 1) + (Number(frame.stopBits) || 1);
    return Math.max(0, Number(byteCount) || 0) * bits * 1000 / baudRate;
  }

  function markUartActivity(timeMs, uart, byteCount) {
    var time = Number(timeMs) || 0;
    lastUartActivityMs = time;
    // Keep sub-millisecond UART frames visible for at least one 60 Hz UI frame.
    uartActiveUntilMs = Math.max(uartActiveUntilMs, time + Math.max(20, uartFrameDurationMs(uart, byteCount)));
  }

  function driveUartIdlePins(model, options) {
    if (!root.AliceSchematic || typeof root.AliceSchematic.driveMcuPin !== "function") return;
    modelUarts(model).forEach(function (uart) {
      if (uart.txPin) root.AliceSchematic.driveMcuPin(uart.txPin, 1, Object.assign({ source: "uart-idle", instance: uart.instance, handle: uart.handle }, options || {}));
    });
  }

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  function createRuntime(model) {
    if (!root.AliceFirmwareRuntime || typeof root.AliceFirmwareRuntime.create !== "function") {
      throw new Error("HAL 固件运行时尚未加载");
    }
    return root.AliceFirmwareRuntime.create(model, {
      onGpio: function (event) {
        if (root.AliceSchematic && typeof root.AliceSchematic.driveMcuPin === "function") {
          root.AliceSchematic.driveMcuPin(event.pin, event.value, event);
        }
        if (tracePins.indexOf(String(event.pin || "").toUpperCase()) >= 0) appendTraceSample(String(event.pin).toUpperCase(), Number(event.timeMs != null ? event.timeMs : event.time) || 0, event.value);
        dispatch("alice:firmware-gpio", event);
      },
      onGpioRead: function (event) {
        var value = root.AliceSchematic && typeof root.AliceSchematic.sampleMcuPin === "function"
          ? root.AliceSchematic.sampleMcuPin(event.pin || event.physicalPin)
          : null;
        var sample = Object.assign({}, event, { value: value, connected: value != null });
        dispatch("alice:firmware-gpio-read", sample);
        return sample;
      },
      onPwm: function (event) {
        var timer = findTimer(currentModel, event.instance || event.timer || event.handle);
        var channel = timer && Array.isArray(timer.channels) ? timer.channels.find(function (item) { return Number(item.channelNumber) === Number(event.channel); }) : null;
        var enriched = Object.assign({}, event, timer ? {
          instance: timer.instance || event.instance,
          handle: timer.handle || event.handle,
          timerClockHz: timer.clockHz,
          frequencyHz: event.frequencyHz != null ? event.frequencyHz : timer.frequencyHz,
          pin: event.pin || channel && channel.pin || ""
        } : {});
        var result = root.AliceSchematic && typeof root.AliceSchematic.driveMcuPwm === "function"
          ? root.AliceSchematic.driveMcuPwm(enriched)
          : false;
        enriched.result = result;
        dispatch("alice:firmware-pwm", enriched);
        return result;
      },
      onUartTx: function (event) {
        var uart = findUart(currentModel, event.instance || event.uart || event.handle, false);
        var enriched = Object.assign({}, event, uart ? {
          instance: uart.instance || event.instance,
          handle: uart.handle,
          baudRate: uart.baudRate,
          txPin: uart.txPin,
          rxPin: uart.rxPin,
          frame: uart.frame
        } : {});
        var timeMs = Number(event.timeMs != null ? event.timeMs : event.time) || 0;
        markUartActivity(timeMs, uart, Array.isArray(event.bytes) ? event.bytes.length : String(event.text || "").length);
        if (uart && uart.txPin && root.AliceSchematic && typeof root.AliceSchematic.driveMcuPin === "function") {
          // A UART transmitter is high while idle. Byte timing remains observable
          // through the enriched UART event without inventing an ACK or GPIO pin.
          root.AliceSchematic.driveMcuPin(uart.txPin, 1, enriched);
        }
        dispatch("alice:firmware-uart-tx", enriched);
      },
      onI2cTx: function (event) {
        var i2c = findI2c(currentModel, event.instance || event.i2c || event.handle);
        var enriched = Object.assign({}, event, i2c ? {
          instance: i2c.instance || event.instance,
          handle: i2c.handle || event.handle,
          sclPin: i2c.sclPin,
          sdaPin: i2c.sdaPin,
          clockSpeed: i2c.clockSpeed,
          addressBits: i2c.addressBits
        } : {});
        var result = root.AliceSchematic && typeof root.AliceSchematic.handleI2cTransmission === "function"
          ? root.AliceSchematic.handleI2cTransmission(enriched)
          : { accepted: false, targetCount: 0, reason: "schematic-unavailable" };
        enriched.result = result;
        dispatch("alice:firmware-i2c-tx", enriched);
        return result;
      },
      onSpiTx: function (event) {
        var spi = findSpi(currentModel, event.instance || event.spi || event.handle);
        var enriched = Object.assign({}, event, spi ? {
          instance: spi.instance || event.instance,
          handle: spi.handle || event.handle,
          sckPin: spi.sckPin,
          mosiPin: spi.mosiPin,
          misoPin: spi.misoPin,
          mode: spi.mode,
          dataSize: spi.dataSize,
          clockPolarity: spi.clockPolarity,
          clockPhase: spi.clockPhase
        } : {});
        var result = root.AliceSchematic && typeof root.AliceSchematic.handleSpiTransmission === "function"
          ? root.AliceSchematic.handleSpiTransmission(enriched)
          : { accepted: false, targetCount: 0, reason: "schematic-unavailable" };
        enriched.result = result;
        dispatch("alice:firmware-spi-tx", enriched);
        return result;
      },
      onAdcStart: function (event) {
        dispatch("alice:firmware-adc-start", event);
      },
      onAdcPoll: function (event) {
        dispatch("alice:firmware-adc-poll", event);
      },
      onAdcRead: function (event) {
        var adc = findAdc(currentModel, event.instance || event.adc || event.handle);
        var channels = adc && Array.isArray(adc.channels) ? adc.channels : [];
        var channelIndex = Math.max(0, Math.trunc(Number(event.channelIndex) || 0));
        var channel = event.channel || (event.dma ? channels[channelIndex] : null) || primaryAdcChannel(adc);
        var sample = root.AliceSchematic && typeof root.AliceSchematic.sampleAdc === "function"
          ? root.AliceSchematic.sampleAdc(adc && (adc.instance || adc.handle) || event.instance, { pin: channel && channel.pin, channel: channel && channel.channel })
          : { value: null, raw: null, voltage: null, connected: false };
        dispatch("alice:firmware-adc-read", Object.assign({}, event, { descriptor: adc, channel: channel, sample: sample }));
        return sample;
      },
      onAdcValue: function (event) {
        dispatch("alice:firmware-adc-value", event);
      },
      onDma: function (event) {
        dispatch("alice:firmware-dma", event);
      },
      onDmaCallback: function (event) {
        dispatch("alice:firmware-dma-callback", event);
      },
      onPeripheral: function (event) {
        var peripheralType = String(event && event.peripheralType || event && event.type || "").toLowerCase();
        var enriched = Object.assign({}, event, { peripheralType: peripheralType });
        var result = root.AliceSchematic && typeof root.AliceSchematic.handlePeripheralOperation === "function"
          ? root.AliceSchematic.handlePeripheralOperation(enriched)
          : { accepted: false, targetCount: 0, targets: [], result: null, reason: "schematic-unavailable" };
        enriched.result = result;
        dispatch("alice:firmware-peripheral", enriched);
        return result;
      },
      onState: function (event) {
        dispatch("alice:firmware-state", event);
      }
    });
  }

  async function build(payload) {
    var requestPayload = payload || workspacePayload();
    if (runtime && typeof runtime.pause === "function") runtime.pause();
    if (workerBridge) workerBridge.terminate();
    workerBridge = null;
    workerState = null;
    runtime = null;
    currentModel = null;
    tracePin = "";
    tracePins = [];
    traceChannels = [];
    traceSamples = [];
    traceSamplesByPin = Object.create(null);
    lastUartActivityMs = -Infinity;
    uartActiveUntilMs = -Infinity;
    var result = await requestSimulationModel(requestPayload);
    if (!result || result.schemaVersion !== 1) throw new Error("后端返回了不兼容的 HAL 模型");

    var normalizedDiagnostics = (result.diagnostics || []).map(normalizeDiagnostic);
    if (normalizedDiagnostics.some(function (item) { return item.severity === "error"; })) {
      currentModel = result;
      return {
        model: result,
        circuit: null,
        diagnostics: normalizedDiagnostics,
        outputs: modelOutputs(result),
        uarts: modelUarts(result),
        i2cs: modelI2cs(result),
        spis: modelSpis(result),
        adcs: modelAdcs(result),
        timers: modelTimers(result),
        middlewares: result.middlewares || {}
      };
    }

    traceChannels = collectTraceChannels(result);
    setTracePinsInternal([chooseTracePin(result)], true);
    var nextRuntime = null;
    var nextWorker = createWorkerBridge();
    if (nextWorker) {
      try {
        await nextWorker.init(result);
      } catch (_) {
        nextWorker.terminate();
        nextWorker = null;
      }
    }
    if (!nextWorker) nextRuntime = createRuntime(result);

    var circuit = null;
    if (root.AliceSchematic && typeof root.AliceSchematic.applyProjectModel === "function") {
      circuit = root.AliceSchematic.applyProjectModel(result);
    }
    currentModel = result;
    runtime = nextRuntime;
    workerBridge = nextWorker;
    driveUartIdlePins(result);
    dispatch("alice:firmware-built", { model: result, circuit: circuit });
    return {
      model: result,
      circuit: circuit,
      diagnostics: normalizedDiagnostics,
      outputs: modelOutputs(result),
      uarts: modelUarts(result),
      i2cs: modelI2cs(result),
      spis: modelSpis(result),
      adcs: modelAdcs(result),
      timers: modelTimers(result),
      middlewares: result.middlewares || {},
      runtimeBackend: nextWorker ? "worker" : "main-thread",
      acceleration: root.AliceSimulationAccel && typeof root.AliceSimulationAccel.getState === "function"
        ? root.AliceSimulationAccel.getState()
        : { backend: "js", wasm: false, traceKernel: false }
    };
  }

  function requireRuntime() {
    if (!runtime) throw new Error("请先构建 HAL 仿真模型");
    return runtime;
  }

  function synchronizePins() {
    var gpio = workerState && workerState.gpio ? workerState.gpio : runtimeGpioState();
    Object.keys(gpio).forEach(function (pin) {
      if (root.AliceSchematic && typeof root.AliceSchematic.driveMcuPin === "function") {
        root.AliceSchematic.driveMcuPin(pin, gpio[pin], { render: false, source: "firmware-worker-sync" });
      }
    });
    driveUartIdlePins(currentModel, workerBridge ? { render: false } : null);
    if (workerBridge && root.AliceSchematic && typeof root.AliceSchematic.renderWires === "function") root.AliceSchematic.renderWires();
  }

  function start() {
    if (workerBridge) {
      return workerBridge.call("start").then(function (state) {
        synchronizePins();
        recordTrace(state && state.timeMs || 0);
        return state;
      });
    }
    var activeRuntime = requireRuntime();
    var state = activeRuntime.start();
    synchronizePins();
    recordTrace(state && state.timeMs || 0);
    return state;
  }

  function pause() {
    if (workerBridge) return workerBridge.call("pause");
    return runtime && typeof runtime.pause === "function" ? runtime.pause() : null;
  }

  function reset() {
    if (workerBridge) {
      return workerBridge.call("reset").then(function (state) {
        workerState = state;
        clearTraceSamples();
        lastUartActivityMs = -Infinity;
        uartActiveUntilMs = -Infinity;
        recordTrace(state && state.timeMs || 0);
        if (root.AliceSchematic && typeof root.AliceSchematic.reset === "function") root.AliceSchematic.reset();
        synchronizePins();
        return state;
      });
    }
    var state = requireRuntime().reset();
    clearTraceSamples();
    lastUartActivityMs = -Infinity;
    uartActiveUntilMs = -Infinity;
    recordTrace(state && state.timeMs || 0);
    if (root.AliceSchematic && typeof root.AliceSchematic.reset === "function") root.AliceSchematic.reset();
    synchronizePins();
    return state;
  }

  function step(deltaMs) {
    if (workerBridge) {
      return workerBridge.step(workerInputs(), Math.max(0, Number(deltaMs) || 0)).then(function (state) {
        workerState = state;
        recordTrace(state && state.timeMs || 0);
        return state;
      });
    }
    var result = requireRuntime().step(Math.max(0, Number(deltaMs) || 0));
    var state = result || runtime.getState();
    recordTrace(state && state.timeMs || 0);
    return state;
  }

  function serialBytes(value) {
    if (value == null) return [];
    if (typeof value === "string") {
      return typeof TextEncoder === "function"
        ? Array.prototype.slice.call(new TextEncoder().encode(value))
        : Array.from(value).map(function (character) { return character.charCodeAt(0) & 0xff; });
    }
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) value = new Uint8Array(value);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(value)) value = Array.prototype.slice.call(value);
    if (!Array.isArray(value)) value = [value];
    return value.map(function (item) {
      var number = Number(item);
      return Number.isFinite(number) ? ((Math.trunc(number) % 256) + 256) % 256 : 0;
    });
  }

  function serialText(bytes) {
    var normalized = serialBytes(bytes);
    if (typeof TextDecoder === "function") {
      try { return new TextDecoder().decode(new Uint8Array(normalized)); } catch (_) { /* Fall through. */ }
    }
    return normalized.map(function (byte) { return String.fromCharCode(byte); }).join("");
  }

  function enqueueSerialPayload(value, instance, preserveBytes) {
    var uart = findUart(currentModel, instance, false);
    if (!uart) throw new Error(instance ? "所选 UART 不存在" : "当前工程没有可用 UART");
    var selectedInstance = uart.instance || uart.handle;
    var bytes = serialBytes(value);
    var text = preserveBytes ? serialText(bytes) : String(value == null ? "" : value);
    if (workerBridge) {
      return workerBridge.call("enqueueUart", selectedInstance, preserveBytes ? bytes : text).then(function (state) {
        workerState = state;
        var timeMs = Number(state && state.timeMs) || 0;
        markUartActivity(timeMs, uart, bytes.length);
        dispatch("alice:firmware-uart-rx", {
          instance: uart.instance, handle: uart.handle, baudRate: uart.baudRate, txPin: uart.txPin, rxPin: uart.rxPin,
          frame: uart.frame, text: text, bytes: bytes, time: timeMs, timeMs: timeMs
        });
        return state;
      });
    }
    var state = requireRuntime().enqueueUart(selectedInstance, preserveBytes ? bytes : text);
    var timeMs = Number(state && state.timeMs) || 0;
    markUartActivity(timeMs, uart, bytes.length);
    dispatch("alice:firmware-uart-rx", {
      instance: uart.instance,
      handle: uart.handle,
      baudRate: uart.baudRate,
      txPin: uart.txPin,
      rxPin: uart.rxPin,
      frame: uart.frame,
      text: text,
      bytes: bytes,
      time: timeMs,
      timeMs: timeMs
    });
    return state;
  }

  function enqueueSerial(text, instance) {
    return enqueueSerialPayload(text, instance, false);
  }

  function enqueueSerialBytes(bytes, instance) {
    return enqueueSerialPayload(bytes, instance, true);
  }

  function getTrace() {
    var state = workerBridge
      ? (workerState || { timeMs: 0 })
      : (runtime && runtime.getState ? runtime.getState() : { timeMs: 0 });
    return {
      pin: tracePin,
      samples: compressTrace((traceSamplesByPin[tracePin] || traceSamples || []).slice()),
      pins: tracePins.slice(),
      channels: tracePins.map(function (pin) {
        var descriptor = traceChannels.find(function (channel) { return channel.pin === pin; }) || { pin: pin, label: pin, source: "GPIO" };
        return { pin: pin, label: descriptor.label, source: descriptor.source, samples: compressTrace((traceSamplesByPin[pin] || []).slice()) };
      }),
      uartActive: Number(state && state.timeMs || 0) <= uartActiveUntilMs,
      lastUartActivityMs: lastUartActivityMs
    };
  }

  function getSummary() {
    var uarts = modelUarts(currentModel);
    var i2cs = modelI2cs(currentModel);
    var spis = modelSpis(currentModel);
    var adcs = modelAdcs(currentModel);
    var dmas = modelDmas(currentModel);
    var timers = modelTimers(currentModel);
    var outputs = modelOutputs(currentModel);
    return {
      mcu: currentModel && currentModel.mcu || "STM32F103C8T6",
      outputCount: outputs.length,
      outputs: outputs,
      uartCount: uarts.length,
      uarts: uarts,
      i2cCount: i2cs.length,
      i2cs: i2cs,
      spiCount: spis.length,
      spis: spis,
      adcCount: adcs.length,
      adcs: adcs,
      dmaCount: dmas.length,
      dmas: dmas,
      timerCount: timers.length,
      timers: timers,
      tracePin: tracePin,
      tracePins: tracePins.slice(),
      traceChannels: traceChannels.slice(),
      middlewares: currentModel && currentModel.middlewares || {},
      confidence: currentModel && currentModel.confidence || "parsed",
      runtimeBackend: workerBridge ? "worker" : "main-thread",
      acceleration: root.AliceSimulationAccel && typeof root.AliceSimulationAccel.getState === "function"
        ? root.AliceSimulationAccel.getState()
        : { backend: "js", wasm: false, traceKernel: false }
    };
  }

  root.AliceHalSimulator = Object.freeze({
    build: build,
    start: start,
    pause: pause,
    reset: reset,
    step: step,
    enqueueSerial: enqueueSerial,
    enqueueSerialBytes: enqueueSerialBytes,
    setTracePins: function (pins) { return setTracePinsInternal(pins, false); },
    getTraceChannels: function () { return traceChannels.slice(); },
    getModel: function () { return currentModel; },
    getRuntimeState: function () { return workerBridge ? workerState : (runtime && runtime.getState ? runtime.getState() : null); },
    getTrace: getTrace,
    getSummary: getSummary,
    createPayload: function () { return simulationPayload(workspacePayload()); }
  });
}(window));
