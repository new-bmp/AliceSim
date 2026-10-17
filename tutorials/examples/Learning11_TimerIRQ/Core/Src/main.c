/* 学习 11：定时器中断只累计事件，主循环处理事件并继续独立工作。 */
#include "main.h"
#include <stdio.h>
#include <string.h>

UART_HandleTypeDef huart2;
TIM_HandleTypeDef htim2;
volatile uint32_t timer_ticks = 0U;
uint32_t processed_ticks = 0U;
uint32_t work_count = 0U;
uint32_t last_work = 0U;
uint32_t loop_count = 0U;
char report[80];

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  HAL_GPIO_WritePin(TICK_LED_GPIO_Port, TICK_LED_Pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(WORK_LED_GPIO_Port, WORK_LED_Pin, GPIO_PIN_RESET);
  gpio.Pin = TICK_LED_Pin | WORK_LED_Pin;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &gpio);
}
static void MX_USART2_UART_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_USART2_CLK_ENABLE();
  gpio.Pin = GPIO_PIN_2;
  gpio.Mode = GPIO_MODE_AF_PP;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOA, &gpio);
  gpio.Pin = GPIO_PIN_3;
  gpio.Mode = GPIO_MODE_INPUT;
  gpio.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(GPIOA, &gpio);
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
static void MX_TIM2_Init(void)
{
  __HAL_RCC_TIM2_CLK_ENABLE();
  htim2.Instance = TIM2;
  /* HCLK=8 MHz，APB1 /2 -> PCLK1=4 MHz，TIM2 时钟再 ×2 = 8 MHz。 */
  htim2.Init.Prescaler = 7999U;
  htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim2.Init.Period = 99U;
  htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim2) != HAL_OK) Error_Handler();
  HAL_NVIC_SetPriority(TIM2_IRQn, 2U, 0U);
  HAL_NVIC_EnableIRQ(TIM2_IRQn);
}
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
  if (htim->Instance == TIM2) timer_ticks++;
}
int main(void)
{
  uint32_t pending_until;
  uint32_t now;
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART2_UART_Init();
  MX_TIM2_Init();
  HAL_GPIO_WritePin(TICK_LED_GPIO_Port, TICK_LED_Pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(WORK_LED_GPIO_Port, WORK_LED_Pin, GPIO_PIN_RESET);
  if (HAL_TIM_Base_Start_IT(&htim2) != HAL_OK) Error_Handler();
  last_work = HAL_GetTick();
  while (1)
  {
    /* 单写者累计计数优于 bool 标志：两次中断不会合并成一次。 */
    pending_until = timer_ticks;
    while (processed_ticks != pending_until)
    {
      processed_ticks++;
      HAL_GPIO_TogglePin(TICK_LED_GPIO_Port, TICK_LED_Pin);
      snprintf(report, sizeof(report), "TICK=%lu WORK=%lu\r\n",
        (unsigned long)processed_ticks, (unsigned long)work_count);
      HAL_UART_Transmit(&huart2, (uint8_t *)report, strlen(report), 100U);
    }
    /* 独立的 250 ms 主循环任务；不在回调里等待。 */
    now = HAL_GetTick();
    if ((uint32_t)(now - last_work) >= 250U)
    {
      last_work += 250U;
      work_count++;
      HAL_GPIO_TogglePin(WORK_LED_GPIO_Port, WORK_LED_Pin);
    }
    loop_count++;
    HAL_Delay(1U);
  }
}
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clock = {0};
  osc.OscillatorType = RCC_OSCILLATORTYPE_HSI;
  osc.HSIState = RCC_HSI_ON;
  osc.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  osc.PLL.PLLState = RCC_PLL_NONE;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
  clock.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                    RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clock.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
  clock.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clock.APB1CLKDivider = RCC_HCLK_DIV2;
  clock.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clock, FLASH_LATENCY_0) != HAL_OK) Error_Handler();
}
void TIM2_IRQHandler(void) { HAL_TIM_IRQHandler(&htim2); }
void SysTick_Handler(void) { HAL_IncTick(); }
void Error_Handler(void) { __disable_irq(); while (1) {} }
