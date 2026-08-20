#ifndef ALICESIM_MOSFET_H
#define ALICESIM_MOSFET_H

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
  GPIO_TypeDef *gate_port;
  uint16_t gate_pin;
  uint8_t active_high;
  uint8_t gate_on;
} AliceSIM_MOSFET;

HAL_StatusTypeDef AliceSIM_MOSFET_Init(AliceSIM_MOSFET *device, GPIO_TypeDef *gate_port, uint16_t gate_pin, uint8_t active_high);
HAL_StatusTypeDef AliceSIM_MOSFET_Set(AliceSIM_MOSFET *device, uint8_t on);
HAL_StatusTypeDef AliceSIM_MOSFET_Toggle(AliceSIM_MOSFET *device);
uint8_t AliceSIM_MOSFET_IsOn(const AliceSIM_MOSFET *device);

#ifdef __cplusplus
}
#endif

#endif
