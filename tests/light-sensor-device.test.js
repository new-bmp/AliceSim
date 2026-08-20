"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AliceLightSensorDevice = require("../light-sensor-device.js");

function fullyConnected(options = {}) {
  return AliceLightSensorDevice.create({
    ...options,
    connection: {
      powered: true,
      vccConnected: true,
      gndConnected: true,
      aoConnected: true,
      doConnected: true,
      bindingValid: true,
      vccLevel: 3.3,
      gndLevel: 0,
      aoPin: "PA0",
      doPin: "PB1"
    }
  });
}

test("lux and threshold values are clamped to the supported 0..100000 range", () => {
  const sensor = AliceLightSensorDevice.create({ lux: -50, thresholdLux: 200000 });

  assert.equal(sensor.lux, 0);
  assert.equal(sensor.thresholdLux, 100000);
  assert.equal(sensor.setLux(125000), 100000);
  assert.equal(sensor.setThreshold(-1), 0);
  assert.equal(sensor.setLux("2500"), 2500);
});

test("AO voltage and 12-bit ADC value follow the configured illuminance", () => {
  const sensor = fullyConnected({ lux: 50000, thresholdLux: 25000 });
  const state = sensor.getState();

  assert.equal(state.powered, true);
  assert.equal(state.power.reason, "ok");
  assert.equal(state.aoVoltage, 1.65);
  assert.equal(state.adcRaw, 2048);
  assert.equal(state.doLevel, 1);
  assert.equal(state.analog.available, true);
  assert.equal(state.digital.available, true);
  assert.equal(state.connection.aoPin, "PA0");
  assert.equal(state.connection.doPin, "PB1");
});

test("unpowered or disconnected outputs are high impedance while ideal values remain observable", () => {
  const sensor = AliceLightSensorDevice.create({ lux: 100000, thresholdLux: 50000 });
  let state = sensor.getState();

  assert.equal(state.powered, false);
  assert.equal(state.power.reason, "disabled");
  assert.equal(sensor.sampleAnalog(), null);
  assert.equal(sensor.getAdcRaw(), null);
  assert.equal(sensor.sampleDigital(), null);
  assert.equal(state.analog.idealVoltage, 3.3);
  assert.equal(sensor.getDigitalLevel({ ignoreConnection: true }), 1);

  sensor.setConnection({
    powered: true,
    vccConnected: true,
    gndConnected: true,
    aoConnected: false,
    doConnected: true,
    vccLevel: 3.3,
    gndLevel: 0
  });
  state = sensor.getState();
  assert.equal(state.powered, true);
  assert.equal(state.aoVoltage, null);
  assert.equal(state.doLevel, 1);
});

test("power status distinguishes missing rails and invalid supply voltages", () => {
  const sensor = fullyConnected({ lux: 1000 });

  sensor.updateConnection({ vccConnected: false });
  assert.deepEqual(
    { powered: sensor.isPowered(), reason: sensor.getPowerStatus().reason },
    { powered: false, reason: "vcc-disconnected" }
  );

  sensor.updateConnection({ vccConnected: true, vccLevel: 1.8 });
  assert.deepEqual(
    { powered: sensor.isPowered(), reason: sensor.getPowerStatus().reason },
    { powered: false, reason: "undervoltage" }
  );

  sensor.setPower(3.3, 0);
  assert.equal(sensor.isPowered(), true);
  assert.equal(sensor.sampleAnalog(), 0.033);
});

test("transfer direction, response gamma, active-low DO and ADC configuration are configurable", () => {
  const sensor = fullyConnected({
    lux: 25000,
    thresholdLux: 25000,
    analogInverted: true,
    digitalActiveLow: true,
    gamma: 2
  });

  assert.equal(sensor.getAnalogRatio(), 0.9375);
  assert.equal(sensor.getAnalogVoltage(), 3.09375);
  assert.equal(sensor.getDigitalLevel(), 0);

  sensor.setAdcConfig({ bits: 10, referenceVoltage: 3.3 });
  assert.equal(sensor.getAdcRaw(), 959);

  sensor.setTransfer({ analogInverted: false, digitalActiveLow: false, gamma: 1 });
  assert.equal(sensor.getAnalogVoltage(), 0.825);
  assert.equal(sensor.getDigitalLevel(), 1);
  assert.equal(sensor.getAdcRaw(), 256);
});

test("binding errors suppress both electrical outputs without losing sensor settings", () => {
  const sensor = fullyConnected({ lux: 12345, thresholdLux: 12000 });
  const revision = sensor.revision;
  sensor.updateConnection({ bindingValid: false, reason: "ADC pin is not configured" });
  const state = sensor.getState();

  assert.equal(state.powered, true);
  assert.equal(state.aoVoltage, null);
  assert.equal(state.doLevel, null);
  assert.equal(state.lux, 12345);
  assert.equal(state.thresholdLux, 12000);
  assert.equal(state.connection.reason, "ADC pin is not configured");
  assert.equal(state.revision, revision + 1);
});
