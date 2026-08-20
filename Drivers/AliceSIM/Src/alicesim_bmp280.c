#include "alicesim_bmp280.h"

HAL_StatusTypeDef AliceSIM_BMP280_Init(AliceSIM_BMP280 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms) {
  uint8_t chip_id = 0U;
  HAL_StatusTypeDef status;
  if (device == NULL || i2c == NULL) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_BMP280_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  status = AliceSIM_BMP280_ReadRegister(device, 0xD0U, &chip_id, 1U);
  if (status != HAL_OK || chip_id != 0x58U) return HAL_ERROR;
  return AliceSIM_BMP280_WriteRegister(device, 0xF4U, 0x27U);
}

HAL_StatusTypeDef AliceSIM_BMP280_ReadRegister(AliceSIM_BMP280 *device, uint8_t reg, uint8_t *data, uint16_t length) {
  if (device == NULL || device->i2c == NULL || data == NULL || length == 0U) return HAL_ERROR;
  return HAL_I2C_Mem_Read(device->i2c, (uint16_t)(device->address << 1U), reg, I2C_MEMADD_SIZE_8BIT, data, length, device->timeout_ms);
}

HAL_StatusTypeDef AliceSIM_BMP280_WriteRegister(AliceSIM_BMP280 *device, uint8_t reg, uint8_t value) {
  if (device == NULL || device->i2c == NULL) return HAL_ERROR;
  return HAL_I2C_Mem_Write(device->i2c, (uint16_t)(device->address << 1U), reg, I2C_MEMADD_SIZE_8BIT, &value, 1U, device->timeout_ms);
}

HAL_StatusTypeDef AliceSIM_BMP280_ReadRaw(AliceSIM_BMP280 *device, uint32_t *pressure_raw, int32_t *temperature_raw) {
  uint8_t data[6];
  HAL_StatusTypeDef status;
  if (pressure_raw == NULL || temperature_raw == NULL) return HAL_ERROR;
  status = AliceSIM_BMP280_ReadRegister(device, 0xF7U, data, (uint16_t)sizeof(data));
  if (status != HAL_OK) return status;
  *pressure_raw = ((uint32_t)data[0] << 12U) | ((uint32_t)data[1] << 4U) | ((uint32_t)data[2] >> 4U);
  *temperature_raw = (int32_t)(((uint32_t)data[3] << 12U) | ((uint32_t)data[4] << 4U) | ((uint32_t)data[5] >> 4U));
  return HAL_OK;
}
