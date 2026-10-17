from pathlib import Path
import json
import shutil
import subprocess
import unittest

from hal_model import build_hal_model


ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or str(Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe")
IOC = """Mcu.CPN=STM32F103C8T6
PA5.Signal=SPI1_SCK
PA6.Signal=SPI1_MISO
PA7.Signal=SPI1_MOSI
PB0.Signal=GPIO_Output
PB13.Signal=SPI2_SCK
PB14.Signal=SPI2_MISO
PB15.Signal=SPI2_MOSI
"""
PROBE = r"""
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {loadCircuit, root} = require('./examples/Learning06_Components/circuit-tools.cjs');
const {model, omitPin} = JSON.parse(fs.readFileSync(0, 'utf8'));
const api = loadCircuit(model);
const component = (id, type) => ({id, type, ref:id, value:type, x:0, y:0, rotation:0});
const circuit = {kind:'AliceSIMCircuit', schemaVersion:1, mcu:'STM32F103C8T6', components:[
  component('mcu','mcu'), {...component('vcc','vcc'),value:'+3.3V'}, component('gnd','ground'),
  {...component('flash','w25qxx'),peripheralProperties:{capacityKiB:8192}}], wires:[]};
for (const [from,pin,toPin] of [['vcc','VCC','VCC'],['gnd','GND','GND'],['mcu','PA5','SCK'],
  ['mcu','PA6','MISO'],['mcu','PA7','MOSI'],['mcu','PB0','CS']]) {
  if (pin !== omitPin) circuit.wires.push({id:'w'+circuit.wires.length,from:{componentId:from,pin},
    to:{componentId:'flash',pin:toPin},route:[{x:0,y:0},{x:100,y:0}]});
}
if (!api.importCircuit(circuit).ok) throw new Error('Circuit import failed');
api.driveMcuPin('PB0',1,{render:false});
const initialInputs = api.getFirmwareInputSnapshot();
const messages = [], replay = [];
const flashState = () => api.getState().components.find(c=>c.id==='flash').deviceState;
const context = vm.createContext({console,postMessage(message) {
  messages.push(message);
  if (message.type !== 'event') return;
  let response;
  if (message.kind === 'gpio') api.driveMcuPin(message.detail.pin,message.detail.value,{render:false});
  else if (message.kind === 'spi-tx') response = api.handleSpiTransmission(message.detail);
  else if (message.kind === 'spi-rx') response = api.handleSpiReception(message.detail);
  else return;
  const state = flashState();
  replay.push({kind:message.kind,event:message.detail,response,storedBytes:state.storedBytes,
    writeEnabled:state.writeEnabled,selected:state.connection.selected});
}});
context.self = context;
context.importScripts = source => {
  const file = path.join(root,String(source).split('?')[0]);
  vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
};
vm.runInContext(fs.readFileSync(path.join(root,'firmware-worker.js'),'utf8'),context);
let id = 0;
const send = command => {
  const requestId = ++id;
  context.onmessage({data:{...command,id:requestId}});
  const result = messages.find(m=>m.type==='result'&&m.id===requestId);
  if (!result || result.error) throw new Error(result&&result.error||'Worker returned no result');
  return result.value;
};
send({command:'init',model});send({command:'call',method:'start'});
let state;
for (let pass=0;pass<4;pass++) {
  state=send({command:'step',deltaMs:pass?10:0,inputs:api.getFirmwareInputSnapshot()});
  if (state.status==='completed'||state.error) break;
}
process.stdout.write(JSON.stringify({state,initialInputs,replay,device:flashState()}));
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


class BundledSpiDriverModelTests(unittest.TestCase):
    def compile_driver(self, spi="hspi1"):
        main = f"""#include "alicesim_w25qxx.h"
SPI_HandleTypeDef hspi1;
SPI_HandleTypeDef hspi2;
AliceSIM_W25QXX device;
uint32_t jedec = 99;
uint8_t tx[4] = {{0xa5,0x5a,0x00,0xff}};
uint8_t erased[4] = {{77,77,77,77}};
uint8_t rx[4] = {{88,88,88,88}};
int init_status=-1; int id_status=-1; int erased_status=-1; int program_status=-1; int read_status=-1;
int main(void) {{
  init_status=AliceSIM_W25QXX_Init(&device,&{spi},GPIOB,GPIO_PIN_0,100);
  id_status=AliceSIM_W25QXX_ReadJedecId(&device,&jedec);
  erased_status=AliceSIM_W25QXX_Read(&device,16,erased,4);
  program_status=AliceSIM_W25QXX_PageProgram(&device,16,tx,4);
  HAL_Delay(10);
  read_status=AliceSIM_W25QXX_Read(&device,16,rx,4);
  return 0;
}}
"""
        files = [(Path("Flash.ioc"), IOC), (Path("Core/Src/main.c"), main)]
        for suffix, folder in [("h", "Inc"), ("c", "Src")]:
            path = Path("Drivers/AliceSIM") / folder / f"alicesim_w25qxx.{suffix}"
            files.append((path, (ROOT / path).read_text(encoding="utf-8")))
        return build_hal_model(files)

    def run_driver(self, spi="hspi1", omit_pin=None):
        if not Path(NODE).exists() and not shutil.which(NODE):
            self.skipTest("Node runtime unavailable")
        model = self.compile_driver(spi)
        result = subprocess.run([NODE, "-e", PROBE], input=json.dumps({"model": model, "omitPin": omit_pin}),
                                text=True, cwd=ROOT, capture_output=True, timeout=20)
        self.assertEqual(0, result.returncode, result.stderr)
        output = json.loads(result.stdout)
        self.assertIsNone(output["state"]["error"], output)
        self.assertEqual("completed", output["state"]["status"], output)
        return output

    def test_real_flash_driver_preserves_struct_spi_and_gpio_binding_expressions(self):
        model = self.compile_driver()
        self.assertEqual([], [item for item in model["diagnostics"] if item["severity"] == "error"])
        emitted = list(operations(model["program"]["operations"]))
        self.assertTrue({"spiTransmit", "spiReceive", "gpioWrite"}.issubset({op["op"] for op in emitted}))
        for op in emitted:
            if op["op"] in {"spiTransmit", "spiReceive"}:
                self.assertIsNotNone(op.get("spiExpression"), op)
            if op["op"] == "gpioWrite":
                self.assertIsNotNone(op.get("portExpression"), op)
                self.assertIsNotNone(op.get("pinExpression"), op)

    def test_real_flash_driver_reads_jedec_programs_on_cs_rise_and_reads_across_worker_batches(self):
        result = self.run_driver()
        variables = result["state"]["variables"]
        for status in ["init_status", "id_status", "erased_status", "program_status", "read_status"]:
            self.assertEqual(0, variables[status], (status, result))
        self.assertEqual(0xef4017, variables["jedec"], result)
        self.assertEqual([255] * 4, variables["erased"], result)
        self.assertEqual([0xa5, 0x5a, 0, 255], variables["rx"], result)
        target = next(target for target in result["initialInputs"]["spi"] if target["componentId"] == "flash")
        self.assertTrue(target["ready"])
        self.assertEqual(("SPI1", "PB0"), (target["instance"], target["csPin"]))
        replay = result["replay"]
        self.assertTrue(any(item["kind"] == "spi-tx" and item["event"]["bytes"] == [6] for item in replay))
        payload_index = next(i for i, item in enumerate(replay) if item["kind"] == "spi-tx" and item["event"]["bytes"] == [0xa5, 0x5a, 0, 255])
        self.assertEqual(0, replay[payload_index]["storedBytes"], "Data must remain pending while CS is low")
        self.assertEqual("gpio", replay[payload_index + 1]["kind"])
        self.assertEqual(("PB0", 1), (replay[payload_index + 1]["event"]["pin"], replay[payload_index + 1]["event"]["value"]))
        self.assertEqual(3, replay[payload_index + 1]["storedBytes"], "The final 0xff byte remains erased in sparse storage")
        self.assertFalse(result["device"]["writeEnabled"])

    def test_real_flash_driver_rejects_missing_wires_and_wrong_spi_without_overwriting_outputs(self):
        for spi, missing in [("hspi1", "VCC"), ("hspi1", "PA6"), ("hspi1", "PB0"), ("hspi2", None)]:
            result = self.run_driver(spi, missing)
            variables = result["state"]["variables"]
            self.assertEqual(1, variables["id_status"], (spi, missing, result))
            self.assertEqual(1, variables["read_status"], (spi, missing, result))
            self.assertEqual(99, variables["jedec"])
            self.assertEqual([88] * 4, variables["rx"])
            self.assertEqual(0, result["device"]["storedBytes"])


if __name__ == "__main__":
    unittest.main()
