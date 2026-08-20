#include "alicesim_joystick.h"

static HAL_StatusTypeDef alice_joystick_read_adc(ADC_HandleTypeDef *adc, uint32_t timeout_ms, uint32_t *raw) {
  HAL_StatusTypeDef status;
  if (adc == NULL || raw == NULL) return HAL_ERROR;
  status = HAL_ADC_Start(adc);
  if (status == HAL_OK) status = HAL_ADC_PollForConversion(adc, timeout_ms);
  if (status == HAL_OK) *raw = HAL_ADC_GetValue(adc);
  (void)HAL_ADC_Stop(adc);
  return status;
}

HAL_StatusTypeDef AliceSIM_Joystick_Init(AliceSIM_Joystick *joystick, ADC_HandleTypeDef *x_adc, ADC_HandleTypeDef *y_adc, GPIO_TypeDef *switch_port, uint16_t switch_pin, uint8_t switch_active_low, uint32_t timeout_ms) {
  if (joystick == NULL || x_adc == NULL || y_adc == NULL) return HAL_ERROR;
  joystick->x_adc = x_adc;
  joystick->y_adc = y_adc;
  joystick->switch_port = switch_port;
  joystick->switch_pin = switch_pin;
  joystick->switch_active_low = switch_active_low != 0U ? 1U : 0U;
  joystick->timeout_ms = timeout_ms == 0U ? 10U : timeout_ms;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_Joystick_Read(AliceSIM_Joystick *joystick, AliceSIM_Joystick_Sample *sample) {
  HAL_StatusTypeDef status;
  uint8_t high;
  if (joystick == NULL || sample == NULL) return HAL_ERROR;
  status = alice_joystick_read_adc(joystick->x_adc, joystick->timeout_ms, &sample->x_raw);
  if (status != HAL_OK) return status;
  status = alice_joystick_read_adc(joystick->y_adc, joystick->timeout_ms, &sample->y_raw);
  if (status != HAL_OK) return status;
  high = joystick->switch_port != NULL && HAL_GPIO_ReadPin(joystick->switch_port, joystick->switch_pin) == GPIO_PIN_SET ? 1U : 0U;
  sample->pressed = joystick->switch_active_low != 0U ? (uint8_t)(high == 0U) : high;
  return HAL_OK;
}
