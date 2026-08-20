#include "alicesim_pir.h"

HAL_StatusTypeDef AliceSIM_PIR_Init(AliceSIM_PIR *sensor, GPIO_TypeDef *port, uint16_t pin, uint8_t active_high) {
  if (sensor == NULL || port == NULL) return HAL_ERROR;
  sensor->port = port;
  sensor->pin = pin;
  sensor->active_high = active_high != 0U ? 1U : 0U;
  return HAL_OK;
}

uint8_t AliceSIM_PIR_MotionDetected(const AliceSIM_PIR *sensor) {
  uint8_t high;
  if (sensor == NULL || sensor->port == NULL) return 0U;
  high = HAL_GPIO_ReadPin(sensor->port, sensor->pin) == GPIO_PIN_SET ? 1U : 0U;
  return sensor->active_high != 0U ? high : (uint8_t)(high == 0U);
}
