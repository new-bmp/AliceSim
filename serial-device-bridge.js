(function (root, factory) {
  "use strict";

  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.AliceSerialBridge = api.create({
      eventTarget: root,
      serial: root.navigator && root.navigator.serial,
      halProvider: function () { return root.AliceHalSimulator; }
    });
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function bytesOf(value) {
    if (value == null) return [];
    if (typeof value === "string") {
      if (typeof TextEncoder === "function") return Array.prototype.slice.call(new TextEncoder().encode(value));
      return Array.from(value).map(function (character) { return character.charCodeAt(0) & 0xff; });
    }
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) value = new Uint8Array(value);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(value)) value = Array.prototype.slice.call(value);
    if (!Array.isArray(value)) value = [value];
    return value.map(function (item) {
      var number = Number(item);
      return Number.isFinite(number) ? ((Math.trunc(number) % 256) + 256) % 256 : 0;
    });
  }

  function textOf(bytes) {
    var normalized = bytesOf(bytes);
    if (typeof TextDecoder === "function") {
      try { return new TextDecoder().decode(new Uint8Array(normalized)); } catch (_) { /* Use byte characters below. */ }
    }
    return normalized.map(function (byte) { return String.fromCharCode(byte); }).join("");
  }

  function uartName(uart) {
    return String(uart && (uart.instance || uart.handle || uart.name) || "").trim();
  }

  function sameUart(left, right) {
    return String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase();
  }

  function normalizeUarts(records) {
    var source = Array.isArray(records) ? records : (records && typeof records === "object" ? Object.keys(records).map(function (key) { return records[key]; }) : []);
    return source.filter(function (uart) { return uart && typeof uart === "object" && uartName(uart); }).map(function (uart) {
      return Object.assign({}, uart, { instance: uart.instance || uart.handle || uart.name });
    });
  }

  function serialOptions(uart) {
    var frame = uart && uart.frame || {};
    var parity = String(frame.parity || "none").toLowerCase();
    if (["none", "even", "odd"].indexOf(parity) < 0) parity = "none";
    return {
      baudRate: Math.max(1, Math.round(Number(uart && uart.baudRate) || 115200)),
      dataBits: Number(frame.dataBits) === 7 ? 7 : 8,
      stopBits: Number(frame.stopBits) === 2 ? 2 : 1,
      parity: parity,
      bufferSize: 4096,
      flowControl: "none"
    };
  }

  function deviceInfo(port) {
    var info = port && typeof port.getInfo === "function" ? port.getInfo() || {} : {};
    return {
      usbVendorId: info.usbVendorId == null ? null : Number(info.usbVendorId),
      usbProductId: info.usbProductId == null ? null : Number(info.usbProductId),
      bluetoothServiceClassId: info.bluetoothServiceClassId || null
    };
  }

  function create(options) {
    var config = options || {};
    var eventTarget = config.eventTarget || root;
    var serial = config.serial !== undefined ? config.serial : (root && root.navigator && root.navigator.serial);
    var halProvider = typeof config.halProvider === "function" ? config.halProvider : function () { return config.hal || (root && root.AliceHalSimulator); };
    var onEvent = typeof config.onEvent === "function" ? config.onEvent : null;
    var uarts = [];
    var targetInstance = "";
    var port = null;
    var reader = null;
    var writer = null;
    var readTask = null;
    var writeTask = Promise.resolve();
    var connected = false;
    var connecting = false;
    var disconnecting = false;
    var lastError = "";
    var activeDevice = null;
    var activeOptions = null;

    function targetUart() {
      return uarts.find(function (uart) {
        return sameUart(uart.instance, targetInstance) || sameUart(uart.handle, targetInstance);
      }) || null;
    }

    function getState() {
      var uart = targetUart();
      return {
        supported: Boolean(serial && typeof serial.requestPort === "function"),
        connected: connected,
        connecting: connecting,
        disconnecting: disconnecting,
        status: connected ? "connected" : (connecting ? "connecting" : (disconnecting ? "disconnecting" : (lastError ? "error" : "idle"))),
        error: lastError,
        targetInstance: targetInstance,
        uart: uart ? Object.assign({}, uart) : null,
        uarts: uarts.map(function (entry) { return Object.assign({}, entry); }),
        device: activeDevice ? Object.assign({}, activeDevice) : null,
        serialOptions: activeOptions ? Object.assign({}, activeOptions) : (uart ? serialOptions(uart) : null)
      };
    }

    function emit(name, detail) {
      var payload = Object.assign({ bridge: getState() }, detail || {});
      if (onEvent) onEvent(name, payload);
      if (eventTarget && typeof eventTarget.dispatchEvent === "function") {
        var EventConstructor = eventTarget.CustomEvent || (root && root.CustomEvent) || (typeof CustomEvent === "function" ? CustomEvent : null);
        if (EventConstructor) eventTarget.dispatchEvent(new EventConstructor(name, { detail: payload }));
      }
      return payload;
    }

    function configure(records) {
      uarts = normalizeUarts(records);
      if (!targetUart()) targetInstance = uarts.length ? uartName(uarts[0]) : "";
      if (connected && !targetUart()) void disconnect("映射的 MCU UART 已不存在");
      emit("alice:serial-bridge-state", { reason: "configure" });
      return getState();
    }

    function setTarget(instance) {
      if (connected || connecting) throw new Error("请先断开实体串口，再更改 MCU UART 映射");
      var selected = uarts.find(function (uart) {
        return sameUart(uart.instance, instance) || sameUart(uart.handle, instance);
      });
      if (!selected) throw new Error("未找到所选 MCU UART");
      targetInstance = uartName(selected);
      lastError = "";
      emit("alice:serial-bridge-state", { reason: "target" });
      return getState();
    }

    function receivePhysical(value) {
      var bytes = bytesOf(value);
      if (!bytes.length) return null;
      var uart = targetUart();
      if (!connected || !uart) throw new Error("实体串口尚未连接到 MCU UART");
      var hal = halProvider();
      if (!hal || typeof hal.enqueueSerialBytes !== "function") throw new Error("当前仿真器不支持原始串口字节输入");
      var runtimeState = hal.enqueueSerialBytes(bytes, uart.instance || uart.handle);
      emit("alice:serial-bridge-rx", {
        instance: uart.instance || uart.handle,
        bytes: bytes.slice(),
        text: textOf(bytes),
        runtimeState: runtimeState
      });
      return runtimeState;
    }

    async function runReadLoop() {
      var unexpectedEnd = false;
      while (connected && port && port.readable) {
        var localReader = port.readable.getReader();
        reader = localReader;
        try {
          while (connected) {
            var result = await localReader.read();
            if (result.done) { unexpectedEnd = true; break; }
            if (result.value && result.value.byteLength) {
              try { receivePhysical(result.value); }
              catch (error) {
                lastError = error && error.message || String(error);
                emit("alice:serial-bridge-error", { direction: "pc-to-mcu", error: lastError });
              }
            }
          }
        } catch (error) {
          if (connected) {
            unexpectedEnd = true;
            lastError = error && error.message || String(error);
            emit("alice:serial-bridge-error", { direction: "pc-to-mcu", error: lastError });
          }
        } finally {
          if (reader === localReader) reader = null;
          try { localReader.releaseLock(); } catch (_) {}
        }
        break;
      }
      if (connected && unexpectedEnd) await disconnect("PC 串口读取已结束");
    }

    function forwardFirmwareTx(detail) {
      var event = detail || {};
      var uart = targetUart();
      if (!connected || !writer || !uart) return Promise.resolve(false);
      var sourceInstance = event.instance || event.uart || event.handle;
      if (!sameUart(sourceInstance, uart.instance) && !sameUart(sourceInstance, uart.handle)) return Promise.resolve(false);
      var bytes = bytesOf(event.bytes != null ? event.bytes : (event.text != null ? event.text : event.data));
      if (!bytes.length) return Promise.resolve(false);
      writeTask = writeTask.then(async function () {
        if (!connected || !writer) return false;
        await writer.write(new Uint8Array(bytes));
        emit("alice:serial-bridge-tx", {
          instance: uart.instance || uart.handle,
          bytes: bytes.slice(),
          text: textOf(bytes)
        });
        return true;
      }).catch(function (error) {
        lastError = error && error.message || String(error);
        emit("alice:serial-bridge-error", { direction: "mcu-to-pc", error: lastError });
        return false;
      });
      return writeTask;
    }

    async function connect(instance) {
      if (!serial || typeof serial.requestPort !== "function") throw new Error("当前浏览器不支持 Web Serial，请使用支持串口授权的 Chromium 浏览器");
      if (connected) return getState();
      if (connecting) return getState();
      if (instance) setTarget(instance);
      var uart = targetUart();
      if (!uart) throw new Error("请先构建工程并选择要实体化的 MCU UART");
      connecting = true;
      lastError = "";
      emit("alice:serial-bridge-state", { reason: "connecting" });
      var selectedPort = null;
      try {
        selectedPort = await serial.requestPort();
        activeOptions = serialOptions(uart);
        await selectedPort.open(activeOptions);
        if (!selectedPort.writable || typeof selectedPort.writable.getWriter !== "function") throw new Error("所选 PC 串口不可写");
        port = selectedPort;
        writer = selectedPort.writable.getWriter();
        activeDevice = deviceInfo(selectedPort);
        connected = true;
        connecting = false;
        emit("alice:serial-bridge-state", { reason: "connected" });
        if (selectedPort.readable && typeof selectedPort.readable.getReader === "function") readTask = runReadLoop();
        return getState();
      } catch (error) {
        connecting = false;
        lastError = error && error.message || String(error);
        if (selectedPort && selectedPort !== port && typeof selectedPort.close === "function") {
          try { await selectedPort.close(); } catch (_) {}
        }
        activeOptions = null;
        emit("alice:serial-bridge-error", { direction: "connect", error: lastError });
        throw error;
      }
    }

    async function disconnect(reason) {
      if (disconnecting) return getState();
      if (!connected && !port) {
        if (reason) lastError = String(reason);
        emit("alice:serial-bridge-state", { reason: reason || "disconnected" });
        return getState();
      }
      disconnecting = true;
      connected = false;
      connecting = false;
      var activeReader = reader;
      var activeWriter = writer;
      var activePort = port;
      reader = null;
      writer = null;
      port = null;
      try { if (activeReader) await activeReader.cancel(); } catch (_) {}
      try { if (activeReader) activeReader.releaseLock(); } catch (_) {}
      try { await writeTask; } catch (_) {}
      try { if (activeWriter) activeWriter.releaseLock(); } catch (_) {}
      try { if (activePort && typeof activePort.close === "function") await activePort.close(); } catch (_) {}
      readTask = null;
      writeTask = Promise.resolve();
      activeDevice = null;
      activeOptions = null;
      disconnecting = false;
      lastError = reason ? String(reason) : "";
      emit("alice:serial-bridge-state", { reason: reason || "disconnected" });
      return getState();
    }

    function firmwareTxListener(event) {
      void forwardFirmwareTx(event && event.detail || {});
    }

    function serialDisconnectListener(event) {
      if (!port || (event && event.target !== port && event.port !== port)) return;
      void disconnect("PC 串口设备已断开");
    }

    if (eventTarget && typeof eventTarget.addEventListener === "function") eventTarget.addEventListener("alice:firmware-uart-tx", firmwareTxListener);
    if (serial && typeof serial.addEventListener === "function") serial.addEventListener("disconnect", serialDisconnectListener);

    function destroy() {
      if (eventTarget && typeof eventTarget.removeEventListener === "function") eventTarget.removeEventListener("alice:firmware-uart-tx", firmwareTxListener);
      if (serial && typeof serial.removeEventListener === "function") serial.removeEventListener("disconnect", serialDisconnectListener);
      return disconnect();
    }

    return Object.freeze({
      configure: configure,
      setTarget: setTarget,
      connect: connect,
      disconnect: disconnect,
      forwardFirmwareTx: forwardFirmwareTx,
      receivePhysical: receivePhysical,
      getState: getState,
      isSupported: function () { return getState().supported; },
      destroy: destroy
    });
  }

  return Object.freeze({ create: create, bytesOf: bytesOf, textOf: textOf, serialOptions: serialOptions });
}));
