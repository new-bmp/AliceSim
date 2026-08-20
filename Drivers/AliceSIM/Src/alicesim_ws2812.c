#include "alicesim_ws2812.h"

HAL_StatusTypeDef AliceSIM_WS2812_Init(AliceSIM_WS2812 *device, void *context, AliceSIM_WS2812_TransmitFn transmit, uint16_t zero_high_ticks, uint16_t one_high_ticks, uint16_t reset_slots) {
  if (device == NULL || transmit == NULL || zero_high_ticks == 0U || one_high_ticks <= zero_high_ticks) return HAL_ERROR;
  device->context = context;
  device->transmit = transmit;
  device->zero_high_ticks = zero_high_ticks;
  device->one_high_ticks = one_high_ticks;
  device->reset_slots = reset_slots == 0U ? 48U : reset_slots;
  return HAL_OK;
}

uint32_t AliceSIM_WS2812_RequiredPulseCount(uint16_t led_count, uint16_t reset_slots) {
  return (uint32_t)led_count * 24U + reset_slots;
}

HAL_StatusTypeDef AliceSIM_WS2812_Encode(const AliceSIM_WS2812 *device, const uint8_t *rgb, uint16_t led_count, uint16_t *pulses, uint32_t capacity, uint32_t *pulse_count) {
  uint32_t required;
  uint32_t output = 0U;
  uint16_t led;
  uint8_t channel;
  uint8_t bit;
  if (device == NULL || rgb == NULL || pulses == NULL || pulse_count == NULL) return HAL_ERROR;
  required = AliceSIM_WS2812_RequiredPulseCount(led_count, device->reset_slots);
  if (capacity < required) return HAL_ERROR;
  for (led = 0U; led < led_count; led += 1U) {
    uint8_t grb[3] = {rgb[(uint32_t)led * 3U + 1U], rgb[(uint32_t)led * 3U], rgb[(uint32_t)led * 3U + 2U]};
    for (channel = 0U; channel < 3U; channel += 1U) {
      for (bit = 0U; bit < 8U; bit += 1U) pulses[output++] = (grb[channel] & (uint8_t)(0x80U >> bit)) != 0U ? device->one_high_ticks : device->zero_high_ticks;
    }
  }
  while (output < required) pulses[output++] = 0U;
  *pulse_count = required;
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_WS2812_Show(AliceSIM_WS2812 *device, const uint8_t *rgb, uint16_t led_count, uint16_t *pulses, uint32_t capacity) {
  uint32_t pulse_count = 0U;
  HAL_StatusTypeDef status;
  if (device == NULL || device->transmit == NULL) return HAL_ERROR;
  status = AliceSIM_WS2812_Encode(device, rgb, led_count, pulses, capacity, &pulse_count);
  if (status != HAL_OK) return status;
  return device->transmit(device->context, pulses, pulse_count);
}
