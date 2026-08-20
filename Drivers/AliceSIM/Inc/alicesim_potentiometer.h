#ifndef ALICESIM_POTENTIOMETER_H
#define ALICESIM_POTENTIOMETER_H

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
  ADC_HandleTypeDef *adc;
  uint32_t reference_mv;
  uint8_t resolution_bits;
  uint32_t timeout_ms;
} AliceSIM_Potentiometer;

HAL_StatusTypeDef AliceSIM_Potentiometer_Init(AliceSIM_Potentiometer *device, ADC_HandleTypeDef *adc, uint32_t reference_mv, uint8_t resolution_bits, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_Potentiometer_ReadRaw(AliceSIM_Potentiometer *device, uint32_t *raw);
HAL_StatusTypeDef AliceSIM_Potentiometer_ReadMillivolts(AliceSIM_Potentiometer *device, uint32_t *millivolts);
HAL_StatusTypeDef AliceSIM_Potentiometer_ReadPercentX10(AliceSIM_Potentiometer *device, uint16_t *percent_x10);

#ifdef __cplusplus
}
#endif

#endif
