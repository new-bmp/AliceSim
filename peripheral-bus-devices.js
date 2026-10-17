(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AlicePeripheralBusDevices = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ADDRESSES = { bmp280: 0x76, mpu6050: 0x68, bh1750: 0x23, sht30: 0x44, ds3231: 0x68, ina219: 0x40, pcf8574: 0x20, pca9685: 0x40, w25qxx: null };
  var VOLTAGES = { bmp280: [1.71, 3.6], mpu6050: [2.375, 3.46], bh1750: [2.4, 3.6], sht30: [2.15, 5.5], ds3231: [2.3, 5.5], ina219: [2.7, 5.5], pcf8574: [2.5, 6], pca9685: [2.3, 5.5], w25qxx: [2.7, 3.6] };
  var DEFAULTS = {
    bmp280: { temperatureC: 25, pressurePa: 101325 },
    mpu6050: { accelX: 0, accelY: 0, accelZ: 1, gyroX: 0, gyroY: 0, gyroZ: 0, temperatureC: 25 },
    bh1750: { lux: 500 }, sht30: { temperatureC: 25, humidityPercent: 50 },
    ds3231: { unixTime: 1785470400, temperatureC: 25 },
    ina219: { busVoltageV: 12, currentA: 0.5, shuntOhms: 0.1 },
    pcf8574: { inputMask: 255 }, pca9685: { frequencyHz: 50, channel0: 0 },
    w25qxx: { capacityKiB: 8192 }
  };
  function number(value, fallback) { var n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
  function bytes(value) { return Array.from(value || [], function (n) { return number(n, 0) & 255; }); }
  function bcd(value) { return Math.floor(value / 10) * 16 + value % 10; }
  function decimal(value) { return (value >> 4) * 10 + (value & 15); }
  function word(value) { var n = Math.round(value) & 65535; return [n >> 8, n & 255]; }
  function crc8(data) {
    var crc = 255;
    data.forEach(function (value) { crc ^= value; for (var i = 0; i < 8; i += 1) crc = ((crc & 128) ? (crc << 1) ^ 0x31 : crc << 1) & 255; });
    return crc;
  }
  function denied(reason) { return { accepted: false, byteCount: 0, bytes: [], reason: reason }; }

  function BusDevice(type, options) {
    var config = options || {};
    this.kind = type;
    this.properties = Object.assign({}, DEFAULTS[type], config.properties || {});
    Object.keys(DEFAULTS[type]).forEach(function (key) { if (config[key] != null) this.properties[key] = config[key]; }, this);
    this.address = ADDRESSES[type];
    var address = config.address == null ? this.properties.address : config.address;
    if (address != null && Number.isInteger(Number(address)) && Number(address) >= 3 && Number(address) <= 119) this.address = Number(address);
    this.nominalVoltage = number(config.nominalVoltage, 3.3);
    this.minimum = number(config.minOperatingVoltage, VOLTAGES[type][0]);
    this.maximum = number(config.maxOperatingVoltage, VOLTAGES[type][1]);
    this.connection = Object.assign({}, config.connection || {});
    this.time = 0;
    this.revision = 0;
    this.storage = new Map();
    this.flashStoredBytes = 0;
    this.portInputs = 255;
    this.clockUnix = number(this.properties.unixTime, 1785470400);
    this.clockAnchor = 0;
    this.clockWeekday = new Date(this.clockUnix * 1000).getUTCDay() + 1;
    this.reset();
    if (type === "pca9685") this.applyPcaProperties(config.properties || {});
  }
  BusDevice.prototype.powerStatus = function () {
    var c = this.connection;
    var ground = number(c.gndLevel, 0);
    var voltage = number(c.vccLevel, ground + this.nominalVoltage) - ground;
    var reason = !c.powered || c.vccConnected === false || c.gndConnected === false ? "power-disconnected" : voltage < this.minimum ? "undervoltage" : voltage > this.maximum ? "overvoltage" : "ok";
    return { powered: reason === "ok", reason: reason, railVoltage: voltage, vccLevel: voltage + ground, gndLevel: ground, minimum: this.minimum, maximum: this.maximum };
  };
  BusDevice.prototype.ready = function () {
    var c = this.connection;
    return this.powerStatus().powered && c.bindingValid === true && c.clkConnected === true && c.dioConnected === true && c.busConnected !== false
      && (this.kind !== "w25qxx" || c.dataConnected === true && c.signalConnected === true);
  };
  BusDevice.prototype.accepts = function (address) { return this.kind !== "w25qxx" && Number(address) === this.address; };
  BusDevice.prototype.setTime = function (timeMs) {
    var next = number(timeMs, this.time);
    if (next < this.time && this.kind === "ds3231") this.clockAnchor = next;
    this.time = Math.max(0, next);
    return this.time;
  };
  BusDevice.prototype.setConnection = function (connection) {
    var powered = this.powerStatus().powered;
    var selected = Boolean(this.connection.selected);
    this.connection = Object.assign({}, connection || {});
    var nowPowered = this.powerStatus().powered;
    if (this.kind === "w25qxx") {
      if (!nowPowered) { this.flashPacket = []; this.writeEnabled = false; this.flashOffset = 0; }
      else if (selected && !this.connection.selected) {
        if (this.ready()) this.latchFlash();
        else { this.flashPacket = []; this.flashData = new Map(); this.flashProgramCount = 0; this.flashOffset = 0; }
      }
      else if (!selected && this.connection.selected) { this.flashPacket = []; this.flashOffset = 0; }
    } else if (powered && !nowPowered && this.kind !== "ds3231") this.reset();
    this.revision += 1;
    return this.getState();
  };
  BusDevice.prototype.setProperties = function (properties) {
    var oldMask = this.portMask();
    this.properties = Object.assign({}, this.properties, properties || {});
    if (properties && properties.address != null && Number.isInteger(Number(properties.address)) && Number(properties.address) >= 3 && Number(properties.address) <= 119) this.address = Number(properties.address);
    if (properties && properties.unixTime != null && this.kind === "ds3231") {
      this.clockUnix = number(properties.unixTime, this.clockUnix); this.clockAnchor = this.time;
      this.clockWeekday = new Date(this.clockUnix * 1000).getUTCDay() + 1;
    }
    if (this.kind === "pcf8574" && this.portMask() !== oldMask) this.interruptActive = true;
    if (this.kind === "pca9685") this.applyPcaProperties(properties || {});
    if (this.kind === "w25qxx") { var capacity = this.capacity(); this.storage.forEach(function (page, key) { if (key >= capacity) { this.flashStoredBytes -= page.count; this.storage.delete(key); } }, this); }
    this.revision += 1;
    return this.getState();
  };
  BusDevice.prototype.setPortInputs = function (mask) {
    var previous = this.portMask(); this.portInputs = number(mask, 255) & 255;
    if (this.portMask() !== previous) { this.interruptActive = true; this.revision += 1; }
    return this.portMask();
  };
  BusDevice.prototype.portMask = function () { return (this.outputLatch == null ? 255 : this.outputLatch) & (number(this.properties.inputMask, 255) & 255) & this.portInputs; };
  BusDevice.prototype.reset = function () {
    this.registers = new Uint8Array(256);
    this.pointer = 0;
    this.pending = null;
    this.outputLatch = 255;
    this.interruptActive = false;
    this.bhPowered = false;
    this.bhMode = 0;
    this.mtreg = 69;
    this.flashPacket = [];
    this.flashOffset = 0;
    this.writeEnabled = false;
    if (this.kind === "bmp280") {
      this.registers[0xd0] = 0x58;
      var calibration = [27504, 26435, -1000, 36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000];
      calibration.forEach(function (n, index) { this.registers[0x88 + index * 2] = n & 255; this.registers[0x89 + index * 2] = (n >> 8) & 255; }, this);
      this.registers[0xf7] = 0x80; this.registers[0xfa] = 0x80;
    } else if (this.kind === "mpu6050") { this.registers[0x75] = 0x68; this.registers[0x6b] = 0x40; }
    else if (this.kind === "ina219") { this.words = [0x399f, 0, 0, 0, 0, 0]; }
    else if (this.kind === "pca9685") { this.registers[0] = 1; this.registers[1] = 4; this.registers[0xfe] = 0x1e; }
    this.revision += 1;
  };
  BusDevice.prototype.validate = function (event) {
    if (!this.ready()) return "device-not-ready";
    if (this.kind === "w25qxx") return this.connection.selected ? null : "chip-not-selected";
    var requested = event.address7Bit;
    if (requested == null && event.deviceAddress != null) requested = Number(event.deviceAddress) >> 1;
    if (requested == null && event.address != null) requested = Number(event.address);
    return requested != null && !this.accepts(requested) ? "address-mismatch" : null;
  };
  BusDevice.prototype.transmit = function (input) {
    var event = input || {};
    if (event.timeMs != null || event.time != null) this.setTime(event.timeMs == null ? event.time : event.timeMs);
    var reason = this.validate(event); if (reason) return denied(reason);
    var data = bytes(event.bytes);
    if (!data.length) return denied("empty-write");
    var result;
    if (this.kind === "w25qxx") {
      // Page-program only needs a command, address and final 256 page bytes.
      // Keep read commands separately; bound command storage against long streams.
      this.clockedResponse = [];
      for (var f = 0; f < data.length; f += 1) {
        var command = this.flashPacket[0];
        var responseReady = command === 0x9f || command === 5 || command === 3 && this.flashPacket.length >= 4 || command === 0x0b && this.flashPacket.length >= 5;
        this.clockedResponse.push(responseReady ? this.readFlash(1).bytes[0] : 255);
        if (this.flashPacket.length < 4 || this.flashPacket[0] === 0x0b && this.flashPacket.length < 5) this.flashPacket.push(data[f]);
        else if (this.flashPacket[0] === 2) {
          this.flashData = this.flashData || new Map();
          this.flashData.set(this.flashProgramCount & 255, data[f]); this.flashProgramCount += 1;
        }
        if (this.flashPacket.length === 1) { this.flashProgramCount = 0; this.flashData = new Map(); }
      }
      result = true;
    } else if (this.kind === "bh1750") result = this.bhCommand(data);
    else if (this.kind === "sht30") result = this.shtCommand(data);
    else if (this.kind === "pcf8574") { this.outputLatch = data[data.length - 1]; this.interruptActive = false; result = true; }
    else {
      var start = event.memoryAddress == null ? data.shift() : Number(event.memoryAddress) & 255;
      this.pointer = start;
      result = this.writeRegisters(start, data);
    }
    if (!result) return denied("unsupported-command");
    this.revision += 1;
    return { accepted: true, byteCount: bytes(event.bytes).length };
  };
  BusDevice.prototype.receive = function (input) {
    var event = typeof input === "number" ? { length: input } : input || {};
    if (event.timeMs != null || event.time != null) this.setTime(event.timeMs == null ? event.time : event.timeMs);
    var reason = this.validate(event); if (reason) return denied(reason);
    var length = Number(event.length);
    if (!Number.isInteger(length) || length < 1 || length > 65536) return denied("invalid-length");
    var data;
    if (this.kind === "w25qxx") {
      if (event.clockedByTransmit) {
        if (!this.clockedResponse || this.clockedResponse.length < length) return denied("short-clocked-response");
        var clocked = this.clockedResponse.slice(0, length); this.clockedResponse = [];
        return { accepted: true, bytes: clocked };
      }
      return this.readFlash(length);
    }
    if (this.kind === "bh1750") return this.bhRead(length);
    if (this.kind === "sht30") return this.shtRead(length);
    if (this.kind === "pcf8574") { data = Array(length).fill(this.portMask()); this.interruptActive = false; }
    else {
      if (event.memoryAddress != null) this.pointer = Number(event.memoryAddress) & 255;
      this.refreshMeasurements();
      if (this.kind === "ina219") {
        data = [];
        for (var w = 0; w < length; w += 1) { var index = (this.pointer + Math.floor(w / 2)) % 6; data.push((this.words[index] >> (w % 2 ? 0 : 8)) & 255); }
        this.pointer = (this.pointer + Math.ceil(length / 2)) % 6;
      } else {
        data = [];
        for (var i = 0; i < length; i += 1) data.push(this.registers[(this.pointer + (this.kind === "pca9685" && !(this.registers[0] & 0x20) ? 0 : i)) & 255]);
        if (this.kind !== "pca9685" || this.registers[0] & 0x20) this.pointer = (this.pointer + length) & 255;
      }
    }
    return { accepted: true, bytes: data };
  };
  BusDevice.prototype.writeRegisters = function (start, data) {
    if (this.kind === "ds3231" && start <= 6 && data.length) this.refreshRtc();
    if (this.kind === "ina219") {
      if (data.length % 2) return false;
      for (var w = 0; w < data.length; w += 2) {
        var index = (start + w / 2) % 6;
        if (index === 0 && data[w] & 0x80) { this.reset(); break; }
        if (index === 0 || index === 5) this.words[index] = (data[w] << 8) | data[w + 1];
      }
      return true;
    }
    var autoIncrement = this.kind !== "pca9685" || Boolean(this.registers[0] & 0x20);
    for (var i = 0; i < data.length; i += 1) {
      var reg = (start + (autoIncrement ? i : 0)) & 255, value = data[i];
      if (this.kind === "bmp280" && reg === 0xe0 && value === 0xb6) { this.reset(); continue; }
      if (this.kind === "mpu6050" && reg === 0x6b && value & 0x80) { this.reset(); continue; }
      if (this.kind === "bmp280" && [0xf4, 0xf5].indexOf(reg) < 0) continue;
      if (this.kind === "mpu6050" && (reg === 0x75 || reg >= 0x3b && reg <= 0x48)) continue;
      if (this.kind === "pca9685" && reg === 0xfe && !(this.registers[0] & 0x10)) continue;
      this.registers[reg] = value;
      if (this.kind === "pca9685" && reg >= 0xfa && reg <= 0xfd) for (var ch = 0; ch < 16; ch += 1) this.registers[6 + ch * 4 + reg - 0xfa] = value;
    }
    if (this.kind === "ds3231" && start <= 6 && data.length) this.applyRtcWrite();
    if (this.kind === "bmp280" && start === 0xf4 && this.registers[0xf4] & 3) { this.refreshMeasurements(); if ((this.registers[0xf4] & 3) !== 3) this.registers[0xf4] &= 0xfc; }
    this.pointer = (start + (autoIncrement ? data.length : 0)) & 255;
    return true;
  };
  // Calibration matches the Bosch datasheet example. Inverting its compensation
  // produces raw measurements that any normal BMP280 driver can compensate.
  function bmpTemperature(raw) {
    var a = (raw / 16384 - 27504 / 1024) * 26435;
    var b = Math.pow(raw / 131072 - 27504 / 8192, 2) * -1000;
    return { celsius: (a + b) / 5120, fine: a + b };
  }
  function bmpPressure(raw, fine) {
    var a = fine / 2 - 64000;
    var b = a * a * -7 / 32768 + a * 140 * 2;
    b = b / 4 + 2855 * 65536;
    a = (3024 * a * a / 524288 + -10685 * a) / 524288;
    a = (1 + a / 32768) * 36477;
    var p = (1048576 - raw - b / 4096) * 6250 / a;
    return p + (6000 * p * p / 2147483648 + p * -14600 / 32768 + 15500) / 16;
  }
  function invert(target, calculate, increasing) {
    var lo = 0, hi = 1048575;
    for (var i = 0; i < 21; i += 1) { var mid = (lo + hi) / 2; if ((calculate(mid) < target) === increasing) lo = mid; else hi = mid; }
    return clamp(Math.round((lo + hi) / 2), 0, 1048575);
  }
  BusDevice.prototype.refreshMeasurements = function () {
    var p = this.properties, r = this.registers;
    if (this.kind === "bmp280" && r[0xf4] & 3) {
      var rawT = invert(clamp(number(p.temperatureC, 25), -40, 85), function (raw) { return bmpTemperature(raw).celsius; }, true);
      var fine = bmpTemperature(rawT).fine;
      var rawP = invert(clamp(number(p.pressurePa, 101325), 30000, 110000), function (raw) { return bmpPressure(raw, fine); }, false);
      [rawP, rawT].forEach(function (raw, index) { var reg = 0xf7 + index * 3; r[reg] = raw >> 12; r[reg + 1] = (raw >> 4) & 255; r[reg + 2] = (raw & 15) << 4; });
    } else if (this.kind === "mpu6050" && !(r[0x6b] & 0x40)) {
      var accelScale = [16384, 8192, 4096, 2048][(r[0x1c] >> 3) & 3];
      var gyroScale = [131, 65.5, 32.8, 16.4][(r[0x1b] >> 3) & 3];
      var values = [number(p.accelX, 0) * accelScale, number(p.accelY, 0) * accelScale, number(p.accelZ, 1) * accelScale, (number(p.temperatureC, 25) - 36.53) * 340,
        number(p.gyroX, 0) * gyroScale, number(p.gyroY, 0) * gyroScale, number(p.gyroZ, 0) * gyroScale];
      values.forEach(function (value, index) { var encoded = word(clamp(value, -32768, 32767)); r[0x3b + index * 2] = encoded[0]; r[0x3c + index * 2] = encoded[1]; });
    } else if (this.kind === "ds3231") this.refreshRtc();
    else if (this.kind === "ina219") {
      var current = number(p.currentA, 0.5), shunt = Math.max(0.00001, number(p.shuntOhms, 0.1));
      this.words[1] = Math.round(clamp(current * shunt / 0.00001, -32768, 32767)) & 65535;
      this.words[2] = ((clamp(Math.round(number(p.busVoltageV, 12) / 0.004), 0, 8191) << 3) | 2) & 65535;
      var lsb = this.words[5] ? 0.04096 / (this.words[5] * shunt) : 0;
      this.words[4] = lsb ? Math.round(clamp(current / lsb, -32768, 32767)) & 65535 : 0;
      this.words[3] = lsb ? Math.round(clamp(Math.max(0, number(p.busVoltageV, 12) * current) / (20 * lsb), 0, 65535)) : 0;
    }
  };
  BusDevice.prototype.bhCommand = function (data) {
    for (var i = 0; i < data.length; i += 1) {
      var command = data[i];
      if (command === 0) { this.bhPowered = false; this.bhMode = 0; }
      else if (command === 1) this.bhPowered = true;
      else if (command === 7) { if (!this.bhPowered) return false; this.pending = null; }
      else if (command >= 0x40 && command <= 0x47) this.mtreg = clamp((this.mtreg & 31) | (command & 7) << 5, 31, 254);
      else if (command >= 0x60 && command <= 0x7f) this.mtreg = clamp((this.mtreg & 224) | (command & 31), 31, 254);
      else if ([0x10, 0x11, 0x13, 0x20, 0x21, 0x23].indexOf(command) >= 0) {
        this.bhPowered = true; this.bhMode = command;
        this.pending = { due: this.time + ((command & 3) === 3 ? 16 : 120) * this.mtreg / 69 };
      } else return false;
    }
    return true;
  };
  BusDevice.prototype.bhRead = function (length) {
    if (!this.bhPowered || !this.bhMode || !this.pending) return denied("measurement-not-started");
    if (this.time < this.pending.due) return denied("conversion-pending");
    if (length !== 2) return denied("invalid-length");
    var raw = Math.round(clamp(number(this.properties.lux, 500) * 1.2 * this.mtreg / 69 * ((this.bhMode & 3) === 1 ? 2 : 1), 0, 65535));
    if (this.bhMode & 0x20) { this.bhPowered = false; this.bhMode = 0; }
    return { accepted: true, bytes: word(raw) };
  };
  BusDevice.prototype.shtCommand = function (data) {
    if (data.length !== 2) return false;
    var command = (data[0] << 8) | data[1];
    if ([0x2400, 0x240b, 0x2416, 0x2c06, 0x2c0d, 0x2c10].indexOf(command) >= 0) {
      this.pending = { due: this.time + ([0x2416, 0x2c10].indexOf(command) >= 0 ? 4 : [0x240b, 0x2c0d].indexOf(command) >= 0 ? 6 : 15), kind: "measurement" }; return true;
    }
    if (command === 0x30a2) { this.pending = null; this.heater = false; return true; }
    if (command === 0x306d || command === 0x3066) { this.heater = command === 0x306d; return true; }
    if (command === 0xf32d) { this.pending = { kind: "status", due: this.time }; return true; }
    if (command === 0x3041) return true;
    return false;
  };
  BusDevice.prototype.shtRead = function (length) {
    if (!this.pending) return denied("measurement-not-started");
    if (this.time < this.pending.due) return denied("conversion-pending");
    var data;
    if (this.pending.kind === "status") { data = [this.heater ? 0x20 : 0, 0]; data.push(crc8(data)); }
    else {
      var temperature = word(clamp(Math.round((number(this.properties.temperatureC, 25) + 45) / 175 * 65535), 0, 65535));
      var humidity = word(clamp(Math.round(number(this.properties.humidityPercent, 50) / 100 * 65535), 0, 65535));
      data = temperature.concat(crc8(temperature), humidity, crc8(humidity));
    }
    if (length > data.length) return denied("invalid-length");
    return { accepted: true, bytes: data.slice(0, length) };
  };
  BusDevice.prototype.refreshRtc = function () {
    var elapsedSeconds = Math.floor((this.time - this.clockAnchor) / 1000);
    var date = new Date((this.clockUnix + elapsedSeconds) * 1000);
    var original = new Date(this.clockUnix * 1000);
    var days = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000) - Math.floor(Date.UTC(original.getUTCFullYear(), original.getUTCMonth(), original.getUTCDate()) / 86400000);
    var twelveHour = Boolean(this.registers[2] & 0x40);
    var values = [date.getUTCSeconds(), date.getUTCMinutes(), date.getUTCHours(), ((this.clockWeekday - 1 + days) % 7 + 7) % 7 + 1, date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear() % 100];
    values.forEach(function (value, index) { this.registers[index] = bcd(value); }, this);
    if (twelveHour) this.registers[2] = 0x40 | (date.getUTCHours() >= 12 ? 0x20 : 0) | bcd(date.getUTCHours() % 12 || 12);
    if (date.getUTCFullYear() >= 2100) this.registers[5] |= 0x80;
    var temp = Math.round(clamp(number(this.properties.temperatureC, 25), -40, 85) * 4);
    this.registers[0x11] = (temp >> 2) & 255; this.registers[0x12] = (temp & 3) << 6;
  };
  BusDevice.prototype.applyRtcWrite = function () {
    var r = this.registers;
    var hours = r[2] & 0x40 ? decimal(r[2] & 0x1f) % 12 + (r[2] & 0x20 ? 12 : 0) : decimal(r[2] & 0x3f);
    this.clockUnix = Date.UTC(2000 + decimal(r[6]) + (r[5] & 0x80 ? 100 : 0), decimal(r[5] & 0x1f) - 1, decimal(r[4] & 0x3f), hours, decimal(r[1] & 0x7f), decimal(r[0] & 0x7f)) / 1000;
    this.clockAnchor = this.time; this.clockWeekday = clamp(decimal(r[3] & 7), 1, 7);
    this.properties.unixTime = this.clockUnix;
  };
  BusDevice.prototype.capacity = function () { return clamp(Math.round(number(this.properties.capacityKiB, 8192)), 512, 32768) * 1024; };
  // Allocate only programmed pages; even a completely written 32 MiB chip
  // stores bytes in typed arrays instead of millions of Map entries.
  BusDevice.prototype.flashByte = function (address) {
    var page = this.storage.get(address & ~255);
    return page ? page.data[address & 255] : 255;
  };
  BusDevice.prototype.programFlashByte = function (address, value) {
    var pageAddress = address & ~255, page = this.storage.get(pageAddress), old = page ? page.data[address & 255] : 255;
    var next = old & value;
    if (next === old) return;
    if (!page) { page = { data: new Uint8Array(256).fill(255), count: 0 }; this.storage.set(pageAddress, page); }
    if (old === 255) { page.count += 1; this.flashStoredBytes += 1; }
    page.data[address & 255] = next;
  };
  BusDevice.prototype.applyPcaProperties = function (properties) {
    var keys = Object.keys(properties);
    if (!keys.some(function (key) { return key === "frequencyHz" || /^channel(?:[0-9]|1[0-5])$/.test(key); })) return;
    this.registers[0] = (this.registers[0] | 0x20) & ~0x10;
    if (properties.frequencyHz != null) this.registers[0xfe] = clamp(Math.round(25000000 / (4096 * clamp(number(properties.frequencyHz, 50), 24, 1526))) - 1, 3, 255);
    for (var index = 0; index < 16; index += 1) if (properties["channel" + index] != null) {
      var count = clamp(Math.round(number(properties["channel" + index], 0)), 0, 4095), reg = 6 + index * 4;
      this.registers[reg] = 0; this.registers[reg + 1] = 0; this.registers[reg + 2] = count & 255; this.registers[reg + 3] = count >> 8;
    }
  };
  BusDevice.prototype.flashAddress = function () { return ((this.flashPacket[1] << 16) | (this.flashPacket[2] << 8) | this.flashPacket[3]) % this.capacity(); };
  BusDevice.prototype.latchFlash = function () {
    var p = this.flashPacket, command = p[0];
    if (command === 6 && p.length === 1) this.writeEnabled = true;
    else if (command === 4) this.writeEnabled = false;
    else if (command === 2 && p.length >= 4 && this.writeEnabled && this.flashProgramCount) {
      var address = this.flashAddress(), page = address & ~255;
      this.flashData.forEach(function (value, offset) {
        var target = (page + ((address + offset) & 255)) % this.capacity();
        this.programFlashByte(target, value);
      }, this);
      this.writeEnabled = false;
    } else if ((command === 0x20 || command === 0xd8) && p.length >= 4 && this.writeEnabled) {
      var blockSize = command === 0x20 ? 4096 : 65536, start = Math.floor(this.flashAddress() / blockSize) * blockSize;
      this.storage.forEach(function (page, key) { if (key >= start && key < start + blockSize) { this.flashStoredBytes -= page.count; this.storage.delete(key); } }, this); this.writeEnabled = false;
    } else if ((command === 0xc7 || command === 0x60) && this.writeEnabled) { this.storage.clear(); this.flashStoredBytes = 0; this.writeEnabled = false; }
    this.flashPacket = []; this.flashData = new Map(); this.flashOffset = 0; this.flashProgramCount = 0; this.revision += 1;
  };
  BusDevice.prototype.readFlash = function (length) {
    var command = this.flashPacket[0], data = [];
    if (command === 0x9f) {
      var id = [0xef, 0x40, Math.round(Math.log2(this.capacity()))];
      for (var i = 0; i < length; i += 1) data.push(id[(this.flashOffset + i) % 3]);
    } else if (command === 5) data = Array(length).fill(this.writeEnabled ? 2 : 0);
    else if ((command === 3 || command === 0x0b) && this.flashPacket.length >= (command === 3 ? 4 : 5)) {
      var address = this.flashAddress();
      for (var j = 0; j < length; j += 1) { var target = (address + this.flashOffset + j) % this.capacity(); data.push(this.flashByte(target)); }
    } else return denied("unsupported-read-command");
    this.flashOffset += length;
    return { accepted: true, bytes: data };
  };
  BusDevice.prototype.getState = function () {
    var power = this.powerStatus();
    var state = { type: this.kind, properties: Object.assign({}, this.properties), address: this.address, ready: this.ready(), power: power, connection: Object.assign({}, this.connection), revision: this.revision };
    Object.keys(DEFAULTS[this.kind]).forEach(function (key) { state[key] = this.properties[key]; }, this);
    if (this.kind === "pcf8574") {
      state.outputLatch = this.outputLatch; state.inputMask = number(this.properties.inputMask, 255) & 255; state.pinMask = this.portMask();
      state.pinLevels = Array.from({ length: 8 }, function (_, i) { return (state.pinMask >> i) & 1; });
      state.interruptActive = Boolean(power.powered && this.interruptActive);
    } else if (this.kind === "pca9685") {
      var r = this.registers, frequency = 25000000 / (4096 * (r[0xfe] + 1));
      state.frequencyHz = frequency;
      state.channels = Array.from({ length: 16 }, function (_, index) {
        var reg = 6 + index * 4, on = r[reg] | (r[reg + 1] & 15) << 8, off = r[reg + 2] | (r[reg + 3] & 15) << 8;
        var count = r[reg + 3] & 16 ? 0 : r[reg + 1] & 16 ? 4096 : (off - on + 4096) % 4096;
        var active = Boolean(power.powered && !(r[0] & 0x10) && this.connection.outputEnabled !== false && count > 0);
        var phase = (this.time / 1000 * frequency * 4096) % 4096;
        return { dutyCycle: count / 4096, pulseUs: count / 4096 / frequency * 1000000, active: active, level: active && (phase - on + 4096) % 4096 < count ? 1 : 0 };
      }, this);
    } else if (this.kind === "ds3231") { state.unixTime = this.clockUnix + Math.floor((this.time - this.clockAnchor) / 1000); }
    else if (this.kind === "w25qxx") { state.capacityBytes = this.capacity(); state.storedBytes = this.flashStoredBytes; state.writeEnabled = this.writeEnabled; state.status = this.writeEnabled ? 2 : 0; }
    return state;
  };
  return Object.freeze({ supportedTypes: Object.freeze(Object.keys(ADDRESSES)), supports: function (type) { return Object.prototype.hasOwnProperty.call(ADDRESSES, type); }, create: function (type, options) { return Object.prototype.hasOwnProperty.call(ADDRESSES, type) ? new BusDevice(type, options) : null; } });
}));
