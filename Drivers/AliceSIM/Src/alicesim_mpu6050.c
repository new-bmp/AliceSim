#include "alicesim_mpu6050.h"

static int16_t alice_mpu6050_i16(const uint8_t *data) {
  return (int16_t)(((uint16_t)data[0] << 8U) | data[1]);
}

HAL_StatusTypeDef AliceSIM_MPU6050_Init(AliceSIM_MPU6050 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms) {
  uint8_t who_am_i = 0U;
  HAL_StatusTypeDef status;
  if (device == NULL || i2c == NULL) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_MPU6050_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  status = AliceSIM_MPU6050_ReadRegister(device, 0x75U, &who_am_i, 1U);
  if (status != HAL_OK || (who_am_i & 0x7EU) != 0x68U) return HAL_ERROR;
  return AliceSIM_MPU6050_WriteRegister(device, 0x6BU, 0x00U);
}

HAL_StatusTypeDef AliceSIM_MPU6050_ReadRegister(AliceSIM_MPU6050 *device, uint8_t reg, uint8_t *data, uint16_t length) {
  if (device == NULL || device->i2c == NULL || data == NULL || length == 0U) return HAL_ERROR;
  return HAL_I2C_Mem_Read(device->i2c, (uint16_t)(device->address << 1U), reg, I2C_MEMADD_SIZE_8BIT, data, length, device->timeout_ms);
}

HAL_StatusTypeDef AliceSIM_MPU6050_WriteRegister(AliceSIM_MPU6050 *device, uint8_t reg, uint8_t value) {
  if (device == NULL || device->i2c == NULL) return HAL_ERROR;
  return HAL_I2C_Mem_Write(device->i2c, (uint16_t)(device->address << 1U), reg, I2C_MEMADD_SIZE_8BIT, &value, 1U, device->timeout_ms);
}

HAL_StatusTypeDef AliceSIM_MPU6050_Read(AliceSIM_MPU6050 *device, AliceSIM_MPU6050_Sample *sample) {
  uint8_t data[14];
  HAL_StatusTypeDef status;
  if (sample == NULL) return HAL_ERROR;
  status = AliceSIM_MPU6050_ReadRegister(device, 0x3BU, data, (uint16_t)sizeof(data));
  if (status != HAL_OK) return status;
  sample->accel_x = alice_mpu6050_i16(&data[0]);
  sample->accel_y = alice_mpu6050_i16(&data[2]);
  sample->accel_z = alice_mpu6050_i16(&data[4]);
  sample->temperature_raw = alice_mpu6050_i16(&data[6]);
  sample->gyro_x = alice_mpu6050_i16(&data[8]);
  sample->gyro_y = alice_mpu6050_i16(&data[10]);
  sample->gyro_z = alice_mpu6050_i16(&data[12]);
  return HAL_OK;
}
