(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AliceLightSensorDevice = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MIN_LUX = 0;
  var MAX_LUX = 100000;
  var DEFAULT_LUX = 500;
  var DEFAULT_THRESHOLD_LUX = 1000;
  var DEFAULT_SUPPLY_VOLTAGE = 3.3;
  var DEFAULT_ADC_REFERENCE_VOLTAGE = 3.3;
  var DEFAULT_ADC_BITS = 12;
  var DEFAULT_MIN_OPERATING_VOLTAGE = 2.4;
  var DEFAULT_MAX_OPERATING_VOLTAGE = 5.5;

  function hasOwn(object, key) {
    return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
  }

  function finiteNumber(value, fallback) {
    var numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeLux(value, fallback) {
    return clamp(finiteNumber(value, fallback == null ? MIN_LUX : fallback), MIN_LUX, MAX_LUX);
  }

  function normalizePositiveVoltage(value, fallback) {
    return clamp(finiteNumber(value, fallback), 0.001, 100);
  }

  function normalizeAdcBits(value, fallback) {
    return clamp(Math.round(finiteNumber(value, fallback)), 1, 24);
  }

  function optionalNumber(value) {
    if (value == null || value === "") return null;
    var numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function connectionFlag(source, primary, alias, fallback) {
    if (hasOwn(source, primary)) return Boolean(source[primary]);
    if (alias && hasOwn(source, alias)) return Boolean(source[alias]);
    return Boolean(fallback);
  }

  function copyConnection(input) {
    var source = input && typeof input === "object" ? input : {};
    var hasPowered = hasOwn(source, "powered");
    var powered = hasPowered ? Boolean(source.powered) : false;
    var vccLevel = optionalNumber(source.vccLevel);
    var gndLevel = optionalNumber(source.gndLevel);
    var vccConnected = connectionFlag(source, "vccConnected", "vcc", powered || vccLevel != null);
    var gndConnected = connectionFlag(source, "gndConnected", "gnd", powered || gndLevel != null);

    if (!hasPowered) powered = vccConnected && gndConnected;

    return {
      powered: powered,
      vccConnected: vccConnected,
      gndConnected: gndConnected,
      aoConnected: connectionFlag(source, "aoConnected", "analogConnected", source.connected),
      doConnected: connectionFlag(source, "doConnected", "digitalConnected", source.connected),
      bindingValid: source.bindingValid !== false,
      vccLevel: vccLevel,
      gndLevel: gndLevel,
      vccNet: String(source.vccNet || ""),
      gndNet: String(source.gndNet || ""),
      aoPin: String(source.aoPin || source.analogPin || ""),
      doPin: String(source.doPin || source.digitalPin || ""),
      reason: String(source.reason || "")
    };
  }

  function LightSensorDevice(options) {
    var config = options && typeof options === "object" ? options : {};
    this.lux = normalizeLux(config.lux, DEFAULT_LUX);
    this.thresholdLux = normalizeLux(
      config.thresholdLux == null ? config.threshold : config.thresholdLux,
      DEFAULT_THRESHOLD_LUX
    );
    this.supplyVoltage = normalizePositiveVoltage(config.supplyVoltage, DEFAULT_SUPPLY_VOLTAGE);
    this.adcReferenceVoltage = normalizePositiveVoltage(
      config.adcReferenceVoltage == null ? config.adcReference : config.adcReferenceVoltage,
      DEFAULT_ADC_REFERENCE_VOLTAGE
    );
    this.adcBits = normalizeAdcBits(config.adcBits, DEFAULT_ADC_BITS);
    this.minOperatingVoltage = normalizePositiveVoltage(
      config.minOperatingVoltage,
      DEFAULT_MIN_OPERATING_VOLTAGE
    );
    this.maxOperatingVoltage = normalizePositiveVoltage(
      config.maxOperatingVoltage,
      DEFAULT_MAX_OPERATING_VOLTAGE
    );
    if (this.maxOperatingVoltage < this.minOperatingVoltage) {
      this.maxOperatingVoltage = this.minOperatingVoltage;
    }
    this.gamma = clamp(finiteNumber(config.gamma, 1), 0.05, 10);
    this.analogInverted = Boolean(config.analogInverted);
    this.digitalActiveLow = Boolean(config.digitalActiveLow);
    this.connection = copyConnection(config.connection);
    this.revision = 0;
  }

  LightSensorDevice.prototype.setLux = function (lux) {
    this.lux = normalizeLux(lux, this.lux);
    this.revision += 1;
    return this.lux;
  };

  LightSensorDevice.prototype.setThresholdLux = function (thresholdLux) {
    this.thresholdLux = normalizeLux(thresholdLux, this.thresholdLux);
    this.revision += 1;
    return this.thresholdLux;
  };

  LightSensorDevice.prototype.setThreshold = LightSensorDevice.prototype.setThresholdLux;

  LightSensorDevice.prototype.setConnection = function (connection) {
    this.connection = copyConnection(connection);
    this.revision += 1;
    return this.getState();
  };

  LightSensorDevice.prototype.updateConnection = function (connection) {
    var patch = connection && typeof connection === "object" ? connection : {};
    this.connection = copyConnection(Object.assign({}, this.connection, patch));
    this.revision += 1;
    return this.getState();
  };

  LightSensorDevice.prototype.setPower = function (vccLevel, gndLevel) {
    var patch;
    if (vccLevel && typeof vccLevel === "object") {
      patch = Object.assign({}, vccLevel);
    } else if (typeof vccLevel === "boolean" && arguments.length === 1) {
      patch = {
        powered: vccLevel,
        vccConnected: vccLevel,
        gndConnected: vccLevel
      };
    } else {
      patch = {
        powered: true,
        vccConnected: true,
        gndConnected: true,
        vccLevel: optionalNumber(vccLevel),
        gndLevel: optionalNumber(gndLevel) == null ? 0 : optionalNumber(gndLevel)
      };
    }
    return this.updateConnection(patch);
  };

  LightSensorDevice.prototype.setAdcConfig = function (options) {
    var config = options && typeof options === "object" ? options : {};
    if (config.bits != null || config.adcBits != null) {
      this.adcBits = normalizeAdcBits(config.bits == null ? config.adcBits : config.bits, this.adcBits);
    }
    if (config.referenceVoltage != null || config.adcReferenceVoltage != null) {
      this.adcReferenceVoltage = normalizePositiveVoltage(
        config.referenceVoltage == null ? config.adcReferenceVoltage : config.referenceVoltage,
        this.adcReferenceVoltage
      );
    }
    this.revision += 1;
    return { bits: this.adcBits, referenceVoltage: this.adcReferenceVoltage };
  };

  LightSensorDevice.prototype.setTransfer = function (options) {
    var config = options && typeof options === "object" ? options : {};
    if (config.gamma != null) this.gamma = clamp(finiteNumber(config.gamma, this.gamma), 0.05, 10);
    if (config.analogInverted != null) this.analogInverted = Boolean(config.analogInverted);
    if (config.digitalActiveLow != null) this.digitalActiveLow = Boolean(config.digitalActiveLow);
    this.revision += 1;
    return {
      gamma: this.gamma,
      analogInverted: this.analogInverted,
      digitalActiveLow: this.digitalActiveLow
    };
  };

  LightSensorDevice.prototype.getGroundLevel = function () {
    return this.connection.gndLevel == null ? 0 : this.connection.gndLevel;
  };

  LightSensorDevice.prototype.getVccLevel = function () {
    var ground = this.getGroundLevel();
    return this.connection.vccLevel == null ? ground + this.supplyVoltage : this.connection.vccLevel;
  };

  LightSensorDevice.prototype.getRailVoltage = function () {
    return Math.max(0, this.getVccLevel() - this.getGroundLevel());
  };

  LightSensorDevice.prototype.getPowerStatus = function () {
    var railVoltage = this.getRailVoltage();
    var reason = "ok";
    if (!this.connection.powered) reason = "disabled";
    else if (!this.connection.vccConnected) reason = "vcc-disconnected";
    else if (!this.connection.gndConnected) reason = "gnd-disconnected";
    else if (railVoltage < this.minOperatingVoltage) reason = "undervoltage";
    else if (railVoltage > this.maxOperatingVoltage) reason = "overvoltage";
    return {
      powered: reason === "ok",
      reason: reason,
      railVoltage: railVoltage,
      vccLevel: this.getVccLevel(),
      gndLevel: this.getGroundLevel(),
      minOperatingVoltage: this.minOperatingVoltage,
      maxOperatingVoltage: this.maxOperatingVoltage
    };
  };

  LightSensorDevice.prototype.isPowered = function () {
    return this.getPowerStatus().powered;
  };

  LightSensorDevice.prototype.isAnalogAvailable = function () {
    return Boolean(this.isPowered() && this.connection.bindingValid && this.connection.aoConnected);
  };

  LightSensorDevice.prototype.isDigitalAvailable = function () {
    return Boolean(this.isPowered() && this.connection.bindingValid && this.connection.doConnected);
  };

  LightSensorDevice.prototype.getAnalogRatio = function () {
    var ratio = Math.pow(this.lux / MAX_LUX, this.gamma);
    return this.analogInverted ? 1 - ratio : ratio;
  };

  LightSensorDevice.prototype.getAnalogVoltage = function (options) {
    var config = options && typeof options === "object" ? options : {};
    if (!config.ignoreConnection && !this.isAnalogAvailable()) return null;
    var ground = this.getGroundLevel();
    var railVoltage = this.getRailVoltage();
    if (config.ignoreConnection && railVoltage <= 0) railVoltage = this.supplyVoltage;
    return ground + railVoltage * this.getAnalogRatio();
  };

  LightSensorDevice.prototype.sampleAnalog = LightSensorDevice.prototype.getAnalogVoltage;

  LightSensorDevice.prototype.getAdcRaw = function (options) {
    var config = options && typeof options === "object" ? options : {};
    var bits = normalizeAdcBits(config.bits == null ? config.adcBits : config.bits, this.adcBits);
    var referenceVoltage = normalizePositiveVoltage(
      config.referenceVoltage == null ? config.adcReferenceVoltage : config.referenceVoltage,
      this.adcReferenceVoltage
    );
    var voltage = this.getAnalogVoltage({ ignoreConnection: Boolean(config.ignoreConnection) });
    if (voltage == null) return null;
    var adcGround = finiteNumber(config.groundVoltage, this.getGroundLevel());
    var ratio = clamp((voltage - adcGround) / referenceVoltage, 0, 1);
    return Math.round(ratio * (Math.pow(2, bits) - 1));
  };

  LightSensorDevice.prototype.getDigitalTriggered = function () {
    return this.lux >= this.thresholdLux;
  };

  LightSensorDevice.prototype.getDigitalLevel = function (options) {
    var config = options && typeof options === "object" ? options : {};
    if (!config.ignoreConnection && !this.isDigitalAvailable()) return null;
    var level = this.getDigitalTriggered() ? 1 : 0;
    return this.digitalActiveLow ? 1 - level : level;
  };

  LightSensorDevice.prototype.sampleDigital = LightSensorDevice.prototype.getDigitalLevel;

  LightSensorDevice.prototype.getState = function () {
    var power = this.getPowerStatus();
    var analogAvailable = this.isAnalogAvailable();
    var digitalAvailable = this.isDigitalAvailable();
    var analogVoltage = this.getAnalogVoltage();
    var adcRaw = this.getAdcRaw();
    var digitalLevel = this.getDigitalLevel();
    return {
      type: "light-sensor",
      lux: this.lux,
      minLux: MIN_LUX,
      maxLux: MAX_LUX,
      thresholdLux: this.thresholdLux,
      powered: power.powered,
      power: power,
      aoVoltage: analogVoltage,
      adcRaw: adcRaw,
      doLevel: digitalLevel,
      analog: {
        connected: this.connection.aoConnected,
        available: analogAvailable,
        ratio: this.getAnalogRatio(),
        voltage: analogVoltage,
        idealVoltage: this.getAnalogVoltage({ ignoreConnection: true }),
        adcBits: this.adcBits,
        adcReferenceVoltage: this.adcReferenceVoltage,
        adcRaw: adcRaw,
        inverted: this.analogInverted
      },
      digital: {
        connected: this.connection.doConnected,
        available: digitalAvailable,
        thresholdLux: this.thresholdLux,
        triggered: this.getDigitalTriggered(),
        activeLow: this.digitalActiveLow,
        level: digitalLevel
      },
      connection: Object.assign({}, this.connection),
      revision: this.revision
    };
  };

  return {
    MIN_LUX: MIN_LUX,
    MAX_LUX: MAX_LUX,
    DEFAULT_LUX: DEFAULT_LUX,
    DEFAULT_THRESHOLD_LUX: DEFAULT_THRESHOLD_LUX,
    DEFAULT_SUPPLY_VOLTAGE: DEFAULT_SUPPLY_VOLTAGE,
    DEFAULT_ADC_REFERENCE_VOLTAGE: DEFAULT_ADC_REFERENCE_VOLTAGE,
    DEFAULT_ADC_BITS: DEFAULT_ADC_BITS,
    LightSensorDevice: LightSensorDevice,
    create: function (options) { return new LightSensorDevice(options); },
    normalizeLux: normalizeLux
  };
}));
