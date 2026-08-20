#ifndef ALICESIM_DS3231_H
#define ALICESIM_DS3231_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_DS3231_DEFAULT_ADDRESS 0x68U

typedef struct {
  uint8_t second;
  uint8_t minute;
  uint8_t hour;
  uint8_t weekday;
  uint8_t day;
  uint8_t month;
  uint16_t year;
} AliceSIM_DS3231_Time;

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
} AliceSIM_DS3231;

HAL_StatusTypeDef AliceSIM_DS3231_Init(AliceSIM_DS3231 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_DS3231_ReadTime(AliceSIM_DS3231 *device, AliceSIM_DS3231_Time *time);
HAL_StatusTypeDef AliceSIM_DS3231_WriteTime(AliceSIM_DS3231 *device, const AliceSIM_DS3231_Time *time);

#ifdef __cplusplus
}
#endif

#endif
