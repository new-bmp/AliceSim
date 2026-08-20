(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AliceSpiDisplayDevice = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var WIDTH = 160;
  var HEIGHT = 128;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function bytesOf(value) {
    if (Array.isArray(value)) return value.map(function (item) { return Number(item) & 0xff; });
    if (value instanceof Uint8Array) return Array.prototype.slice.call(value);
    return value == null ? [] : [Number(value) & 0xff];
  }

  function create(options) {
    var config = options || {};
    var width = Math.max(1, Math.round(Number(config.width) || WIDTH));
    var height = Math.max(1, Math.round(Number(config.height) || HEIGHT));
    var framebuffer = new Uint16Array(width * height);
    var state = {
      width: width,
      height: height,
      initialized: false,
      sleeping: true,
      displayOn: false,
      command: null,
      parameterBytes: [],
      columnStart: 0,
      columnEnd: width - 1,
      rowStart: 0,
      rowEnd: height - 1,
      cursorX: 0,
      cursorY: 0,
      pendingPixelHigh: null,
      bytesReceived: 0,
      framesWritten: 0,
      connection: {
        powered: false,
        busConnected: false,
        bindingValid: false,
        selected: false,
        dataMode: false,
        reason: "power"
      }
    };

    function resetController(clearRam) {
      state.initialized = false;
      state.sleeping = true;
      state.displayOn = false;
      state.command = null;
      state.parameterBytes = [];
      state.columnStart = 0;
      state.columnEnd = width - 1;
      state.rowStart = 0;
      state.rowEnd = height - 1;
      state.cursorX = 0;
      state.cursorY = 0;
      state.pendingPixelHigh = null;
      if (clearRam !== false) framebuffer.fill(0);
    }

    function setConnection(next) {
      var previousPowered = state.connection.powered;
      state.connection = Object.assign({}, state.connection, next || {});
      if (previousPowered && !state.connection.powered) resetController(true);
      return getState();
    }

    function advanceCursor() {
      state.cursorX += 1;
      if (state.cursorX > state.columnEnd) {
        state.cursorX = state.columnStart;
        state.cursorY += 1;
        if (state.cursorY > state.rowEnd) {
          state.cursorY = state.rowStart;
          state.framesWritten += 1;
        }
      }
    }

    function writePixel(color) {
      if (state.cursorX >= 0 && state.cursorX < width && state.cursorY >= 0 && state.cursorY < height) {
        framebuffer[state.cursorY * width + state.cursorX] = Number(color) & 0xffff;
      }
      advanceCursor();
    }

    function applyWindow(command, bytes) {
      if (bytes.length < 4) return false;
      var start = (bytes[0] << 8) | bytes[1];
      var end = (bytes[2] << 8) | bytes[3];
      if (command === 0x2a) {
        state.columnStart = Math.round(clamp(start, 0, width - 1));
        state.columnEnd = Math.round(clamp(end, state.columnStart, width - 1));
      } else {
        state.rowStart = Math.round(clamp(start, 0, height - 1));
        state.rowEnd = Math.round(clamp(end, state.rowStart, height - 1));
      }
      return true;
    }

    function command(value) {
      var code = Number(value) & 0xff;
      state.bytesReceived += 1;
      state.command = code;
      state.parameterBytes = [];
      state.pendingPixelHigh = null;
      if (code === 0x01) resetController(true);
      else if (code === 0x11) {
        state.sleeping = false;
        state.initialized = true;
      } else if (code === 0x10) state.sleeping = true;
      else if (code === 0x29) state.displayOn = true;
      else if (code === 0x28) state.displayOn = false;
      else if (code === 0x2c) {
        state.cursorX = state.columnStart;
        state.cursorY = state.rowStart;
      }
      return code;
    }

    function data(value) {
      var bytes = bytesOf(value);
      state.bytesReceived += bytes.length;
      bytes.forEach(function (byte) {
        if (state.command === 0x2a || state.command === 0x2b) {
          state.parameterBytes.push(byte);
          if (state.parameterBytes.length === 4) {
            applyWindow(state.command, state.parameterBytes);
            state.parameterBytes = [];
          }
          return;
        }
        if (state.command !== 0x2c) return;
        if (state.pendingPixelHigh == null) state.pendingPixelHigh = byte;
        else {
          writePixel((state.pendingPixelHigh << 8) | byte);
          state.pendingPixelHigh = null;
        }
      });
      return bytes.length;
    }

    function transmit(value, dataMode) {
      var bytes = bytesOf(value);
      if (!state.connection.powered || !state.connection.busConnected || !state.connection.bindingValid || !state.connection.selected) return 0;
      if (dataMode) return data(bytes);
      bytes.forEach(command);
      return bytes.length;
    }

    function getState() {
      return {
        width: width,
        height: height,
        initialized: state.initialized,
        sleeping: state.sleeping,
        displayOn: state.displayOn,
        visible: Boolean(state.connection.powered && state.displayOn && !state.sleeping),
        command: state.command,
        columnStart: state.columnStart,
        columnEnd: state.columnEnd,
        rowStart: state.rowStart,
        rowEnd: state.rowEnd,
        bytesReceived: state.bytesReceived,
        framesWritten: state.framesWritten,
        connection: Object.assign({}, state.connection)
      };
    }

    function getFramebuffer() {
      return framebuffer;
    }

    resetController(true);
    return Object.freeze({
      reset: function () { resetController(true); return getState(); },
      setConnection: setConnection,
      command: command,
      data: data,
      transmit: transmit,
      getState: getState,
      getFramebuffer: getFramebuffer
    });
  }

  return Object.freeze({ create: create, WIDTH: WIDTH, HEIGHT: HEIGHT });
}));
