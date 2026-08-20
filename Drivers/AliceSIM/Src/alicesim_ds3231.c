#include "alicesim_ds3231.h"

static uint8_t alice_ds3231_from_bcd(uint8_t value) {
  return (uint8_t)(((value >> 4U) * 10U) + (value & 0x0FU));
}

static uint8_t alice_ds3231_to_bcd(uint8_t value) {
  return (uint8_t)(((value / 10U) << 4U) | (value % 10U));
}

HAL_StatusTypeDef AliceSIM_DS3231_Init(AliceSIM_DS3231 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms) {
  if (device == NULL || i2c == NULL) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_DS3231_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_DS3231_ReadTime(AliceSIM_DS3231 *device, AliceSIM_DS3231_Time *time) {
  uint8_t data[7];
  HAL_StatusTypeDef status;
  if (device == NULL || device->i2c == NULL || time == NULL) return HAL_ERROR;
  status = HAL_I2C_Mem_Read(device->i2c, (uint16_t)(device->address << 1U), 0U, I2C_MEMADD_SIZE_8BIT, data, (uint16_t)sizeof(data), device->timeout_ms);
  if (status != HAL_OK) return status;
  time->second = alice_ds3231_from_bcd((uint8_t)(data[0] & 0x7FU));
  time->minute = alice_ds3231_from_bcd((uint8_t)(data[1] & 0x7FU));
  time->hour = alice_ds3231_from_bcd((uint8_t)(data[2] & 0x3FU));
  time->weekday = alice_ds3231_from_bcd((uint8_t)(data[3] & 0x07U));
  time->day = alice_ds3231_from_bcd((uint8_t)(data[4] & 0x3FU));
  time->month = alice_ds3231_from_bcd((uint8_t)(data[5] & 0x1FU));
  time->year = (uint16_t)(2000U + alice_ds3231_from_bcd(data[6]));
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_DS3231_WriteTime(AliceSIM_DS3231 *device, const AliceSIM_DS3231_Time *time) {
  uint8_t data[7];
  if (device == NULL || device->i2c == NULL || time == NULL || time->year < 2000U || time->year > 2099U) return HAL_ERROR;
  data[0] = alice_ds3231_to_bcd(time->second);
  data[1] = alice_ds3231_to_bcd(time->minute);
  data[2] = alice_ds3231_to_bcd(time->hour);
  data[3] = alice_ds3231_to_bcd(time->weekday);
  data[4] = alice_ds3231_to_bcd(time->day);
  data[5] = alice_ds3231_to_bcd(time->month);
  data[6] = alice_ds3231_to_bcd((uint8_t)(time->year - 2000U));
  return HAL_I2C_Mem_Write(device->i2c, (uint16_t)(device->address << 1U), 0U, I2C_MEMADD_SIZE_8BIT, data, (uint16_t)sizeof(data), device->timeout_ms);
}
