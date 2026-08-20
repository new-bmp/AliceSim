#ifndef ALICESIM_MPU6050_H
#define ALICESIM_MPU6050_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_MPU6050_DEFAULT_ADDRESS 0x68U

typedef struct {
  int16_t accel_x;
  int16_t accel_y;
  int16_t accel_z;
  int16_t temperature_raw;
  int16_t gyro_x;
  int16_t gyro_y;
  int16_t gyro_z;
} AliceSIM_MPU6050_Sample;

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t address;
  uint32_t timeout_ms;
} AliceSIM_MPU6050;

HAL_StatusTypeDef AliceSIM_MPU6050_Init(AliceSIM_MPU6050 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_MPU6050_ReadRegister(AliceSIM_MPU6050 *device, uint8_t reg, uint8_t *data, uint16_t length);
HAL_StatusTypeDef AliceSIM_MPU6050_WriteRegister(AliceSIM_MPU6050 *device, uint8_t reg, uint8_t value);
HAL_StatusTypeDef AliceSIM_MPU6050_Read(AliceSIM_MPU6050 *device, AliceSIM_MPU6050_Sample *sample);

#ifdef __cplusplus
}
#endif

#endif
