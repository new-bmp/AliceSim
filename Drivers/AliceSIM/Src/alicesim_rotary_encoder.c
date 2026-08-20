#include "alicesim_rotary_encoder.h"

static uint8_t alice_rotary_phase(const AliceSIM_RotaryEncoder *encoder) {
  uint8_t a = HAL_GPIO_ReadPin(encoder->a_port, encoder->a_pin) == GPIO_PIN_SET ? 1U : 0U;
  uint8_t b = HAL_GPIO_ReadPin(encoder->b_port, encoder->b_pin) == GPIO_PIN_SET ? 1U : 0U;
  return (uint8_t)((a << 1U) | b);
}

HAL_StatusTypeDef AliceSIM_RotaryEncoder_Init(AliceSIM_RotaryEncoder *encoder, GPIO_TypeDef *a_port, uint16_t a_pin, GPIO_TypeDef *b_port, uint16_t b_pin, GPIO_TypeDef *switch_port, uint16_t switch_pin) {
  if (encoder == NULL || a_port == NULL || b_port == NULL) return HAL_ERROR;
  encoder->a_port = a_port;
  encoder->a_pin = a_pin;
  encoder->b_port = b_port;
  encoder->b_pin = b_pin;
  encoder->switch_port = switch_port;
  encoder->switch_pin = switch_pin;
  encoder->position = 0;
  encoder->last_phase = alice_rotary_phase(encoder);
  return HAL_OK;
}

int8_t AliceSIM_RotaryEncoder_Update(AliceSIM_RotaryEncoder *encoder) {
  static const int8_t transitions[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
  uint8_t phase;
  int8_t delta;
  if (encoder == NULL || encoder->a_port == NULL || encoder->b_port == NULL) return 0;
  phase = alice_rotary_phase(encoder);
  delta = transitions[(uint8_t)((encoder->last_phase << 2U) | phase)];
  encoder->last_phase = phase;
  encoder->position += delta;
  return delta;
}

GPIO_PinState AliceSIM_RotaryEncoder_ReadSwitch(const AliceSIM_RotaryEncoder *encoder) {
  if (encoder == NULL || encoder->switch_port == NULL) return GPIO_PIN_SET;
  return HAL_GPIO_ReadPin(encoder->switch_port, encoder->switch_pin);
}
