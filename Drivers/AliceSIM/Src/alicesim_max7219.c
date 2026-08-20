#include "alicesim_max7219.h"

HAL_StatusTypeDef AliceSIM_MAX7219_WriteRegister(AliceSIM_MAX7219 *device, uint8_t reg, uint8_t value) {
  uint8_t data[2] = {reg, value};
  HAL_StatusTypeDef status;
  if (device == NULL || device->spi == NULL || device->cs_port == NULL) return HAL_ERROR;
  HAL_GPIO_WritePin(device->cs_port, device->cs_pin, GPIO_PIN_RESET);
  status = HAL_SPI_Transmit(device->spi, data, (uint16_t)sizeof(data), device->timeout_ms);
  HAL_GPIO_WritePin(device->cs_port, device->cs_pin, GPIO_PIN_SET);
  return status;
}

HAL_StatusTypeDef AliceSIM_MAX7219_Init(AliceSIM_MAX7219 *device, SPI_HandleTypeDef *spi, GPIO_TypeDef *cs_port, uint16_t cs_pin, uint32_t timeout_ms) {
  HAL_StatusTypeDef status;
  if (device == NULL || spi == NULL || cs_port == NULL) return HAL_ERROR;
  device->spi = spi;
  device->cs_port = cs_port;
  device->cs_pin = cs_pin;
  device->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_SET);
  status = AliceSIM_MAX7219_WriteRegister(device, 0x0FU, 0x00U);
  if (status == HAL_OK) status = AliceSIM_MAX7219_WriteRegister(device, 0x09U, 0x00U);
  if (status == HAL_OK) status = AliceSIM_MAX7219_WriteRegister(device, 0x0BU, 0x07U);
  if (status == HAL_OK) status = AliceSIM_MAX7219_SetIntensity(device, 8U);
  if (status == HAL_OK) status = AliceSIM_MAX7219_WriteRegister(device, 0x0CU, 0x01U);
  if (status == HAL_OK) status = AliceSIM_MAX7219_Clear(device);
  return status;
}

HAL_StatusTypeDef AliceSIM_MAX7219_SetIntensity(AliceSIM_MAX7219 *device, uint8_t intensity) {
  if (intensity > 15U) intensity = 15U;
  return AliceSIM_MAX7219_WriteRegister(device, 0x0AU, intensity);
}

HAL_StatusTypeDef AliceSIM_MAX7219_SetRow(AliceSIM_MAX7219 *device, uint8_t row, uint8_t columns) {
  if (row > 7U) return HAL_ERROR;
  return AliceSIM_MAX7219_WriteRegister(device, (uint8_t)(row + 1U), columns);
}

HAL_StatusTypeDef AliceSIM_MAX7219_Clear(AliceSIM_MAX7219 *device) {
  uint8_t row;
  HAL_StatusTypeDef status = HAL_OK;
  for (row = 0U; row < 8U && status == HAL_OK; row += 1U) status = AliceSIM_MAX7219_SetRow(device, row, 0U);
  return status;
}
