#ifndef ALICESIM_INA219_H
#define ALICESIM_INA219_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_INA219_DEFAULT_ADDRESS 0x40U

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
  uint32_t current_lsb_ua;
} AliceSIM_INA219;

HAL_StatusTypeDef AliceSIM_INA219_Init(AliceSIM_INA219 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms, uint32_t current_lsb_ua);
HAL_StatusTypeDef AliceSIM_INA219_ReadRegister(AliceSIM_INA219 *device, uint8_t reg, uint16_t *value);
HAL_StatusTypeDef AliceSIM_INA219_WriteRegister(AliceSIM_INA219 *device, uint8_t reg, uint16_t value);
HAL_StatusTypeDef AliceSIM_INA219_ReadBusMillivolts(AliceSIM_INA219 *device, uint32_t *millivolts);
HAL_StatusTypeDef AliceSIM_INA219_ReadCurrentMilliamps(AliceSIM_INA219 *device, int32_t *milliamps);

#ifdef __cplusplus
}
#endif

#endif
