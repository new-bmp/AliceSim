/* global importScripts, self */
(function () {
  "use strict";

  importScripts("./firmware-runtime.js?v=20261001.1");
  importScripts("./peripheral-bus-devices.js?v=20261017.1");
  importScripts("./ds18b20-device.js?v=20261017.1");
  importScripts("./peripheral-devices.js?v=20261017.1");

  var runtime = null;
  var model = null;
  var inputs = { gpio: Object.create(null), adc: Object.create(null), i2c: [], spi: [], peripherals: [] };
  var gpioOutputs = Object.create(null);
  var busDevices = Object.create(null);

  function syncBusDevices() {
    var retained = Object.create(null);
    (inputs.i2c || []).concat(inputs.spi || [], inputs.peripherals || []).forEach(function (target) {
      if (!target || !(target.type === "ds18b20" || self.AlicePeripheralBusDevices.supports(target.type))) return;
      var properties = target.properties || target.state && target.state.properties || {};
      var key = String(target.componentId), record = busDevices[key];
      if (!record || record.type !== target.type) {
        record = { type: target.type, device: self.AlicePeripheralDevices.createGeneric(target.type, { properties: properties, address: target.address }), properties: clone(properties) };
      } else {
        var changes = {}, changed = false;
        Object.keys(properties).forEach(function (name) {
          if (record.properties[name] !== properties[name]) { changes[name] = properties[name]; changed = true; }
        });
        if (changed) record.device.setProperties(changes);
        record.properties = clone(properties);
      }
      record.target = target;
      var connection = Object.assign({}, target.connection || {});
      if (target.type === "w25qxx") connection.selected = outputLevel(target.csPin, target.selected ? 0 : 1) === 0;
      if (target.type === "pca9685" && target.oePin) connection.outputEnabled = outputLevel(target.oePin, connection.outputEnabled === false ? 1 : 0) === 0;
      record.device.setConnection(connection);
      if (target.type === "pcf8574") {
        var mask = connection.externalInputMask == null ? 255 : connection.externalInputMask;
        (target.portPins || []).forEach(function (physical, index) { if (physical && outputLevel(physical, target.portMcuLevels && target.portMcuLevels[physical]) === 0) mask &= ~(1 << index); });
        record.device.setPortInputs(mask);
      }
      retained[key] = record;
    });
    busDevices = retained;
  }

  function busDevice(target) { return busDevices[String(target.componentId)] && busDevices[String(target.componentId)].device; }

  function updateBusGpio(pin, value) {
    Object.keys(busDevices).forEach(function (key) {
      var record = busDevices[key], target = record.target;
      if (record.type === "w25qxx" && target.csPin === pin) record.device.setConnection(Object.assign({}, record.device.getState().connection, { selected: value === 0 }));
      if (record.type === "pca9685" && target.oePin === pin) record.device.setConnection(Object.assign({}, record.device.getState().connection, {outputEnabled: value === 0}));
      if (record.type === "pcf8574" && Array.isArray(target.portPins)) {
        var mask = target.connection && target.connection.externalInputMask != null ? target.connection.externalInputMask : 255;
        target.portPins.forEach(function (physical, index) { if (physical && outputLevel(physical, target.portMcuLevels && target.portMcuLevels[physical]) === 0) mask &= ~(1 << index); });
        record.device.setPortInputs(mask);
      }
    });
  }

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
    var address = event.address7Bit != null ? Number(event.address7Bit) : event.deviceAddress != null ? Number(event.deviceAddress) >> 1 : normalizedI2cAddress(event.address);
    var targets = (Array.isArray(inputs.i2c) ? inputs.i2c : []).filter(function (target) {
      return target && target.ready && sameReference(target, reference)
        && (address == null || normalizedI2cAddress(target.address) === address);
    });
    if (targets.length !== 1) return { accepted: false, targetCount: targets.length, reason: targets.length ? "i2c-address-collision" : "no-i2c-target" };
    var device = busDevice(targets[0]);
    var response = device ? device.transmit(Object.assign({}, event, { address7Bit: address })) : { accepted: true };
    return Object.assign({}, response, { targetCount: response.accepted ? 1 : 0, targets: [{componentId: targets[0].componentId}], address: address });
  }

  function readBytesForTarget(target) {
    if (!target || typeof target !== "object") return undefined;
    if (target.readBytes !== undefined) return target.readBytes;
    if (target.rxBytes !== undefined) return target.rxBytes;
    return undefined;
  }

  function i2cReadResponse(event) {
    var reference = event && (event.instance || event.i2c || event.handle);
    var address = event.address7Bit != null ? Number(event.address7Bit) : event.deviceAddress != null ? Number(event.deviceAddress) >> 1 : normalizedI2cAddress(event.address);
    var targets = (Array.isArray(inputs.i2c) ? inputs.i2c : []).filter(function (target) {
      return target && target.ready && sameReference(target, reference)
        && (address == null || normalizedI2cAddress(target.address) === address);
    });
    if (targets.length !== 1) return { accepted: false, targetCount: targets.length, reason: targets.length ? "i2c-address-collision" : "no-readable-i2c-target" };
    var selected = targets[0];
    var device = busDevice(selected);
    if (device) return Object.assign({}, device.receive(Object.assign({}, event, { address7Bit: address })), { targetCount: 1, targets: [{componentId: selected.componentId}], address: address });
    if (readBytesForTarget(selected) === undefined) selected = null;
    return {
      accepted: Boolean(selected),
      targetCount: targets.length,
      targets: clone(targets),
      address: address,
      bytes: selected ? clone(readBytesForTarget(selected)) : undefined,
      reason: selected ? undefined : "no-readable-i2c-target"
    };
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
      if (target.resetRequired && outputLevel(target.resetPin, target.resetReleased ? 1 : 0) !== 1) return false;
      return target.noChipSelect === true || outputLevel(target.csPin, target.selected ? 0 : 1) === 0;
    }).map(function (target) {
      var copy = clone(target);
      copy.selected = true;
      copy.dataMode = outputLevel(target.dcPin, target.dataMode ? 1 : 0) === 1;
      return copy;
    });
    var accepted = targets.filter(function (target) {
      var device = busDevice(target);
      return !device || device.transmit(event).accepted;
    });
    return { accepted: accepted.length > 0, targetCount: accepted.length, targets: accepted, reason: accepted.length ? undefined : "no-spi-target" };
  }

  function spiReadResponse(event) {
    var reference = event && (event.instance || event.spi || event.handle);
    var targets = (Array.isArray(inputs.spi) ? inputs.spi : []).filter(function (target) {
      return target && target.ready && sameReference(target, reference)
        && outputLevel(target.csPin, target.selected ? 0 : 1) === 0
        && (busDevice(target) || readBytesForTarget(target) !== undefined);
    });
    if (targets.length !== 1) return { accepted: false, targetCount: targets.length, reason: targets.length ? "spi-bus-contention" : "no-readable-spi-target" };
    var selected = targets[0];
    var device = busDevice(selected);
    if (device) return Object.assign({}, device.receive(event), { targetCount: 1, targets: [{componentId: selected.componentId}] });
    if (readBytesForTarget(selected) === undefined) selected = null;
    return {
      accepted: Boolean(selected),
      targetCount: targets.length,
      targets: clone(targets),
      bytes: selected ? clone(readBytesForTarget(selected)) : undefined,
      reason: selected ? undefined : "no-readable-spi-target"
    };
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
    if (type === "ds18b20") {
      if (!event.dataPin || matches.length !== 1) return { accepted: false, targetCount: matches.length, result: null, targets: [], reason: matches.length > 1 ? "onewire-bus-collision" : "no-onewire-target" };
      var sensor = busDevice(matches[0]);
      var response = sensor ? sensor.apply(event.action, event) : {accepted: false, result: null};
      return Object.assign({}, response, {targetCount: response.accepted ? 1 : 0,
        targets: response.accepted ? [{componentId: matches[0].componentId, type: type, result: response.result}] : []});
    }
    if (type === "ws2812" && event.action === "pwm-frame") matches = matches.filter(function (target) {
      var strip = self.AlicePeripheralDevices.createWS2812({properties: target.state && target.state.properties || {}, connection: target.connection});
      return strip.transmitPwm(event.pulses, event.period, event.frequencyHz) > 0;
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
        if (pin) updateBusGpio(pin, gpioOutputs[pin]);
        emit("gpio", event);
      },
      onGpioRead: function (event) {
        var pin = String(event && (event.pin || event.physicalPin) || "").toUpperCase();
        var value = Object.prototype.hasOwnProperty.call(gpioOutputs, pin)
          ? gpioOutputs[pin]
          : (Object.prototype.hasOwnProperty.call(inputs.gpio, pin) ? inputs.gpio[pin] : null);
        Object.keys(busDevices).forEach(function (key) {
          var record = busDevices[key], target = record.target;
          if (record.type === "pca9685" && Array.isArray(target.channelPins)) {
            var channelIndex = target.channelPins.indexOf(pin);
            if (channelIndex >= 0) {
              record.device.setTime(event.timeMs == null ? event.time : event.timeMs);
              var pwmState = record.device.getState();
              if (pwmState.ready) value = pwmState.channels[channelIndex].level;
            }
          }
          if (record.type !== "pcf8574" || !Array.isArray(target.portPins)) return;
          var index = target.portPins.indexOf(pin), state = record.device.getState();
          if (index >= 0 && state.ready) value = state.pinMask & (1 << index) ? 1 : 0;
          if (target.connection && target.connection.signalPin === pin) {
            value = state.interruptActive ? 0 : outputLevel(pin, target.interruptReleaseLevel == null ? null : target.interruptReleaseLevel);
          }
        });
        var result = Object.assign({}, event, { value: value, connected: value != null });
        emit("gpio-read", result);
        return result;
      },
      onPwm: function (event) { emit("pwm", event); return true; },
      onUartTx: function (event) { emit("uart-tx", event); },
      onStdio: function (event) { emit("stdio", event); },
      onI2cTx: function (event) { var response = i2cResponse(event); emit("i2c-tx", event); return response; },
      onI2cRx: function (event) { var response = i2cReadResponse(event); emit("i2c-rx", event); return response; },
      onSpiTx: function (event) { var response = spiResponse(event); emit("spi-tx", event); return response; },
      onSpiRx: function (event) { var response = spiReadResponse(event); emit("spi-rx", event); return response; },
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
      onInterrupt: function (event) { emit("interrupt", event); },
      onInterruptCallback: function (event) { emit("interrupt-callback", event); },
      onInterruptCallbackComplete: function (event) { emit("interrupt-callback-complete", event); },
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
        busDevices = Object.create(null);
        inputs = {gpio: {}, adc: {}, i2c: [], spi: [], peripherals: []};
        runtime = create(request.model);
        result(id, runtime.getState());
        return;
      }
      if (request.command === "sync") {
        inputs = request.inputs && typeof request.inputs === "object" ? request.inputs : inputs;
        syncBusDevices();
        if (runtime && typeof runtime.syncGpioInputs === "function") runtime.syncGpioInputs(inputs.gpio);
        result(id, true);
        return;
      }
      if (request.command === "step") {
        inputs = request.inputs && typeof request.inputs === "object" ? request.inputs : inputs;
        syncBusDevices();
        if (runtime && typeof runtime.syncGpioInputs === "function") runtime.syncGpioInputs(inputs.gpio);
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
