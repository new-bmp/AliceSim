#ifndef ALICESIM_BUZZER_H
#define ALICESIM_BUZZER_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_BUZZER_DEFAULT_TIMER_TICK_HZ 1000000UL
#define ALICESIM_BUZZER_DEFAULT_DUTY_PERMILLE     500U
#define ALICESIM_BUZZER_DEFAULT_MAX_PERIOD_TICKS 65536UL

typedef struct {
  TIM_HandleTypeDef *timer;
  uint32_t channel;
  uint32_t timer_tick_hz;
  uint32_t max_period_ticks;
  uint32_t frequency_hz;
  uint16_t duty_permille;
  uint8_t running;
} AliceSIM_Buzzer;

typedef struct {
  uint16_t frequency_hz;
  uint16_t duration_ms;
  uint16_t pause_ms;
} AliceSIM_BuzzerNote;

/**
 * Bind a passive buzzer to a CubeMX-created PWM channel.
 * The driver changes ARR/CCR, so this timer should not be shared with another
 * channel that requires an unrelated PWM frequency.
 */
HAL_StatusTypeDef AliceSIM_Buzzer_Init(
  AliceSIM_Buzzer *buzzer,
  TIM_HandleTypeDef *timer,
  uint32_t channel,
  uint32_t timer_tick_hz
);

/** Start or update a continuous PWM tone. Duty is expressed in permille. */
HAL_StatusTypeDef AliceSIM_Buzzer_Set(
  AliceSIM_Buzzer *buzzer,
  uint32_t frequency_hz,
  uint16_t duty_permille
);

/** Play one blocking tone with the default 50 percent duty, then stop. */
HAL_StatusTypeDef AliceSIM_Buzzer_Tone(
  AliceSIM_Buzzer *buzzer,
  uint32_t frequency_hz,
  uint32_t duration_ms
);

HAL_StatusTypeDef AliceSIM_Buzzer_Stop(AliceSIM_Buzzer *buzzer);

void AliceSIM_Buzzer_SetMaxPeriodTicks(
  AliceSIM_Buzzer *buzzer,
  uint32_t max_period_ticks
);

uint32_t AliceSIM_Buzzer_FrequencyToPeriodTicks(
  const AliceSIM_Buzzer *buzzer,
  uint32_t frequency_hz
);

HAL_StatusTypeDef AliceSIM_Buzzer_Play(
  AliceSIM_Buzzer *buzzer,
  const AliceSIM_BuzzerNote *notes,
  size_t note_count
);

#ifdef __cplusplus
}
#endif

#endif
