#include "main.h"

UART_HandleTypeDef huart2;
uint8_t rx_data[2];

static void MX_USART2_UART_Init(void)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  HAL_UART_Init(&huart2);
}

int main(void)
{
  HAL_Init();
  MX_USART2_UART_Init();

  while (1)
  {
    HAL_UART_Receive(&huart2, rx_data, 2, HAL_MAX_DELAY);
    GPIO_PinState state = GPIO_PIN_SET;
    if (rx_data[1] == '0')
    {
      state = GPIO_PIN_RESET;
    }

    if (rx_data[0] == 'R')
    {
      HAL_GPIO_WritePin(RED_GPIO_Port, RED_Pin, state);
    }
    else if (rx_data[0] == 'G')
    {
      HAL_GPIO_WritePin(GREEN_GPIO_Port, GREEN_Pin, state);
    }
    else if (rx_data[0] == 'B')
    {
      HAL_GPIO_WritePin(BLUE_GPIO_Port, BLUE_Pin, state);
    }

    HAL_UART_Transmit(&huart2, rx_data, 2, HAL_MAX_DELAY);
  }
}
