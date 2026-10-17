#include "alicesim_hcsr04.h"

static void alice_hcsr04_configure(const AliceSIM_HCSR04 *sensor) {
  GPIO_InitTypeDef configuration = {0};
  configuration.Pin = sensor->trigger_pin;
  configuration.Mode = GPIO_MODE_OUTPUT_PP;
  configuration.Pull = GPIO_NOPULL;
  configuration.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(sensor->trigger_port, &configuration);

  configuration.Pin = sensor->echo_pin;
  configuration.Mode = GPIO_MODE_INPUT;
  configuration.Pull = GPIO_NOPULL;
  configuration.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(sensor->echo_port, &configuration);
}

static AliceSIM_HCSR04_Status alice_hcsr04_wait_for_level(
  const AliceSIM_HCSR04 *sensor,
  GPIO_PinState level
) {
  uint32_t started = sensor->micros();
  while (HAL_GPIO_ReadPin(sensor->echo_port, sensor->echo_pin) != level) {
    if ((uint32_t)(sensor->micros() - started) >= sensor->timeout_us) return ALICESIM_HCSR04_ERROR_TIMEOUT;
  }
  return ALICESIM_HCSR04_OK;
}

static AliceSIM_HCSR04_Status alice_hcsr04_measure_high(
  const AliceSIM_HCSR04 *sensor,
  uint32_t *pulse_us
) {
  uint32_t started;
  uint32_t elapsed;
  if (pulse_us == NULL) return ALICESIM_HCSR04_ERROR_ARGUMENT;
  started = sensor->micros();
  while (HAL_GPIO_ReadPin(sensor->echo_port, sensor->echo_pin) == GPIO_PIN_SET) {
    elapsed = (uint32_t)(sensor->micros() - started);
    if (elapsed >= sensor->timeout_us) return ALICESIM_HCSR04_ERROR_TIMEOUT;
  }
  *pulse_us = (uint32_t)(sensor->micros() - started);
  return ALICESIM_HCSR04_OK;
}

AliceSIM_HCSR04_Status AliceSIM_HCSR04_Init(
  AliceSIM_HCSR04 *sensor,
  GPIO_TypeDef *trigger_port,
  uint16_t trigger_pin,
  GPIO_TypeDef *echo_port,
  uint16_t echo_pin,
  AliceSIM_DelayUsFn delay_us,
  AliceSIM_MicrosFn micros,
  uint32_t timeout_us
) {
  if (
    sensor == NULL || trigger_port == NULL || echo_port == NULL ||
    trigger_pin == 0U || echo_pin == 0U || delay_us == NULL || micros == NULL
  ) {
    return ALICESIM_HCSR04_ERROR_ARGUMENT;
  }
  sensor->trigger_port = trigger_port;
  sensor->trigger_pin = trigger_pin;
  sensor->echo_port = echo_port;
  sensor->echo_pin = echo_pin;
  sensor->delay_us = delay_us;
  sensor->micros = micros;
  sensor->timeout_us = timeout_us == 0U ? ALICESIM_HCSR04_DEFAULT_TIMEOUT_US : timeout_us;
  alice_hcsr04_configure(sensor);
  HAL_GPIO_WritePin(sensor->trigger_port, sensor->trigger_pin, GPIO_PIN_RESET);
  return ALICESIM_HCSR04_OK;
}

uint32_t AliceSIM_HCSR04_PulseToMillimeters(uint32_t pulse_us) {
  return (uint32_t)(((uint64_t)pulse_us * 343U + 1000U) / 2000U);
}

uint32_t AliceSIM_HCSR04_PulseToCentimetersX100(uint32_t pulse_us) {
  return (uint32_t)(((uint64_t)pulse_us * 1715U + 500U) / 1000U);
}

AliceSIM_HCSR04_Status AliceSIM_HCSR04_Read(
  AliceSIM_HCSR04 *sensor,
  AliceSIM_HCSR04_Sample *sample
) {
  AliceSIM_HCSR04_Status status;
  uint32_t distance_mm;
  if (
    sensor == NULL || sample == NULL || sensor->trigger_port == NULL || sensor->echo_port == NULL ||
    sensor->delay_us == NULL || sensor->micros == NULL
  ) {
    return ALICESIM_HCSR04_ERROR_ARGUMENT;
  }

  HAL_GPIO_WritePin(sensor->trigger_port, sensor->trigger_pin, GPIO_PIN_RESET);
  sensor->delay_us(2U);
  HAL_GPIO_WritePin(sensor->trigger_port, sensor->trigger_pin, GPIO_PIN_SET);
  sensor->delay_us(10U);
  HAL_GPIO_WritePin(sensor->trigger_port, sensor->trigger_pin, GPIO_PIN_RESET);

  status = alice_hcsr04_wait_for_level(sensor, GPIO_PIN_SET);
  if (status != ALICESIM_HCSR04_OK) return status;
  status = alice_hcsr04_measure_high(sensor, &sample->pulse_us);
  if (status != ALICESIM_HCSR04_OK) return status;

  distance_mm = AliceSIM_HCSR04_PulseToMillimeters(sample->pulse_us);
  sample->distance_mm = distance_mm;
  sample->distance_cm_x100 = AliceSIM_HCSR04_PulseToCentimetersX100(sample->pulse_us);
  if (distance_mm < ALICESIM_HCSR04_MIN_DISTANCE_MM || distance_mm > ALICESIM_HCSR04_MAX_DISTANCE_MM) {
    return ALICESIM_HCSR04_ERROR_OUT_OF_RANGE;
  }
  return ALICESIM_HCSR04_OK;
}

AliceSIM_HCSR04_Status AliceSIM_HCSR04_MeasureMm(
  AliceSIM_HCSR04 *sensor,
  uint32_t *distance_mm
) {
  AliceSIM_HCSR04_Sample sample;
  AliceSIM_HCSR04_Status status;
  if (distance_mm == NULL) return ALICESIM_HCSR04_ERROR_ARGUMENT;
  status = AliceSIM_HCSR04_Read(sensor, &sample);
  if (status == ALICESIM_HCSR04_OK || status == ALICESIM_HCSR04_ERROR_OUT_OF_RANGE) {
    *distance_mm = sample.distance_mm;
  }
  return status;
}

const char *AliceSIM_HCSR04_StatusText(AliceSIM_HCSR04_Status status) {
  if (status == ALICESIM_HCSR04_OK) return "ok";
  if (status == ALICESIM_HCSR04_ERROR_ARGUMENT) return "invalid argument";
  if (status == ALICESIM_HCSR04_ERROR_TIMEOUT) return "echo timeout";
  if (status == ALICESIM_HCSR04_ERROR_OUT_OF_RANGE) return "distance out of range";
  return "unknown HC-SR04 status";
}
