#ifndef ALICESIM_DHT11_H
#define ALICESIM_DHT11_H

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

#define ALICESIM_DHT11_MIN_INTERVAL_MS 1000UL

typedef enum {
  ALICESIM_DHT11_OK = 0,
  ALICESIM_DHT11_ERROR_ARGUMENT,
  ALICESIM_DHT11_ERROR_TOO_SOON,
  ALICESIM_DHT11_ERROR_TIMEOUT,
  ALICESIM_DHT11_ERROR_CHECKSUM
} AliceSIM_DHT11_Status;

typedef struct {
  uint8_t raw[5];
  uint16_t humidity_x10;
  int16_t temperature_x10;
} AliceSIM_DHT11_Sample;

typedef struct {
  GPIO_TypeDef *port;
  uint16_t pin;
  AliceSIM_DelayUsFn delay_us;
  AliceSIM_MicrosFn micros;
  uint32_t last_read_ms;
  AliceSIM_DHT11_Sample last_sample;
  uint8_t has_read;
  uint8_t has_sample;
} AliceSIM_DHT11;

AliceSIM_DHT11_Status AliceSIM_DHT11_Init(
  AliceSIM_DHT11 *sensor,
  GPIO_TypeDef *port,
  uint16_t pin,
  AliceSIM_DelayUsFn delay_us,
  AliceSIM_MicrosFn micros
);

AliceSIM_DHT11_Status AliceSIM_DHT11_Read(
  AliceSIM_DHT11 *sensor,
  AliceSIM_DHT11_Sample *sample
);

AliceSIM_DHT11_Status AliceSIM_DHT11_GetLastSample(
  const AliceSIM_DHT11 *sensor,
  AliceSIM_DHT11_Sample *sample
);

const char *AliceSIM_DHT11_StatusText(AliceSIM_DHT11_Status status);

#ifdef __cplusplus
}
#endif

#endif
