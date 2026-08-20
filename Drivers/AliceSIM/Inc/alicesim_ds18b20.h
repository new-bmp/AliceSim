#ifndef ALICESIM_DS18B20_H
#define ALICESIM_DS18B20_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

typedef HAL_StatusTypeDef (*AliceSIM_OneWireResetFn)(void *context);
typedef HAL_StatusTypeDef (*AliceSIM_OneWireWriteByteFn)(void *context, uint8_t value);
typedef HAL_StatusTypeDef (*AliceSIM_OneWireReadByteFn)(void *context, uint8_t *value);

typedef struct {
  void *context;
  AliceSIM_OneWireResetFn reset;
  AliceSIM_OneWireWriteByteFn write_byte;
  AliceSIM_OneWireReadByteFn read_byte;
} AliceSIM_DS18B20;

HAL_StatusTypeDef AliceSIM_DS18B20_Init(AliceSIM_DS18B20 *device, void *context, AliceSIM_OneWireResetFn reset, AliceSIM_OneWireWriteByteFn write_byte, AliceSIM_OneWireReadByteFn read_byte);
HAL_StatusTypeDef AliceSIM_DS18B20_StartConversion(AliceSIM_DS18B20 *device);
HAL_StatusTypeDef AliceSIM_DS18B20_ReadRaw(AliceSIM_DS18B20 *device, int16_t *raw_temperature);
int32_t AliceSIM_DS18B20_RawToCelsiusX100(int16_t raw_temperature);

#ifdef __cplusplus
}
#endif

#endif
