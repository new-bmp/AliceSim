#include "alicesim_pcf8574.h"

HAL_StatusTypeDef AliceSIM_PCF8574_Init(AliceSIM_PCF8574 *device, I2C_HandleTypeDef *i2c, uint16_t address, uint32_t timeout_ms) {
  if (device == NULL || i2c == NULL) return HAL_ERROR;
  device->i2c = i2c;
  device->address = address == 0U ? ALICESIM_PCF8574_DEFAULT_ADDRESS : address;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  device->output_latch = 0xFFU;
  return AliceSIM_PCF8574_Write(device, device->output_latch);
}

HAL_StatusTypeDef AliceSIM_PCF8574_Write(AliceSIM_PCF8574 *device, uint8_t value) {
  HAL_StatusTypeDef status;
  if (device == NULL || device->i2c == NULL) return HAL_ERROR;
  status = HAL_I2C_Master_Transmit(device->i2c, (uint16_t)(device->address << 1U), &value, 1U, device->timeout_ms);
  if (status == HAL_OK) device->output_latch = value;
  return status;
}

HAL_StatusTypeDef AliceSIM_PCF8574_Read(AliceSIM_PCF8574 *device, uint8_t *value) {
  if (device == NULL || device->i2c == NULL || value == NULL) return HAL_ERROR;
  return HAL_I2C_Master_Receive(device->i2c, (uint16_t)(device->address << 1U), value, 1U, device->timeout_ms);
}

HAL_StatusTypeDef AliceSIM_PCF8574_WritePin(AliceSIM_PCF8574 *device, uint8_t pin, GPIO_PinState state) {
  uint8_t next;
  if (device == NULL || pin > 7U) return HAL_ERROR;
  next = device->output_latch;
  if (state == GPIO_PIN_SET) next = (uint8_t)(next | (uint8_t)(1U << pin));
  else next = (uint8_t)(next & (uint8_t)~(uint8_t)(1U << pin));
  return AliceSIM_PCF8574_Write(device, next);
}
