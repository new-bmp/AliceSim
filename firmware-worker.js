/* global importScripts, self */
(function () {
  "use strict";

  importScripts("./firmware-runtime.js?v=20260820.2");

  var runtime = null;
  var model = null;
  var inputs = { gpio: Object.create(null), adc: Object.create(null), i2c: [], spi: [], peripherals: [] };
  var gpioOutputs = Object.create(null);

  function clone(value) {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }

  function emit(kind, detail) {
    // postMessage already performs a structured clone. Avoid cloning large
    // DMA and framebuffer payloads twice inside the Worker.
    self.postMessage({ type: "event", kind: kind, detail: detail });
  }

  function adcKey(instance, channel, pin) {
    return [String(instance || ""), String(channel || ""), String(pin || "")].join("|");
  }

  function inputAdc(event) {
    var channel = event && event.channel || {};
    var key = adcKey(event && (event.instance || event.adc || event.handle), channel.channel, channel.pin);
    var sample = inputs.adc[key] || inputs.adc[adcKey(event && (event.instance || event.adc || event.handle), "", "")];
    return sample == null ? { value: null, raw: null, voltage: null, connected: false } : clone(sample);
  }

  function sameReference(target, reference) {
    var requested = String(reference || "").replace(/^&/, "").toUpperCase();
    if (!requested) return true;
    return [target && target.instance, target && target.handle].some(function (value) {
      return String(value || "").replace(/^&/, "").toUpperCase() === requested;
    });
  }

  function normalizedI2cAddress(value) {
    var numeric = typeof value === "string" && /^0x/i.test(value.trim()) ? parseInt(value, 16) : Number(value);
    if (!Number.isFinite(numeric)) return null;
    numeric = Math.floor(numeric);
    return numeric > 0x77 ? numeric >> 1 : numeric;
  }

  function i2cResponse(event) {
    var reference = event && (event.instance || event.i2c || event.handle);
    var address = normalizedI2cAddress(event && (event.deviceAddress != null ? event.deviceAddress : event.address));
    var targets = (Array.isArray(inputs.i2c) ? inputs.i2c : []).filter(function (target) {
      return target && target.ready && sameReference(target, reference)
        && (address == null || normalizedI2cAddress(target.address) === address);
    });
    return { accepted: targets.length > 0, targetCount: targets.length, targets: clone(targets), address: address };
  }

  function outputLevel(pin, fallback) {
    var physical = String(pin || "").toUpperCase();
    if (physical && Object.prototype.hasOwnProperty.call(gpioOutputs, physical)) return gpioOutputs[physical];
    return fallback;
  }

  function spiResponse(event) {
    var reference = event && (event.instance || event.spi || event.handle);
    var targets = (Array.isArray(inputs.spi) ? inputs.spi : []).filter(function (target) {
      if (!target || !target.ready || !sameReference(target, reference)) return false;
      return outputLevel(target.csPin, target.selected ? 0 : 1) === 0;
    }).map(function (target) {
      var copy = clone(target);
      copy.selected = true;
      copy.dataMode = outputLevel(target.dcPin, target.dataMode ? 1 : 0) === 1;
      return copy;
    });
    return { accepted: targets.length > 0, targetCount: targets.length, targets: targets };
  }

  function peripheralMatches(target, event, candidates) {
    var pairs = [
      ["dataPin", "dataPin"], ["triggerPin", "triggerPin"], ["trigPin", "triggerPin"],
      ["echoPin", "echoPin"], ["pwmPin", "pwmPin"], ["signalPin", "signalPin"],
      ["clkPin", "clkPin"], ["dioPin", "dioPin"]
    ];
    var compared = false;
    for (var index = 0; index < pairs.length; index += 1) {
      var requested = String(event && event[pairs[index][0]] || "").toUpperCase();
      if (!requested) continue;
      compared = true;
      if (String(target.connection && target.connection[pairs[index][1]] || "").toUpperCase() !== requested) return false;
    }
    return compared || candidates.length === 1;
  }

  function peripheralResult(target, event) {
    var state = target && target.state || {};
    var type = String(target && target.type || "").toLowerCase();
    if (type === "dht11") {
      var temperature = Number(state.temperatureC) || 0;
      var humidity = Number(state.humidityPercent) || 0;
      return {
        ok: true,
        temperatureC: temperature,
        temperatureX10: Math.round(temperature * 10),
        humidityPercent: humidity,
        humidityX10: Math.round(humidity * 10),
        checksum: (Math.round(temperature) + Math.round(humidity)) & 0xff
      };
    }
    if (type === "hcsr04") return {
      ok: true,
      distanceCm: Number(state.distanceCm) || 0,
      distanceMm: Math.max(0, Math.round(Number(state.distanceMm) || 0)),
      echoPulseUs: Math.max(1, Math.round(Number(state.echoPulseUs) || 1))
    };
    if (type === "sg90") return { angle: Number(event && event.angle != null ? event.angle : state.angle) || 0 };
    if (type === "buzzer") return { active: String(event && event.action || "").toLowerCase().indexOf("stop") < 0 };
    if (type === "tm1637") return {
      brightness: Number(event && event.brightness != null ? event.brightness : state.brightness) || 0,
      text: state.text || ""
    };
    return { type: type, properties: clone(state.properties || {}), ready: true };
  }

  function peripheralResponse(event) {
    var type = String(event && (event.peripheralType || event.type) || "").toLowerCase();
    var candidates = (Array.isArray(inputs.peripherals) ? inputs.peripherals : []).filter(function (target) {
      return String(target && target.type || "").toLowerCase() === type;
    });
    var matches = candidates.filter(function (target) {
      return target && target.ready && peripheralMatches(target, event, candidates);
    });
    var targets = matches.map(function (target) {
      return { componentId: target.componentId, type: target.type, result: peripheralResult(target, event) };
    });
    return { accepted: targets.length > 0, targetCount: targets.length, targets: targets, result: targets[0] && targets[0].result || null };
  }

  function create(modelValue) {
    model = modelValue;
    if (!self.AliceFirmwareRuntime || typeof self.AliceFirmwareRuntime.create !== "function") throw new Error("HAL 固件运行时尚未加载");
    return self.AliceFirmwareRuntime.create(model, {
      onGpio: function (event) {
        var pin = String(event && (event.pin || event.physicalPin) || "").toUpperCase();
        if (pin) gpioOutputs[pin] = event && event.value ? 1 : 0;
        emit("gpio", event);
      },
      onGpioRead: function (event) {
        var pin = String(event && (event.pin || event.physicalPin) || "").toUpperCase();
        var value = Object.prototype.hasOwnProperty.call(gpioOutputs, pin)
          ? gpioOutputs[pin]
          : (Object.prototype.hasOwnProperty.call(inputs.gpio, pin) ? inputs.gpio[pin] : null);
        var result = Object.assign({}, event, { value: value, connected: value != null });
        emit("gpio-read", result);
        return result;
      },
      onPwm: function (event) { emit("pwm", event); return true; },
      onUartTx: function (event) { emit("uart-tx", event); },
      onI2cTx: function (event) { var response = i2cResponse(event); emit("i2c-tx", event); return response; },
      onSpiTx: function (event) { var response = spiResponse(event); emit("spi-tx", event); return response; },
      onAdcStart: function (event) { emit("adc-start", event); },
      onAdcPoll: function (event) { emit("adc-poll", event); },
      onAdcRead: function (event) {
        var sample = inputAdc(event);
        emit("adc-read", Object.assign({}, event, { sample: sample }));
        return sample;
      },
      onAdcValue: function (event) { emit("adc-value", event); },
      onDma: function (event) { emit("dma", event); },
      onDmaCallback: function (event) { emit("dma-callback", event); },
      onDmaCallbackComplete: function (event) { emit("dma-callback-complete", event); },
      onPeripheral: function (event) {
        var response = peripheralResponse(event);
        emit("peripheral", event);
        return response;
      },
      // State is returned with each command result. Sending it here as well
      // would clone and transfer the full runtime snapshot twice per tick.
      onState: function () {}
    });
  }

  function result(id, value, error) {
    self.postMessage({ type: "result", id: id, value: value, error: error ? String(error.message || error) : "" });
  }

  self.onmessage = function (message) {
    var request = message && message.data || {};
    var id = request.id;
    try {
      if (request.command === "init") {
        gpioOutputs = Object.create(null);
        runtime = create(request.model);
        result(id, runtime.getState());
        return;
      }
      if (request.command === "sync") {
        inputs = request.inputs && typeof request.inputs === "object" ? request.inputs : inputs;
        result(id, true);
        return;
      }
      if (request.command === "step") {
        inputs = request.inputs && typeof request.inputs === "object" ? request.inputs : inputs;
        result(id, runtime.step(Math.max(0, Number(request.deltaMs) || 0)));
        return;
      }
      if (!runtime) throw new Error("请先构建 HAL 仿真模型");
      if (request.command === "call") {
        var method = String(request.method || "");
        if (typeof runtime[method] !== "function") throw new Error("Worker 不支持运行时操作 " + method);
        if (method === "reset") gpioOutputs = Object.create(null);
        result(id, runtime[method].apply(runtime, Array.isArray(request.args) ? request.args : []));
        return;
      }
      throw new Error("未知 Worker 命令");
    } catch (error) {
      result(id, null, error);
    }
  };
}());
