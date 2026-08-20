#ifndef ALICESIM_BH1750_H
#define ALICESIM_BH1750_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_BH1750_DEFAULT_ADDRESS 0x23U
#define ALICESIM_BH1750_MODE_CONTINUOUS_HIGH_RES 0x10U

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
  uint8_t mode;
} AliceSIM_BH1750;

HAL_StatusTypeDef AliceSIM_BH1750_Init(AliceSIM_BH1750 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_BH1750_SetMode(AliceSIM_BH1750 *device, uint8_t mode);
HAL_StatusTypeDef AliceSIM_BH1750_ReadLux(AliceSIM_BH1750 *device, uint32_t *lux_x10);

#ifdef __cplusplus
}
#endif

#endif
