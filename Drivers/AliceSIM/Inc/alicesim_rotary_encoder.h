#ifndef ALICESIM_ROTARY_ENCODER_H
#define ALICESIM_ROTARY_ENCODER_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

typedef struct {
  GPIO_TypeDef *a_port;
  uint16_t a_pin;
  GPIO_TypeDef *b_port;
  uint16_t b_pin;
  GPIO_TypeDef *switch_port;
  uint16_t switch_pin;
  uint8_t last_phase;
  int32_t position;
} AliceSIM_RotaryEncoder;

HAL_StatusTypeDef AliceSIM_RotaryEncoder_Init(AliceSIM_RotaryEncoder *encoder, GPIO_TypeDef *a_port, uint16_t a_pin, GPIO_TypeDef *b_port, uint16_t b_pin, GPIO_TypeDef *switch_port, uint16_t switch_pin);
int8_t AliceSIM_RotaryEncoder_Update(AliceSIM_RotaryEncoder *encoder);
GPIO_PinState AliceSIM_RotaryEncoder_ReadSwitch(const AliceSIM_RotaryEncoder *encoder);

#ifdef __cplusplus
}
#endif

#endif
