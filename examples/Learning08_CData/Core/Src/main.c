/* 学习 08：数组、结构体、位掩码和指针输出参数。 */
#include "main.h"

typedef struct
{
  uint8_t mask;
  uint16_t hold_ms;
} ChaseStep;

/* 每个元素描述一步：亮哪盏灯、保持多久。 */
const ChaseStep steps[3] = {{1U, 200U}, {2U, 200U}, {4U, 400U}};
uint8_t led_mask = 0U;
uint16_t hold_time = 0U;
uint8_t loop_count = 254U;

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOB_CLK_ENABLE();
  HAL_GPIO_WritePin(GPIOB, GREEN_LED_Pin | RED_LED_Pin | BLUE_LED_Pin, GPIO_PIN_RESET);
  gpio.Pin = GREEN_LED_Pin | RED_LED_Pin | BLUE_LED_Pin;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &gpio);
}

static uint8_t NextIndex(void)
{
  /* static 局部变量只初始化一次；current 每次调用重新创建。 */
  static uint8_t index = 0U;
  uint8_t current = index;
  index = (index + 1U) % 3U;
  return current;
}

static void ReadStep(uint8_t index, uint8_t *mask, uint16_t *hold_ms)
{
  /* * 解引用，写入调用者提供的两个变量。 */
  *mask = steps[index].mask;
  *hold_ms = steps[index].hold_ms;
}

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();

  while (1)
  {
    ReadStep(NextIndex(), &led_mask, &hold_time);
    HAL_GPIO_WritePin(GREEN_LED_GPIO_Port, GREEN_LED_Pin,
      (led_mask & (1U << 0U)) != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(RED_LED_GPIO_Port, RED_LED_Pin,
      (led_mask & (1U << 1U)) != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(BLUE_LED_GPIO_Port, BLUE_LED_Pin,
      (led_mask & (1U << 2U)) != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET);
    /* uint8_t 的赋值转换按模 256 回绕；不要推广到有符号溢出。 */
    loop_count++;
    HAL_Delay(hold_time);
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
