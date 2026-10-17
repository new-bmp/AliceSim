#ifndef LEARNING03_MAIN_H
#define LEARNING03_MAIN_H
#include "stm32f1xx_hal.h"
void Error_Handler(void);
void Timing_DelayUs(uint32_t microseconds);
uint32_t Timing_Micros(void);
#endif
