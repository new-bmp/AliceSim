#ifndef ALICESIM_RELAY_H
#define ALICESIM_RELAY_H

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
  GPIO_TypeDef *port;
  uint16_t pin;
  uint8_t active_low;
  uint8_t energized;
} AliceSIM_Relay;

HAL_StatusTypeDef AliceSIM_Relay_Init(AliceSIM_Relay *relay, GPIO_TypeDef *port, uint16_t pin, uint8_t active_low);
HAL_StatusTypeDef AliceSIM_Relay_Set(AliceSIM_Relay *relay, uint8_t energized);
HAL_StatusTypeDef AliceSIM_Relay_Toggle(AliceSIM_Relay *relay);
uint8_t AliceSIM_Relay_IsEnergized(const AliceSIM_Relay *relay);

#ifdef __cplusplus
}
#endif

#endif
