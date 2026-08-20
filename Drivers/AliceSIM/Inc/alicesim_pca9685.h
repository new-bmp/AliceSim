#ifndef ALICESIM_PCA9685_H
#define ALICESIM_PCA9685_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_PCA9685_DEFAULT_ADDRESS 0x40U

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
  uint16_t frequency_hz;
} AliceSIM_PCA9685;

HAL_StatusTypeDef AliceSIM_PCA9685_Init(AliceSIM_PCA9685 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_PCA9685_SetFrequency(AliceSIM_PCA9685 *device, uint16_t frequency_hz);
HAL_StatusTypeDef AliceSIM_PCA9685_SetChannel(AliceSIM_PCA9685 *device, uint8_t channel, uint16_t on_count, uint16_t off_count);

#ifdef __cplusplus
}
#endif

#endif
