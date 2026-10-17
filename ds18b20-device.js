(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AliceDS18B20Device = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function number(value, fallback) { var n = value == null ? NaN : Number(value); return Number.isFinite(n) ? n : fallback; }
  function pin(value) { var name = String(value || "").toUpperCase(); return /^P[A-K](?:[0-9]|1[0-5])$/.test(name) ? name : ""; }
  function Device(options) {
    var config = options || {};
    this.properties = Object.assign({ temperatureC: 25 }, config.properties || {});
    if (config.temperatureC != null) this.properties.temperatureC = config.temperatureC;
    this.connection = Object.assign({}, config.connection || {});
    this.time = 0;
    this.revision = 0;
    this.reset();
  }
  Device.prototype.reset = function () {
    this.raw = 85 * 16;
    this.pending = null;
    this.conversion = null;
    this.revision += 1;
  };
  Device.prototype.powerStatus = function () {
    var c = this.connection;
    var ground = number(c.gndLevel, 0);
    var unresolvedRail = ["vccLevel", "gndLevel"].some(function (key) { return c[key] === null || c[key] !== undefined && (String(c[key]).trim() === "" || !Number.isFinite(Number(c[key]))); });
    var voltage = unresolvedRail ? null : number(c.vccLevel, ground + 3.3) - ground;
    var reason = c.powered !== true || c.vccConnected === false || c.gndConnected === false ? "power-disconnected" : unresolvedRail ? "voltage-unresolved" : voltage < 3 ? "undervoltage" : voltage > 5.5 ? "overvoltage" : "ok";
    return { powered: reason === "ok", reason: reason, railVoltage: voltage, vccLevel: unresolvedRail ? null : voltage + ground, gndLevel: unresolvedRail ? null : ground, minimum: 3, maximum: 5.5 };
  };
  Device.prototype.ready = function () {
    return this.powerStatus().powered && this.connection.bindingValid === true && this.connection.dataConnected === true && Boolean(pin(this.connection.dataPin));
  };
  Device.prototype.setTime = function (timeMs) {
    var next = Math.max(0, number(timeMs, this.time));
    this.time = next;
    if (this.conversion) {
      // Rendering can reach a frame boundary before older firmware events
      // are replayed. Retain both scratchpad values so that this clock move
      // cannot reset a conversion or make an early read see its future value.
      var complete = this.time >= this.conversion.readyAt;
      var nextRaw = complete ? this.conversion.raw : this.conversion.previousRaw;
      var pending = !complete && this.time >= this.conversion.startedAt ? this.conversion : null;
      if (this.raw !== nextRaw || Boolean(this.pending) !== Boolean(pending)) this.revision += 1;
      this.raw = nextRaw;
      this.pending = pending;
    }
    return this.time;
  };
  Device.prototype.setConnection = function (connection) {
    var wasPowered = this.powerStatus().powered;
    this.connection = Object.assign({}, connection || {});
    if (wasPowered && !this.powerStatus().powered) this.reset();
    this.revision += 1;
    return this.getState();
  };
  Device.prototype.setProperties = function (properties) {
    this.properties = Object.assign({}, this.properties, properties || {});
    this.revision += 1;
    return this.getState();
  };
  Device.prototype.getState = function () {
    return {
      kind: "ds18b20", type: "ds18b20", ready: this.ready(), power: this.powerStatus(),
      connection: Object.assign({}, this.connection), properties: Object.assign({}, this.properties),
      dataPin: pin(this.connection.dataPin), raw: this.raw, convertedTemperatureC: this.raw / 16,
      temperatureC: Math.max(-55, Math.min(125, number(this.properties.temperatureC, 25))),
      conversionPending: Boolean(this.pending), conversionReadyAt: this.pending ? this.pending.readyAt : null,
      conversionTimeMs: 750, resolutionBits: 12, timeMs: this.time, revision: this.revision
    };
  };
  Device.prototype.apply = function (action, input) {
    var event = input || {};
    if (event.timeMs != null || event.time != null) this.setTime(event.timeMs == null ? event.time : event.timeMs);
    if (!this.ready()) return { accepted: false, result: null, reason: "device-not-ready" };
    if (event.dataPin != null && pin(event.dataPin) !== pin(this.connection.dataPin)) return { accepted: false, result: null, reason: "data-pin-mismatch" };
    if (action === "start-conversion") {
      this.conversion = this.pending = { raw: Math.round(this.getState().temperatureC * 16), previousRaw: this.raw, startedAt: this.time, readyAt: this.time + 750 };
      this.revision += 1;
      return { accepted: true, result: { conversionPending: true, readyAt: this.pending.readyAt } };
    }
    if (action === "read-raw") return { accepted: true, result: { raw: this.raw, temperatureC: this.raw / 16, conversionPending: Boolean(this.pending) } };
    return { accepted: false, result: null, reason: "unsupported-action" };
  };
  return { create: function (options) { return new Device(options); } };
}));
