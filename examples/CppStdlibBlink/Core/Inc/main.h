#ifndef CXX_STDLIB_BLINK_MAIN_H
#define CXX_STDLIB_BLINK_MAIN_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GPIO_TypeDef GPIO_TypeDef;

extern GPIO_TypeDef *GPIOC;

#define GPIO_PIN_13 (1U << 13)
#define GPIO_PIN_RESET 0U
#define GPIO_PIN_SET 1U

#define STATUS_LED_GPIO_Port GPIOC
#define STATUS_LED_Pin GPIO_PIN_13

void HAL_Init(void);
void HAL_GPIO_WritePin(GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin, uint32_t PinState);
void HAL_Delay(uint32_t Delay);

#ifdef __cplusplus
}
#endif

#endif
