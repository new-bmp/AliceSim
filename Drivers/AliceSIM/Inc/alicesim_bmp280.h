#ifndef ALICESIM_BMP280_H
#define ALICESIM_BMP280_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_BMP280_DEFAULT_ADDRESS 0x76U

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
} AliceSIM_BMP280;

HAL_StatusTypeDef AliceSIM_BMP280_Init(AliceSIM_BMP280 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_BMP280_ReadRegister(AliceSIM_BMP280 *device, uint8_t reg, uint8_t *data, uint16_t length);
HAL_StatusTypeDef AliceSIM_BMP280_WriteRegister(AliceSIM_BMP280 *device, uint8_t reg, uint8_t value);
HAL_StatusTypeDef AliceSIM_BMP280_ReadRaw(AliceSIM_BMP280 *device, uint32_t *pressure_raw, int32_t *temperature_raw);

#ifdef __cplusplus
}
#endif

#endif
