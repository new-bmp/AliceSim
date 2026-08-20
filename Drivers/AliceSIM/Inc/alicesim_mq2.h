#ifndef ALICESIM_MQ2_H
#define ALICESIM_MQ2_H

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
  GPIO_TypeDef *digital_port;
  uint16_t digital_pin;
  uint32_t reference_mv;
  uint8_t resolution_bits;
  uint8_t digital_active_low;
  uint32_t timeout_ms;
} AliceSIM_MQ2;

HAL_StatusTypeDef AliceSIM_MQ2_Init(AliceSIM_MQ2 *sensor, ADC_HandleTypeDef *adc, GPIO_TypeDef *digital_port, uint16_t digital_pin, uint32_t reference_mv, uint8_t resolution_bits, uint8_t digital_active_low, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_MQ2_ReadRaw(AliceSIM_MQ2 *sensor, uint32_t *raw);
HAL_StatusTypeDef AliceSIM_MQ2_ReadMillivolts(AliceSIM_MQ2 *sensor, uint32_t *millivolts);
uint8_t AliceSIM_MQ2_ThresholdTriggered(const AliceSIM_MQ2 *sensor);

#ifdef __cplusplus
}
#endif

#endif
