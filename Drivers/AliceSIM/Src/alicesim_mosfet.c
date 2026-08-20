#include "alicesim_mosfet.h"

HAL_StatusTypeDef AliceSIM_MOSFET_Set(AliceSIM_MOSFET *device, uint8_t on) {
  GPIO_PinState state;
  if (device == NULL || device->gate_port == NULL) return HAL_ERROR;
  device->gate_on = on != 0U ? 1U : 0U;
  state = device->gate_on != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET;
  if (device->active_high == 0U) state = state == GPIO_PIN_SET ? GPIO_PIN_RESET : GPIO_PIN_SET;
  HAL_GPIO_WritePin(device->gate_port, device->gate_pin, state);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_MOSFET_Init(AliceSIM_MOSFET *device, GPIO_TypeDef *gate_port, uint16_t gate_pin, uint8_t active_high) {
  if (device == NULL || gate_port == NULL) return HAL_ERROR;
  device->gate_port = gate_port;
  device->gate_pin = gate_pin;
  device->active_high = active_high != 0U ? 1U : 0U;
  device->gate_on = 0U;
  return AliceSIM_MOSFET_Set(device, 0U);
}

HAL_StatusTypeDef AliceSIM_MOSFET_Toggle(AliceSIM_MOSFET *device) {
  if (device == NULL) return HAL_ERROR;
  return AliceSIM_MOSFET_Set(device, device->gate_on == 0U ? 1U : 0U);
}

uint8_t AliceSIM_MOSFET_IsOn(const AliceSIM_MOSFET *device) {
  return device == NULL ? 0U : device->gate_on;
}
