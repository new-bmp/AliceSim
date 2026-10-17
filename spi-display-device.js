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
      pixelBytes: [],
      pixelFormat: 5,
      madctl: 0,
      inverse: false,
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
      state.pixelBytes = [];
      state.pixelFormat = 5;
      state.madctl = 0;
      state.inverse = false;
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
      var x = state.madctl & 0x20 ? state.cursorY : state.cursorX;
      var y = state.madctl & 0x20 ? state.cursorX : state.cursorY;
      if (state.madctl & 0x40) x = width - 1 - x;
      if (state.madctl & 0x80) y = height - 1 - y;
      if (x >= 0 && x < width && y >= 0 && y < height) {
        framebuffer[y * width + x] = Number(color) & 0xffff;
      }
      advanceCursor();
    }

    function applyWindow(command, bytes) {
      if (bytes.length < 4) return false;
      var start = (bytes[0] << 8) | bytes[1];
      var end = (bytes[2] << 8) | bytes[3];
      var columns = state.madctl & 0x20 ? height : width;
      var rows = state.madctl & 0x20 ? width : height;
      if (command === 0x2a) {
        state.columnStart = Math.round(clamp(start, 0, columns - 1));
        state.columnEnd = Math.round(clamp(end, state.columnStart, columns - 1));
      } else {
        state.rowStart = Math.round(clamp(start, 0, rows - 1));
        state.rowEnd = Math.round(clamp(end, state.rowStart, rows - 1));
      }
      return true;
    }

    function command(value) {
      var code = Number(value) & 0xff;
      state.bytesReceived += 1;
      state.command = code;
      state.parameterBytes = [];
      state.pendingPixelHigh = null;
      state.pixelBytes = [];
      if (code === 0x01) resetController(true);
      else if (code === 0x11) {
        state.sleeping = false;
        state.initialized = true;
      } else if (code === 0x10) state.sleeping = true;
      else if (code === 0x29) state.displayOn = true;
      else if (code === 0x28) state.displayOn = false;
      else if (code === 0x20) state.inverse = false;
      else if (code === 0x21) state.inverse = true;
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
        if (state.command === 0x36 || state.command === 0x3a) {
          if (state.parameterBytes.length === 0) {
            if (state.command === 0x36) state.madctl = byte;
            else state.pixelFormat = byte & 7;
            state.parameterBytes.push(byte);
          }
          return;
        }
        if (state.command === 0x2a || state.command === 0x2b) {
          state.parameterBytes.push(byte);
          if (state.parameterBytes.length === 4) {
            applyWindow(state.command, state.parameterBytes);
            state.parameterBytes = [];
          }
          return;
        }
        if (state.command !== 0x2c && state.command !== 0x3c) return;
        if (state.pixelFormat !== 5 && state.pixelFormat !== 6) return;
        state.pixelBytes.push(byte);
        if (state.pixelBytes.length === (state.pixelFormat === 6 ? 3 : 2)) {
          var color = state.pixelFormat === 6
            ? ((state.pixelBytes[0] & 0xf8) << 8) | ((state.pixelBytes[1] & 0xfc) << 3) | (state.pixelBytes[2] >> 3)
            : (state.pixelBytes[0] << 8) | state.pixelBytes[1];
          writePixel(color);
          state.pixelBytes = [];
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
        madctl: state.madctl,
        pixelFormat: state.pixelFormat,
        inverse: state.inverse,
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

    function getDisplayFramebuffer() {
      // RAM stores the transmitted color. BGR and inversion affect the panel
      // output, leaving stored pixels available when those modes are undone.
      var pixels = new Uint16Array(framebuffer.length);
      for (var i = 0; i < framebuffer.length; i += 1) {
        var color = framebuffer[i];
        if (state.madctl & 8) color = ((color & 0x1f) << 11) | (color & 0x07e0) | ((color >> 11) & 0x1f);
        pixels[i] = state.inverse ? color ^ 0xffff : color;
      }
      return pixels;
    }

    resetController(true);
    return Object.freeze({
      reset: function () { resetController(true); return getState(); },
      setConnection: setConnection,
      command: command,
      data: data,
      transmit: transmit,
      getState: getState,
      getFramebuffer: getFramebuffer,
      getDisplayFramebuffer: getDisplayFramebuffer
    });
  }

  return Object.freeze({ create: create, WIDTH: WIDTH, HEIGHT: HEIGHT });
}));
