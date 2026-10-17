/* 学习 10：低有效按键、非阻塞消抖、短按计数和 EXTI 通知。 */
#include "main.h"
#include <stdio.h>
#include <string.h>

#define DEBOUNCE_MS 30U
#define LONG_PRESS_MS 1000U
UART_HandleTypeDef huart2;
/* 回调写，主循环读；volatile 让每次访问都重新读取共享值。 */
volatile uint32_t edge_pending = 0U;
volatile uint32_t edge_tick = 0U;
uint32_t candidate_state = 1U; /* GPIO_PIN_SET：上拉、未按下 */
uint32_t stable_state = 1U;
uint32_t candidate_since = 0U;
uint32_t last_edge_seen = 0U;
uint32_t press_started = 0U;
uint32_t pressed = 0U;
uint32_t long_handled = 0U;
uint32_t press_count = 0U;
uint32_t loop_count = 0U;
char report[64];

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  __HAL_RCC_AFIO_CLK_ENABLE();
  HAL_GPIO_WritePin(PRESS_LED_GPIO_Port, PRESS_LED_Pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(COUNT_LED_GPIO_Port, COUNT_LED_Pin, GPIO_PIN_RESET);
  gpio.Pin = PRESS_LED_Pin | COUNT_LED_Pin;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &gpio);
  gpio.Pin = BUTTON_Pin;
  gpio.Mode = GPIO_MODE_IT_RISING_FALLING;
  gpio.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(BUTTON_GPIO_Port, &gpio);
  HAL_NVIC_SetPriority(EXTI1_IRQn, 2U, 0U);
  HAL_NVIC_EnableIRQ(EXTI1_IRQn);
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

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
  if (GPIO_Pin == BUTTON_Pin)
  {
    /* 只通知和记时；不要在中断里延时、消抖、打印。 */
    edge_tick = HAL_GetTick();
    edge_pending = 1U;
  }
}

int main(void)
{
  uint32_t now;
  uint32_t raw_state;
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART2_UART_Init();
  HAL_GPIO_WritePin(PRESS_LED_GPIO_Port, PRESS_LED_Pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(COUNT_LED_GPIO_Port, COUNT_LED_Pin, GPIO_PIN_RESET);
  /* 初始状态通过同一个 30 ms 确认过程，支持上电时按住。 */
  candidate_state = HAL_GPIO_ReadPin(BUTTON_GPIO_Port, BUTTON_Pin);
  candidate_since = HAL_GetTick();
  while (1)
  {
    now = HAL_GetTick();
    raw_state = HAL_GPIO_ReadPin(BUTTON_GPIO_Port, BUTTON_Pin);
    if (edge_pending != 0U)
    {
      /* 先清通知再采样；若又有边沿，下一圈仍会收到通知。 */
      edge_pending = 0U;
      raw_state = HAL_GPIO_ReadPin(BUTTON_GPIO_Port, BUTTON_Pin);
      candidate_state = raw_state;
      last_edge_seen = edge_tick;
      /* 从处理通知的时刻计稳定窗口，避免异步更新时间戳的竞态。 */
      candidate_since = HAL_GetTick();
    }
    /* 轮询兜底也说明：消抖是状态机，不依赖中断替我们过滤。 */
    if (raw_state != candidate_state)
    {
      candidate_state = raw_state;
      candidate_since = HAL_GetTick();
    }
    now = HAL_GetTick();
    if (candidate_state != stable_state &&
        (uint32_t)(now - candidate_since) >= DEBOUNCE_MS)
    {
      stable_state = candidate_state;
      if (stable_state == GPIO_PIN_RESET)
      {
        pressed = 1U;
        press_started = now;
        long_handled = 0U;
        HAL_GPIO_WritePin(PRESS_LED_GPIO_Port, PRESS_LED_Pin, GPIO_PIN_SET);
        snprintf(report, sizeof(report), "PRESS\r\n");
      }
      else
      {
        pressed = 0U;
        HAL_GPIO_WritePin(PRESS_LED_GPIO_Port, PRESS_LED_Pin, GPIO_PIN_RESET);
        if (long_handled == 0U)
        {
          /* 短按在确认松开时计数，因此长按不会再算一次短按。 */
          press_count++;
          HAL_GPIO_WritePin(COUNT_LED_GPIO_Port, COUNT_LED_Pin,
            (press_count % 2U) ? GPIO_PIN_SET : GPIO_PIN_RESET);
          snprintf(report, sizeof(report), "SHORT count=%lu\r\n", (unsigned long)press_count);
        }
        else
          snprintf(report, sizeof(report), "RELEASE after long\r\n");
      }
      HAL_UART_Transmit(&huart2, (uint8_t *)report, strlen(report), 100U);
    }
    if (pressed != 0U && long_handled == 0U &&
        (uint32_t)(now - press_started) >= LONG_PRESS_MS)
    {
      long_handled = 1U;
      press_count = 0U;
      HAL_GPIO_WritePin(COUNT_LED_GPIO_Port, COUNT_LED_Pin, GPIO_PIN_RESET);
      snprintf(report, sizeof(report), "LONG RESET count=0\r\n");
      HAL_UART_Transmit(&huart2, (uint8_t *)report, strlen(report), 100U);
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
  clock.APB1CLKDivider = RCC_HCLK_DIV1;
  clock.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clock, FLASH_LATENCY_0) != HAL_OK) Error_Handler();
}
void EXTI1_IRQHandler(void) { HAL_GPIO_EXTI_IRQHandler(BUTTON_Pin); }
void SysTick_Handler(void) { HAL_IncTick(); }
void Error_Handler(void) { __disable_irq(); while (1) {} }
