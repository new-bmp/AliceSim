(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AliceOledDevice = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var WIDTH = 128;
  var HEIGHT = 64;
  var PAGES = HEIGHT / 8;
  var BUFFER_SIZE = WIDTH * PAGES;

  function clampByte(value) {
    var numeric = Number(value);
    return Number.isFinite(numeric) ? (Math.floor(numeric) & 0xff) : 0;
  }

  function normalizeBytes(input) {
    if (input == null) return [];
    if (typeof input === "number") return [clampByte(input)];
    if (typeof input === "string") {
      return Array.from(input).map(function (character) { return character.charCodeAt(0) & 0xff; });
    }
    if (input instanceof ArrayBuffer) return Array.from(new Uint8Array(input), clampByte);
    if (ArrayBuffer.isView(input)) return Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength), clampByte);
    if (Array.isArray(input) || (typeof input.length === "number" && input.length >= 0)) return Array.from(input, clampByte);
    return [];
  }

  function normalizeAddress(value) {
    if (typeof value === "string") {
      var text = value.trim();
      if (/^0x[0-9a-f]+$/i.test(text)) value = parseInt(text, 16);
      else value = Number(text);
    }
    var address = Number(value);
    return Number.isFinite(address) ? Math.max(0x03, Math.min(0x77, Math.floor(address))) : 0x3c;
  }

  function copyConnection(input) {
    var source = input && typeof input === "object" ? input : {};
    return {
      powered: Boolean(source.powered),
      busConnected: Boolean(source.busConnected),
      bindingValid: source.bindingValid !== false,
      vccLevel: source.vccLevel == null ? null : Number(source.vccLevel),
      gndLevel: source.gndLevel == null ? null : Number(source.gndLevel),
      sclPin: String(source.sclPin || ""),
      sdaPin: String(source.sdaPin || ""),
      reason: String(source.reason || "")
    };
  }

  function SSD1306Device(options) {
    var config = options && typeof options === "object" ? options : {};
    this.width = WIDTH;
    this.height = HEIGHT;
    this.address = normalizeAddress(config.address);
    this.connection = copyConnection(config.connection);
    this.framebuffer = new Uint8Array(BUFFER_SIZE);
    this.textEntries = [];
    this.revision = 0;
    this._resetController();
  }

  SSD1306Device.prototype._resetController = function () {
    this.initialized = false;
    this.displayOn = false;
    this.inverse = false;
    this.entireDisplayOn = false;
    this.addressingMode = "horizontal";
    this.columnStart = 0;
    this.columnEnd = WIDTH - 1;
    this.pageStart = 0;
    this.pageEnd = PAGES - 1;
    this.column = 0;
    this.page = 0;
    this.startLine = 0;
    this.displayOffset = 0;
    this.contrast = 0x7f;
    // The simulated part represents the complete 128x64 module. Its glass is
    // wired so the common A1/C8 initialization maps logical (0, 0) to the
    // visible top-left pixel.
    this.segmentRemap = true;
    this.comScanDec = true;
    this.pendingCommand = null;
    this.contentMode = "framebuffer";
  };

  SSD1306Device.prototype.reset = function (options) {
    var config = options && typeof options === "object" ? options : {};
    this.framebuffer.fill(0);
    this.textEntries = [];
    this._resetController();
    if (config.address != null) this.address = normalizeAddress(config.address);
    this.revision += 1;
    return this.getState();
  };

  SSD1306Device.prototype.setAddress = function (address) {
    this.address = normalizeAddress(address);
    this.revision += 1;
    return this.address;
  };

  SSD1306Device.prototype.setConnection = function (connection) {
    var previousPowered = this.connection.powered;
    this.connection = copyConnection(connection);
    if (previousPowered && !this.connection.powered) {
      this.framebuffer.fill(0);
      this.textEntries = [];
      this._resetController();
    }
    this.revision += 1;
    return this.getState();
  };

  SSD1306Device.prototype.initialize = function (options) {
    var config = options && typeof options === "object" ? options : {};
    if (config.reset !== false) {
      this.framebuffer.fill(0);
      this.textEntries = [];
      this._resetController();
    }
    if (config.address != null) this.address = normalizeAddress(config.address);
    this.initialized = true;
    if (config.commands != null) this.command(config.commands);
    if (config.displayOn == null) this.displayOn = true;
    else this.displayOn = Boolean(config.displayOn);
    this.revision += 1;
    return this.getState();
  };

  SSD1306Device.prototype._applyPendingArgument = function (byte) {
    var pending = this.pendingCommand;
    if (!pending) return false;
    pending.values.push(byte);
    if (pending.values.length < pending.count) return true;

    if (pending.command === 0x20) {
      this.addressingMode = pending.values[0] === 1 ? "vertical" : (pending.values[0] === 2 ? "page" : "horizontal");
    } else if (pending.command === 0x21) {
      this.columnStart = Math.max(0, Math.min(WIDTH - 1, pending.values[0]));
      this.columnEnd = Math.max(this.columnStart, Math.min(WIDTH - 1, pending.values[1]));
      this.column = this.columnStart;
    } else if (pending.command === 0x22) {
      this.pageStart = Math.max(0, Math.min(PAGES - 1, pending.values[0]));
      this.pageEnd = Math.max(this.pageStart, Math.min(PAGES - 1, pending.values[1]));
      this.page = this.pageStart;
    } else if (pending.command === 0x81) {
      this.contrast = pending.values[0];
    } else if (pending.command === 0xd3) {
      this.displayOffset = pending.values[0] & 0x3f;
    }
    this.pendingCommand = null;
    return true;
  };

  SSD1306Device.prototype._startPending = function (command, count) {
    this.pendingCommand = { command: command, count: count, values: [] };
  };

  SSD1306Device.prototype.command = function (input) {
    var bytes = normalizeBytes(input);
    for (var index = 0; index < bytes.length; index += 1) {
      var command = bytes[index];
      if (this._applyPendingArgument(command)) continue;
      if (command === 0xae) this.displayOn = false;
      else if (command === 0xaf) {
        this.displayOn = true;
        this.initialized = true;
      } else if (command === 0xa4) this.entireDisplayOn = false;
      else if (command === 0xa5) this.entireDisplayOn = true;
      else if (command === 0xa6) this.inverse = false;
      else if (command === 0xa7) this.inverse = true;
      else if (command === 0x20) this._startPending(command, 1);
      else if (command === 0x21 || command === 0x22) this._startPending(command, 2);
      else if (command === 0x81 || command === 0x8d || command === 0xa8 || command === 0xd3 || command === 0xd5 || command === 0xd9 || command === 0xda || command === 0xdb) this._startPending(command, 1);
      else if (command >= 0x40 && command <= 0x7f) this.startLine = command & 0x3f;
      else if (command >= 0xb0 && command <= 0xb7) this.page = command & 0x07;
      else if (command >= 0x00 && command <= 0x0f) this.column = (this.column & 0xf0) | (command & 0x0f);
      else if (command >= 0x10 && command <= 0x1f) this.column = ((command & 0x0f) << 4) | (this.column & 0x0f);
      else if (command === 0xa0) this.segmentRemap = false;
      else if (command === 0xa1) this.segmentRemap = true;
      else if (command === 0xc0) this.comScanDec = false;
      else if (command === 0xc8) this.comScanDec = true;
    }
    this.revision += 1;
    return bytes.length;
  };

  SSD1306Device.prototype._advanceCursor = function () {
    if (this.addressingMode === "vertical") {
      this.page += 1;
      if (this.page > this.pageEnd) {
        this.page = this.pageStart;
        this.column += 1;
        if (this.column > this.columnEnd) this.column = this.columnStart;
      }
      return;
    }
    this.column += 1;
    if (this.column <= this.columnEnd) return;
    this.column = this.columnStart;
    if (this.addressingMode === "horizontal") {
      this.page += 1;
      if (this.page > this.pageEnd) this.page = this.pageStart;
    }
  };

  SSD1306Device.prototype.data = function (input) {
    var bytes = normalizeBytes(input);
    this.contentMode = "framebuffer";
    for (var index = 0; index < bytes.length; index += 1) {
      var column = Math.max(0, Math.min(WIDTH - 1, this.column));
      var page = Math.max(0, Math.min(PAGES - 1, this.page));
      this.framebuffer[page * WIDTH + column] = bytes[index];
      this._advanceCursor();
    }
    this.revision += 1;
    return bytes.length;
  };

  SSD1306Device.prototype.writeFramebuffer = function (input, options) {
    var config = options && typeof options === "object" ? options : {};
    var bytes = normalizeBytes(input);
    var offset = Math.max(0, Math.min(BUFFER_SIZE, Math.floor(Number(config.offset) || 0)));
    if (config.clear !== false) this.framebuffer.fill(0);
    var count = Math.min(bytes.length, BUFFER_SIZE - offset);
    for (var index = 0; index < count; index += 1) this.framebuffer[offset + index] = bytes[index];
    this.contentMode = "framebuffer";
    this.textEntries = [];
    this.revision += 1;
    return count;
  };

  SSD1306Device.prototype.writeText = function (text, options) {
    var config = options && typeof options === "object" ? options : {};
    if (config.clear !== false) this.textEntries = [];
    var entry = {
      text: String(text == null ? "" : text),
      x: Math.max(0, Math.min(WIDTH - 1, Math.floor(Number(config.x) || 0))),
      y: Math.max(0, Math.min(HEIGHT - 1, Math.floor(Number(config.y) || 0))),
      size: Math.max(6, Math.min(24, Math.floor(Number(config.size) || 8))),
      color: String(config.color || "#9ffcff")
    };
    this.textEntries.push(entry);
    this.contentMode = "text";
    this.revision += 1;
    return Object.assign({}, entry);
  };

  SSD1306Device.prototype.pixelAt = function (x, y) {
    var column = Math.floor(Number(x));
    var row = Math.floor(Number(y));
    if (column < 0 || column >= WIDTH || row < 0 || row >= HEIGHT) return 0;
    // Common 128x64 modules have their glass wired in the reverse SEG/COM
    // direction, so the usual A1/C8 init sequence produces upright logical
    // framebuffer coordinates. Model the visible module, not bare controller
    // segment numbers, while still allowing A0/C0 to flip the display.
    var mappedColumn = this.segmentRemap ? column : WIDTH - 1 - column;
    var mappedRow = this.comScanDec ? row : HEIGHT - 1 - row;
    mappedRow = (mappedRow + this.startLine + this.displayOffset) % HEIGHT;
    var bit = (this.framebuffer[Math.floor(mappedRow / 8) * WIDTH + mappedColumn] >> (mappedRow & 7)) & 1;
    if (this.entireDisplayOn) bit = 1;
    if (this.inverse) bit = bit ? 0 : 1;
    return bit;
  };

  SSD1306Device.prototype.isVisible = function () {
    return Boolean(this.connection.powered && this.connection.busConnected && this.connection.bindingValid && this.initialized && this.displayOn);
  };

  SSD1306Device.prototype.accepts = function (address) {
    return address == null || normalizeAddress(address) === this.address;
  };

  SSD1306Device.prototype.getState = function (options) {
    var config = options && typeof options === "object" ? options : {};
    var state = {
      width: WIDTH,
      height: HEIGHT,
      address: this.address,
      initialized: this.initialized,
      displayOn: this.displayOn,
      visible: this.isVisible(),
      inverse: this.inverse,
      entireDisplayOn: this.entireDisplayOn,
      addressingMode: this.addressingMode,
      column: this.column,
      page: this.page,
      contrast: this.contrast,
      contentMode: this.contentMode,
      textEntries: this.textEntries.map(function (entry) { return Object.assign({}, entry); }),
      connection: Object.assign({}, this.connection),
      revision: this.revision
    };
    if (config.framebuffer) state.framebuffer = Array.from(this.framebuffer);
    return state;
  };

  return {
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    BUFFER_SIZE: BUFFER_SIZE,
    SSD1306Device: SSD1306Device,
    create: function (options) { return new SSD1306Device(options); },
    normalizeAddress: normalizeAddress,
    normalizeBytes: normalizeBytes
  };
}));
