#include "alicesim_buzzer.h"

uint32_t AliceSIM_Buzzer_FrequencyToPeriodTicks(
  const AliceSIM_Buzzer *buzzer,
  uint32_t frequency_hz
) {
  uint64_t rounded;
  uint32_t period_ticks;
  if (buzzer == NULL || buzzer->timer_tick_hz == 0U || frequency_hz == 0U) return 0U;
  rounded = (uint64_t)buzzer->timer_tick_hz + frequency_hz / 2U;
  period_ticks = (uint32_t)(rounded / frequency_hz);
  if (period_ticks < 2U || period_ticks > buzzer->max_period_ticks) return 0U;
  return period_ticks;
}

void AliceSIM_Buzzer_SetMaxPeriodTicks(
  AliceSIM_Buzzer *buzzer,
  uint32_t max_period_ticks
) {
  if (buzzer == NULL) return;
  buzzer->max_period_ticks = max_period_ticks < 2U ? 2U : max_period_ticks;
}

HAL_StatusTypeDef AliceSIM_Buzzer_Init(
  AliceSIM_Buzzer *buzzer,
  TIM_HandleTypeDef *timer,
  uint32_t channel,
  uint32_t timer_tick_hz
) {
  if (buzzer == NULL || timer == NULL) return HAL_ERROR;
  buzzer->timer = timer;
  buzzer->channel = channel;
  buzzer->timer_tick_hz = timer_tick_hz == 0U ? ALICESIM_BUZZER_DEFAULT_TIMER_TICK_HZ : timer_tick_hz;
  buzzer->max_period_ticks = ALICESIM_BUZZER_DEFAULT_MAX_PERIOD_TICKS;
  buzzer->frequency_hz = 0U;
  buzzer->duty_permille = ALICESIM_BUZZER_DEFAULT_DUTY_PERMILLE;
  buzzer->running = 0U;
  __HAL_TIM_SET_COMPARE(timer, channel, 0U);
  __HAL_TIM_SET_COUNTER(timer, 0U);
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_Buzzer_Set(
  AliceSIM_Buzzer *buzzer,
  uint32_t frequency_hz,
  uint16_t duty_permille
) {
  HAL_StatusTypeDef status;
  uint32_t period_ticks;
  uint32_t compare_ticks;
  if (buzzer == NULL || buzzer->timer == NULL || duty_permille == 0U || duty_permille >= 1000U) return HAL_ERROR;
  period_ticks = AliceSIM_Buzzer_FrequencyToPeriodTicks(buzzer, frequency_hz);
  if (period_ticks == 0U) return HAL_ERROR;
  compare_ticks = (uint32_t)(((uint64_t)period_ticks * duty_permille + 500U) / 1000U);
  if (compare_ticks == 0U) compare_ticks = 1U;
  if (compare_ticks >= period_ticks) compare_ticks = period_ticks - 1U;

  __HAL_TIM_SET_AUTORELOAD(buzzer->timer, period_ticks - 1U);
  __HAL_TIM_SET_COUNTER(buzzer->timer, 0U);
  __HAL_TIM_SET_COMPARE(buzzer->timer, buzzer->channel, compare_ticks);
  if (buzzer->running == 0U) {
    status = HAL_TIM_PWM_Start(buzzer->timer, buzzer->channel);
    if (status != HAL_OK) {
      __HAL_TIM_SET_COMPARE(buzzer->timer, buzzer->channel, 0U);
      return status;
    }
    buzzer->running = 1U;
  }
  buzzer->frequency_hz = frequency_hz;
  buzzer->duty_permille = duty_permille;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_Buzzer_Stop(AliceSIM_Buzzer *buzzer) {
  HAL_StatusTypeDef status;
  if (buzzer == NULL || buzzer->timer == NULL) return HAL_ERROR;
  __HAL_TIM_SET_COMPARE(buzzer->timer, buzzer->channel, 0U);
  buzzer->frequency_hz = 0U;
  if (buzzer->running == 0U) return HAL_OK;
  status = HAL_TIM_PWM_Stop(buzzer->timer, buzzer->channel);
  if (status == HAL_OK) buzzer->running = 0U;
  return status;
}

HAL_StatusTypeDef AliceSIM_Buzzer_Tone(
  AliceSIM_Buzzer *buzzer,
  uint32_t frequency_hz,
  uint32_t duration_ms
) {
  HAL_StatusTypeDef status;
  status = AliceSIM_Buzzer_Set(buzzer, frequency_hz, ALICESIM_BUZZER_DEFAULT_DUTY_PERMILLE);
  if (status != HAL_OK) return status;
  if (duration_ms != 0U) HAL_Delay(duration_ms);
  return AliceSIM_Buzzer_Stop(buzzer);
}

HAL_StatusTypeDef AliceSIM_Buzzer_Play(
  AliceSIM_Buzzer *buzzer,
  const AliceSIM_BuzzerNote *notes,
  size_t note_count
) {
  size_t index;
  HAL_StatusTypeDef status;
  if (buzzer == NULL || (notes == NULL && note_count != 0U)) return HAL_ERROR;
  for (index = 0U; index < note_count; index += 1U) {
    if (notes[index].frequency_hz == 0U) {
      status = AliceSIM_Buzzer_Stop(buzzer);
      if (status != HAL_OK) return status;
      if (notes[index].duration_ms != 0U) HAL_Delay(notes[index].duration_ms);
    } else {
      status = AliceSIM_Buzzer_Tone(buzzer, notes[index].frequency_hz, notes[index].duration_ms);
      if (status != HAL_OK) return status;
    }
    if (notes[index].pause_ms != 0U) HAL_Delay(notes[index].pause_ms);
  }
  return HAL_OK;
}
