"""Execute the driver's actual init statements in Clang's constant evaluator."""
from pathlib import Path
import unittest

import server

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(server.CLANG_AVAILABLE, "Clang runtime is unavailable")
class Ina219CalibrationTests(unittest.TestCase):
    def test_init_calibrates_default_100_milliohm_shunt_and_propagates_hal_errors(self):
        source = (ROOT / "Drivers/AliceSIM/Src/alicesim_ina219.c").read_text(encoding="utf-8")
        start = source.index("HAL_StatusTypeDef AliceSIM_INA219_Init(")
        opening = source.index("{", start)
        depth = 1
        end = opening + 1
        while depth:
            depth += (source[end] == "{") - (source[end] == "}")
            end += 1
        # Only add constexpr: the initialization statements are the shipped C.
        init = "constexpr " + source[start:end]
        header = (ROOT / "Drivers/AliceSIM/Inc/alicesim_ina219.h").read_text(encoding="utf-8")
        public_defines = "\n".join(line for line in header.splitlines() if line.startswith("#define ALICESIM_INA219_DEFAULT_"))
        probe = r"""
typedef unsigned short uint16_t;
typedef unsigned int uint32_t;
typedef int HAL_StatusTypeDef;
enum { HAL_OK = 0, HAL_ERROR = 1, HAL_TIMEOUT = 3 };
#define NULL 0
PUBLIC_DRIVER_DEFINES
struct I2C_HandleTypeDef { uint16_t config; uint16_t calibration; unsigned calls; int fail_register; };
struct AliceSIM_INA219 { I2C_HandleTypeDef *i2c; uint16_t address; uint32_t timeout_ms; uint32_t current_lsb_ua; };
constexpr HAL_StatusTypeDef AliceSIM_INA219_WriteRegister(AliceSIM_INA219 *device, unsigned reg, uint16_t value) {
  device->i2c->calls += 1;
  if (device->i2c->fail_register == (int)reg) return HAL_TIMEOUT;
  if (reg == 0) device->i2c->config = value;
  if (reg == 5) device->i2c->calibration = value;
  return HAL_OK;
}
""".replace("PUBLIC_DRIVER_DEFINES", public_defines) + init + r"""
constexpr bool initializes(unsigned lsb, unsigned calibration) {
  I2C_HandleTypeDef handle = {0, 0, 0, -1}; AliceSIM_INA219 device = {};
  return AliceSIM_INA219_Init(&device, &handle, 0, 0, lsb) == HAL_OK
    && handle.config == 0x399f && handle.calibration == calibration && handle.calls == 2
    && device.address == 0x40 && device.timeout_ms == 100 && device.current_lsb_ua == lsb;
}
constexpr bool rejects(unsigned lsb) {
  I2C_HandleTypeDef handle = {0, 0, 0, -1}; AliceSIM_INA219 device = {};
  return AliceSIM_INA219_Init(&device, &handle, 0, 0, lsb) == HAL_ERROR && handle.calls == 0;
}
constexpr bool propagates(int failing_register, unsigned calls) {
  I2C_HandleTypeDef handle = {0, 0, 0, failing_register}; AliceSIM_INA219 device = {};
  return AliceSIM_INA219_Init(&device, &handle, 0, 0, 100) == HAL_TIMEOUT && handle.calls == calls;
}
static_assert(initializes(100, 4096), "100 uA LSB must calibrate 0.1 ohm shunt");
static_assert(initializes(10, 40960), "10 uA LSB must calibrate 0.1 ohm shunt");
static_assert(initializes(7, 58514), "Calibration divides with integer truncation");
static_assert(rejects(0), "Zero LSB must be rejected before I2C traffic");
static_assert(rejects(1), "Overflowing calibration must be rejected before I2C traffic");
static_assert(rejects(500000), "Underflowing calibration must be rejected before I2C traffic");
static_assert(propagates(0, 1), "Config failure must propagate without calibration write");
static_assert(propagates(5, 2), "Calibration failure must propagate");
"""
        with server.CLANG_LOCK:
            unit = server.clang_index.parse(
                "ina219_calibration_probe.cpp", args=["-std=c++17", "-nostdinc", "-fsyntax-only"],
                unsaved_files=[("ina219_calibration_probe.cpp", probe)],
            )
        errors = [str(item) for item in unit.diagnostics if item.severity >= server.clang_cindex.Diagnostic.Error]
        self.assertEqual([], errors, "\n".join(errors))


if __name__ == "__main__":
    unittest.main()
