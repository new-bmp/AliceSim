#ifndef ALICESIM_JOYSTICK_H
#define ALICESIM_JOYSTICK_H

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
  uint32_t x_raw;
  uint32_t y_raw;
  uint8_t pressed;
} AliceSIM_Joystick_Sample;

typedef struct {
  ADC_HandleTypeDef *x_adc;
  ADC_HandleTypeDef *y_adc;
  GPIO_TypeDef *switch_port;
  uint16_t switch_pin;
  uint8_t switch_active_low;
  uint32_t timeout_ms;
} AliceSIM_Joystick;

HAL_StatusTypeDef AliceSIM_Joystick_Init(AliceSIM_Joystick *joystick, ADC_HandleTypeDef *x_adc, ADC_HandleTypeDef *y_adc, GPIO_TypeDef *switch_port, uint16_t switch_pin, uint8_t switch_active_low, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_Joystick_Read(AliceSIM_Joystick *joystick, AliceSIM_Joystick_Sample *sample);

#ifdef __cplusplus
}
#endif

#endif
