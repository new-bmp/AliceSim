#include "alicesim_relay.h"

HAL_StatusTypeDef AliceSIM_Relay_Set(AliceSIM_Relay *relay, uint8_t energized) {
  GPIO_PinState output;
  if (relay == NULL || relay->port == NULL) return HAL_ERROR;
  relay->energized = energized != 0U ? 1U : 0U;
  output = relay->energized != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET;
  if (relay->active_low != 0U) output = output == GPIO_PIN_SET ? GPIO_PIN_RESET : GPIO_PIN_SET;
  HAL_GPIO_WritePin(relay->port, relay->pin, output);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_Relay_Init(AliceSIM_Relay *relay, GPIO_TypeDef *port, uint16_t pin, uint8_t active_low) {
  if (relay == NULL || port == NULL) return HAL_ERROR;
  relay->port = port;
  relay->pin = pin;
  relay->active_low = active_low != 0U ? 1U : 0U;
  relay->energized = 0U;
  return AliceSIM_Relay_Set(relay, 0U);
}

HAL_StatusTypeDef AliceSIM_Relay_Toggle(AliceSIM_Relay *relay) {
  if (relay == NULL) return HAL_ERROR;
  return AliceSIM_Relay_Set(relay, relay->energized == 0U ? 1U : 0U);
}

uint8_t AliceSIM_Relay_IsEnergized(const AliceSIM_Relay *relay) {
  return relay == NULL ? 0U : relay->energized;
}
