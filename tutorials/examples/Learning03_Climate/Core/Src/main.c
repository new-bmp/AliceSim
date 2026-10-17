/* AliceSIM learning 03: an actual DHT11 measurement, displayed and reported. */
#include "main.h"
#include "alicesim_dht11.h"
#include "alicesim_tm1637.h"
#include <stdio.h>

#define HIGH_TEMPERATURE_X10 300 /* 30.0 degrees C, change and test the boundary. */

UART_HandleTypeDef huart2;
AliceSIM_DHT11 climate;
AliceSIM_DHT11_Sample climate_sample;
AliceSIM_TM1637 digits;
char uart_line[96];
int uart_length;
uint32_t climate_status;
int temperature_magnitude;

void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART2_UART_Init(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART2_UART_Init();

  AliceSIM_DHT11_Init(&climate, GPIOB, GPIO_PIN_0,
                     Timing_DelayUs, Timing_Micros);
  AliceSIM_TM1637_Init(&digits, GPIOB, GPIO_PIN_6,
                      GPIOB, GPIO_PIN_7, Timing_DelayUs);
  AliceSIM_TM1637_SetBrightness(&digits, 5, 1);
  HAL_Delay(1100); /* DHT11 power-up settling time, also on hardware. */

  while (1)
  {
    climate_status = AliceSIM_DHT11_Read(&climate, &climate_sample);
    if (climate_status == ALICESIM_DHT11_OK)
    {
      HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12,
          climate_sample.temperature_x10 >= HIGH_TEMPERATURE_X10 ? GPIO_PIN_SET : GPIO_PIN_RESET);
      /* Colon OFF identifies temperature; integer degrees on four digits. */
      AliceSIM_TM1637_DisplayNumber(&digits,
                                   climate_sample.temperature_x10 / 10, 0, 0);
      temperature_magnitude = climate_sample.temperature_x10;
      if (temperature_magnitude < 0) temperature_magnitude = -temperature_magnitude;
      uart_length = snprintf(uart_line, sizeof(uart_line),
                             "TEMP=%s%d.%d C\r\n",
                             climate_sample.temperature_x10 < 0 ? "-" : "",
                             temperature_magnitude / 10,
                             temperature_magnitude % 10);
      HAL_UART_Transmit(&huart2, (uint8_t *)uart_line, uart_length, 100);
      HAL_Delay(1000);

      /* Colon ON identifies humidity; serial keeps an explicit unit/label. */
      AliceSIM_TM1637_DisplayNumber(&digits,
                                   climate_sample.humidity_x10 / 10, 0, 1);
      uart_length = snprintf(uart_line, sizeof(uart_line),
                             "HUM=%u.%u %%RH\r\n",
                             climate_sample.humidity_x10 / 10,
                             climate_sample.humidity_x10 % 10);
      HAL_UART_Transmit(&huart2, (uint8_t *)uart_line, uart_length, 100);
    }
    else
    {
      HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
      AliceSIM_TM1637_Clear(&digits);
      uart_length = snprintf(uart_line, sizeof(uart_line),
                             "DHT11 ERROR=%lu\r\n", (unsigned long)climate_status);
      HAL_UART_Transmit(&huart2, (uint8_t *)uart_line, uart_length, 100);
    }
    HAL_Delay(1000); /* One sensor transaction every >= 2 seconds. */
  }
}

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef oscillator = {0};
  RCC_ClkInitTypeDef clocks = {0};
  oscillator.OscillatorType = RCC_OSCILLATORTYPE_HSI;
  oscillator.HSIState = RCC_HSI_ON;
  oscillator.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  oscillator.PLL.PLLState = RCC_PLL_NONE;
  if (HAL_RCC_OscConfig(&oscillator) != HAL_OK) Error_Handler();
  clocks.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                     RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clocks.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
  clocks.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clocks.APB1CLKDivider = RCC_HCLK_DIV1;
  clocks.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clocks, FLASH_LATENCY_0) != HAL_OK) Error_Handler();
}

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOB_CLK_ENABLE();
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0 | GPIO_PIN_6 | GPIO_PIN_7, GPIO_PIN_SET);
  gpio.Pin = GPIO_PIN_0;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_PULLUP;
  gpio.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &gpio);
  gpio.Pin = GPIO_PIN_6 | GPIO_PIN_7;
  gpio.Mode = GPIO_MODE_OUTPUT_OD;
  HAL_GPIO_Init(GPIOB, &gpio);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
  gpio.Pin = GPIO_PIN_12;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(GPIOB, &gpio);
}

static void MX_USART2_UART_Init(void)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  huart2.Init.Mode = UART_MODE_TX_RX;
  huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart2) != HAL_OK) Error_Handler();
}

void HAL_UART_MspInit(UART_HandleTypeDef *uart)
{
  GPIO_InitTypeDef gpio = {0};
  if (uart->Instance == USART2)
  {
    __HAL_RCC_USART2_CLK_ENABLE();
    __HAL_RCC_GPIOA_CLK_ENABLE();
    gpio.Pin = GPIO_PIN_2;
    gpio.Mode = GPIO_MODE_AF_PP;
    gpio.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(GPIOA, &gpio);
    gpio.Pin = GPIO_PIN_3;
    gpio.Mode = GPIO_MODE_INPUT;
    gpio.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(GPIOA, &gpio);
  }
}

void SysTick_Handler(void) { HAL_IncTick(); }
void Error_Handler(void) { __disable_irq(); while (1) {} }
