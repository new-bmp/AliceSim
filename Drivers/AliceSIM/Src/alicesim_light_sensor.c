#include "alicesim_light_sensor.h"

static uint32_t alice_light_clamp(uint32_t value, uint32_t minimum, uint32_t maximum) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

static uint32_t alice_light_adc_max(uint8_t bits) {
  if (bits == 0U) bits = ALICESIM_LIGHT_SENSOR_DEFAULT_ADC_BITS;
  if (bits > 24U) bits = 24U;
  return (1UL << bits) - 1UL;
}

HAL_StatusTypeDef AliceSIM_LightSensor_Init(
  AliceSIM_LightSensor *sensor,
  ADC_HandleTypeDef *adc,
  GPIO_TypeDef *digital_port,
  uint16_t digital_pin,
  uint8_t digital_active_low,
  uint32_t reference_mv,
  uint8_t adc_bits,
  uint32_t poll_timeout_ms
) {
  if (sensor == NULL || adc == NULL) return HAL_ERROR;
  sensor->adc = adc;
  sensor->digital_port = digital_port;
  sensor->digital_pin = digital_pin;
  sensor->poll_timeout_ms = poll_timeout_ms == 0U ? HAL_MAX_DELAY : poll_timeout_ms;
  sensor->reference_mv = reference_mv == 0U ? ALICESIM_LIGHT_SENSOR_DEFAULT_VREF_MV : reference_mv;
  sensor->adc_max = alice_light_adc_max(adc_bits);
  sensor->raw_at_min_lux = 0U;
  sensor->raw_at_max_lux = sensor->adc_max;
  sensor->min_lux = 0U;
  sensor->max_lux = ALICESIM_LIGHT_SENSOR_DEFAULT_MAX_LUX;
  sensor->digital_active_low = digital_active_low != 0U ? 1U : 0U;
  return HAL_OK;
}

void AliceSIM_LightSensor_SetCalibration(
  AliceSIM_LightSensor *sensor,
  uint32_t raw_at_min_lux,
  uint32_t min_lux,
  uint32_t raw_at_max_lux,
  uint32_t max_lux
) {
  if (sensor == NULL || raw_at_min_lux == raw_at_max_lux || min_lux == max_lux) return;
  sensor->raw_at_min_lux = raw_at_min_lux;
  sensor->raw_at_max_lux = raw_at_max_lux;
  sensor->min_lux = min_lux;
  sensor->max_lux = max_lux;
}

HAL_StatusTypeDef AliceSIM_LightSensor_ReadRaw(
  AliceSIM_LightSensor *sensor,
  uint32_t *raw
) {
  HAL_StatusTypeDef status;
  HAL_StatusTypeDef stop_status;
  if (sensor == NULL || sensor->adc == NULL || raw == NULL) return HAL_ERROR;
  status = HAL_ADC_Start(sensor->adc);
  if (status != HAL_OK) return status;
  status = HAL_ADC_PollForConversion(sensor->adc, sensor->poll_timeout_ms);
  if (status != HAL_OK) {
    (void)HAL_ADC_Stop(sensor->adc);
    return status;
  }
  *raw = HAL_ADC_GetValue(sensor->adc);
  stop_status = HAL_ADC_Stop(sensor->adc);
  return stop_status == HAL_OK ? HAL_OK : stop_status;
}

uint32_t AliceSIM_LightSensor_RawToMillivolts(
  const AliceSIM_LightSensor *sensor,
  uint32_t raw
) {
  uint64_t scaled;
  if (sensor == NULL || sensor->adc_max == 0U) return 0U;
  raw = alice_light_clamp(raw, 0U, sensor->adc_max);
  scaled = (uint64_t)raw * sensor->reference_mv + (uint64_t)(sensor->adc_max / 2U);
  return (uint32_t)(scaled / sensor->adc_max);
}

