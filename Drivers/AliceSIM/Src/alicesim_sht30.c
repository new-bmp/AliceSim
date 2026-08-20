#include "alicesim_sht30.h"

uint8_t AliceSIM_SHT30_Crc8(const uint8_t *data, uint16_t length) {
  uint8_t crc = 0xFFU;
  uint16_t index;
  uint8_t bit;
  if (data == NULL) return 0U;
  for (index = 0U; index < length; index += 1U) {
    crc ^= data[index];
    for (bit = 0U; bit < 8U; bit += 1U) crc = (uint8_t)((crc & 0x80U) != 0U ? (crc << 1U) ^ 0x31U : crc << 1U);
  }
  return crc;
}

HAL_StatusTypeDef AliceSIM_SHT30_Init(AliceSIM_SHT30 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms) {
  if (device == NULL || i2c == NULL) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_SHT30_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_SHT30_Read(AliceSIM_SHT30 *device, AliceSIM_SHT30_Sample *sample) {
  uint8_t command[2] = {0x24U, 0x00U};
  uint8_t data[6];
  uint32_t raw_temperature;
  uint32_t raw_humidity;
  HAL_StatusTypeDef status;
  if (device == NULL || device->i2c == NULL || sample == NULL) return HAL_ERROR;
  status = HAL_I2C_Master_Transmit(device->i2c, (uint16_t)(device->address << 1U), command, (uint16_t)sizeof(command), device->timeout_ms);
  if (status != HAL_OK) return status;
  HAL_Delay(15U);
  status = HAL_I2C_Master_Receive(device->i2c, (uint16_t)(device->address << 1U), data, (uint16_t)sizeof(data), device->timeout_ms);
  if (status != HAL_OK) return status;
  if (AliceSIM_SHT30_Crc8(&data[0], 2U) != data[2] || AliceSIM_SHT30_Crc8(&data[3], 2U) != data[5]) return HAL_ERROR;
  raw_temperature = ((uint32_t)data[0] << 8U) | data[1];
  raw_humidity = ((uint32_t)data[3] << 8U) | data[4];
  sample->temperature_x100 = -4500 + (int32_t)((17500U * raw_temperature + 32767U) / 65535U);
  sample->humidity_x100 = (10000U * raw_humidity + 32767U) / 65535U;
  return HAL_OK;
}
