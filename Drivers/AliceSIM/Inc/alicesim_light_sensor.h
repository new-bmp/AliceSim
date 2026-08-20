#ifndef ALICESIM_LIGHT_SENSOR_H
#define ALICESIM_LIGHT_SENSOR_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_LIGHT_SENSOR_DEFAULT_MAX_LUX 100000UL
#define ALICESIM_LIGHT_SENSOR_DEFAULT_VREF_MV   3300UL
#define ALICESIM_LIGHT_SENSOR_DEFAULT_ADC_BITS    12U

typedef struct {
  ADC_HandleTypeDef *adc;
  GPIO_TypeDef *digital_port;
  uint16_t digital_pin;
  uint32_t poll_timeout_ms;
  uint32_t reference_mv;
  uint32_t adc_max;
  uint32_t raw_at_min_lux;
  uint32_t raw_at_max_lux;
  uint32_t min_lux;
  uint32_t max_lux;
  uint8_t digital_active_low;
} AliceSIM_LightSensor;

typedef struct {
  uint32_t raw;
  uint32_t millivolts;
  uint32_t lux;
  uint16_t percent_x100;
  GPIO_PinState digital_level;
  uint8_t digital_valid;
  uint8_t triggered;
} AliceSIM_LightSensor_Sample;

/**
 * Bind the AliceSIM AO/DO light sensor to CubeMX-created HAL handles.
 * digital_port may be NULL when only AO is connected. The AliceSIM component
 * drives DO high above its threshold by default, so digital_active_low should
 * normally be 0 unless the component property was changed.
 */
HAL_StatusTypeDef AliceSIM_LightSensor_Init(
  AliceSIM_LightSensor *sensor,
  ADC_HandleTypeDef *adc,
  GPIO_TypeDef *digital_port,
  uint16_t digital_pin,
  uint8_t digital_active_low,
  uint32_t reference_mv,
  uint8_t adc_bits,
  uint32_t poll_timeout_ms
);

void AliceSIM_LightSensor_SetCalibration(
  AliceSIM_LightSensor *sensor,
  uint32_t raw_at_min_lux,
  uint32_t min_lux,
  uint32_t raw_at_max_lux,
  uint32_t max_lux
);

HAL_StatusTypeDef AliceSIM_LightSensor_ReadRaw(
  AliceSIM_LightSensor *sensor,
  uint32_t *raw
);

HAL_StatusTypeDef AliceSIM_LightSensor_ReadMillivolts(
  AliceSIM_LightSensor *sensor,
  uint32_t *millivolts
);

HAL_StatusTypeDef AliceSIM_LightSensor_ReadLux(
  AliceSIM_LightSensor *sensor,
  uint32_t *lux
);

HAL_StatusTypeDef AliceSIM_LightSensor_ReadDigital(
  const AliceSIM_LightSensor *sensor,
  GPIO_PinState *level,
  uint8_t *triggered
);

HAL_StatusTypeDef AliceSIM_LightSensor_Read(
  AliceSIM_LightSensor *sensor,
  AliceSIM_LightSensor_Sample *sample
);

uint32_t AliceSIM_LightSensor_RawToMillivolts(
  const AliceSIM_LightSensor *sensor,
  uint32_t raw
);

uint32_t AliceSIM_LightSensor_RawToLux(
  const AliceSIM_LightSensor *sensor,
  uint32_t raw
);

uint16_t AliceSIM_LightSensor_RawToPercentX100(
  const AliceSIM_LightSensor *sensor,
  uint32_t raw
);

#ifdef __cplusplus
}
#endif

#endif
