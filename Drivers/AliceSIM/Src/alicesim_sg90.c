#include "alicesim_sg90.h"

static uint16_t alice_sg90_clamp_u16(uint16_t value, uint16_t minimum, uint16_t maximum) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

uint16_t AliceSIM_SG90_AngleToPulseUs(
  const AliceSIM_SG90 *servo,
  uint16_t angle_x10
) {
  uint32_t pulse_span;
  uint32_t scaled;
  if (servo == NULL || servo->max_angle_x10 == 0U || servo->max_pulse_us <= servo->min_pulse_us) return 0U;
  angle_x10 = alice_sg90_clamp_u16(angle_x10, 0U, servo->max_angle_x10);
  pulse_span = (uint32_t)servo->max_pulse_us - servo->min_pulse_us;
  scaled = (uint32_t)angle_x10 * pulse_span + (servo->max_angle_x10 / 2U);
  return (uint16_t)(servo->min_pulse_us + scaled / servo->max_angle_x10);
}

uint32_t AliceSIM_SG90_PulseUsToCompare(
  const AliceSIM_SG90 *servo,
  uint16_t pulse_us
) {
  uint64_t scaled;
  uint32_t compare;
  if (servo == NULL || servo->timer_tick_hz == 0U) return 0U;
  scaled = (uint64_t)pulse_us * servo->timer_tick_hz + 500000ULL;
  compare = (uint32_t)(scaled / 1000000ULL);
  return compare == 0U ? 1U : compare;
}

HAL_StatusTypeDef AliceSIM_SG90_SetPulseUs(
  AliceSIM_SG90 *servo,
  uint16_t pulse_us
) {
  uint32_t pulse_span;
  uint32_t angle_scaled;
  if (servo == NULL || servo->timer == NULL || servo->max_pulse_us <= servo->min_pulse_us) return HAL_ERROR;
  pulse_us = alice_sg90_clamp_u16(pulse_us, servo->min_pulse_us, servo->max_pulse_us);
  __HAL_TIM_SET_COMPARE(servo->timer, servo->channel, AliceSIM_SG90_PulseUsToCompare(servo, pulse_us));
  servo->current_pulse_us = pulse_us;
  pulse_span = (uint32_t)servo->max_pulse_us - servo->min_pulse_us;
  angle_scaled = ((uint32_t)pulse_us - servo->min_pulse_us) * servo->max_angle_x10 + pulse_span / 2U;
  servo->current_angle_x10 = (uint16_t)(angle_scaled / pulse_span);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_SG90_SetAngleX10(
  AliceSIM_SG90 *servo,
  uint16_t angle_x10
) {
  uint16_t pulse_us;
  if (servo == NULL) return HAL_ERROR;
  angle_x10 = alice_sg90_clamp_u16(angle_x10, 0U, servo->max_angle_x10);
  pulse_us = AliceSIM_SG90_AngleToPulseUs(servo, angle_x10);
  if (pulse_us == 0U) return HAL_ERROR;
  return AliceSIM_SG90_SetPulseUs(servo, pulse_us);
}

HAL_StatusTypeDef AliceSIM_SG90_SetAngle(
  AliceSIM_SG90 *servo,
  uint16_t angle_degrees
) {
  uint32_t angle_x10;
  if (servo == NULL) return HAL_ERROR;
  angle_x10 = (uint32_t)angle_degrees * 10U;
  if (angle_x10 > servo->max_angle_x10) angle_x10 = servo->max_angle_x10;
  return AliceSIM_SG90_SetAngleX10(servo, (uint16_t)angle_x10);
}

HAL_StatusTypeDef AliceSIM_SG90_SetCalibration(
  AliceSIM_SG90 *servo,
  uint16_t min_pulse_us,
  uint16_t max_pulse_us,
  uint16_t max_angle_x10
) {
  if (servo == NULL || min_pulse_us == 0U || max_pulse_us <= min_pulse_us || max_angle_x10 == 0U) return HAL_ERROR;
  servo->min_pulse_us = min_pulse_us;
  servo->max_pulse_us = max_pulse_us;
  servo->max_angle_x10 = max_angle_x10;
  if (servo->current_angle_x10 > max_angle_x10) servo->current_angle_x10 = max_angle_x10;
  return AliceSIM_SG90_SetAngleX10(servo, servo->current_angle_x10);
}

HAL_StatusTypeDef AliceSIM_SG90_Start(AliceSIM_SG90 *servo) {
  HAL_StatusTypeDef status;
  if (servo == NULL || servo->timer == NULL) return HAL_ERROR;
  status = AliceSIM_SG90_SetAngleX10(servo, servo->current_angle_x10);
  if (status != HAL_OK) return status;
  status = HAL_TIM_PWM_Start(servo->timer, servo->channel);
  if (status == HAL_OK) servo->started = 1U;
  return status;
}

HAL_StatusTypeDef AliceSIM_SG90_Stop(AliceSIM_SG90 *servo) {
  HAL_StatusTypeDef status;
  if (servo == NULL || servo->timer == NULL) return HAL_ERROR;
  __HAL_TIM_SET_COMPARE(servo->timer, servo->channel, 0U);
  if (servo->started == 0U) return HAL_OK;
  status = HAL_TIM_PWM_Stop(servo->timer, servo->channel);
  if (status == HAL_OK) servo->started = 0U;
  return status;
}

HAL_StatusTypeDef AliceSIM_SG90_Init(
  AliceSIM_SG90 *servo,
  TIM_HandleTypeDef *timer,
  uint32_t channel,
  uint32_t timer_tick_hz
) {
  if (servo == NULL || timer == NULL) return HAL_ERROR;
  servo->timer = timer;
  servo->channel = channel;
  servo->timer_tick_hz = timer_tick_hz == 0U ? ALICESIM_SG90_DEFAULT_TIMER_TICK_HZ : timer_tick_hz;
  servo->min_pulse_us = ALICESIM_SG90_DEFAULT_MIN_PULSE_US;
  servo->max_pulse_us = ALICESIM_SG90_DEFAULT_MAX_PULSE_US;
  servo->max_angle_x10 = ALICESIM_SG90_DEFAULT_MAX_ANGLE_X10;
  servo->current_angle_x10 = ALICESIM_SG90_DEFAULT_ANGLE_DEGREES * 10U;
  servo->current_pulse_us = AliceSIM_SG90_AngleToPulseUs(servo, servo->current_angle_x10);
  servo->started = 0U;
  return AliceSIM_SG90_Start(servo);
}
