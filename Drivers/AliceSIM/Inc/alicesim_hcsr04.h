#ifndef ALICESIM_HCSR04_H
#define ALICESIM_HCSR04_H

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#include "alicesim_timing.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ALICESIM_HCSR04_DEFAULT_TIMEOUT_US 30000UL
#define ALICESIM_HCSR04_MIN_DISTANCE_MM       20UL
#define ALICESIM_HCSR04_MAX_DISTANCE_MM     4000UL

typedef enum {
  ALICESIM_HCSR04_OK = 0,
  ALICESIM_HCSR04_ERROR_ARGUMENT,
  ALICESIM_HCSR04_ERROR_TIMEOUT,
  ALICESIM_HCSR04_ERROR_OUT_OF_RANGE
} AliceSIM_HCSR04_Status;

typedef struct {
  uint32_t pulse_us;
  uint32_t distance_mm;
  uint32_t distance_cm_x100;
} AliceSIM_HCSR04_Sample;

typedef struct {
  GPIO_TypeDef *trigger_port;
  uint16_t trigger_pin;
  GPIO_TypeDef *echo_port;
  uint16_t echo_pin;
  AliceSIM_DelayUsFn delay_us;
  AliceSIM_MicrosFn micros;
  uint32_t timeout_us;
} AliceSIM_HCSR04;

AliceSIM_HCSR04_Status AliceSIM_HCSR04_Init(
  AliceSIM_HCSR04 *sensor,
  GPIO_TypeDef *trigger_port,
  uint16_t trigger_pin,
  GPIO_TypeDef *echo_port,
  uint16_t echo_pin,
  AliceSIM_DelayUsFn delay_us,
  AliceSIM_MicrosFn micros,
  uint32_t timeout_us
);

AliceSIM_HCSR04_Status AliceSIM_HCSR04_Read(
  AliceSIM_HCSR04 *sensor,
  AliceSIM_HCSR04_Sample *sample
);

AliceSIM_HCSR04_Status AliceSIM_HCSR04_MeasureMm(
  AliceSIM_HCSR04 *sensor,
  uint32_t *distance_mm
);

uint32_t AliceSIM_HCSR04_PulseToMillimeters(uint32_t pulse_us);
uint32_t AliceSIM_HCSR04_PulseToCentimetersX100(uint32_t pulse_us);
const char *AliceSIM_HCSR04_StatusText(AliceSIM_HCSR04_Status status);

#ifdef __cplusplus
}
#endif

#endif
