#include "main.h"

/* Cortex-M3 DWT supplies real microsecond timing for the bit-banged driver.
 * AliceSIM invokes the driver's semantic operation rather than this busy wait. */
static void Timing_EnableCounter(void)
{
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

uint32_t Timing_Micros(void)
{
  static uint32_t previous_cycles;
  static uint32_t total_microseconds;
  static uint32_t remainder_cycles;
  uint32_t now_cycles;
  uint32_t elapsed_cycles;
  uint32_t cycles_per_us = SystemCoreClock / 1000000U;
  Timing_EnableCounter();
  now_cycles = DWT->CYCCNT;
  elapsed_cycles = now_cycles - previous_cycles;
  previous_cycles = now_cycles;
  total_microseconds += elapsed_cycles / cycles_per_us;
  remainder_cycles += elapsed_cycles % cycles_per_us;
  total_microseconds += remainder_cycles / cycles_per_us;
  remainder_cycles %= cycles_per_us;
  return total_microseconds;
}

void Timing_DelayUs(uint32_t microseconds)
{
  uint32_t started;
  uint32_t cycles;
  Timing_EnableCounter();
  started = DWT->CYCCNT;
  cycles = microseconds * (SystemCoreClock / 1000000U);
  while ((uint32_t)(DWT->CYCCNT - started) < cycles) {}
}
