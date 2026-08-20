#include "alicesim_w25qxx.h"

static void alice_w25qxx_select(AliceSIM_W25QXX *device, GPIO_PinState state) {
  HAL_GPIO_WritePin(device->cs_port, device->cs_pin, state);
}

static HAL_StatusTypeDef alice_w25qxx_command(AliceSIM_W25QXX *device, uint8_t command) {
  return HAL_SPI_Transmit(device->spi, &command, 1U, device->timeout_ms);
}

static HAL_StatusTypeDef alice_w25qxx_write_enable(AliceSIM_W25QXX *device) {
  HAL_StatusTypeDef status;
  alice_w25qxx_select(device, GPIO_PIN_RESET);
  status = alice_w25qxx_command(device, 0x06U);
  alice_w25qxx_select(device, GPIO_PIN_SET);
  return status;
}

HAL_StatusTypeDef AliceSIM_W25QXX_Init(AliceSIM_W25QXX *device, SPI_HandleTypeDef *spi, GPIO_TypeDef *cs_port, uint16_t cs_pin, uint32_t timeout_ms) {
  if (device == NULL || spi == NULL || cs_port == NULL) return HAL_ERROR;
  device->spi = spi;
  device->cs_port = cs_port;
  device->cs_pin = cs_pin;
  device->timeout_ms = timeout_ms == 0U ? 500U : timeout_ms;
  alice_w25qxx_select(device, GPIO_PIN_SET);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_W25QXX_ReadJedecId(AliceSIM_W25QXX *device, uint32_t *jedec_id) {
  uint8_t data[3];
  HAL_StatusTypeDef status;
  if (device == NULL || device->spi == NULL || jedec_id == NULL) return HAL_ERROR;
  alice_w25qxx_select(device, GPIO_PIN_RESET);
  status = alice_w25qxx_command(device, 0x9FU);
  if (status == HAL_OK) status = HAL_SPI_Receive(device->spi, data, (uint16_t)sizeof(data), device->timeout_ms);
  alice_w25qxx_select(device, GPIO_PIN_SET);
  if (status == HAL_OK) *jedec_id = ((uint32_t)data[0] << 16U) | ((uint32_t)data[1] << 8U) | data[2];
  return status;
}

HAL_StatusTypeDef AliceSIM_W25QXX_Read(AliceSIM_W25QXX *device, uint32_t address, uint8_t *data, uint16_t length) {
  uint8_t header[4] = {0x03U, (uint8_t)(address >> 16U), (uint8_t)(address >> 8U), (uint8_t)address};
  HAL_StatusTypeDef status;
  if (device == NULL || device->spi == NULL || data == NULL || length == 0U) return HAL_ERROR;
  alice_w25qxx_select(device, GPIO_PIN_RESET);
  status = HAL_SPI_Transmit(device->spi, header, (uint16_t)sizeof(header), device->timeout_ms);
  if (status == HAL_OK) status = HAL_SPI_Receive(device->spi, data, length, device->timeout_ms);
  alice_w25qxx_select(device, GPIO_PIN_SET);
  return status;
}

HAL_StatusTypeDef AliceSIM_W25QXX_PageProgram(AliceSIM_W25QXX *device, uint32_t address, const uint8_t *data, uint16_t length) {
  uint8_t header[4] = {0x02U, (uint8_t)(address >> 16U), (uint8_t)(address >> 8U), (uint8_t)address};
  HAL_StatusTypeDef status;
  if (device == NULL || device->spi == NULL || data == NULL || length == 0U || length > 256U) return HAL_ERROR;
  status = alice_w25qxx_write_enable(device);
  if (status != HAL_OK) return status;
  alice_w25qxx_select(device, GPIO_PIN_RESET);
  status = HAL_SPI_Transmit(device->spi, header, (uint16_t)sizeof(header), device->timeout_ms);
  if (status == HAL_OK) status = HAL_SPI_Transmit(device->spi, (uint8_t *)(uintptr_t)data, length, device->timeout_ms);
  alice_w25qxx_select(device, GPIO_PIN_SET);
  return status;
}
