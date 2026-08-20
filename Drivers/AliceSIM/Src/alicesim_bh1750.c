#include "alicesim_bh1750.h"

HAL_StatusTypeDef AliceSIM_BH1750_Init(AliceSIM_BH1750 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms) {
  if (device == NULL || i2c == NULL) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_BH1750_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 180U : timeout_ms;
  device->mode = ALICESIM_BH1750_MODE_CONTINUOUS_HIGH_RES;
  return AliceSIM_BH1750_SetMode(device, device->mode);
}

HAL_StatusTypeDef AliceSIM_BH1750_SetMode(AliceSIM_BH1750 *device, uint8_t mode) {
  HAL_StatusTypeDef status;
  if (device == NULL || device->i2c == NULL) return HAL_ERROR;
  status = HAL_I2C_Master_Transmit(device->i2c, (uint16_t)(device->address << 1U), &mode, 1U, device->timeout_ms);
  if (status == HAL_OK) device->mode = mode;
  return status;
}

HAL_StatusTypeDef AliceSIM_BH1750_ReadLux(AliceSIM_BH1750 *device, uint32_t *lux_x10) {
  uint8_t data[2];
  uint32_t raw;
  HAL_StatusTypeDef status;
  if (device == NULL || device->i2c == NULL || lux_x10 == NULL) return HAL_ERROR;
  status = HAL_I2C_Master_Receive(device->i2c, (uint16_t)(device->address << 1U), data, (uint16_t)sizeof(data), device->timeout_ms);
  if (status != HAL_OK) return status;
  raw = ((uint32_t)data[0] << 8U) | data[1];
  *lux_x10 = (raw * 100U + 6U) / 12U;
  return HAL_OK;
}
