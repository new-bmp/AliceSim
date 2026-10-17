"""Check the actual DMA model, callbacks, serial output and independent LED."""
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
assert (PROJECT / "Core/Src/main.c").is_file(), "DMA teaching firmware is missing"
files = [(p.relative_to(PROJECT), p.read_text(encoding="utf-8", errors="replace"))
         for p in PROJECT.rglob("*") if p.suffix.lower() in (".ioc", ".c", ".h")]
model = build_hal_model(files)
errors = [d for d in model["diagnostics"] if d["severity"] == "error"]
assert not errors, json.dumps(errors, ensure_ascii=False, indent=2)
assert model["dmas"]["hdma_adc1"]["circular"] is True
probe = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const api = require(process.argv[1]);
const model = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const raw of [1365, 2730]) {
  const serial = [], gpio = [], events = [];
  const runtime = api.create(model, {
    onAdcRead(event) { assert.equal(event.channel.pin, 'PA0'); return raw; },
    onUartTx(event) { serial.push(event.text); },
    onGpio(event) { gpio.push(event); },
    onDmaCallback(event) { events.push(event); }
  });
  runtime.start(); const state = runtime.step(650);
  assert.equal(state.error, null, JSON.stringify(state.error));
  assert.ok(state.variables.dma_half_count >= 2, JSON.stringify(state.variables));
  assert.ok(state.variables.dma_full_count >= 2);
  assert.ok(state.variables.dma_batch >= 2);
  assert.equal(state.variables.dma_mv, raw === 1365 ? 1100 : 2200);
  assert.ok(serial.some(v => v.includes('ADC=' + (raw === 1365 ? 1100 : 2200) + ' mV')));
  const led = gpio.filter(v => v.pin === 'PC13');
  assert.ok(led.some(v => v.value === 1) && led.some(v => v.value === 0), JSON.stringify(led));
  console.log(JSON.stringify({raw, half:state.variables.dma_half_count, full:state.variables.dma_full_count, batches:state.variables.dma_batch, mv:state.variables.dma_mv, serial:serial.slice(-2), ledTransitions:led.length, status:state.status}));
}
"""
result = subprocess.run(["node", "-e", probe, str(ROOT / "firmware-runtime.js")],
                        input=json.dumps(model), text=True, capture_output=True, check=False)
print(result.stdout, end="")
assert result.returncode == 0, result.stderr
print("DMA model: circular transfer, both callbacks, two voltages and independent LED verified.")
