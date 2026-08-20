from pathlib import Path
import json
import unittest

from hal_model import build_hal_model


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "STM32F103_HAL_Init"


class HalExampleProjectTests(unittest.TestCase):
    def test_example_contains_importable_cube_project_files(self) -> None:
        required = [
            "STM32F103_HAL_Init.ioc",
            "STM32F103_HAL_Init.alice-sch.json",
            "Core/Inc/main.h",
            "Core/Inc/stm32f1xx_hal_conf.h",
            "Core/Src/main.c",
            "Core/Src/adc.c",
            "Core/Src/i2c.c",
            "Core/Src/tim.c",
            "Core/Src/usart.c",
            "Drivers/STM32F1xx_HAL_Driver/Inc/stm32f1xx_hal.h",
            "Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c",
            "Drivers/CMSIS/Include/core_cm3.h",
            "Drivers/CMSIS/Device/ST/STM32F1xx/Include/stm32f103xb.h",
            "Drivers/AliceSIM/Inc/alicesim_ssd1306.h",
            "Drivers/AliceSIM/Src/alicesim_ssd1306.c",
        ]
        for relative_path in required:
            self.assertTrue((EXAMPLE / relative_path).is_file(), relative_path)

    def test_example_circuit_connects_the_required_hardware(self) -> None:
        circuit = json.loads((EXAMPLE / "STM32F103_HAL_Init.alice-sch.json").read_text(encoding="utf-8"))
        components = {component["id"]: component for component in circuit["components"]}
        mcu_id = next(component["id"] for component in circuit["components"] if component["type"] == "mcu")
        connections = {
            frozenset(((wire["from"]["componentId"], wire["from"]["pin"]), (wire["to"]["componentId"], wire["to"]["pin"])))
            for wire in circuit["wires"]
        }

        self.assertEqual("AliceSIMCircuit", circuit["kind"])
        self.assertEqual(0x3C, components["oled-1"]["oledAddress"])
        self.assertGreaterEqual(components["adc-source-1"]["adcVoltage"], 0)
        self.assertLessEqual(components["adc-source-1"]["adcVoltage"], components["adc-source-1"]["adcReferenceVoltage"])
        self.assertGreaterEqual(components["adc-source-2"]["adcVoltage"], 0)
        self.assertLessEqual(components["adc-source-2"]["adcVoltage"], components["adc-source-2"]["adcReferenceVoltage"])
        self.assertFalse(components["run-switch"]["buttonClosed"])
        self.assertIn(frozenset(((mcu_id, "PB6"), ("oled-1", "SCL"))), connections)
        self.assertIn(frozenset(((mcu_id, "PB7"), ("oled-1", "SDA"))), connections)
        self.assertIn(frozenset(((mcu_id, "PA0"), ("adc-source-1", "AO"))), connections)
        self.assertIn(frozenset(((mcu_id, "PB0"), ("adc-source-2", "AO"))), connections)
        self.assertIn(frozenset((("vcc-1", "VCC"), ("oled-1", "VCC"))), connections)
        self.assertIn(frozenset((("ground-1", "GND"), ("oled-1", "GND"))), connections)
        self.assertIn(frozenset((("ground-1", "GND"), ("adc-source-1", "GND"))), connections)
        self.assertIn(frozenset((("ground-1", "GND"), ("adc-source-2", "GND"))), connections)
        self.assertIn(frozenset((("vcc-1", "VCC"), ("switch-pullup", "1"))), connections)
        self.assertIn(frozenset((("switch-pullup", "2"), (mcu_id, "PA1"))), connections)
        self.assertIn(frozenset(((mcu_id, "PA1"), ("run-switch", "1"))), connections)
        self.assertIn(frozenset((("run-switch", "2"), ("ground-1", "GND"))), connections)
        self.assertIn(frozenset(((mcu_id, "PB12"), ("green-resistor", "1"))), connections)
        self.assertIn(frozenset((("green-resistor", "2"), ("green-led", "A"))), connections)
        self.assertIn(frozenset((("green-led", "K"), ("ground-1", "GND"))), connections)
        self.assertIn(frozenset((("vcc-1", "VCC"), ("red-resistor", "1"))), connections)
        self.assertIn(frozenset((("red-resistor", "2"), ("red-led", "A"))), connections)
        self.assertIn(frozenset((("red-led", "K"), (mcu_id, "PB12"))), connections)

        formatted_mv10 = []
        for source_id in ("adc-source-1", "adc-source-2"):
            source = components[source_id]
            raw = int((source["adcVoltage"] / source["adcReferenceVoltage"] * 4095) + 0.5)
            formatted_mv10.append(((raw * 33000) + 2047) // 4095)
        expected_mv10 = [round(components[source_id]["adcVoltage"] * 10000) for source_id in ("adc-source-1", "adc-source-2")]
        for actual, expected in zip(formatted_mv10, expected_mv10):
            self.assertLessEqual(abs(actual - expected), 5)

    def test_example_is_recognized_by_the_hal_model(self) -> None:
        paths = [EXAMPLE / "STM32F103_HAL_Init.ioc"]
        paths.extend(sorted((EXAMPLE / "Core").rglob("*.c")))
        paths.extend(sorted((EXAMPLE / "Core").rglob("*.h")))
        files = [
            (path.relative_to(EXAMPLE), path.read_text(encoding="utf-8", errors="replace"))
            for path in paths
        ]
        model = build_hal_model(files)

        self.assertFalse([item for item in model["diagnostics"] if item["severity"] == "error"])
        self.assertEqual("STM32F103C8T6", model["mcu"])
        self.assertEqual(("PA2", "PA3", 115200), (
            model["uarts"]["huart2"]["txPin"],
            model["uarts"]["huart2"]["rxPin"],
            model["uarts"]["huart2"]["baudRate"],
        ))
        self.assertEqual(("PB6", "PB7", 100000), (
            model["i2cs"]["hi2c1"]["sclPin"],
            model["i2cs"]["hi2c1"]["sdaPin"],
            model["i2cs"]["hi2c1"]["clockSpeed"],
        ))
        self.assertEqual("PA0", model["adcs"]["hadc1"]["channels"][0]["pin"])
        self.assertEqual("PB0", model["adcs"]["hadc2"]["channels"][0]["pin"])
        timer = model["timers"]["htim1"]
        self.assertEqual(72000000, timer["clockHz"])
        self.assertEqual("PA8", timer["channels"][0]["pin"])
        self.assertAlmostEqual(72000000 / 65536, timer["frequencyHz"])

        operations = model["program"]["operations"]

        def walk(items):
            for item in items:
                yield item
                yield from walk(item.get("body", []))
                yield from walk(item.get("then", []))
                yield from walk(item.get("else", []))

        operation_names = [item.get("op") for item in walk(operations)]
        self.assertEqual(2, operation_names.count("adcGetValue"))
        self.assertIn("uartTransmit", operation_names)
        self.assertIn("aliceOledInit", operation_names)
        self.assertIn("aliceOledDrawString", operation_names)
        self.assertIn("aliceOledUpdate", operation_names)
        gpio_read = next(item for item in walk(operations) if item.get("op") == "gpioRead")
        self.assertEqual(("PA1", "run_switch_state"), (gpio_read["pin"], gpio_read["resultTarget"]))
        gpio_writes = [item for item in walk(operations) if item.get("op") == "gpioWrite"]
        self.assertEqual({"PB12"}, {item["pin"] for item in gpio_writes})
        self.assertEqual(2, len(gpio_writes))

        array_assignments = [
            item for item in walk(operations)
            if item.get("op") == "assign" and isinstance(item.get("target"), dict)
        ]
        assigned_arrays = {item["target"].get("name") for item in array_assignments}
        self.assertIn("oled_line_pa0", assigned_arrays)
        self.assertIn("oled_line_pb0", assigned_arrays)
        self.assertIn("uart_report", assigned_arrays)

        uart_report = next(item for item in walk(operations) if item.get("op") == "uartTransmit")
        self.assertEqual(("huart2", "uart_report", 27), (
            uart_report["uart"], uart_report["buffer"], uart_report["length"]
        ))

        main_source = (EXAMPLE / "Core/Src/main.c").read_text(encoding="utf-8")
        self.assertNotIn('"RAW:"', main_source)
        self.assertIn('"PA0 0000.0 mV"', main_source)
        self.assertIn('"PB0 0000.0 mV"', main_source)
        self.assertIn('"PA0=0000.0mV PB0=0000.0mV\\r\\n"', main_source)
        self.assertIn('"READY"', main_source)


if __name__ == "__main__":
    unittest.main()
