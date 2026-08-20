#ifndef ALICESIM_W25QXX_H
#define ALICESIM_W25QXX_H

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
} AliceSIM_W25QXX;

HAL_StatusTypeDef AliceSIM_W25QXX_Init(AliceSIM_W25QXX *device, SPI_HandleTypeDef *spi, GPIO_TypeDef *cs_port, uint16_t cs_pin, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_W25QXX_ReadJedecId(AliceSIM_W25QXX *device, uint32_t *jedec_id);
HAL_StatusTypeDef AliceSIM_W25QXX_Read(AliceSIM_W25QXX *device, uint32_t address, uint8_t *data, uint16_t length);
HAL_StatusTypeDef AliceSIM_W25QXX_PageProgram(AliceSIM_W25QXX *device, uint32_t address, const uint8_t *data, uint16_t length);

#ifdef __cplusplus
}
#endif

#endif
