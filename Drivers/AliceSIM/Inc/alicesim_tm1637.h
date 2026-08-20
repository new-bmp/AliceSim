#ifndef ALICESIM_TM1637_H
#define ALICESIM_TM1637_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_TM1637_DIGIT_COUNT          4U
#define ALICESIM_TM1637_DEFAULT_BRIGHTNESS   7U
#define ALICESIM_TM1637_DEFAULT_BIT_DELAY_US 3U
#define ALICESIM_TM1637_SEGMENT_MINUS      0x40U
#define ALICESIM_TM1637_SEGMENT_COLON      0x80U

typedef void (*AliceSIM_TM1637_DelayUsFn)(uint32_t microseconds);

typedef struct {
  GPIO_TypeDef *clk_port;
  uint16_t clk_pin;
  GPIO_TypeDef *dio_port;
  uint16_t dio_pin;
  AliceSIM_TM1637_DelayUsFn delay_us;
  uint16_t bit_delay_us;
  uint8_t brightness;
  uint8_t enabled;
  uint8_t segments[ALICESIM_TM1637_DIGIT_COUNT];
} AliceSIM_TM1637;

/**
 * Bind a four-digit TM1637 display. CLK and DIO must be configured as
 * open-drain GPIO outputs with pull-ups. delay_us may be NULL to use the small
 * built-in fallback loop.
 */
HAL_StatusTypeDef AliceSIM_TM1637_Init(
  AliceSIM_TM1637 *display,
  GPIO_TypeDef *clk_port,
  uint16_t clk_pin,
  GPIO_TypeDef *dio_port,
  uint16_t dio_pin,
  AliceSIM_TM1637_DelayUsFn delay_us
);

HAL_StatusTypeDef AliceSIM_TM1637_SetBrightness(
  AliceSIM_TM1637 *display,
  uint8_t brightness,
  uint8_t enabled
);

HAL_StatusTypeDef AliceSIM_TM1637_DisplayNumber(
  AliceSIM_TM1637 *display,
  int32_t value,
  uint8_t leading_zero,
  uint8_t colon
);

HAL_StatusTypeDef AliceSIM_TM1637_Clear(AliceSIM_TM1637 *display);

HAL_StatusTypeDef AliceSIM_TM1637_WriteSegments(
  AliceSIM_TM1637 *display,
  uint8_t start_position,
  const uint8_t *segments,
  uint8_t count
);

HAL_StatusTypeDef AliceSIM_TM1637_DisplayRaw(
  AliceSIM_TM1637 *display,
  const uint8_t segments[ALICESIM_TM1637_DIGIT_COUNT],
  uint8_t colon
);

HAL_StatusTypeDef AliceSIM_TM1637_SetColon(
  AliceSIM_TM1637 *display,
  uint8_t enabled
);

void AliceSIM_TM1637_SetBitDelay(
  AliceSIM_TM1637 *display,
  uint16_t bit_delay_us
);

uint8_t AliceSIM_TM1637_EncodeDigit(uint8_t digit);

#ifdef __cplusplus
}
#endif

#endif
