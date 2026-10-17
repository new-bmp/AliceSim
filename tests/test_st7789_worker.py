"""Installed C driver -> firmware Worker -> wired schematic ST7789 pixels."""
import json
from pathlib import Path
import shutil
import subprocess
import unittest

from hal_model import build_hal_model


ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or str(Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe")
PROBE = r"""
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const displayModule = require.resolve('./spi-display-device.js');
const realDisplays = require(displayModule), displays = [];
// Observe the actual controller RAM without adding a test API to the application.
require.cache[displayModule].exports = {...realDisplays, create(options) {
  const device = realDisplays.create(options); displays.push(device); return device;
}};
const {loadCircuit, root} = require('./examples/Learning06_Components/circuit-tools.cjs');
const {model, omitPin} = JSON.parse(fs.readFileSync(0, 'utf8'));
const api = loadCircuit(model);
const component = (id,type) => ({id,type,ref:id,value:type,x:0,y:0,rotation:0});
const circuit = {kind:'AliceSIMCircuit',schemaVersion:1,mcu:'STM32F103C8T6',components:[
  component('mcu','mcu'),{...component('vcc','vcc'),value:'+3.3V'},component('gnd','ground'),component('screen','st7789')],wires:[]};
for (const [from,pin,toPin] of [['vcc','VCC','VCC'],['gnd','GND','GND'],['vcc','VCC','BL'],
  ['mcu','PA5','SCK'],['mcu','PA7','MOSI'],['mcu','PA4','CS'],['mcu','PB0','DC'],['mcu','PB1','RST']]) {
  if (toPin !== omitPin) circuit.wires.push({id:'w'+circuit.wires.length,from:{componentId:from,pin},
    to:{componentId:'screen',pin:toPin},route:[{x:0,y:0},{x:100,y:0}]});
}
if (!api.importCircuit(circuit).ok) throw new Error('Circuit import failed');
const initialInputs=api.getFirmwareInputSnapshot(), messages=[], replay=[];
const context=vm.createContext({console,postMessage(message) {
  messages.push(message);
  if (message.type !== 'event') return;
  if (message.kind === 'gpio') api.driveMcuPin(message.detail.pin,message.detail.value,{render:false});
  else if (message.kind === 'spi-tx') {
    const response=api.handleSpiTransmission(message.detail);
    replay.push({bytes:message.detail.bytes,response});
  }
}});
context.self=context;
context.importScripts=source=>{
  const file=path.join(root,String(source).split('?')[0]);
  vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
};
vm.runInContext(fs.readFileSync(path.join(root,'firmware-worker.js'),'utf8'),context);
let id=0;
const send=command=>{
  const requestId=++id;
  context.onmessage({data:{...command,id:requestId}});
  const response=messages.find(m=>m.type==='result'&&m.id===requestId);
  if (!response || response.error) throw new Error(response&&response.error||'No Worker response');
  return response.value;
};
send({command:'init',model});send({command:'call',method:'start'});
// Deliberately keep the original snapshot for the whole batch: reset release
// and command/data/CS changes must use the Worker's current GPIO outputs.
const state=send({command:'step',deltaMs:1000,inputs:initialInputs});
const display=displays[displays.length-1], pixels=display.getFramebuffer();
process.stdout.write(JSON.stringify({state:{status:state.status,error:state.error,
  variables:{init_status:state.variables.init_status,result:state.variables.result}},
  initialInputs,replay,device:display.getState(),pixels:[pixels[0],pixels[2+2*240],pixels[3],pixels[239+239*240],pixels[11+20*240]],
  nonzero:Array.from(pixels).filter(pixel=>pixel!==0).length}));
"""


class St7789WorkerIntegrationTests(unittest.TestCase):
    def compile_driver(self):
        ioc = "Mcu.CPN=STM32F103C8T6\nPA5.Signal=SPI1_SCK\nPA7.Signal=SPI1_MOSI\nPA4.Signal=GPIO_Output\nPB0.Signal=GPIO_Output\nPB1.Signal=GPIO_Output\n"
        source = """#include "alicesim_st7789.h"
SPI_HandleTypeDef hspi1;
AliceSIM_ST7789 display;
int init_status=-1;
int result=-1;
int main(void) {
  init_status=AliceSIM_ST7789_Init(&display,&hspi1,GPIOA,GPIO_PIN_4,GPIOB,GPIO_PIN_0,GPIOB,GPIO_PIN_1,100);
  if (init_status == HAL_OK) {
    result=AliceSIM_ST7789_FillRect(&display,-1,-2,4,5,ALICESIM_ST7789_COLOR_RED);
    AliceSIM_ST7789_DrawPixel(&display,239,239,ALICESIM_ST7789_COLOR_BLUE);
    AliceSIM_ST7789_DrawString(&display,10,20,"A",1,ALICESIM_ST7789_COLOR_WHITE,ALICESIM_ST7789_COLOR_BLACK);
  }
  return 0;
}
"""
        files = [(Path("Screen.ioc"), ioc), (Path("Core/Src/main.c"), source)]
        for folder, extension in [("Inc", "h"), ("Src", "c")]:
            file = Path("Drivers/AliceSIM") / folder / f"alicesim_st7789.{extension}"
            files.append((file, (ROOT / file).read_text(encoding="utf-8")))
        model = build_hal_model(files)
        self.assertEqual([], [entry for entry in model["diagnostics"] if entry["severity"] == "error"])
        return model

    def run_circuit(self, omitted_pin=None):
        if not Path(NODE).exists() and not shutil.which(NODE):
            self.skipTest("Node runtime unavailable")
        result = subprocess.run([NODE, "-e", PROBE], input=json.dumps({"model": self.compile_driver(), "omitPin": omitted_pin}),
                                text=True, cwd=ROOT, capture_output=True, timeout=30)
        self.assertEqual(0, result.returncode, result.stderr)
        output = json.loads(result.stdout)
        self.assertIsNone(output["state"]["error"], output["state"])
        self.assertEqual("completed", output["state"]["status"], output["state"])
        return output

    def test_real_c_stream_drives_wired_pixels_and_reset_release_in_one_worker_batch(self):
        output = self.run_circuit()
        self.assertEqual({"init_status": 0, "result": 0}, output["state"]["variables"])
        target = next(entry for entry in output["initialInputs"]["spi"] if entry["componentId"] == "screen")
        self.assertEqual(("SPI1", "PA4", "PB0", "PB1"), (target["instance"], target["csPin"], target["dcPin"], target["resetPin"]))
        self.assertTrue(target["resetRequired"])
        self.assertFalse(target["resetReleased"], "The batch starts before firmware releases reset")
        self.assertEqual([0xf800, 0xf800, 0, 0x001f, 0xffff], output["pixels"])
        self.assertTrue(output["device"]["visible"])
        self.assertEqual(3, output["device"]["framesWritten"])
        self.assertTrue(output["replay"])
        self.assertTrue(all(entry["response"]["accepted"] for entry in output["replay"]))

    def test_disconnected_power_or_reset_never_claims_success_or_creates_pixels(self):
        for omitted_pin in ["VCC", "GND", "RST", "SCK", "MOSI", "CS", "DC"]:
            with self.subTest(omitted_pin=omitted_pin):
                output = self.run_circuit(omitted_pin)
                self.assertEqual({"init_status": 1, "result": -1}, output["state"]["variables"])
                self.assertEqual(0, output["nonzero"])
                self.assertFalse(output["device"]["visible"])

    def test_unpowered_backlight_hides_display_but_keeps_written_controller_ram(self):
        output = self.run_circuit("BL")
        self.assertEqual({"init_status": 0, "result": 0}, output["state"]["variables"])
        self.assertEqual([0xf800, 0xf800, 0, 0x001f, 0xffff], output["pixels"])
        self.assertFalse(output["device"]["visible"])
        self.assertFalse(output["device"]["connection"]["backlightOn"])


if __name__ == "__main__":
    unittest.main()
