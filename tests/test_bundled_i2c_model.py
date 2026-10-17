from pathlib import Path
import json
import shutil
import subprocess
import unittest

from hal_model import build_hal_model


ROOT = Path(__file__).resolve().parents[1]
IOC = """Mcu.CPN=STM32F103C8T6
PB6.Signal=I2C1_SCL
PB7.Signal=I2C1_SDA
I2C1.ClockSpeed=100000
"""
PROBE = r"""
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {loadCircuit, root} = require('./examples/Learning06_Components/circuit-tools.cjs');
const {model, type, properties, omitPin} = JSON.parse(fs.readFileSync(0, 'utf8'));
const api = loadCircuit(model);
const component = (id, type) => ({id, type, ref: id, value: type, x: 0, y: 0, rotation: 0});
const circuit = {kind: 'AliceSIMCircuit', schemaVersion: 1, mcu: 'STM32F103C8T6',
  components: [component('mcu', 'mcu'), {...component('vcc', 'vcc'), value: '+3.3V'}, component('gnd', 'ground'),
    {...component('device', type), peripheralProperties: properties || {}}], wires: []};
for (const [from, pin, toPin] of [['vcc', 'VCC', 'VCC'], ['gnd', 'GND', 'GND'], ['mcu', 'PB6', 'SCL'], ['mcu', 'PB7', 'SDA']]) {
  if (pin !== omitPin) circuit.wires.push({id: 'w' + circuit.wires.length, from: {componentId: from, pin},
    to: {componentId: 'device', pin: toPin}, route: [{x: 0, y: 0}, {x: 100, y: 0}]});
}
if (!api.importCircuit(circuit).ok) throw new Error('Circuit import failed');
const messages = [], responses = [];
const context = vm.createContext({console, postMessage(message) {
  messages.push(message);
  if (message.type === 'event' && message.kind === 'i2c-tx') responses.push(api.handleI2cTransmission(message.detail));
  if (message.type === 'event' && message.kind === 'i2c-rx') responses.push(api.handleI2cReception(message.detail));
}});
context.self = context;
context.importScripts = source => {
  const filename = path.join(root, String(source).split('?')[0]);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, {filename});
};
vm.runInContext(fs.readFileSync(path.join(root, 'firmware-worker.js'), 'utf8'), context);
let requestId = 0;
const send = command => {
  const id = ++requestId;
  context.self.onmessage({data: {...command, id}});
  const result = messages.find(message => message.type === 'result' && message.id === id);
  if (!result || result.error) throw new Error(result && result.error || 'Worker returned no result');
  return result.value;
};
send({command: 'init', model}); send({command: 'call', method: 'start'});
let state;
for (let pass = 0; pass < 6; pass++) {
  state = send({command: 'step', deltaMs: pass ? 250 : 0, inputs: api.getFirmwareInputSnapshot()});
  if (state.status === 'completed' || state.error) break;
}
process.stdout.write(JSON.stringify({state, responses, events: messages.filter(message => message.type === 'event'),
  device: api.getState().components.find(component => component.id === 'device').deviceState}));
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


class BundledI2cDriverModelTests(unittest.TestCase):
    def compile_driver(self, name, declarations, calls, expected_bus_operations):
        header = ROOT / "Drivers" / "AliceSIM" / "Inc" / f"alicesim_{name}.h"
        source = ROOT / "Drivers" / "AliceSIM" / "Src" / f"alicesim_{name}.c"
        main = f"""#include "alicesim_{name}.h"
