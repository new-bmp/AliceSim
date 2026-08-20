#ifndef ALICESIM_SG90_H
#define ALICESIM_SG90_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_SG90_DEFAULT_TIMER_TICK_HZ 1000000UL
#define ALICESIM_SG90_DEFAULT_MIN_PULSE_US      500U
#define ALICESIM_SG90_DEFAULT_MAX_PULSE_US     2500U
#define ALICESIM_SG90_DEFAULT_MAX_ANGLE_X10    1800U
#define ALICESIM_SG90_DEFAULT_ANGLE_DEGREES      90U

typedef struct {
  TIM_HandleTypeDef *timer;
  uint32_t channel;
  uint32_t timer_tick_hz;
  uint16_t min_pulse_us;
  uint16_t max_pulse_us;
  uint16_t max_angle_x10;
  uint16_t current_angle_x10;
  uint16_t current_pulse_us;
  uint8_t started;
} AliceSIM_SG90;

/**
 * Bind an SG90 to a CubeMX-configured PWM channel and start at 90 degrees.
 * A common setup is a 1 MHz timer counter with a 20,000 tick PWM period.
 * Passing timer_tick_hz as 0 selects the 1 MHz default.
 */
HAL_StatusTypeDef AliceSIM_SG90_Init(
  AliceSIM_SG90 *servo,
  TIM_HandleTypeDef *timer,
  uint32_t channel,
  uint32_t timer_tick_hz
);

HAL_StatusTypeDef AliceSIM_SG90_Start(AliceSIM_SG90 *servo);
HAL_StatusTypeDef AliceSIM_SG90_Stop(AliceSIM_SG90 *servo);

HAL_StatusTypeDef AliceSIM_SG90_SetCalibration(
  AliceSIM_SG90 *servo,
  uint16_t min_pulse_us,
  uint16_t max_pulse_us,
  uint16_t max_angle_x10
);

HAL_StatusTypeDef AliceSIM_SG90_SetAngle(
  AliceSIM_SG90 *servo,
  uint16_t angle_degrees
);

HAL_StatusTypeDef AliceSIM_SG90_SetAngleX10(
  AliceSIM_SG90 *servo,
  uint16_t angle_x10
);

HAL_StatusTypeDef AliceSIM_SG90_SetPulseUs(
  AliceSIM_SG90 *servo,
  uint16_t pulse_us
);

uint16_t AliceSIM_SG90_AngleToPulseUs(
  const AliceSIM_SG90 *servo,
  uint16_t angle_x10
);

uint32_t AliceSIM_SG90_PulseUsToCompare(
  const AliceSIM_SG90 *servo,
  uint16_t pulse_us
);

#ifdef __cplusplus
}
#endif

#endif
