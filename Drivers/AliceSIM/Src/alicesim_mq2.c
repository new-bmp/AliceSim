#include "alicesim_mq2.h"

HAL_StatusTypeDef AliceSIM_MQ2_Init(AliceSIM_MQ2 *sensor, ADC_HandleTypeDef *adc, GPIO_TypeDef *digital_port, uint16_t digital_pin, uint32_t reference_mv, uint8_t resolution_bits, uint8_t digital_active_low, uint32_t timeout_ms) {
  if (sensor == NULL || adc == NULL || resolution_bits == 0U || resolution_bits > 16U) return HAL_ERROR;
  sensor->adc = adc;
  sensor->digital_port = digital_port;
  sensor->digital_pin = digital_pin;
  sensor->reference_mv = reference_mv == 0U ? 3300U : reference_mv;
  sensor->resolution_bits = resolution_bits;
  sensor->digital_active_low = digital_active_low != 0U ? 1U : 0U;
  sensor->timeout_ms = timeout_ms == 0U ? 10U : timeout_ms;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_MQ2_ReadRaw(AliceSIM_MQ2 *sensor, uint32_t *raw) {
  HAL_StatusTypeDef status;
  if (sensor == NULL || sensor->adc == NULL || raw == NULL) return HAL_ERROR;
  status = HAL_ADC_Start(sensor->adc);
  if (status == HAL_OK) status = HAL_ADC_PollForConversion(sensor->adc, sensor->timeout_ms);
  if (status == HAL_OK) *raw = HAL_ADC_GetValue(sensor->adc);
  (void)HAL_ADC_Stop(sensor->adc);
  return status;
}

HAL_StatusTypeDef AliceSIM_MQ2_ReadMillivolts(AliceSIM_MQ2 *sensor, uint32_t *millivolts) {
  uint32_t raw;
  uint32_t maximum;
  HAL_StatusTypeDef status;
  if (sensor == NULL || millivolts == NULL) return HAL_ERROR;
  status = AliceSIM_MQ2_ReadRaw(sensor, &raw);
  maximum = ((uint32_t)1U << sensor->resolution_bits) - 1U;
  if (status == HAL_OK) *millivolts = (raw * sensor->reference_mv + maximum / 2U) / maximum;
  return status;
}

uint8_t AliceSIM_MQ2_ThresholdTriggered(const AliceSIM_MQ2 *sensor) {
  uint8_t high;
  if (sensor == NULL || sensor->digital_port == NULL) return 0U;
  high = HAL_GPIO_ReadPin(sensor->digital_port, sensor->digital_pin) == GPIO_PIN_SET ? 1U : 0U;
  return sensor->digital_active_low != 0U ? (uint8_t)(high == 0U) : high;
}
