#ifndef ALICESIM_WS2812_H
#define ALICESIM_WS2812_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

typedef HAL_StatusTypeDef (*AliceSIM_WS2812_TransmitFn)(void *context, const uint16_t *pulses, uint32_t pulse_count);

typedef struct {
  void *context;
  AliceSIM_WS2812_TransmitFn transmit;
  uint16_t zero_high_ticks;
  uint16_t one_high_ticks;
  uint16_t reset_slots;
} AliceSIM_WS2812;

HAL_StatusTypeDef AliceSIM_WS2812_Init(AliceSIM_WS2812 *device, void *context, AliceSIM_WS2812_TransmitFn transmit, uint16_t zero_high_ticks, uint16_t one_high_ticks, uint16_t reset_slots);
uint32_t AliceSIM_WS2812_RequiredPulseCount(uint16_t led_count, uint16_t reset_slots);
HAL_StatusTypeDef AliceSIM_WS2812_Encode(const AliceSIM_WS2812 *device, const uint8_t *rgb, uint16_t led_count, uint16_t *pulses, uint32_t capacity, uint32_t *pulse_count);
HAL_StatusTypeDef AliceSIM_WS2812_Show(AliceSIM_WS2812 *device, const uint8_t *rgb, uint16_t led_count, uint16_t *pulses, uint32_t capacity);

#ifdef __cplusplus
}
#endif

#endif
