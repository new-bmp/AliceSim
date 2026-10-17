#ifndef LEARNING_MAIN_H
#define LEARNING_MAIN_H
#include "stm32f1xx_hal.h"
#define GREEN_LED_GPIO_Port GPIOB
#define GREEN_LED_Pin GPIO_PIN_12
void SystemClock_Config(void);
void Error_Handler(void);
#endif
