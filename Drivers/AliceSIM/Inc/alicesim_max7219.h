#ifndef ALICESIM_MAX7219_H
#define ALICESIM_MAX7219_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

typedef struct {
  SPI_HandleTypeDef *spi;
  GPIO_TypeDef *cs_port;
  uint16_t cs_pin;
  uint32_t timeout_ms;
} AliceSIM_MAX7219;

HAL_StatusTypeDef AliceSIM_MAX7219_Init(AliceSIM_MAX7219 *device, SPI_HandleTypeDef *spi, GPIO_TypeDef *cs_port, uint16_t cs_pin, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_MAX7219_WriteRegister(AliceSIM_MAX7219 *device, uint8_t reg, uint8_t value);
HAL_StatusTypeDef AliceSIM_MAX7219_SetIntensity(AliceSIM_MAX7219 *device, uint8_t intensity);
HAL_StatusTypeDef AliceSIM_MAX7219_SetRow(AliceSIM_MAX7219 *device, uint8_t row, uint8_t columns);
HAL_StatusTypeDef AliceSIM_MAX7219_Clear(AliceSIM_MAX7219 *device);

#ifdef __cplusplus
}
#endif

#endif
