#ifndef ALICESIM_PIR_H
#define ALICESIM_PIR_H

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
  uint8_t active_high;
} AliceSIM_PIR;

HAL_StatusTypeDef AliceSIM_PIR_Init(AliceSIM_PIR *sensor, GPIO_TypeDef *port, uint16_t pin, uint8_t active_high);
uint8_t AliceSIM_PIR_MotionDetected(const AliceSIM_PIR *sensor);

#ifdef __cplusplus
}
#endif

#endif
