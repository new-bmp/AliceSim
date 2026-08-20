#include "alicesim_peripherals.h"

static AliceSIM_SSD1306 alice_display;
static AliceSIM_LightSensor alice_light;

HAL_StatusTypeDef AliceSIM_PeripheralExample_Init(
  I2C_HandleTypeDef *i2c,
  ADC_HandleTypeDef *adc,
  GPIO_TypeDef *light_do_port,
  uint16_t light_do_pin
) {
  HAL_StatusTypeDef status;
  status = AliceSIM_SSD1306_Init(
    &alice_display,
    i2c,
    ALICESIM_SSD1306_DEFAULT_ADDRESS,
    100U
  );
  if (status != HAL_OK) return status;
  return AliceSIM_LightSensor_Init(
    &alice_light,
    adc,
    light_do_port,
    light_do_pin,
    0U,
    3300U,
    12U,
    10U
  );
}

HAL_StatusTypeDef AliceSIM_PeripheralExample_Tick(AliceSIM_LightSensor_Sample *sample) {
  HAL_StatusTypeDef status;
  uint16_t bar_width;
  uint16_t x;
  if (sample == NULL) return HAL_ERROR;
  status = AliceSIM_LightSensor_Read(&alice_light, sample);
  if (status != HAL_OK) return status;

  AliceSIM_SSD1306_Clear(&alice_display);
  (void)AliceSIM_SSD1306_DrawString(
    &alice_display,
    3U,
    3U,
    "LIGHT SENSOR",
    1U,
    ALICESIM_SSD1306_COLOR_WHITE
  );
  AliceSIM_SSD1306_DrawRectangle(
    &alice_display,
    3U,
    20U,
    122U,
    14U,
    ALICESIM_SSD1306_COLOR_WHITE
  );
  bar_width = (uint16_t)(((uint32_t)sample->percent_x100 * 118U) / 10000U);
  for (x = 0U; x < bar_width; x += 1U) {
    AliceSIM_SSD1306_DrawVerticalLine(
      &alice_display,
      (uint16_t)(5U + x),
      22U,
      10U,
      ALICESIM_SSD1306_COLOR_WHITE
    );
  }
  return AliceSIM_SSD1306_Update(&alice_display);
}
