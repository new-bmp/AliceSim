#ifndef STM32F1XX_HAL_H
#define STM32F1XX_HAL_H

#include <stdint.h>

#define HAL_MAX_DELAY 0xFFFFFFFFU
#define I2C_DUTYCYCLE_2 0x00000000U
#define I2C_ADDRESSINGMODE_7BIT 0x00004000U
#define I2C1 ((void *)0x40005400U)
#define ADC1 ((void *)0x40012400U)

typedef enum {
  HAL_OK = 0x00U,
  HAL_ERROR = 0x01U,
  HAL_BUSY = 0x02U,
  HAL_TIMEOUT = 0x03U
} HAL_StatusTypeDef;

typedef struct {
  uint32_t ClockSpeed;
  uint32_t DutyCycle;
  uint32_t OwnAddress1;
  uint32_t AddressingMode;
  uint32_t DualAddressMode;
  uint32_t OwnAddress2;
  uint32_t GeneralCallMode;
  uint32_t NoStretchMode;
} I2C_InitTypeDef;

typedef struct {
  void *Instance;
  I2C_InitTypeDef Init;
} I2C_HandleTypeDef;

typedef struct {
  void *Instance;
} ADC_HandleTypeDef;

HAL_StatusTypeDef HAL_Init(void);
HAL_StatusTypeDef HAL_I2C_Init(I2C_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_I2C_Mem_Write(I2C_HandleTypeDef *handle, uint16_t device_address, uint16_t memory_address, uint16_t memory_address_size, uint8_t *data, uint16_t length, uint32_t timeout);
HAL_StatusTypeDef HAL_ADC_Init(ADC_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_ADC_Start(ADC_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_ADC_PollForConversion(ADC_HandleTypeDef *handle, uint32_t timeout);
uint32_t HAL_ADC_GetValue(ADC_HandleTypeDef *handle);
void HAL_Delay(uint32_t milliseconds);

#endif
