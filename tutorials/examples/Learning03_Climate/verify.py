"""Build and exercise the teaching project without a browser."""
from pathlib import Path
import json
import subprocess
import sys

import os
ROOT = next((candidate for candidate in [Path(os.environ.get("ALICESIM_ROOT", ".")).resolve(), *Path(__file__).resolve().parents] if (candidate / "firmware-runtime.js").is_file() and (candidate / "hal_model.py").is_file() and (candidate / "index.html").is_file()), None)
if ROOT is None:
    raise SystemExit("Verification needs AliceSIM platform source; set ALICESIM_ROOT or place the example under tutorials/examples.")
sys.path.insert(0, str(ROOT))
from hal_model import build_hal_model

PROJECT = Path(__file__).resolve().parent
assert (PROJECT / "Core/Src/main.c").is_file(), "Climate teaching firmware is missing"
files = [(p.relative_to(PROJECT), p.read_text(encoding="utf-8", errors="replace"))
         for p in PROJECT.rglob("*") if p.suffix.lower() in (".ioc", ".c", ".h")]
model = build_hal_model(files)
errors = [d for d in model["diagnostics"] if d["severity"] == "error"]
assert not errors, json.dumps(errors, ensure_ascii=False, indent=2)
probe = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const api = require(process.argv[1]);
const model = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const [temperature, humidity] of [[250, 500], [310, 720], [-55, 420]]) {
  const readings = [], serial = [], gpio = [];
  const runtime = api.create(model, {
    onPeripheral(event) {
      if (event.peripheralType === 'dht11') {
        assert.equal(event.dataPin, 'PB0');
        return {accepted:true, result:{temperatureX10:temperature, humidityX10:humidity}};
      }
      if (event.peripheralType === 'tm1637') {
        assert.equal(event.clkPin, 'PB6'); assert.equal(event.dioPin, 'PB7');
        if (event.action === 'display-number') readings.push({value:event.value, colon:event.colon});
        return {accepted:true, result:{}};
      }
      return {accepted:false};
    },
    onUartTx(event) { serial.push(event.text); },
    onGpio(event) { gpio.push(event); }
  });
  runtime.start(); const state = runtime.step(2150);
  assert.equal(state.error, null, JSON.stringify(state.error));
  assert.ok(readings.some(v => v.value === Math.trunc(temperature / 10) && !v.colon));
  assert.ok(readings.some(v => v.value === humidity / 10 && v.colon));
  assert.ok(serial.some(v => v.includes('TEMP=' + (temperature / 10).toFixed(1) + ' C')));
  assert.ok(serial.some(v => v.includes('HUM=' + humidity / 10 + '.0 %RH')));
  assert.ok(gpio.some(v => v.pin === 'PB12' && v.value === (temperature >= 300 ? 1 : 0)));
  console.log(JSON.stringify({temperature, humidity, readings:readings.slice(0,4), serial:serial.slice(0,4), status:state.status}));
}
"""
result = subprocess.run(["node", "-e", probe, str(ROOT / "firmware-runtime.js")],
                        input=json.dumps(model), text=True, capture_output=True, check=False)
print(result.stdout, end="")
assert result.returncode == 0, result.stderr
print("Climate model: no build errors; both environments and alternating display verified.")
