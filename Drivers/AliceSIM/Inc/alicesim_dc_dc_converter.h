#ifndef ALICESIM_DC_DC_CONVERTER_H
#define ALICESIM_DC_DC_CONVERTER_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

typedef struct {
  GPIO_TypeDef *enable_port;
  uint16_t enable_pin;
  uint8_t enable_active_high;
  uint8_t enabled;
  uint16_t output_millivolts;
  uint16_t max_output_milliamps;
  uint8_t efficiency_percent;
  uint16_t output_current_milliamps;
  uint8_t overloaded;
} AliceSIM_DCDCConverter;

typedef struct {
  uint8_t enabled;
  uint8_t overloaded;
  uint16_t output_millivolts;
  uint16_t output_current_milliamps;
  uint16_t max_output_milliamps;
  uint32_t output_milliwatts;
  uint8_t efficiency_percent;
} AliceSIM_DCDCConverterPowerStatus;

HAL_StatusTypeDef AliceSIM_DCDCConverter_Init(AliceSIM_DCDCConverter *device, GPIO_TypeDef *enable_port, uint16_t enable_pin, uint8_t enable_active_high, uint16_t output_millivolts, uint16_t max_output_milliamps, uint8_t efficiency_percent);
HAL_StatusTypeDef AliceSIM_DCDCConverter_Enable(AliceSIM_DCDCConverter *device);
HAL_StatusTypeDef AliceSIM_DCDCConverter_Disable(AliceSIM_DCDCConverter *device);
HAL_StatusTypeDef AliceSIM_DCDCConverter_SetOutputMillivolts(AliceSIM_DCDCConverter *device, uint16_t output_millivolts);
HAL_StatusTypeDef AliceSIM_DCDCConverter_SetSimulatedLoad(AliceSIM_DCDCConverter *device, uint16_t output_current_milliamps);
AliceSIM_DCDCConverterPowerStatus AliceSIM_DCDCConverter_GetPowerStatus(const AliceSIM_DCDCConverter *device);

#ifdef __cplusplus
}
#endif

#endif
