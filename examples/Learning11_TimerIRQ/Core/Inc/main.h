#ifndef LEARNING11_MAIN_H
#define LEARNING11_MAIN_H
#include "stm32f1xx_hal.h"
#define TICK_LED_Pin GPIO_PIN_12
#define TICK_LED_GPIO_Port GPIOB
#define WORK_LED_Pin GPIO_PIN_13
#define WORK_LED_GPIO_Port GPIOB
void SystemClock_Config(void);
void Error_Handler(void);
#endif
