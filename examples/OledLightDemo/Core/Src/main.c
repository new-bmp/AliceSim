#include "main.h"

I2C_HandleTypeDef hi2c1;
ADC_HandleTypeDef hadc1;

uint8_t oled_on[1] = {0xAF};
uint8_t oled_pixels[16] = {
  0xFF, 0x81, 0xBD, 0xA5, 0xA5, 0xBD, 0x81, 0xFF,
  0x00, 0x7E, 0x42, 0x5A, 0x5A, 0x42, 0x7E, 0x00
};
uint32_t light_adc = 0;

static void MX_I2C1_Init(void)
{
  hi2c1.Instance = I2C1;
  hi2c1.Init.ClockSpeed = 100000;
  hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
  hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
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

  HAL_I2C_Mem_Write(&hi2c1, OLED_ADDRESS, OLED_CONTROL_COMMAND, 1, oled_on, 1, HAL_MAX_DELAY);
  HAL_I2C_Mem_Write(&hi2c1, OLED_ADDRESS, OLED_CONTROL_DATA, 1, oled_pixels, 16, HAL_MAX_DELAY);

  while (1)
  {
    HAL_ADC_Start(&hadc1);
    HAL_ADC_PollForConversion(&hadc1, 10);
    light_adc = HAL_ADC_GetValue(&hadc1);
    HAL_Delay(100);
  }
}
