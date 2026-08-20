#include "alicesim_potentiometer.h"

static uint32_t alice_potentiometer_maximum(const AliceSIM_Potentiometer *device) {
  return ((uint32_t)1U << device->resolution_bits) - 1U;
}

HAL_StatusTypeDef AliceSIM_Potentiometer_Init(AliceSIM_Potentiometer *device, ADC_HandleTypeDef *adc, uint32_t reference_mv, uint8_t resolution_bits, uint32_t timeout_ms) {
  if (device == NULL || adc == NULL || resolution_bits == 0U || resolution_bits > 16U) return HAL_ERROR;
  device->adc = adc;
  device->reference_mv = reference_mv == 0U ? 3300U : reference_mv;
  device->resolution_bits = resolution_bits;
  device->timeout_ms = timeout_ms == 0U ? 10U : timeout_ms;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_Potentiometer_ReadRaw(AliceSIM_Potentiometer *device, uint32_t *raw) {
  HAL_StatusTypeDef status;
  if (device == NULL || device->adc == NULL || raw == NULL) return HAL_ERROR;
  status = HAL_ADC_Start(device->adc);
  if (status == HAL_OK) status = HAL_ADC_PollForConversion(device->adc, device->timeout_ms);
  if (status == HAL_OK) *raw = HAL_ADC_GetValue(device->adc);
  (void)HAL_ADC_Stop(device->adc);
  return status;
}

HAL_StatusTypeDef AliceSIM_Potentiometer_ReadMillivolts(AliceSIM_Potentiometer *device, uint32_t *millivolts) {
  uint32_t raw;
  HAL_StatusTypeDef status;
  if (device == NULL || millivolts == NULL) return HAL_ERROR;
  status = AliceSIM_Potentiometer_ReadRaw(device, &raw);
  if (status == HAL_OK) *millivolts = (raw * device->reference_mv + alice_potentiometer_maximum(device) / 2U) / alice_potentiometer_maximum(device);
  return status;
}

HAL_StatusTypeDef AliceSIM_Potentiometer_ReadPercentX10(AliceSIM_Potentiometer *device, uint16_t *percent_x10) {
  uint32_t raw;
  uint32_t maximum;
  HAL_StatusTypeDef status;
  if (device == NULL || percent_x10 == NULL) return HAL_ERROR;
  status = AliceSIM_Potentiometer_ReadRaw(device, &raw);
  maximum = alice_potentiometer_maximum(device);
  if (status == HAL_OK) *percent_x10 = (uint16_t)((raw * 1000U + maximum / 2U) / maximum);
  return status;
}
