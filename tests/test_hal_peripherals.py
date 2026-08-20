import json
from pathlib import Path
import unittest

from hal_model import build_hal_model


IOC = r"""\
#MicroXplorer Configuration settings - do not modify
Mcu.CPN=STM32F103C8T6
Mcu.Name=STM32F103C8Tx
Mcu.Pin0=PB6
Mcu.Pin1=PB7
Mcu.Pin2=PA0-WKUP
PB6.Mode=I2C
PB6.Signal=I2C1_SCL
PB7.Mode=I2C
PB7.Signal=I2C1_SDA
PA0-WKUP.Signal=ADC1_IN0
I2C1.ClockSpeed=100000
I2C1.DutyCycle=I2C_DUTYCYCLE_2
I2C1.AddressingMode=I2C_ADDRESSINGMODE_7BIT
ADC1.Channel-0\#ChannelRegularConversion=ADC_CHANNEL_0
ADC1.Rank-0\#ChannelRegularConversion=1
ADC1.SamplingTime-0\#ChannelRegularConversion=ADC_SAMPLETIME_55CYCLES_5
"""


MAIN_H = """\
#ifndef __MAIN_H
#define __MAIN_H
#include "stm32f1xx_hal.h"
#define OLED_ADDRESS (0x3CU << 1)
#define I2C_TIMEOUT_MS 100U
#define I2C_MEMADD_SIZE_8BIT 0x00000001U
#endif
"""


MAIN_C = """\
#include "main.h"

I2C_HandleTypeDef hi2c1;
ADC_HandleTypeDef hadc1;
uint8_t tx_data[2] = {0x00, 0xAF};

static void MX_I2C1_Init(void)
{
  hi2c1.Instance = I2C1;
  hi2c1.Init.ClockSpeed = 100000;
  hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
  hi2c1.Init.OwnAddress1 = 0;
  hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
  hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
  hi2c1.Init.OwnAddress2 = 0;
  hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
  hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
  HAL_I2C_Init(&hi2c1);
}

static void MX_ADC1_Init(void)
{
  hadc1.Instance = ADC1;
  HAL_ADC_Init(&hadc1);
}

int main(void)
{
  HAL_Init();
  MX_I2C1_Init();
  MX_ADC1_Init();
  HAL_I2C_Master_Transmit(&hi2c1, OLED_ADDRESS, tx_data, 2, I2C_TIMEOUT_MS);
  HAL_I2C_Mem_Write(&hi2c1, OLED_ADDRESS, 0x10U, I2C_MEMADD_SIZE_8BIT, tx_data, 2, HAL_MAX_DELAY);
  HAL_ADC_Start(&hadc1);
  HAL_ADC_PollForConversion(&hadc1, 50U);
  uint32_t sample = HAL_ADC_GetValue(&hadc1);
  while (1) {}
}
"""


def fixture_files():
    return [
        (Path("SensorBoard.ioc"), IOC),
        (Path("Core/Inc/main.h"), MAIN_H),
        (Path("Core/Src/main.c"), MAIN_C),
    ]


def walk_operations(operations):
    for operation in operations:
        yield operation
        if operation["op"] == "while":
            yield from walk_operations(operation["body"])
        elif operation["op"] == "if":
            yield from walk_operations(operation["then"])
            yield from walk_operations(operation["else"])


