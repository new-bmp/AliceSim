#include "alicesim_pca9685.h"

static HAL_StatusTypeDef alice_pca9685_write(AliceSIM_PCA9685 *device, uint8_t reg, uint8_t *data, uint16_t length) {
  if (device == NULL || device->i2c == NULL || data == NULL || length == 0U) return HAL_ERROR;
  return HAL_I2C_Mem_Write(device->i2c, (uint16_t)(device->address << 1U), reg, I2C_MEMADD_SIZE_8BIT, data, length, device->timeout_ms);
}

HAL_StatusTypeDef AliceSIM_PCA9685_Init(AliceSIM_PCA9685 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms) {
  uint8_t mode = 0x20U;
  HAL_StatusTypeDef status;
  if (device == NULL || i2c == NULL) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_PCA9685_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  device->frequency_hz = 50U;
  status = alice_pca9685_write(device, 0x00U, &mode, 1U);
  if (status != HAL_OK) return status;
  return AliceSIM_PCA9685_SetFrequency(device, device->frequency_hz);
}

HAL_StatusTypeDef AliceSIM_PCA9685_SetFrequency(AliceSIM_PCA9685 *device, uint16_t frequency_hz) {
  uint32_t divisor;
  uint32_t prescale;
  uint8_t sleep = 0x30U;
  uint8_t wake = 0x20U;
  uint8_t encoded;
  HAL_StatusTypeDef status;
  if (device == NULL || frequency_hz < 24U || frequency_hz > 1526U) return HAL_ERROR;
  divisor = 4096U * frequency_hz;
  prescale = (25000000U + divisor / 2U) / divisor;
  prescale = prescale > 0U ? prescale - 1U : 3U;
  if (prescale < 3U) prescale = 3U;
  if (prescale > 255U) prescale = 255U;
  encoded = (uint8_t)prescale;
  status = alice_pca9685_write(device, 0x00U, &sleep, 1U);
  if (status == HAL_OK) status = alice_pca9685_write(device, 0xFEU, &encoded, 1U);
  if (status == HAL_OK) status = alice_pca9685_write(device, 0x00U, &wake, 1U);
  if (status == HAL_OK) device->frequency_hz = frequency_hz;
  return status;
}

HAL_StatusTypeDef AliceSIM_PCA9685_SetChannel(AliceSIM_PCA9685 *device, uint8_t channel, uint16_t on_count, uint16_t off_count) {
  uint8_t data[4];
  if (device == NULL || channel > 15U || on_count > 4095U || off_count > 4095U) return HAL_ERROR;
  data[0] = (uint8_t)(on_count & 0xFFU);
  data[1] = (uint8_t)(on_count >> 8U);
  data[2] = (uint8_t)(off_count & 0xFFU);
  data[3] = (uint8_t)(off_count >> 8U);
  return alice_pca9685_write(device, (uint8_t)(0x06U + 4U * channel), data, (uint16_t)sizeof(data));
}
