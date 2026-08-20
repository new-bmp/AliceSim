#ifndef __MAIN_H
#define __MAIN_H

typedef unsigned char uint8_t;
typedef unsigned int uint32_t;
typedef int GPIO_PinState;

typedef struct {
  void *Instance;
  struct {
    uint32_t BaudRate;
    uint32_t WordLength;
    uint32_t StopBits;
    uint32_t Parity;
  } Init;
} UART_HandleTypeDef;

#define GPIOA ((void *)0x40010800U)
#define GPIOB ((void *)0x40010C00U)
#define USART2 ((void *)0x40004400U)

#define GPIO_PIN_0 (1U << 0)
#define GPIO_PIN_6 (1U << 6)
#define GPIO_PIN_7 (1U << 7)
#define GPIO_PIN_RESET 0
#define GPIO_PIN_SET 1
#define HAL_MAX_DELAY 0xFFFFFFFFU
#define UART_WORDLENGTH_8B 8U
#define UART_STOPBITS_1 1U
#define UART_PARITY_NONE 0U

#define RED_Pin GPIO_PIN_6
#define RED_GPIO_Port GPIOA
#define GREEN_Pin GPIO_PIN_7
#define GREEN_GPIO_Port GPIOA
#define BLUE_Pin GPIO_PIN_0
#define BLUE_GPIO_Port GPIOB

int HAL_Init(void);
int HAL_UART_Init(UART_HandleTypeDef *handle);
int HAL_UART_Receive(UART_HandleTypeDef *handle, uint8_t *data, uint32_t length, uint32_t timeout);
int HAL_UART_Transmit(UART_HandleTypeDef *handle, uint8_t *data, uint32_t length, uint32_t timeout);
int HAL_GPIO_WritePin(void *port, uint32_t pin, GPIO_PinState state);

#endif
