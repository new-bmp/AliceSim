import json
from pathlib import Path
import unittest

import server
from hal_model import build_hal_model


ROOT = Path(__file__).resolve().parents[1]
DRIVER_ROOT = ROOT / "Drivers" / "AliceSIM"

HAL_STUB = r"""
#ifndef STM32F1XX_HAL_H
#define STM32F1XX_HAL_H

#include <stddef.h>
#include <stdint.h>

#define HAL_MAX_DELAY 0xFFFFFFFFU
#define I2C_MEMADD_SIZE_8BIT 0x00000001U
#define GPIO_MODE_INPUT 0x00000000U
#define GPIO_MODE_OUTPUT_PP 0x00000001U
#define GPIO_NOPULL 0x00000000U
#define GPIO_PULLUP 0x00000001U
#define GPIO_SPEED_FREQ_LOW 0x00000000U

typedef enum {
  HAL_OK = 0x00U,
  HAL_ERROR = 0x01U,
  HAL_BUSY = 0x02U,
  HAL_TIMEOUT = 0x03U
} HAL_StatusTypeDef;

typedef enum {
  GPIO_PIN_RESET = 0U,
  GPIO_PIN_SET = 1U
} GPIO_PinState;

typedef struct GPIO_TypeDef GPIO_TypeDef;
typedef struct {
  uint32_t Pin;
  uint32_t Mode;
  uint32_t Pull;
  uint32_t Speed;
} GPIO_InitTypeDef;
typedef struct { void *Instance; } I2C_HandleTypeDef;
typedef struct { void *Instance; } ADC_HandleTypeDef;
typedef struct { void *Instance; } TIM_HandleTypeDef;
typedef struct { void *Instance; } SPI_HandleTypeDef;

#define __HAL_TIM_SET_COMPARE(handle, channel, value) ((void)(handle), (void)(channel), (void)(value))
#define __HAL_TIM_SET_AUTORELOAD(handle, value) ((void)(handle), (void)(value))
#define __HAL_TIM_SET_COUNTER(handle, value) ((void)(handle), (void)(value))

HAL_StatusTypeDef HAL_I2C_Mem_Write(
  I2C_HandleTypeDef *handle,
  uint16_t device_address,
  uint16_t memory_address,
  uint16_t memory_address_size,
  uint8_t *data,
  uint16_t length,
  uint32_t timeout
);
HAL_StatusTypeDef HAL_I2C_Mem_Read(
  I2C_HandleTypeDef *handle,
  uint16_t device_address,
  uint16_t memory_address,
  uint16_t memory_address_size,
  uint8_t *data,
  uint16_t length,
  uint32_t timeout
);
HAL_StatusTypeDef HAL_I2C_Master_Transmit(I2C_HandleTypeDef *handle, uint16_t device_address, uint8_t *data, uint16_t length, uint32_t timeout);
HAL_StatusTypeDef HAL_I2C_Master_Receive(I2C_HandleTypeDef *handle, uint16_t device_address, uint8_t *data, uint16_t length, uint32_t timeout);
HAL_StatusTypeDef HAL_SPI_Transmit(SPI_HandleTypeDef *handle, uint8_t *data, uint16_t length, uint32_t timeout);
HAL_StatusTypeDef HAL_SPI_Receive(SPI_HandleTypeDef *handle, uint8_t *data, uint16_t length, uint32_t timeout);
HAL_StatusTypeDef HAL_ADC_Start(ADC_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_ADC_PollForConversion(ADC_HandleTypeDef *handle, uint32_t timeout);
uint32_t HAL_ADC_GetValue(ADC_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_ADC_Stop(ADC_HandleTypeDef *handle);
GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint16_t pin);
void HAL_GPIO_Init(GPIO_TypeDef *port, GPIO_InitTypeDef *configuration);
void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint16_t pin, GPIO_PinState state);
uint32_t HAL_GetTick(void);
void HAL_Delay(uint32_t milliseconds);
HAL_StatusTypeDef HAL_TIM_PWM_Start(TIM_HandleTypeDef *handle, uint32_t channel);
HAL_StatusTypeDef HAL_TIM_PWM_Stop(TIM_HandleTypeDef *handle, uint32_t channel);

#endif
"""


