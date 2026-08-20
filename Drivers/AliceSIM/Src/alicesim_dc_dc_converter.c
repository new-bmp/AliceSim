#include "alicesim_dc_dc_converter.h"

static HAL_StatusTypeDef AliceSIM_DCDCConverter_WriteEnable(AliceSIM_DCDCConverter *device, uint8_t enabled) {
  GPIO_PinState state;
  if (device == NULL) return HAL_ERROR;
  device->enabled = enabled != 0U ? 1U : 0U;
  if (device->enable_port == NULL) return HAL_OK;
  state = device->enabled != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET;
  if (device->enable_active_high == 0U) state = state == GPIO_PIN_SET ? GPIO_PIN_RESET : GPIO_PIN_SET;
  HAL_GPIO_WritePin(device->enable_port, device->enable_pin, state);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_DCDCConverter_Init(AliceSIM_DCDCConverter *device, GPIO_TypeDef *enable_port, uint16_t enable_pin, uint8_t enable_active_high, uint16_t output_millivolts, uint16_t max_output_milliamps, uint8_t efficiency_percent) {
  if (device == NULL || output_millivolts == 0U || max_output_milliamps == 0U) return HAL_ERROR;
  device->enable_port = enable_port;
  device->enable_pin = enable_pin;
  device->enable_active_high = enable_active_high != 0U ? 1U : 0U;
  device->output_millivolts = output_millivolts;
  device->max_output_milliamps = max_output_milliamps;
  device->efficiency_percent = efficiency_percent < 1U ? 1U : (efficiency_percent > 100U ? 100U : efficiency_percent);
  device->output_current_milliamps = 0U;
  device->overloaded = 0U;
  return AliceSIM_DCDCConverter_WriteEnable(device, 0U);
}

HAL_StatusTypeDef AliceSIM_DCDCConverter_Enable(AliceSIM_DCDCConverter *device) { return AliceSIM_DCDCConverter_WriteEnable(device, 1U); }
HAL_StatusTypeDef AliceSIM_DCDCConverter_Disable(AliceSIM_DCDCConverter *device) { return AliceSIM_DCDCConverter_WriteEnable(device, 0U); }

HAL_StatusTypeDef AliceSIM_DCDCConverter_SetOutputMillivolts(AliceSIM_DCDCConverter *device, uint16_t output_millivolts) {
  if (device == NULL || output_millivolts == 0U) return HAL_ERROR;
  device->output_millivolts = output_millivolts;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_DCDCConverter_SetSimulatedLoad(AliceSIM_DCDCConverter *device, uint16_t output_current_milliamps) {
  if (device == NULL) return HAL_ERROR;
  device->output_current_milliamps = output_current_milliamps;
  device->overloaded = output_current_milliamps > device->max_output_milliamps ? 1U : 0U;
  return device->overloaded != 0U ? HAL_ERROR : HAL_OK;
}

AliceSIM_DCDCConverterPowerStatus AliceSIM_DCDCConverter_GetPowerStatus(const AliceSIM_DCDCConverter *device) {
  AliceSIM_DCDCConverterPowerStatus status = {0U, 0U, 0U, 0U, 0U, 0U, 0U};
  if (device == NULL) return status;
  status.enabled = device->enabled;
  status.overloaded = device->overloaded;
  status.output_millivolts = device->output_millivolts;
  status.output_current_milliamps = device->output_current_milliamps;
  status.max_output_milliamps = device->max_output_milliamps;
  status.output_milliwatts = ((uint32_t)device->output_millivolts * (uint32_t)device->output_current_milliamps) / 1000U;
  status.efficiency_percent = device->efficiency_percent;
  return status;
}
