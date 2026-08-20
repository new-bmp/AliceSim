#ifndef ALICESIM_PCF8574_H
#define ALICESIM_PCF8574_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_PCF8574_DEFAULT_ADDRESS 0x20U

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
  uint8_t output_latch;
} AliceSIM_PCF8574;

HAL_StatusTypeDef AliceSIM_PCF8574_Init(AliceSIM_PCF8574 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_PCF8574_Write(AliceSIM_PCF8574 *device, uint8_t value);
HAL_StatusTypeDef AliceSIM_PCF8574_Read(AliceSIM_PCF8574 *device, uint8_t *value);
HAL_StatusTypeDef AliceSIM_PCF8574_WritePin(AliceSIM_PCF8574 *device, uint8_t pin, GPIO_PinState state);

#ifdef __cplusplus
}
#endif

#endif
