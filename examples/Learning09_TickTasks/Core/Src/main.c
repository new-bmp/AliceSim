/* 学习 09：时间差、两个独立定时任务和开关状态机。 */
#include "main.h"

typedef enum { STOPPED = 0, RUNNING = 1 } RunState;
RunState run_state = STOPPED;
uint32_t now = 0U;
uint32_t last_green = 0U;
uint32_t last_red = 0U;
uint32_t elapsed_green = 0U;
uint32_t elapsed_red = 0U;
uint32_t switch_level = GPIO_PIN_SET;

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOB_CLK_ENABLE();
  HAL_GPIO_WritePin(GPIOB, GREEN_LED_Pin | RED_LED_Pin, GPIO_PIN_RESET);
  gpio.Pin = GREEN_LED_Pin | RED_LED_Pin;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &gpio);
  __HAL_RCC_GPIOA_CLK_ENABLE();
  gpio.Pin = RUN_SWITCH_Pin;
  gpio.Mode = GPIO_MODE_INPUT;
  gpio.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(RUN_SWITCH_GPIO_Port, &gpio);
}

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  run_state = STOPPED;
  last_green = HAL_GetTick();
  last_red = HAL_GetTick();

  while (1)
  {
    now = HAL_GetTick();
    switch_level = HAL_GPIO_ReadPin(RUN_SWITCH_GPIO_Port, RUN_SWITCH_Pin);

    if (switch_level == GPIO_PIN_RESET && run_state == STOPPED)
    {
      run_state = RUNNING;
      last_red = now;
      HAL_GPIO_WritePin(RED_LED_GPIO_Port, RED_LED_Pin, GPIO_PIN_SET);
    }
    if (switch_level == GPIO_PIN_SET && run_state == RUNNING)
    {
      run_state = STOPPED;
      HAL_GPIO_WritePin(RED_LED_GPIO_Port, RED_LED_Pin, GPIO_PIN_RESET);
    }

    /* 保存到 uint32_t，减法结果按模 2^32 表示。 */
    elapsed_green = now - last_green;
    elapsed_red = now - last_red;
    if (elapsed_green >= 250U)
    {
      last_green = now;
      HAL_GPIO_TogglePin(GREEN_LED_GPIO_Port, GREEN_LED_Pin);
    }
    if (run_state == RUNNING && elapsed_red >= 700U)
    {
      last_red = now;
      HAL_GPIO_TogglePin(RED_LED_GPIO_Port, RED_LED_Pin);
    }

    /* 固定 1 ms 轮询间隔，不等待某盏灯的 250/700 ms 周期。 */
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
  osc.PLL.PLLState = RCC_PLL_OFF;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
  clock.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                    RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clock.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
  clock.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clock.APB1CLKDivider = RCC_HCLK_DIV1;
  clock.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clock, FLASH_LATENCY_0) != HAL_OK) Error_Handler();
}

void HAL_MspInit(void)
{
  __HAL_RCC_AFIO_CLK_ENABLE();
  __HAL_RCC_PWR_CLK_ENABLE();
  /* Keep PA13/PA14 available for a hardware SWD debugger. */
  __HAL_AFIO_REMAP_SWJ_NOJTAG();
}

void SysTick_Handler(void) { HAL_IncTick(); }

void Error_Handler(void)
{
  __disable_irq();
  while (1) {}
}