I2C_HandleTypeDef hi2c1;
{declarations}
int main(void) {{
  {calls}
}}
"""
        model = build_hal_model([
            (Path("Sensor.ioc"), IOC),
            (Path("Core/Src/main.c"), main),
            (header.relative_to(ROOT), header.read_text(encoding="utf-8")),
            (source.relative_to(ROOT), source.read_text(encoding="utf-8")),
        ])
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertEqual([], errors, f"{name}: {errors}")
        emitted = list(operations(model["program"]["operations"]))
        kinds = {item["op"] for item in emitted}
        self.assertTrue(set(expected_bus_operations).issubset(kinds), (name, kinds))
        self.assertNotIn("unsupported", kinds)
        return model

    def run_driver(self, name, declarations, calls, expected_bus_operations, properties=None, omit_pin=None):
        model = self.compile_driver(name, declarations, calls, expected_bus_operations)
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node.js is required for real driver/Worker integration")
        result = subprocess.run([node, "-e", PROBE], input=json.dumps({"model": model, "type": name,
            "properties": properties or {}, "omitPin": omit_pin}), text=True, capture_output=True, cwd=ROOT, timeout=20)
        self.assertEqual(0, result.returncode, result.stderr)
        output = json.loads(result.stdout)
        self.assertIsNone(output["state"]["error"], output)
        self.assertEqual("completed", output["state"]["status"], output)
        return output

    def test_bmp280_real_driver_compiles_init_and_raw_read_to_i2c(self):
        self.compile_driver("bmp280", "AliceSIM_BMP280 device; uint32_t pressure; int32_t temperature;",
            "AliceSIM_BMP280_Init(&device, &hi2c1, 0, 100); AliceSIM_BMP280_ReadRaw(&device, &pressure, &temperature);",
            ["i2cMemRead", "i2cMemWrite"])

    def test_mpu6050_real_driver_compiles_init_and_sample_read_to_i2c(self):
        self.compile_driver("mpu6050", "AliceSIM_MPU6050 device; AliceSIM_MPU6050_Sample sample;",
            "AliceSIM_MPU6050_Init(&device, &hi2c1, 0, 100); AliceSIM_MPU6050_Read(&device, &sample);",
            ["i2cMemRead", "i2cMemWrite"])

    def test_sht30_real_driver_compiles_measurement_and_crc_to_i2c(self):
        self.compile_driver("sht30", "AliceSIM_SHT30 device; AliceSIM_SHT30_Sample sample;",
            "AliceSIM_SHT30_Init(&device, &hi2c1, 0, 100); AliceSIM_SHT30_Read(&device, &sample);",
            ["i2cMasterTransmit", "i2cMasterReceive"])

    def test_bh1750_real_driver_compiles_mode_and_lux_read_to_i2c(self):
        self.compile_driver("bh1750", "AliceSIM_BH1750 device; uint32_t lux;",
            "AliceSIM_BH1750_Init(&device, &hi2c1, 0, 180); AliceSIM_BH1750_ReadLux(&device, &lux);",
            ["i2cMasterTransmit", "i2cMasterReceive"])

    def test_ds3231_real_driver_compiles_read_and_write_time_to_i2c(self):
        self.compile_driver("ds3231", "AliceSIM_DS3231 device; AliceSIM_DS3231_Time time;",
            "AliceSIM_DS3231_Init(&device, &hi2c1, 0, 100); AliceSIM_DS3231_ReadTime(&device, &time); AliceSIM_DS3231_WriteTime(&device, &time);",
            ["i2cMemRead", "i2cMemWrite"])

    def test_pcf8574_real_driver_compiles_port_read_and_write_to_i2c(self):
        self.compile_driver("pcf8574", "AliceSIM_PCF8574 device; uint8_t pins;",
            "AliceSIM_PCF8574_Init(&device, &hi2c1, 0, 100); AliceSIM_PCF8574_WritePin(&device, 0, GPIO_PIN_RESET); AliceSIM_PCF8574_Read(&device, &pins);",
            ["i2cMasterTransmit", "i2cMasterReceive"])

    def test_pca9685_real_driver_compiles_frequency_and_channel_to_i2c(self):
        self.compile_driver("pca9685", "AliceSIM_PCA9685 device;",
            "AliceSIM_PCA9685_Init(&device, &hi2c1, 0, 100); AliceSIM_PCA9685_SetFrequency(&device, 50); AliceSIM_PCA9685_SetChannel(&device, 2, 0, 307);",
            ["i2cMemWrite"])

    def test_ina219_real_driver_compiles_voltage_and_current_to_i2c(self):
        self.compile_driver("ina219", "AliceSIM_INA219 device; uint32_t voltage; int32_t current;",
            "AliceSIM_INA219_Init(&device, &hi2c1, 0, 100, 100); AliceSIM_INA219_ReadBusMillivolts(&device, &voltage); AliceSIM_INA219_ReadCurrentMilliamps(&device, &current);",
            ["i2cMemRead", "i2cMemWrite"])

    def test_bh1750_compiled_driver_reads_real_worker_lux_and_status(self):
        result = self.run_driver("bh1750", "AliceSIM_BH1750 device; uint32_t lux; int init_status = -1; int read_status = -1;",
            "init_status = AliceSIM_BH1750_Init(&device, &hi2c1, 0, 180); HAL_Delay(180); read_status = AliceSIM_BH1750_ReadLux(&device, &lux);",
            ["i2cMasterTransmit", "i2cMasterReceive"], {"lux": 500})
        self.assertEqual(0, result["state"]["variables"]["init_status"], result)
        self.assertEqual(0, result["state"]["variables"]["read_status"], result)
        self.assertEqual(5000, result["state"]["variables"]["lux"], result)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_bmp280_compiled_driver_reads_real_worker_measurement(self):
        result = self.run_driver("bmp280", "AliceSIM_BMP280 device; uint32_t pressure; int32_t temperature; int init_status = -1; int read_status = -1;",
            "init_status = AliceSIM_BMP280_Init(&device, &hi2c1, 0, 100); read_status = AliceSIM_BMP280_ReadRaw(&device, &pressure, &temperature);",
            ["i2cMemRead", "i2cMemWrite"], {"temperatureC": 25, "pressurePa": 101325})
        self.assertEqual(0, result["state"]["variables"]["init_status"], result)
        self.assertEqual(0, result["state"]["variables"]["read_status"], result)
        self.assertGreater(result["state"]["variables"]["pressure"], 0, result)
        self.assertGreater(result["state"]["variables"]["temperature"], 0, result)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_mpu6050_compiled_driver_reads_signed_acceleration_and_gyro(self):
        result = self.run_driver("mpu6050", "AliceSIM_MPU6050 device; AliceSIM_MPU6050_Sample sample; int status = -1;",
            "if (AliceSIM_MPU6050_Init(&device, &hi2c1, 0, 100) != HAL_OK) return 11; status = AliceSIM_MPU6050_Read(&device, &sample);",
            ["i2cMemRead", "i2cMemWrite"], {"accelX": -0.5, "gyroZ": -10, "temperatureC": 25})
        self.assertEqual(0, result["state"]["variables"]["status"], result)
        sample = result["state"]["variables"]["sample"]
        self.assertEqual((-8192, 0, 16384, -1310), (sample["accel_x"], sample["accel_y"], sample["accel_z"], sample["gyro_z"]), result)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_sht30_compiled_driver_checks_real_crc_and_reads_temperature_humidity(self):
        result = self.run_driver("sht30", "AliceSIM_SHT30 device; AliceSIM_SHT30_Sample sample; int status = -1;",
            "if (AliceSIM_SHT30_Init(&device, &hi2c1, 0, 100) != HAL_OK) return 11; status = AliceSIM_SHT30_Read(&device, &sample);",
            ["i2cMasterTransmit", "i2cMasterReceive"], {"temperatureC": 23.5, "humidityPercent": 61})
        self.assertEqual(0, result["state"]["variables"]["status"], result)
        self.assertAlmostEqual(2350, result["state"]["variables"]["sample"]["temperature_x100"], delta=1)
        self.assertAlmostEqual(6100, result["state"]["variables"]["sample"]["humidity_x100"], delta=1)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_ds3231_compiled_driver_round_trips_a_calendar_write(self):
        result = self.run_driver("ds3231", "AliceSIM_DS3231 device; AliceSIM_DS3231_Time written = {30, 20, 10, 7, 17, 10, 2026}; AliceSIM_DS3231_Time time; int status = -1;",
            "AliceSIM_DS3231_Init(&device, &hi2c1, 0, 100); if (AliceSIM_DS3231_WriteTime(&device, &written) != HAL_OK) return 11; status = AliceSIM_DS3231_ReadTime(&device, &time);",
            ["i2cMemRead", "i2cMemWrite"])
        self.assertEqual(0, result["state"]["variables"]["status"], result)
        self.assertEqual({"second": 30, "minute": 20, "hour": 10, "weekday": 7, "day": 17, "month": 10, "year": 2026}, result["state"]["variables"]["time"], result)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_ina219_compiled_driver_calibrates_and_reads_signed_current(self):
        result = self.run_driver("ina219", "AliceSIM_INA219 device; uint32_t voltage; int32_t current; int status = -1;",
            "if (AliceSIM_INA219_Init(&device, &hi2c1, 0, 100, 100) != HAL_OK) return 11; if (AliceSIM_INA219_ReadBusMillivolts(&device, &voltage) != HAL_OK) return 12; status = AliceSIM_INA219_ReadCurrentMilliamps(&device, &current);",
            ["i2cMemRead", "i2cMemWrite"], {"busVoltageV": 12, "currentA": -0.5})
        self.assertEqual(0, result["state"]["variables"]["status"], result)
        self.assertEqual(12000, result["state"]["variables"]["voltage"], result)
        self.assertEqual(-500, result["state"]["variables"]["current"], result)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_pcf8574_compiled_driver_drives_the_port_and_reads_external_low(self):
        result = self.run_driver("pcf8574", "AliceSIM_PCF8574 device; uint8_t pins; int status = -1;",
            "if (AliceSIM_PCF8574_Init(&device, &hi2c1, 0, 100) != HAL_OK) return 11; if (AliceSIM_PCF8574_WritePin(&device, 0, GPIO_PIN_RESET) != HAL_OK) return 12; status = AliceSIM_PCF8574_Read(&device, &pins);",
            ["i2cMasterTransmit", "i2cMasterReceive"], {"inputMask": 0xfd})
        self.assertEqual(0, result["state"]["variables"]["status"], result)
        self.assertEqual(0xfc, result["state"]["variables"]["pins"], result)
        self.assertEqual(0xfe, result["device"]["outputLatch"], result)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_pca9685_compiled_driver_changes_real_channel_frequency_and_duty(self):
        result = self.run_driver("pca9685", "AliceSIM_PCA9685 device; int status = -1;",
            "if (AliceSIM_PCA9685_Init(&device, &hi2c1, 0, 100) != HAL_OK) return 11; status = AliceSIM_PCA9685_SetChannel(&device, 2, 0, 307);",
            ["i2cMemWrite"])
        self.assertEqual(0, result["state"]["variables"]["status"], result)
        self.assertAlmostEqual(50, result["device"]["frequencyHz"], delta=1)
        self.assertEqual(307 / 4096, result["device"]["channels"][2]["dutyCycle"], result)
        self.assertEqual(True, result["device"]["channels"][2]["active"], result)
        self.assertTrue(all(item["accepted"] for item in result["responses"]), result)

    def test_bundled_driver_propagates_actual_missing_wiring_and_wrong_address(self):
        declarations = "AliceSIM_BH1750 device; uint32_t lux = 77; int status = -1;"
        for missing in ["PB6", "PB7", "VCC", "GND"]:
            result = self.run_driver("bh1750", declarations,
                "AliceSIM_BH1750_Init(&device, &hi2c1, 0, 180); HAL_Delay(180); status = AliceSIM_BH1750_ReadLux(&device, &lux);",
                ["i2cMasterTransmit", "i2cMasterReceive"], omit_pin=missing)
            self.assertEqual(1, result["state"]["variables"]["status"], missing)
            self.assertEqual(77, result["state"]["variables"]["lux"], missing)
            self.assertFalse(any(item["accepted"] for item in result["responses"]), missing)
        result = self.run_driver("bh1750", declarations,
            "AliceSIM_BH1750_Init(&device, &hi2c1, 0x5c, 180); HAL_Delay(180); status = AliceSIM_BH1750_ReadLux(&device, &lux);",
            ["i2cMasterTransmit", "i2cMasterReceive"])
        self.assertEqual(1, result["state"]["variables"]["status"], result)
        self.assertEqual(77, result["state"]["variables"]["lux"], result)

    def test_missing_driver_source_keeps_an_explicit_unsupported_diagnostic(self):
        model = build_hal_model([(Path("main.c"), "int main(void) { AliceSIM_BH1750_Init(&device, &hi2c1, 0, 100); }")])
        self.assertIn("ALICESIM_DRIVER_UNSUPPORTED", [item["code"] for item in model["diagnostics"]])


if __name__ == "__main__":
    unittest.main()
