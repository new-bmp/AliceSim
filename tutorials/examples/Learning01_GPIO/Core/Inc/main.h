#ifndef LEARNING01_MAIN_H
#define LEARNING01_MAIN_H

#include "stm32f1xx_hal.h"

#define RUN_SWITCH_GPIO_Port GPIOA
#define RUN_SWITCH_Pin GPIO_PIN_1
#define GREEN_LED_GPIO_Port GPIOB
#define GREEN_LED_Pin GPIO_PIN_12
#define RED_LED_GPIO_Port GPIOB
#define RED_LED_Pin GPIO_PIN_13

void SystemClock_Config(void);
void Error_Handler(void);

#endif