def project_files():
    manifest = json.loads((DRIVER_ROOT / "manifest.json").read_text(encoding="utf-8"))
    relative_paths = set(manifest["commonFiles"])
    for driver in manifest["drivers"]:
        relative_paths.update(driver["files"])
    relative_paths.add("Drivers/AliceSIM/Examples/oled_light_example.c")
    files = [(Path(path), (ROOT / path).read_text(encoding="utf-8")) for path in relative_paths]
    files.append((Path("Core/Inc/stm32f1xx_hal.h"), HAL_STUB))
    return files


class AliceSIMPeripheralDriverTests(unittest.TestCase):
    def test_manifest_matches_frontend_contract_and_files_exist(self) -> None:
        manifest = json.loads((DRIVER_ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(2, manifest["schemaVersion"])
        expected_ids = {
            "ssd1306", "light-sensor", "dht11", "hcsr04", "sg90", "buzzer", "tm1637",
            "bmp280", "mpu6050", "bh1750", "sht30", "ds3231", "pcf8574", "pca9685",
            "ina219", "ds18b20", "max7219", "w25qxx", "ws2812", "rotary-encoder",
            "potentiometer", "relay", "pir", "mq2", "joystick", "mosfet", "dc-dc-converter",
        }
        self.assertEqual(expected_ids, {item["id"] for item in manifest["drivers"]})
        self.assertEqual({"oled", "lightSensor", "dht11", "hcsr04", "sg90", "buzzer", "tm1637", "bmp280", "mpu6050", "bh1750", "sht30", "ds3231", "pcf8574", "pca9685", "ina219", "ds18b20", "max7219", "w25qxx", "ws2812", "rotaryEncoder", "potentiometer", "relay", "pir", "mq2", "joystick", "mosfet", "dcDcConverter"}, {
            component
            for driver in manifest["drivers"]
            for component in driver["componentTypes"]
        })
        for path in manifest["commonFiles"]:
            self.assertTrue((ROOT / path).is_file(), path)
        for driver in manifest["drivers"]:
            self.assertTrue(driver["name"])
            self.assertTrue(driver["description"])
            self.assertTrue(driver["attribution"])
            self.assertTrue(any(path.endswith(".h") for path in driver["files"]))
            self.assertTrue(any(path.endswith(".c") for path in driver["files"]))
            for path in driver["files"]:
                self.assertTrue((ROOT / path).is_file(), path)
        by_id = {driver["id"]: driver for driver in manifest["drivers"]}
        for driver_id in ("ssd1306", "dht11", "hcsr04", "tm1637"):
            self.assertEqual("libdriver 制作 · AliceSIM 适配", by_id[driver_id]["attribution"])
            self.assertEqual("MIT", by_id[driver_id]["upstream"]["license"])
            self.assertTrue(by_id[driver_id]["upstream"]["url"].startswith("https://github.com/libdriver/"))

    @unittest.skipUnless(server.CLANG_AVAILABLE, "Clang runtime is unavailable")
    def test_hal_drivers_and_example_are_warning_free(self) -> None:
        manifest = json.loads((DRIVER_ROOT / "manifest.json").read_text(encoding="utf-8"))
        targets = [Path(path) for driver in manifest["drivers"] for path in driver["files"] if path.endswith(".c")]
        targets.append(Path("Drivers/AliceSIM/Examples/oled_light_example.c"))
        result = server.clang_check_files(
            project_files(),
            targets,
            [Path("Core/Inc"), Path("Drivers/AliceSIM/Inc")],
            ["USE_HAL_DRIVER", "STM32F103xB"],
        )
        self.assertEqual([], result["diagnostics"], result["diagnostics"])

    @unittest.skipUnless(server.CLANG_AVAILABLE, "Clang runtime is unavailable")
    def test_ssd1306_draw_string_public_signature_and_size_t(self) -> None:
        probe = r"""
#include <stddef.h>
#include "alicesim_ssd1306.h"

typedef size_t (*AliceDrawStringSignature)(
  AliceSIM_SSD1306 *,
  uint16_t,
  uint16_t,
  const char *,
  uint8_t,
  AliceSIM_SSD1306_Color
);

static AliceDrawStringSignature draw_string_api = AliceSIM_SSD1306_DrawString;

size_t verify_draw_string_api(AliceSIM_SSD1306 *display) {
  _Static_assert(sizeof(size_t) >= sizeof(uint16_t), "size_t must be available in the public header");
  return draw_string_api(display, 0U, 0U, "AliceSIM", 1U, ALICESIM_SSD1306_COLOR_WHITE);
}
"""
        files = project_files() + [(Path("DriverApi/ssd1306_api_probe.c"), probe)]
        result = server.clang_check_files(
            files,
            [Path("Drivers/AliceSIM/Src/alicesim_ssd1306.c"), Path("DriverApi/ssd1306_api_probe.c")],
            [Path("Core/Inc"), Path("Drivers/AliceSIM/Inc")],
            ["USE_HAL_DRIVER", "STM32F103xB"],
        )
        self.assertEqual([], result["diagnostics"], result["diagnostics"])

    @unittest.skipUnless(server.CLANG_AVAILABLE, "Clang runtime is unavailable")
    def test_new_sensor_public_api_signatures(self) -> None:
        probe = r"""
#include "alicesim_dht11.h"
#include "alicesim_hcsr04.h"

typedef AliceSIM_DHT11_Status (*DhtInitSignature)(
  AliceSIM_DHT11 *, GPIO_TypeDef *, uint16_t, AliceSIM_DelayUsFn, AliceSIM_MicrosFn
);
typedef AliceSIM_DHT11_Status (*DhtReadSignature)(AliceSIM_DHT11 *, AliceSIM_DHT11_Sample *);
typedef AliceSIM_HCSR04_Status (*HcsrInitSignature)(
  AliceSIM_HCSR04 *, GPIO_TypeDef *, uint16_t, GPIO_TypeDef *, uint16_t,
  AliceSIM_DelayUsFn, AliceSIM_MicrosFn, uint32_t
);
typedef AliceSIM_HCSR04_Status (*HcsrMeasureMmSignature)(AliceSIM_HCSR04 *, uint32_t *);

static DhtInitSignature dht_init_api = AliceSIM_DHT11_Init;
static DhtReadSignature dht_read_api = AliceSIM_DHT11_Read;
static HcsrInitSignature hcsr_init_api = AliceSIM_HCSR04_Init;
static HcsrMeasureMmSignature hcsr_measure_api = AliceSIM_HCSR04_MeasureMm;

int32_t verify_sensor_api(
  AliceSIM_DHT11 *dht,
  AliceSIM_HCSR04 *hcsr,
  GPIO_TypeDef *port,
  AliceSIM_DelayUsFn delay_us,
  AliceSIM_MicrosFn micros
) {
  AliceSIM_DHT11_Sample climate = {0};
  uint32_t distance_mm = 0U;
  (void)dht_init_api(dht, port, 1U, delay_us, micros);
  (void)dht_read_api(dht, &climate);
  (void)hcsr_init_api(hcsr, port, 1U, port, 2U, delay_us, micros, 30000U);
  (void)hcsr_measure_api(hcsr, &distance_mm);
  return (int32_t)climate.temperature_x10 + (int32_t)climate.humidity_x10 + (int32_t)distance_mm;
}
"""
        files = project_files() + [(Path("DriverApi/sensor_api_probe.c"), probe)]
        result = server.clang_check_files(
            files,
            [
                Path("Drivers/AliceSIM/Src/alicesim_dht11.c"),
                Path("Drivers/AliceSIM/Src/alicesim_hcsr04.c"),
                Path("DriverApi/sensor_api_probe.c"),
            ],
            [Path("Core/Inc"), Path("Drivers/AliceSIM/Inc")],
            ["USE_HAL_DRIVER", "STM32F103xB"],
        )
        self.assertEqual([], result["diagnostics"], result["diagnostics"])

    def test_driver_sources_use_the_hal_operations_expected_by_alicesim(self) -> None:
        oled_source = (DRIVER_ROOT / "Src" / "alicesim_ssd1306.c").read_text(encoding="utf-8")
        light_source = (DRIVER_ROOT / "Src" / "alicesim_light_sensor.c").read_text(encoding="utf-8")
        self.assertIn("HAL_I2C_Mem_Write", oled_source)
        self.assertIn("ALICESIM_SSD1306_CONTROL_COMMAND", oled_source)
        self.assertIn("ALICESIM_SSD1306_CONTROL_DATA", oled_source)
        self.assertIn("HAL_ADC_Start", light_source)
        self.assertIn("HAL_ADC_PollForConversion", light_source)
        self.assertIn("HAL_ADC_GetValue", light_source)
        self.assertIn("HAL_GPIO_ReadPin", light_source)
        dht_source = (DRIVER_ROOT / "Src" / "alicesim_dht11.c").read_text(encoding="utf-8")
        hcsr_source = (DRIVER_ROOT / "Src" / "alicesim_hcsr04.c").read_text(encoding="utf-8")
        self.assertIn("AliceSIM_DHT11_Read", dht_source)
        self.assertIn("HAL_GPIO_ReadPin", dht_source)
        self.assertIn("AliceSIM_HCSR04_MeasureMm", hcsr_source)
        self.assertIn("HAL_GPIO_WritePin", hcsr_source)

    def test_high_level_driver_calls_are_lowered_to_simulation_operations(self) -> None:
        ioc = """\
Mcu.CPN=STM32F103C8T6
Mcu.Pin0=PB6
Mcu.Pin1=PB7
Mcu.Pin2=PA0-WKUP
Mcu.Pin3=PB0
PB6.Signal=I2C1_SCL
PB7.Signal=I2C1_SDA
PA0-WKUP.Signal=ADC1_IN0
PB0.Signal=GPIO_Input
"""
        main_h = """\
#include "stm32f1xx_hal.h"
#define LIGHT_DO_GPIO_Port GPIOB
#define LIGHT_DO_Pin GPIO_PIN_0
"""
        main_c = """\
#include "main.h"
#include "alicesim_peripherals.h"
I2C_HandleTypeDef hi2c1;
ADC_HandleTypeDef hadc1;
AliceSIM_SSD1306 display;
AliceSIM_LightSensor light;
uint32_t raw = 0;
uint32_t lux = 0;
uint32_t copied_lux = 0;
HAL_StatusTypeDef status;
int main(void) {
  hi2c1.Instance = I2C1;
  hadc1.Instance = ADC1;
  status = AliceSIM_SSD1306_Init(&display, &hi2c1, 0x3C, 100);
  AliceSIM_SSD1306_Clear(&display);
  AliceSIM_SSD1306_DrawString(&display, 2, 2, "LUX", 1, ALICESIM_SSD1306_COLOR_WHITE);
  AliceSIM_SSD1306_Update(&display);
  AliceSIM_LightSensor_Init(&light, &hadc1, LIGHT_DO_GPIO_Port, LIGHT_DO_Pin, 0, 3300, 12, 10);
  AliceSIM_LightSensor_ReadRaw(&light, &raw);
  AliceSIM_LightSensor_ReadLux(&light, &lux);
  AliceSIM_LightSensor_Sample sample;
  status = AliceSIM_LightSensor_Read(&light, &sample);
  copied_lux = sample.lux;
  while (1) { HAL_Delay(10); }
}
"""
        files = [
            (Path("DriverDemo.ioc"), ioc),
            (Path("Core/Inc/main.h"), main_h),
            (Path("Core/Src/main.c"), main_c),
            (Path("Drivers/AliceSIM/Inc/alicesim_ssd1306.h"), (DRIVER_ROOT / "Inc/alicesim_ssd1306.h").read_text(encoding="utf-8")),
            (Path("Drivers/AliceSIM/Inc/alicesim_light_sensor.h"), (DRIVER_ROOT / "Inc/alicesim_light_sensor.h").read_text(encoding="utf-8")),
            (Path("Drivers/AliceSIM/Inc/alicesim_peripherals.h"), (DRIVER_ROOT / "Inc/alicesim_peripherals.h").read_text(encoding="utf-8")),
        ]
        model = build_hal_model(files)
        operations = model["program"]["operations"]
        kinds = [operation["op"] for operation in operations]
        self.assertEqual(
            [
                "aliceOledInit",
                "aliceOledClear",
                "aliceOledDrawString",
                "aliceOledUpdate",
                "aliceLightInit",
                "aliceLightReadRaw",
                "aliceLightReadLux",
                "aliceLightRead",
                "assign",
                "while",
            ],
            kinds,
        )
        self.assertEqual("LUX", operations[2]["text"]["value"])
        self.assertEqual("PB0", operations[4]["digitalPin"])
        self.assertEqual("raw", operations[5]["target"])
        self.assertEqual("lux", operations[6]["target"])
        self.assertEqual("status", operations[0]["resultTarget"])
        self.assertEqual("status", operations[7]["resultTarget"])
        self.assertEqual("sample", operations[7]["target"])
        self.assertEqual(
            {"kind": "member", "object": {"kind": "variable", "name": "sample"}, "member": "lux", "pointer": False},
            operations[8]["value"],
        )


if __name__ == "__main__":
    unittest.main()
