"""Run the installed ST7789 C source through the real semantic compiler/runtime.

The probe observes SPI bytes and GPIO only; it has no ST7789 shortcut hook.
"""
import json
from pathlib import Path
import shutil
import subprocess
import unittest

from hal_model import build_hal_model


ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or str(Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe")
IOC = """Mcu.CPN=STM32F103C8T6
PA5.Signal=SPI1_SCK
PA7.Signal=SPI1_MOSI
PA4.Signal=GPIO_Output
PB0.Signal=GPIO_Output
PB1.Signal=GPIO_Output
"""
PROBE = r"""
const fs = require('node:fs');
const runtimeApi = require('./firmware-runtime.js');
const {model, failAt} = JSON.parse(fs.readFileSync(0, 'utf8'));
const gpio = {}, transfers = [];
const runtime = runtimeApi.create(model, {
  onGpio(event) { gpio[event.pin] = event.value; },
  onSpiTx(event) {
    transfers.push({bytes:event.bytes,instance:event.instance,cs:gpio.PA4,dc:gpio.PB0,rst:gpio.PB1});
    return {accepted:transfers.length !== failAt, targetCount:1};
  }
});
runtime.start();
let state;
for (let pass=0; pass<3000; pass++) {
  state = runtime.step(10);
  if (state.error || state.status==='completed') break;
}
process.stdout.write(JSON.stringify({state, gpio, transfers}));
"""


def operations(value):
    if isinstance(value, dict):
        if "op" in value:
            yield value
        for child in value.values():
            yield from operations(child)
    elif isinstance(value, list):
        for child in value:
            yield from operations(child)


class St7789DriverTests(unittest.TestCase):
    def compile(self, calls, initialize=True):
        init = "init_status=AliceSIM_ST7789_Init(&display,&hspi1,GPIOA,GPIO_PIN_4,GPIOB,GPIO_PIN_0,GPIOB,GPIO_PIN_1,100);" if initialize else ""
        main = f"""#include "alicesim_st7789.h"
SPI_HandleTypeDef hspi1;
AliceSIM_ST7789 display;
int init_status=-1;
int result=-1;
int other_result=-1;
int main(void) {{ {init} {calls} return 0; }}
"""
        files = [(Path("Display.ioc"), IOC), (Path("Core/Src/main.c"), main)]
        for folder, suffix in [("Inc", "h"), ("Src", "c")]:
            path = Path("Drivers/AliceSIM") / folder / f"alicesim_st7789.{suffix}"
            files.append((path, (ROOT / path).read_text(encoding="utf-8")))
        model = build_hal_model(files)
        self.assertEqual([], [item for item in model["diagnostics"] if item["severity"] == "error"])
        return model

    def run_driver(self, calls, initialize=True, fail_at=None):
        if not Path(NODE).exists() and not shutil.which(NODE):
            self.skipTest("Node runtime unavailable")
        model = self.compile(calls, initialize)
        response = subprocess.run([NODE, "-e", PROBE], input=json.dumps({"model": model, "failAt": fail_at}),
                                  text=True, cwd=ROOT, capture_output=True, timeout=30)
        self.assertEqual(0, response.returncode, response.stderr)
        output = json.loads(response.stdout)
        self.assertIsNone(output["state"]["error"], output["state"])
        self.assertEqual("completed", output["state"]["status"], output["state"])
        return output

    def test_real_driver_compiles_to_spi_gpio_and_delays_without_display_shortcuts(self):
        model = self.compile("result=AliceSIM_ST7789_DrawPixel(&display,2,3,ALICESIM_ST7789_COLOR_RED);")
        emitted = list(operations(model["program"]["operations"]))
        self.assertTrue({"spiTransmit", "gpioWrite", "delay"}.issubset({op["op"] for op in emitted}))
        self.assertFalse(any(op["op"].lower().startswith("alicest7789") for op in emitted))

    def test_clipped_rgb565_rectangle_stream_and_initialization_commands(self):
        output = self.run_driver("result=AliceSIM_ST7789_FillRect(&display,-1,-2,4,5,ALICESIM_ST7789_COLOR_RED);")
        self.assertEqual(0, output["state"]["variables"]["init_status"])
        self.assertEqual(0, output["state"]["variables"]["result"])
        transfers = output["transfers"]
        self.assertTrue(all(item["cs"] == 0 and item["rst"] == 1 and item["instance"] == "SPI1" for item in transfers))
        self.assertEqual([1, 0x11, 0x3a, 0x36, 0x20, 0x13, 0x29, 0x2a, 0x2b, 0x2c],
                         [item["bytes"][0] for item in transfers if item["dc"] == 0])
        self.assertEqual([0, 0, 0, 2], transfers[-5]["bytes"])
        self.assertEqual([0, 0, 0, 2], transfers[-3]["bytes"])
        self.assertEqual([0xf8, 0] * 9, transfers[-1]["bytes"])
        self.assertEqual(1, output["gpio"]["PA4"])

    def test_full_screen_fill_uses_bounded_chunks_and_exact_pixel_count(self):
        output = self.run_driver("result=AliceSIM_ST7789_Fill(&display,ALICESIM_ST7789_COLOR_CYAN);")
        payload = output["transfers"][14:]
        # Init emits 9 transfers; CASET/RASET/RAMWR emit another 5.
        self.assertEqual(900, len(payload))
        self.assertEqual(115200, sum(len(item["bytes"]) for item in payload))
        self.assertTrue(all(item["dc"] == 1 and len(item["bytes"]) <= 128 for item in payload))
        self.assertTrue(all(item["bytes"] == [0x07, 0xff] * 64 for item in payload))

    def test_text_uses_real_glyph_pixels_and_rejects_invalid_scale(self):
        output = self.run_driver('result=AliceSIM_ST7789_DrawString(&display,0,0,"A",1,0xffff,0); other_result=AliceSIM_ST7789_DrawString(&display,0,0,"A",0,0xffff,0);')
        self.assertEqual(0, output["state"]["variables"]["result"])
        self.assertEqual(1, output["state"]["variables"]["other_result"])
        pixels = [item for item in output["transfers"] if item["dc"] == 1][-8:]
        self.assertEqual(8, len(pixels))
        self.assertEqual([0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0], pixels[0]["bytes"])
        self.assertEqual([0] * 12, pixels[-1]["bytes"])

    def test_transport_failure_propagates_and_releases_chip_select(self):
        output = self.run_driver("result=AliceSIM_ST7789_FillRect(&display,0,0,2,2,0xffff);", fail_at=15)
        self.assertEqual(1, output["state"]["variables"]["result"])
        self.assertEqual(15, len(output["transfers"]))
        self.assertEqual(1, output["gpio"]["PA4"])
        uninitialized = self.run_driver("result=AliceSIM_ST7789_DrawPixel(&display,0,0,0xffff);", initialize=False)
        self.assertEqual(1, uninitialized["state"]["variables"]["result"])
        self.assertEqual([], uninitialized["transfers"])

    def test_maximum_scale_and_partial_glyphs_remain_bounded_and_yield(self):
        output = self.run_driver('result=AliceSIM_ST7789_DrawString(&display,0,0,"A",8,0xffff,0); other_result=AliceSIM_ST7789_DrawString(&display,-3,-2,"A",1,0xffff,0);')
        self.assertEqual(0, output["state"]["variables"]["result"])
        self.assertEqual(0, output["state"]["variables"]["other_result"])
        self.assertTrue(all(len(item["bytes"]) <= 128 for item in output["transfers"]))
        self.assertGreaterEqual(output["state"]["timeMs"], 419)


if __name__ == "__main__":
    unittest.main()
