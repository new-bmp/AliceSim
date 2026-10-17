#include "alicesim_ina219.h"

HAL_StatusTypeDef AliceSIM_INA219_Init(AliceSIM_INA219 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms, uint32_t current_lsb_ua) {
  uint32_t calibration = 0U;
  HAL_StatusTypeDef status = HAL_ERROR;
  if (device == NULL || i2c == NULL || current_lsb_ua == 0U) return HAL_ERROR;
  calibration = (40960000U / ALICESIM_INA219_DEFAULT_SHUNT_MILLIOHMS) / current_lsb_ua;
  if (calibration == 0U || calibration > 65535U) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_INA219_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  device->current_lsb_ua = current_lsb_ua;
  status = AliceSIM_INA219_WriteRegister(device, 0x00U, 0x399FU);
  if (status != HAL_OK) return status;
  return AliceSIM_INA219_WriteRegister(device, 0x05U, (uint16_t)calibration);
}

HAL_StatusTypeDef AliceSIM_INA219_ReadRegister(AliceSIM_INA219 *device, uint8_t reg, uint16_t *value) {
  uint8_t data[2];
  HAL_StatusTypeDef status;
  if (device == NULL || device->i2c == NULL || value == NULL) return HAL_ERROR;
  status = HAL_I2C_Mem_Read(device->i2c, (uint16_t)(device->address << 1U), reg, I2C_MEMADD_SIZE_8BIT, data, (uint16_t)sizeof(data), device->timeout_ms);
  if (status == HAL_OK) *value = (uint16_t)(((uint16_t)data[0] << 8U) | data[1]);
  return status;
}

HAL_StatusTypeDef AliceSIM_INA219_WriteRegister(AliceSIM_INA219 *device, uint8_t reg, uint16_t value) {
  uint8_t data[2];
  if (device == NULL || device->i2c == NULL) return HAL_ERROR;
  data[0] = (uint8_t)(value >> 8U);
  data[1] = (uint8_t)(value & 0xFFU);
  return HAL_I2C_Mem_Write(device->i2c, (uint16_t)(device->address << 1U), reg, I2C_MEMADD_SIZE_8BIT, data, (uint16_t)sizeof(data), device->timeout_ms);
}

HAL_StatusTypeDef AliceSIM_INA219_ReadBusMillivolts(AliceSIM_INA219 *device, uint32_t *millivolts) {
  uint16_t raw;
  HAL_StatusTypeDef status;
  if (millivolts == NULL) return HAL_ERROR;
  status = AliceSIM_INA219_ReadRegister(device, 0x02U, &raw);
  if (status == HAL_OK) *millivolts = (uint32_t)(raw >> 3U) * 4U;
  return status;
}

HAL_StatusTypeDef AliceSIM_INA219_ReadCurrentMilliamps(AliceSIM_INA219 *device, int32_t *milliamps) {
  uint16_t raw;
  int32_t signed_raw;
  HAL_StatusTypeDef status;
  if (device == NULL || milliamps == NULL) return HAL_ERROR;
  status = AliceSIM_INA219_ReadRegister(device, 0x04U, &raw);
  if (status != HAL_OK) return status;
  signed_raw = (int16_t)raw;
  *milliamps = (int32_t)((signed_raw * (int32_t)device->current_lsb_ua) / 1000);
  return HAL_OK;
}
