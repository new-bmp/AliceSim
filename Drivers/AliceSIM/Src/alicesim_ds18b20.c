#include "alicesim_ds18b20.h"

HAL_StatusTypeDef AliceSIM_DS18B20_Init(AliceSIM_DS18B20 *device, void *context, AliceSIM_OneWireResetFn reset, AliceSIM_OneWireWriteByteFn write_byte, AliceSIM_OneWireReadByteFn read_byte) {
  if (device == NULL || reset == NULL || write_byte == NULL || read_byte == NULL) return HAL_ERROR;
  device->context = context;
  device->reset = reset;
  device->write_byte = write_byte;
  device->read_byte = read_byte;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_DS18B20_StartConversion(AliceSIM_DS18B20 *device) {
  HAL_StatusTypeDef status;
  if (device == NULL || device->reset == NULL || device->write_byte == NULL) return HAL_ERROR;
  status = device->reset(device->context);
  if (status == HAL_OK) status = device->write_byte(device->context, 0xCCU);
  if (status == HAL_OK) status = device->write_byte(device->context, 0x44U);
  return status;
}

HAL_StatusTypeDef AliceSIM_DS18B20_ReadRaw(AliceSIM_DS18B20 *device, int16_t *raw_temperature) {
  uint8_t low = 0U;
  uint8_t high = 0U;
  HAL_StatusTypeDef status;
  if (device == NULL || raw_temperature == NULL || device->reset == NULL || device->write_byte == NULL || device->read_byte == NULL) return HAL_ERROR;
  status = device->reset(device->context);
  if (status == HAL_OK) status = device->write_byte(device->context, 0xCCU);
  if (status == HAL_OK) status = device->write_byte(device->context, 0xBEU);
  if (status == HAL_OK) status = device->read_byte(device->context, &low);
  if (status == HAL_OK) status = device->read_byte(device->context, &high);
  if (status == HAL_OK) *raw_temperature = (int16_t)(((uint16_t)high << 8U) | low);
  return status;
}

int32_t AliceSIM_DS18B20_RawToCelsiusX100(int16_t raw_temperature) {
  return ((int32_t)raw_temperature * 100) / 16;
}
