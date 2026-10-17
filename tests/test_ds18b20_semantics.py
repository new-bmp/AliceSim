from pathlib import Path
import json
import shutil
import subprocess
import unittest

from hal_model import build_hal_model

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or str(Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe")

CALLBACKS = """
HAL_StatusTypeDef reset_wire(void *ctx) { HAL_GPIO_WritePin(TEMP_GPIO_Port, TEMP_Pin, GPIO_PIN_RESET); return HAL_OK; }
HAL_StatusTypeDef write_wire(void *ctx, uint8_t value) { HAL_GPIO_WritePin(TEMP_GPIO_Port, TEMP_Pin, value); return HAL_OK; }
HAL_StatusTypeDef read_wire(void *ctx, uint8_t *value) { *value = HAL_GPIO_ReadPin(TEMP_GPIO_Port, TEMP_Pin); return HAL_OK; }
"""


def fixture(callbacks=CALLBACKS, read_pin="GPIO_PIN_4", init_callback="reset_wire"):
    main = callbacks.replace("TEMP_Pin", read_pin) + f"""
AliceSIM_DS18B20 probe;
int16_t raw = 999;
int32_t temperature = 0;
HAL_StatusTypeDef status;
int main(void) {{
  status = AliceSIM_DS18B20_Init(&probe, NULL, {init_callback}, write_wire, read_wire);
  if (AliceSIM_DS18B20_StartConversion(&probe) == HAL_OK) {{
    HAL_Delay(750);
    status = AliceSIM_DS18B20_ReadRaw(&probe, &raw);
    temperature = AliceSIM_DS18B20_RawToCelsiusX100(raw);
  }}
  return 0;
}}
"""
    return [(Path("probe.ioc"), "Mcu.CPN=STM32F103C8T6\nMcu.Pin0=PA4\nPA4.Signal=GPIO_Output\n"),
            (Path("Core/Inc/main.h"), "#define TEMP_GPIO_Port GPIOA\n#define GPIO_PIN_4 16U\n#define GPIO_PIN_5 32U\n"),
            (Path("Core/Src/main.c"), main),
            (Path("Drivers/AliceSIM/Inc/alicesim_ds18b20.h"), (ROOT / "Drivers/AliceSIM/Inc/alicesim_ds18b20.h").read_text(encoding="utf-8"))]


class Ds18b20SemanticsTests(unittest.TestCase):
    def run_model(self, model):
        if not Path(NODE).exists() and not shutil.which(NODE):
            self.skipTest("Node runtime unavailable")
        script = r"""
const fs = require('node:fs');
const model = JSON.parse(fs.readFileSync(0, 'utf8'));
const sensor = require('./ds18b20-device.js').create({temperatureC:-12.375,connection:{powered:true,vccLevel:3.3,gndLevel:0,bindingValid:true,dataConnected:true,dataPin:'PA4'}});
const events = [];
const runtime = require('./firmware-runtime.js').create(model,{onPeripheral:e=>{events.push(e);return e.dataPin==='PA4'?sensor.apply(e.action,e):{accepted:false};}});
runtime.start();runtime.step(0);process.stdout.write(JSON.stringify({state:runtime.step(750),events}));
"""
        result = subprocess.run([NODE, "-e", script], input=json.dumps(model), text=True, cwd=ROOT, capture_output=True, check=True)
        result = json.loads(result.stdout)
        self.assertIsNone(result["state"].get("error"))
        return result["state"], result["events"]

    def test_callback_gpio_is_resolved_and_compiled_program_reads_signed_temperature(self):
        model = build_hal_model(fixture())
        init = next((op for op in model["program"]["operations"] if op["op"] == "aliceDs18b20Init"), None)
        self.assertIsNotNone(init, model.get("diagnostics"))
        self.assertEqual("PA4", init["dataPin"])
        self.assertTrue(init["bindingValid"])
        self.assertEqual(["reset_wire", "write_wire", "read_wire"], init["callbacks"])
        errors = [item for item in model.get("diagnostics", []) if item.get("severity") == "error"]
        self.assertEqual([], errors)
        state, _ = self.run_model(model)
        self.assertIsNone(state.get("error"))
        self.assertEqual(-198, state["variables"]["raw"])
        self.assertEqual(-1237, state["variables"]["temperature"])
        self.assertEqual(0, state["variables"]["status"])

    def test_multiple_callback_pins_or_missing_callbacks_never_silently_bind(self):
        for files in [fixture(CALLBACKS.replace("read_wire(void *ctx, uint8_t *value) { *value = HAL_GPIO_ReadPin(TEMP_GPIO_Port, TEMP_Pin)", "read_wire(void *ctx, uint8_t *value) { *value = HAL_GPIO_ReadPin(TEMP_GPIO_Port, GPIO_PIN_5)")), fixture(init_callback="NULL")]:
            model = build_hal_model(files)
            errors = [item for item in model.get("diagnostics", []) if item.get("code") == "ALICESIM_DS18B20_BINDING_UNRESOLVED"]
            self.assertTrue(errors, model.get("diagnostics"))
            init = next(op for op in model["program"]["operations"] if op["op"] == "aliceDs18b20Init")
            self.assertFalse(init["bindingValid"])
            self.assertIsNone(init["dataPin"])

    def test_static_helper_parameters_bind_to_the_actual_pin(self):
        callbacks = """
void drive(GPIO_TypeDef *port, uint16_t mask, int value) { HAL_GPIO_WritePin(port, mask, value); }
int sample(GPIO_TypeDef *port, uint16_t mask) { return HAL_GPIO_ReadPin(port, mask); }
HAL_StatusTypeDef reset_wire(void *ctx) { drive(TEMP_GPIO_Port, TEMP_Pin, 0); return HAL_OK; }
HAL_StatusTypeDef write_wire(void *ctx, uint8_t value) { drive(TEMP_GPIO_Port, TEMP_Pin, value); return HAL_OK; }
HAL_StatusTypeDef read_wire(void *ctx, uint8_t *value) { *value = sample(TEMP_GPIO_Port, TEMP_Pin); return HAL_OK; }
"""
        model = build_hal_model(fixture(callbacks))
        init = next(op for op in model["program"]["operations"] if op["op"] == "aliceDs18b20Init")
        self.assertEqual("PA4", init["dataPin"])
        self.assertTrue(init["bindingValid"])
        state, _ = self.run_model(model)
        self.assertEqual(-198, state["variables"]["raw"])

    def test_opaque_or_ambiguous_gpio_expressions_are_rejected(self):
        for callbacks in [CALLBACKS.replace("TEMP_GPIO_Port", "ctx->port"),
                          CALLBACKS.replace("TEMP_GPIO_Port", "choose ? GPIOA : GPIOB"),
                          CALLBACKS.replace("TEMP_Pin", "TEMP_Pin | GPIO_PIN_5")]:
            files = fixture(callbacks)
            files[1] = (files[1][0], files[1][1] + "#define TEMP_Pin GPIO_PIN_4\n")
            model = build_hal_model(files)
            init = next(op for op in model["program"]["operations"] if op["op"] == "aliceDs18b20Init")
            self.assertFalse(init["bindingValid"], callbacks)
            self.assertIsNone(init["dataPin"])

    def test_readraw_writes_through_a_pointer_to_a_signed_array_element(self):
        files = fixture()
        files[2] = (files[2][0], files[2][1].replace("int16_t raw = 999;", "int16_t raw[2] = {999, 777}; int16_t *output = &raw[1];")
                    .replace("ReadRaw(&probe, &raw)", "ReadRaw(&probe, output)")
                    .replace("RawToCelsiusX100(raw)", "RawToCelsiusX100(raw[1])"))
        state, _ = self.run_model(build_hal_model(files))
        self.assertEqual([999, -198], state["variables"]["raw"])
        self.assertEqual(-1237, state["variables"]["temperature"])

    def test_null_output_or_device_returns_error_without_bus_activity(self):
        files = fixture()
        files[2] = (files[2][0], files[2][1].replace("ReadRaw(&probe, &raw)", "ReadRaw(&probe, NULL)"))
        state, events = self.run_model(build_hal_model(files))
        self.assertEqual(999, state["variables"]["raw"])
        self.assertEqual(1, state["variables"]["status"])
        self.assertEqual(["start-conversion"], [event["action"] for event in events])
        files = fixture()
        files[2] = (files[2][0], files[2][1].replace("Init(&probe, NULL", "Init(NULL, NULL")
                    .replace("StartConversion(&probe)", "StartConversion(NULL)"))
        state, events = self.run_model(build_hal_model(files))
        self.assertEqual(1, state["variables"]["status"])
        self.assertEqual([], events)

    def test_static_device_array_elements_have_separate_contexts_and_dynamic_pointers_are_rejected(self):
        files = fixture()
        files[2] = (files[2][0], files[2][1].replace("AliceSIM_DS18B20 probe;", "AliceSIM_DS18B20 probes[2];")
                    .replace("&probe", "&probes[0]").replace("  if (", "  AliceSIM_DS18B20_Init(&probes[1], NULL, reset_wire, write_wire, read_wire);\n  if (", 1))
        model = build_hal_model(files)
        contexts = [op["context"] for op in model["program"]["operations"] if op["op"] == "aliceDs18b20Init"]
        self.assertEqual(["probes[0]", "probes[1]"], contexts)
        state, _ = self.run_model(model)
        self.assertEqual(-198, state["variables"]["raw"])
        for device_argument in ["pointer_alias", "&probes[index]"]:
            files = fixture()
            files[2] = (files[2][0], files[2][1].replace("&probe", device_argument))
            model = build_hal_model(files)
            self.assertTrue(any(item["code"] == "ALICESIM_DS18B20_CONTEXT_UNRESOLVED" for item in model["diagnostics"]))
            _, events = self.run_model(model)
            self.assertEqual([], events)

    def test_known_unconditional_callback_failure_is_not_a_valid_binding(self):
        files = fixture(CALLBACKS.replace("return HAL_OK;", "return HAL_ERROR;"))
        model = build_hal_model(files)
        init = next(op for op in model["program"]["operations"] if op["op"] == "aliceDs18b20Init")
        self.assertFalse(init["bindingValid"])


if __name__ == "__main__":
    unittest.main()