class HalPeripheralModelTests(unittest.TestCase):
    def test_timer_pwm_configuration_and_compare_updates_are_modeled(self) -> None:
        timer_ioc = """\
Mcu.CPN=STM32F103C8T6
Mcu.Pin0=PA0
PA0.Signal=TIM2_CH1
RCC.HCLKFreq_Value=72000000
RCC.APB1CLKDivider=RCC_HCLK_DIV2
RCC.APB1Freq_Value=36000000
TIM2.Prescaler=71
TIM2.Period=999
"""
        timer_source = """\
#include "main.h"
TIM_HandleTypeDef htim2;
TIM_OC_InitTypeDef sConfigOC;
static void MX_TIM2_Init(void)
{
  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 71;
  htim2.Init.Period = 999;
  sConfigOC.Pulse = 250;
  HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_1);
}
int main(void)
{
  MX_TIM2_Init();
  __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1, 500);
  HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1);
  while (1) {}
}
"""
        model = build_hal_model([
            (Path("Pwm.ioc"), timer_ioc),
            (Path("Core/Src/main.c"), timer_source),
        ])
        timer = model["timers"]["htim2"]
        self.assertEqual("TIM2", timer["instance"])
        self.assertEqual("PA0", timer["channels"][0]["pin"])
        self.assertEqual(250, timer["channels"][0]["pulse"])
        self.assertEqual(1000, timer["frequencyHz"])
        operations = list(walk_operations(model["program"]["operations"]))
        compare = next(item for item in operations if item["op"] == "pwmSetCompare")
        start = next(item for item in operations if item["op"] == "pwmStart")
        self.assertEqual(1, compare["channel"])
        self.assertEqual("PA0", start["pin"])
        self.assertEqual(999, start["period"])

    def test_spi_ioc_pins_and_hal_transmit_are_modeled(self) -> None:
        spi_ioc = """\
Mcu.CPN=STM32F103C8T6
Mcu.Pin0=PA5
Mcu.Pin1=PA7
PA5.Signal=SPI1_SCK
PA7.Signal=SPI1_MOSI
SPI1.Mode=SPI_MODE_MASTER
SPI1.Direction=SPI_DIRECTION_2LINES
SPI1.DataSize=SPI_DATASIZE_8BIT
SPI1.CLKPolarity=SPI_POLARITY_LOW
SPI1.CLKPhase=SPI_PHASE_1EDGE
SPI1.BaudRatePrescaler=SPI_BAUDRATEPRESCALER_8
SPI1.FirstBit=SPI_FIRSTBIT_MSB
"""
        spi_source = """\
#include "main.h"
SPI_HandleTypeDef hspi1;
uint8_t pixels[4] = {0xF8, 0x00, 0x07, 0xE0};
int main(void)
{
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
  HAL_SPI_Transmit(&hspi1, pixels, 4, 100U);
  while (1) {}
}
"""
        model = build_hal_model([
            (Path("SpiScreen.ioc"), spi_ioc),
            (Path("Core/Src/main.c"), spi_source),
        ])
        spi = model["spis"]["hspi1"]
        self.assertEqual("SPI1", spi["instance"])
        self.assertEqual("PA5", spi["sckPin"])
        self.assertEqual("PA7", spi["mosiPin"])
        operations = list(walk_operations(model["program"]["operations"]))
        transmit = next(item for item in operations if item["op"] == "spiTransmit")
        self.assertEqual("hspi1", transmit["spi"])
        self.assertEqual("SPI1", transmit["instance"])
        self.assertEqual("pixels", transmit["buffer"])
        self.assertEqual(4, transmit["length"])
        self.assertEqual(1, len(spi["transmitCalls"]))
        self.assertEqual([0xF8, 0x00, 0x07, 0xE0], model["variables"]["pixels"])

    def test_i2c_ioc_pins_configuration_and_calls(self) -> None:
        model = build_hal_model(fixture_files())
        i2c = model["i2cs"]["hi2c1"]

        self.assertEqual("I2C1", i2c["instance"])
        self.assertEqual("PB6", i2c["sclPin"])
        self.assertEqual("PB7", i2c["sdaPin"])
        self.assertEqual(100000, i2c["clockSpeed"])
        self.assertEqual("I2C_DUTYCYCLE_2", i2c["dutyCycle"])
        self.assertEqual(7, i2c["addressBits"])

        operations = list(walk_operations(model["program"]["operations"]))
        transmit = next(item for item in operations if item["op"] == "i2cMasterTransmit")
        self.assertEqual("hi2c1", transmit["i2c"])
        self.assertEqual("I2C1", transmit["instance"])
        self.assertEqual({"kind": "constant", "name": "OLED_ADDRESS", "value": 120}, transmit["deviceAddress"])
        self.assertEqual("tx_data", transmit["buffer"])
        self.assertEqual(2, transmit["length"])
        self.assertEqual("I2C_TIMEOUT_MS", transmit["timeout"])
        self.assertTrue(transmit["blocking"])

        memory_write = next(item for item in operations if item["op"] == "i2cMemWrite")
        self.assertEqual({"kind": "literal", "value": 16}, memory_write["memoryAddress"])
        self.assertEqual(
            {"kind": "constant", "name": "I2C_MEMADD_SIZE_8BIT", "value": 1},
            memory_write["memoryAddressSize"],
        )
        self.assertEqual(1, len(i2c["masterTransmitCalls"]))
        self.assertEqual(1, len(i2c["memWriteCalls"]))
        self.assertEqual([0x00, 0xAF], model["variables"]["tx_data"])
        self.assertFalse([item for item in model["diagnostics"] if item["severity"] == "error"])

    def test_adc_ioc_channel_and_hal_sequence(self) -> None:
        model = build_hal_model(fixture_files())
        adc = model["adcs"]["hadc1"]

        self.assertEqual("ADC1", adc["instance"])
        self.assertEqual(
            [{
                "channel": "ADC_CHANNEL_0",
                "channelNumber": 0,
                "pin": "PA0",
                "rank": 1,
                "slot": 0,
                "samplingTime": "ADC_SAMPLETIME_55CYCLES_5",
            }],
            adc["channels"],
        )

        operations = list(walk_operations(model["program"]["operations"]))
        start = next(item for item in operations if item["op"] == "adcStart")
        poll = next(item for item in operations if item["op"] == "adcPollForConversion")
        read = next(item for item in operations if item["op"] == "adcGetValue")
        self.assertEqual(("hadc1", "ADC1"), (start["adc"], start["instance"]))
        self.assertEqual("50U", poll["timeout"])
        self.assertTrue(poll["blocking"])
        self.assertEqual("sample", read["target"])
        self.assertEqual(1, len(adc["startCalls"]))
        self.assertEqual(1, len(adc["pollCalls"]))
        self.assertEqual("sample", adc["getValueCalls"][0]["target"])
        json.dumps(model)


if __name__ == "__main__":
    unittest.main()
