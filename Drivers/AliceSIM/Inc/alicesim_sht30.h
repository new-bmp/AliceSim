#ifndef ALICESIM_SHT30_H
#define ALICESIM_SHT30_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_SHT30_DEFAULT_ADDRESS 0x44U

typedef struct {
  int32_t temperature_x100;
  uint32_t humidity_x100;
} AliceSIM_SHT30_Sample;

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
} AliceSIM_SHT30;

HAL_StatusTypeDef AliceSIM_SHT30_Init(AliceSIM_SHT30 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_SHT30_Read(AliceSIM_SHT30 *device, AliceSIM_SHT30_Sample *sample);
uint8_t AliceSIM_SHT30_Crc8(const uint8_t *data, uint16_t length);

#ifdef __cplusplus
}
#endif

#endif
