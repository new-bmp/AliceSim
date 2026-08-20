(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AlicePeripheralDevices = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function optionalNumber(value) {
    if (value == null || value === "") return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function connectionFlag(source, name, fallback) {
    return Object.prototype.hasOwnProperty.call(source, name) ? Boolean(source[name]) : Boolean(fallback);
  }

  function copyConnection(input) {
    var source = input && typeof input === "object" ? input : {};
    var vccLevel = optionalNumber(source.vccLevel);
    var gndLevel = optionalNumber(source.gndLevel);
    var powered = connectionFlag(source, "powered", false);
    return {
      powered: powered,
      bindingValid: source.bindingValid !== false,
      vccConnected: connectionFlag(source, "vccConnected", powered || vccLevel != null),
      gndConnected: connectionFlag(source, "gndConnected", powered || gndLevel != null),
      dataConnected: connectionFlag(source, "dataConnected", source.signalConnected),
      triggerConnected: connectionFlag(source, "triggerConnected", false),
      echoConnected: connectionFlag(source, "echoConnected", false),
      pwmConnected: connectionFlag(source, "pwmConnected", source.signalConnected),
      signalConnected: connectionFlag(source, "signalConnected", false),
      clkConnected: connectionFlag(source, "clkConnected", false),
      dioConnected: connectionFlag(source, "dioConnected", false),
      vccLevel: vccLevel,
      gndLevel: gndLevel,
      dataPin: String(source.dataPin || ""),
      triggerPin: String(source.triggerPin || source.trigPin || ""),
      echoPin: String(source.echoPin || ""),
      pwmPin: String(source.pwmPin || source.signalPin || ""),
      signalPin: String(source.signalPin || ""),
      clkPin: String(source.clkPin || ""),
      dioPin: String(source.dioPin || ""),
      timer: String(source.timer || ""),
      channel: String(source.channel || ""),
      reason: String(source.reason || "")
    };
  }

  function BaseDevice(kind, options, limits) {
    var config = options && typeof options === "object" ? options : {};
    this.kind = kind;
    this.nominalVoltage = finite(config.nominalVoltage, limits.nominal);
    this.minOperatingVoltage = finite(config.minOperatingVoltage, limits.minimum);
    this.maxOperatingVoltage = Math.max(this.minOperatingVoltage, finite(config.maxOperatingVoltage, limits.maximum));
    this.connection = copyConnection(config.connection);
    this.revision = 0;
  }

  BaseDevice.prototype.setConnection = function (connection) {
    this.connection = copyConnection(connection);
    this.revision += 1;
    return this.getState();
  };

  BaseDevice.prototype.getGroundLevel = function () {
    return this.connection.gndLevel == null ? 0 : this.connection.gndLevel;
  };

  BaseDevice.prototype.getVccLevel = function () {
    return this.connection.vccLevel == null ? this.getGroundLevel() + this.nominalVoltage : this.connection.vccLevel;
  };

  BaseDevice.prototype.getPowerStatus = function () {
    var rail = Math.max(0, this.getVccLevel() - this.getGroundLevel());
    var reason = "ok";
    if (!this.connection.powered || !this.connection.vccConnected || !this.connection.gndConnected) reason = "power-disconnected";
    else if (rail < this.minOperatingVoltage) reason = "undervoltage";
    else if (rail > this.maxOperatingVoltage) reason = "overvoltage";
    return {
      powered: reason === "ok",
      reason: reason,
      railVoltage: rail,
      vccLevel: this.getVccLevel(),
      gndLevel: this.getGroundLevel(),
      minimum: this.minOperatingVoltage,
      maximum: this.maxOperatingVoltage
    };
  };

  BaseDevice.prototype.isReady = function (requiredConnections) {
    var power = this.getPowerStatus();
    if (!power.powered || !this.connection.bindingValid) return false;
    return (requiredConnections || []).every(function (name) { return Boolean(this.connection[name]); }, this);
  };

  function DHT11Device(options) {
    var config = options && typeof options === "object" ? options : {};
    BaseDevice.call(this, "dht11", config, { nominal: 3.3, minimum: 3, maximum: 5.5 });
    this.temperatureC = clamp(finite(config.temperatureC == null ? config.temperature : config.temperatureC, 25), -20, 60);
    this.humidityPercent = clamp(finite(config.humidityPercent == null ? config.humidity : config.humidityPercent, 50), 0, 100);
  }
  DHT11Device.prototype = Object.create(BaseDevice.prototype);
  DHT11Device.prototype.constructor = DHT11Device;
  DHT11Device.prototype.setEnvironment = function (temperatureC, humidityPercent) {
    this.temperatureC = clamp(finite(temperatureC, this.temperatureC), -20, 60);
    this.humidityPercent = clamp(finite(humidityPercent, this.humidityPercent), 0, 100);
    this.revision += 1;
    return this.read({ ignoreConnection: true });
  };
  DHT11Device.prototype.read = function (options) {
    var config = options && typeof options === "object" ? options : {};
    var ready = config.ignoreConnection || this.isReady(["dataConnected"]);
    return {
      ok: Boolean(ready),
      temperatureC: this.temperatureC,
      temperatureX10: Math.round(this.temperatureC * 10),
      humidityPercent: this.humidityPercent,
      humidityX10: Math.round(this.humidityPercent * 10),
      checksum: (Math.round(this.temperatureC) + Math.round(this.humidityPercent)) & 0xff
    };
  };
  DHT11Device.prototype.getState = function () {
    return {
      type: this.kind,
      temperatureC: this.temperatureC,
      humidityPercent: this.humidityPercent,
      ready: this.isReady(["dataConnected"]),
      power: this.getPowerStatus(),
      connection: Object.assign({}, this.connection),
      revision: this.revision
    };
  };

  function HCSR04Device(options) {
    var config = options && typeof options === "object" ? options : {};
    BaseDevice.call(this, "hcsr04", config, { nominal: 5, minimum: 4.5, maximum: 5.5 });
    this.distanceCm = clamp(finite(config.distanceCm == null ? config.distance : config.distanceCm, 100), 2, 400);
    this.temperatureC = clamp(finite(config.temperatureC, 20), -20, 60);
  }
  HCSR04Device.prototype = Object.create(BaseDevice.prototype);
  HCSR04Device.prototype.constructor = HCSR04Device;
  HCSR04Device.prototype.setDistanceCm = function (distanceCm) {
    this.distanceCm = clamp(finite(distanceCm, this.distanceCm), 2, 400);
    this.revision += 1;
    return this.distanceCm;
  };
  HCSR04Device.prototype.measure = function (options) {
    var config = options && typeof options === "object" ? options : {};
    var ready = config.ignoreConnection || this.isReady(["triggerConnected", "echoConnected"]);
    var speedMetersPerSecond = 331.3 + 0.606 * this.temperatureC;
    var pulseUs = this.distanceCm * 2 / (speedMetersPerSecond * 100) * 1000000;
    return {
      ok: Boolean(ready),
      distanceCm: this.distanceCm,
      distanceMm: Math.round(this.distanceCm * 10),
      echoPulseUs: Math.max(1, Math.round(pulseUs))
    };
  };
  HCSR04Device.prototype.getState = function () {
    var measurement = this.measure({ ignoreConnection: true });
    return {
      type: this.kind,
      distanceCm: this.distanceCm,
      distanceMm: measurement.distanceMm,
      echoPulseUs: measurement.echoPulseUs,
      ready: this.isReady(["triggerConnected", "echoConnected"]),
      power: this.getPowerStatus(),
      connection: Object.assign({}, this.connection),
      revision: this.revision
    };
  };

  function SG90Device(options) {
    var config = options && typeof options === "object" ? options : {};
    BaseDevice.call(this, "sg90", config, { nominal: 5, minimum: 4.5, maximum: 6 });
    this.minimumPulseUs = clamp(Math.round(finite(config.minimumPulseUs, 500)), 300, 1500);
    this.maximumPulseUs = clamp(Math.round(finite(config.maximumPulseUs, 2500)), this.minimumPulseUs + 100, 3000);
    this.angle = clamp(finite(config.angle, 90), 0, 180);
    this.pulseUs = this.angleToPulse(this.angle);
  }
  SG90Device.prototype = Object.create(BaseDevice.prototype);
  SG90Device.prototype.constructor = SG90Device;
  SG90Device.prototype.angleToPulse = function (angle) {
    return Math.round(this.minimumPulseUs + clamp(Number(angle) || 0, 0, 180) / 180 * (this.maximumPulseUs - this.minimumPulseUs));
  };
  SG90Device.prototype.setAngle = function (angle) {
    this.angle = clamp(finite(angle, this.angle), 0, 180);
    this.pulseUs = this.angleToPulse(this.angle);
    this.revision += 1;
    return this.angle;
  };
  SG90Device.prototype.setPulseUs = function (pulseUs) {
    this.pulseUs = clamp(Math.round(finite(pulseUs, this.pulseUs)), this.minimumPulseUs, this.maximumPulseUs);
    this.angle = (this.pulseUs - this.minimumPulseUs) * 180 / (this.maximumPulseUs - this.minimumPulseUs);
    this.revision += 1;
    return this.angle;
  };
  SG90Device.prototype.getState = function () {
    return {
      type: this.kind,
      angle: this.angle,
      pulseUs: this.pulseUs,
      ready: this.isReady(["pwmConnected"]),
      power: this.getPowerStatus(),
      connection: Object.assign({}, this.connection),
      revision: this.revision
    };
  };

  function BuzzerDevice(options) {
    var config = options && typeof options === "object" ? options : {};
    BaseDevice.call(this, "buzzer", config, { nominal: 3.3, minimum: 2.5, maximum: 5.5 });
    this.frequencyHz = clamp(Math.round(finite(config.frequencyHz, 0)), 0, 20000);
    this.dutyPermille = clamp(Math.round(finite(config.dutyPermille, 500)), 0, 1000);
    this.active = Boolean(config.active && this.frequencyHz > 0 && this.dutyPermille > 0);
  }
  BuzzerDevice.prototype = Object.create(BaseDevice.prototype);
  BuzzerDevice.prototype.constructor = BuzzerDevice;
  BuzzerDevice.prototype.setTone = function (frequencyHz, dutyPermille) {
    this.frequencyHz = clamp(Math.round(finite(frequencyHz, this.frequencyHz)), 0, 20000);
    this.dutyPermille = clamp(Math.round(finite(dutyPermille, this.dutyPermille)), 0, 1000);
    this.active = this.frequencyHz > 0 && this.dutyPermille > 0;
    this.revision += 1;
    return this.active;
  };
  BuzzerDevice.prototype.stop = function () {
    this.active = false;
    this.frequencyHz = 0;
    this.revision += 1;
    return true;
  };
  BuzzerDevice.prototype.getState = function () {
    var ready = this.isReady(["signalConnected"]);
    return {
      type: this.kind,
      active: Boolean(this.active && ready),
      requestedActive: this.active,
      frequencyHz: this.frequencyHz,
      dutyPermille: this.dutyPermille,
      ready: ready,
      power: this.getPowerStatus(),
      connection: Object.assign({}, this.connection),
      revision: this.revision
    };
  };

  var SEGMENT_DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

  function TM1637Device(options) {
    var config = options && typeof options === "object" ? options : {};
    BaseDevice.call(this, "tm1637", config, { nominal: 3.3, minimum: 3, maximum: 5.5 });
    this.brightness = clamp(Math.round(finite(config.brightness, 7)), 0, 7);
    this.enabled = config.enabled !== false;
    this.colon = Boolean(config.colon);
    this.segments = [0, 0, 0, 0];
    this.text = "    ";
    if (config.value != null) this.displayNumber(config.value, config.leadingZero, config.colon);
  }
  TM1637Device.prototype = Object.create(BaseDevice.prototype);
  TM1637Device.prototype.constructor = TM1637Device;
  TM1637Device.prototype.setBrightness = function (brightness, enabled) {
    this.brightness = clamp(Math.round(finite(brightness, this.brightness)), 0, 7);
    if (enabled != null) this.enabled = Boolean(enabled);
    this.revision += 1;
    return this.brightness;
  };
  TM1637Device.prototype.setSegments = function (segments, colon) {
    var values = Array.isArray(segments) ? segments : [];
    this.segments = [0, 1, 2, 3].map(function (index) { return Math.round(Number(values[index]) || 0) & 0xff; });
    this.colon = Boolean(colon);
    this.text = this.segments.map(function (mask) {
      var digit = SEGMENT_DIGITS.indexOf(mask & 0x7f);
      return digit < 0 ? " " : String(digit);
    }).join("");
    this.revision += 1;
    return this.segments.slice();
  };
  TM1637Device.prototype.displayNumber = function (value, leadingZero, colon) {
    var number = Math.trunc(finite(value, 0));
    var negative = number < 0;
    var absolute = Math.min(9999, Math.abs(number));
    var text = String(absolute);
    if (leadingZero) text = text.padStart(4, "0");
    else text = text.padStart(4, " ");
    if (negative) text = "-" + text.slice(1);
    this.text = text;
    this.colon = Boolean(colon);
    this.segments = Array.from(text).map(function (character) {
      if (character === "-") return 0x40;
      if (character === " ") return 0;
      return SEGMENT_DIGITS[Number(character)] || 0;
    });
    this.revision += 1;
    return this.text;
  };
  TM1637Device.prototype.clear = function () {
    this.segments = [0, 0, 0, 0];
    this.text = "    ";
    this.colon = false;
    this.revision += 1;
  };
  TM1637Device.prototype.getState = function () {
    var ready = this.isReady(["clkConnected", "dioConnected"]);
    return {
      type: this.kind,
      text: this.text,
      segments: this.segments.slice(),
      brightness: this.brightness,
      enabled: this.enabled,
      colon: this.colon,
      visible: Boolean(ready && this.enabled),
      ready: ready,
      power: this.getPowerStatus(),
      connection: Object.assign({}, this.connection),
      revision: this.revision
    };
  };

  function GenericPeripheralDevice(type, options) {
    var config = options && typeof options === "object" ? options : {};
    BaseDevice.call(this, String(type || "peripheral"), config, {
      nominal: finite(config.nominalVoltage, 3.3),
      minimum: finite(config.minOperatingVoltage, 2.4),
      maximum: finite(config.maxOperatingVoltage, 5.5)
    });
    this.properties = Object.assign({}, config.properties || {});
    this.lastOperation = null;
  }
  GenericPeripheralDevice.prototype = Object.create(BaseDevice.prototype);
  GenericPeripheralDevice.prototype.constructor = GenericPeripheralDevice;
  GenericPeripheralDevice.prototype.setProperties = function (properties) {
    this.properties = Object.assign({}, this.properties, properties && typeof properties === "object" ? properties : {});
    this.revision += 1;
    return Object.assign({}, this.properties);
  };
  GenericPeripheralDevice.prototype.apply = function (operation, payload) {
    var name = String(operation || "operation");
    var data = payload && typeof payload === "object" ? payload : {};
    if (data.properties) this.setProperties(data.properties);
    this.lastOperation = { name: name, payload: Object.assign({}, data) };
    this.revision += 1;
    return this.getState();
  };
  GenericPeripheralDevice.prototype.getState = function () {
    var signalKeys = ["dataConnected", "triggerConnected", "echoConnected", "pwmConnected", "signalConnected", "clkConnected", "dioConnected"];
    var hasSignalContract = signalKeys.some(function (key) { return this.connection[key]; }, this);
    return {
      type: this.kind,
      properties: Object.assign({}, this.properties),
      ready: Boolean(this.getPowerStatus().powered && this.connection.bindingValid && (hasSignalContract || this.kind === "rotaryEncoder")),
      power: this.getPowerStatus(),
      connection: Object.assign({}, this.connection),
      lastOperation: this.lastOperation && { name: this.lastOperation.name, payload: Object.assign({}, this.lastOperation.payload) },
      revision: this.revision
    };
  };

  return Object.freeze({
    DHT11Device: DHT11Device,
    HCSR04Device: HCSR04Device,
    SG90Device: SG90Device,
    BuzzerDevice: BuzzerDevice,
    TM1637Device: TM1637Device,
    createDHT11: function (options) { return new DHT11Device(options); },
    createHCSR04: function (options) { return new HCSR04Device(options); },
    createSG90: function (options) { return new SG90Device(options); },
    createBuzzer: function (options) { return new BuzzerDevice(options); },
    createTM1637: function (options) { return new TM1637Device(options); },
    GenericPeripheralDevice: GenericPeripheralDevice,
    createGeneric: function (type, options) { return new GenericPeripheralDevice(type, options); }
  });
}));
