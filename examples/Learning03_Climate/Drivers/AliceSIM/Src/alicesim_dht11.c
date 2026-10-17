#include "alicesim_dht11.h"

static void alice_dht11_configure_output(const AliceSIM_DHT11 *sensor) {
  GPIO_InitTypeDef configuration = {0};
  configuration.Pin = sensor->pin;
  configuration.Mode = GPIO_MODE_OUTPUT_PP;
  configuration.Pull = GPIO_NOPULL;
  configuration.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(sensor->port, &configuration);
}

static void alice_dht11_configure_input(const AliceSIM_DHT11 *sensor) {
  GPIO_InitTypeDef configuration = {0};
  configuration.Pin = sensor->pin;
  configuration.Mode = GPIO_MODE_INPUT;
  configuration.Pull = GPIO_PULLUP;
  configuration.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(sensor->port, &configuration);
}

static AliceSIM_DHT11_Status alice_dht11_wait_for_level(
  const AliceSIM_DHT11 *sensor,
  GPIO_PinState level,
  uint32_t timeout_us
) {
  uint32_t started = sensor->micros();
  while (HAL_GPIO_ReadPin(sensor->port, sensor->pin) != level) {
    if ((uint32_t)(sensor->micros() - started) >= timeout_us) return ALICESIM_DHT11_ERROR_TIMEOUT;
  }
  return ALICESIM_DHT11_OK;
}

static AliceSIM_DHT11_Status alice_dht11_measure_level(
  const AliceSIM_DHT11 *sensor,
  GPIO_PinState level,
  uint32_t timeout_us,
  uint32_t *duration_us
) {
  uint32_t started;
  uint32_t elapsed;
  if (duration_us == NULL) return ALICESIM_DHT11_ERROR_ARGUMENT;
  started = sensor->micros();
  while (HAL_GPIO_ReadPin(sensor->port, sensor->pin) == level) {
    elapsed = (uint32_t)(sensor->micros() - started);
    if (elapsed >= timeout_us) return ALICESIM_DHT11_ERROR_TIMEOUT;
  }
  *duration_us = (uint32_t)(sensor->micros() - started);
  return ALICESIM_DHT11_OK;
}

AliceSIM_DHT11_Status AliceSIM_DHT11_Init(
  AliceSIM_DHT11 *sensor,
  GPIO_TypeDef *port,
  uint16_t pin,
  AliceSIM_DelayUsFn delay_us,
  AliceSIM_MicrosFn micros
) {
  uint8_t index;
  if (sensor == NULL || port == NULL || pin == 0U || delay_us == NULL || micros == NULL) {
    return ALICESIM_DHT11_ERROR_ARGUMENT;
  }
  sensor->port = port;
  sensor->pin = pin;
  sensor->delay_us = delay_us;
  sensor->micros = micros;
  sensor->last_read_ms = 0U;
  sensor->has_read = 0U;
  sensor->has_sample = 0U;
  sensor->last_sample.humidity_x10 = 0U;
  sensor->last_sample.temperature_x10 = 0;
  for (index = 0U; index < 5U; index += 1U) sensor->last_sample.raw[index] = 0U;
  alice_dht11_configure_output(sensor);
  HAL_GPIO_WritePin(sensor->port, sensor->pin, GPIO_PIN_SET);
  return ALICESIM_DHT11_OK;
}

AliceSIM_DHT11_Status AliceSIM_DHT11_Read(
  AliceSIM_DHT11 *sensor,
  AliceSIM_DHT11_Sample *sample
) {
  uint8_t data[5] = {0U, 0U, 0U, 0U, 0U};
  uint8_t bit_index;
  uint8_t checksum;
  uint32_t duration;
  uint32_t now_ms;
  AliceSIM_DHT11_Status status;

  if (sensor == NULL || sample == NULL || sensor->port == NULL || sensor->delay_us == NULL || sensor->micros == NULL) {
    return ALICESIM_DHT11_ERROR_ARGUMENT;
  }
  now_ms = HAL_GetTick();
  if (sensor->has_read != 0U && (uint32_t)(now_ms - sensor->last_read_ms) < ALICESIM_DHT11_MIN_INTERVAL_MS) {
    return ALICESIM_DHT11_ERROR_TOO_SOON;
  }
  sensor->last_read_ms = now_ms;
  sensor->has_read = 1U;

  alice_dht11_configure_output(sensor);
  HAL_GPIO_WritePin(sensor->port, sensor->pin, GPIO_PIN_RESET);
  sensor->delay_us(18000U);
  HAL_GPIO_WritePin(sensor->port, sensor->pin, GPIO_PIN_SET);
  sensor->delay_us(30U);
  alice_dht11_configure_input(sensor);

  status = alice_dht11_wait_for_level(sensor, GPIO_PIN_RESET, 120U);
  if (status != ALICESIM_DHT11_OK) return status;
  status = alice_dht11_measure_level(sensor, GPIO_PIN_RESET, 120U, &duration);
  if (status != ALICESIM_DHT11_OK) return status;
  status = alice_dht11_measure_level(sensor, GPIO_PIN_SET, 120U, &duration);
  if (status != ALICESIM_DHT11_OK) return status;

  for (bit_index = 0U; bit_index < 40U; bit_index += 1U) {
    status = alice_dht11_measure_level(sensor, GPIO_PIN_RESET, 100U, &duration);
    if (status != ALICESIM_DHT11_OK) return status;
    status = alice_dht11_measure_level(sensor, GPIO_PIN_SET, 120U, &duration);
    if (status != ALICESIM_DHT11_OK) return status;
    data[bit_index >> 3U] <<= 1U;
    if (duration > 50U) data[bit_index >> 3U] |= 1U;
  }

  checksum = (uint8_t)(data[0] + data[1] + data[2] + data[3]);
  if (checksum != data[4]) return ALICESIM_DHT11_ERROR_CHECKSUM;

  for (bit_index = 0U; bit_index < 5U; bit_index += 1U) sample->raw[bit_index] = data[bit_index];
  sample->humidity_x10 = (uint16_t)((uint16_t)data[0] * 10U + data[1]);
  sample->temperature_x10 = (int16_t)((uint16_t)(data[2] & 0x7FU) * 10U + data[3]);
  if ((data[2] & 0x80U) != 0U) sample->temperature_x10 = (int16_t)-sample->temperature_x10;
  sensor->last_sample = *sample;
  sensor->has_sample = 1U;
  return ALICESIM_DHT11_OK;
}

AliceSIM_DHT11_Status AliceSIM_DHT11_GetLastSample(
  const AliceSIM_DHT11 *sensor,
  AliceSIM_DHT11_Sample *sample
) {
  if (sensor == NULL || sample == NULL) return ALICESIM_DHT11_ERROR_ARGUMENT;
  if (sensor->has_sample == 0U) return ALICESIM_DHT11_ERROR_TOO_SOON;
  *sample = sensor->last_sample;
  return ALICESIM_DHT11_OK;
}

const char *AliceSIM_DHT11_StatusText(AliceSIM_DHT11_Status status) {
  if (status == ALICESIM_DHT11_OK) return "ok";
  if (status == ALICESIM_DHT11_ERROR_ARGUMENT) return "invalid argument";
  if (status == ALICESIM_DHT11_ERROR_TOO_SOON) return "minimum interval not reached";
  if (status == ALICESIM_DHT11_ERROR_TIMEOUT) return "sensor response timeout";
  if (status == ALICESIM_DHT11_ERROR_CHECKSUM) return "checksum mismatch";
  return "unknown DHT11 status";
}