uint32_t AliceSIM_LightSensor_RawToLux(
  const AliceSIM_LightSensor *sensor,
  uint32_t raw
) {
  uint32_t raw_low;
  uint32_t raw_high;
  uint32_t lux_low;
  uint32_t lux_high;
  uint64_t numerator;
  uint32_t denominator;
  if (sensor == NULL || sensor->raw_at_min_lux == sensor->raw_at_max_lux) return 0U;

  if (sensor->raw_at_min_lux < sensor->raw_at_max_lux) {
    raw_low = sensor->raw_at_min_lux;
    raw_high = sensor->raw_at_max_lux;
    lux_low = sensor->min_lux;
    lux_high = sensor->max_lux;
  } else {
    raw_low = sensor->raw_at_max_lux;
    raw_high = sensor->raw_at_min_lux;
    lux_low = sensor->max_lux;
    lux_high = sensor->min_lux;
  }

  raw = alice_light_clamp(raw, raw_low, raw_high);
  denominator = raw_high - raw_low;
  if (lux_high >= lux_low) {
    numerator = (uint64_t)(raw - raw_low) * (lux_high - lux_low);
    return lux_low + (uint32_t)(numerator / denominator);
  }
  numerator = (uint64_t)(raw - raw_low) * (lux_low - lux_high);
  return lux_low - (uint32_t)(numerator / denominator);
}

uint16_t AliceSIM_LightSensor_RawToPercentX100(
  const AliceSIM_LightSensor *sensor,
  uint32_t raw
) {
  uint64_t scaled;
  if (sensor == NULL || sensor->adc_max == 0U) return 0U;
  raw = alice_light_clamp(raw, 0U, sensor->adc_max);
  scaled = (uint64_t)raw * 10000U + (uint64_t)(sensor->adc_max / 2U);
  return (uint16_t)(scaled / sensor->adc_max);
}

HAL_StatusTypeDef AliceSIM_LightSensor_ReadMillivolts(
  AliceSIM_LightSensor *sensor,
  uint32_t *millivolts
) {
  uint32_t raw;
  HAL_StatusTypeDef status;
  if (millivolts == NULL) return HAL_ERROR;
  status = AliceSIM_LightSensor_ReadRaw(sensor, &raw);
  if (status != HAL_OK) return status;
  *millivolts = AliceSIM_LightSensor_RawToMillivolts(sensor, raw);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_LightSensor_ReadLux(
  AliceSIM_LightSensor *sensor,
  uint32_t *lux
) {
  uint32_t raw;
  HAL_StatusTypeDef status;
  if (lux == NULL) return HAL_ERROR;
  status = AliceSIM_LightSensor_ReadRaw(sensor, &raw);
  if (status != HAL_OK) return status;
  *lux = AliceSIM_LightSensor_RawToLux(sensor, raw);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_LightSensor_ReadDigital(
  const AliceSIM_LightSensor *sensor,
  GPIO_PinState *level,
  uint8_t *triggered
) {
  GPIO_PinState sampled;
  if (sensor == NULL || sensor->digital_port == NULL || level == NULL || triggered == NULL) return HAL_ERROR;
  sampled = HAL_GPIO_ReadPin(sensor->digital_port, sensor->digital_pin);
  *level = sampled;
  if (sensor->digital_active_low != 0U) *triggered = sampled == GPIO_PIN_RESET ? 1U : 0U;
  else *triggered = sampled == GPIO_PIN_SET ? 1U : 0U;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_LightSensor_Read(
  AliceSIM_LightSensor *sensor,
  AliceSIM_LightSensor_Sample *sample
) {
  HAL_StatusTypeDef status;
  if (sensor == NULL || sample == NULL) return HAL_ERROR;
  status = AliceSIM_LightSensor_ReadRaw(sensor, &sample->raw);
  if (status != HAL_OK) return status;
  sample->millivolts = AliceSIM_LightSensor_RawToMillivolts(sensor, sample->raw);
  sample->lux = AliceSIM_LightSensor_RawToLux(sensor, sample->raw);
  sample->percent_x100 = AliceSIM_LightSensor_RawToPercentX100(sensor, sample->raw);
  sample->digital_level = GPIO_PIN_RESET;
  sample->digital_valid = 0U;
  sample->triggered = 0U;
  if (sensor->digital_port != NULL) {
    status = AliceSIM_LightSensor_ReadDigital(sensor, &sample->digital_level, &sample->triggered);
    if (status != HAL_OK) return status;
    sample->digital_valid = 1U;
  }
  return HAL_OK;
}
