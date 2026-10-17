#ifndef LEARNING10_MAIN_H
#define LEARNING10_MAIN_H
#include "stm32f1xx_hal.h"
#define BUTTON_Pin GPIO_PIN_1
#define BUTTON_GPIO_Port GPIOA
#define PRESS_LED_Pin GPIO_PIN_12
#define PRESS_LED_GPIO_Port GPIOB
#define COUNT_LED_Pin GPIO_PIN_13
#define COUNT_LED_GPIO_Port GPIOB
void SystemClock_Config(void);
void Error_Handler(void);
#endif
