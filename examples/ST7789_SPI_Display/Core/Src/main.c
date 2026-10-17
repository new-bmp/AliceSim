#include "main.h"
#include "alicesim_st7789.h"
#include <stdio.h>

SPI_HandleTypeDef hspi1;
AliceSIM_ST7789 display;
uint32_t frame_count;
uint32_t progress;
uint32_t error_count;

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /* CS and RESET are inactive HIGH before the display is initialized. */
  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_SET);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0 | GPIO_PIN_1, GPIO_PIN_SET);
  gpio.Pin = GPIO_PIN_4;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOA, &gpio);
  gpio.Pin = GPIO_PIN_0 | GPIO_PIN_1;
  HAL_GPIO_Init(GPIOB, &gpio);

  gpio.Pin = GPIO_PIN_5 | GPIO_PIN_7;
  gpio.Mode = GPIO_MODE_AF_PP;
  HAL_GPIO_Init(GPIOA, &gpio);
}

static void MX_SPI1_Init(void)
{
  __HAL_RCC_SPI1_CLK_ENABLE();
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.Direction = SPI_DIRECTION_1LINE;
  hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
  hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi1.Init.NSS = SPI_NSS_SOFT;
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_2;
  hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
  hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
  hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
  hspi1.Init.CRCPolynomial = 7U;
  if (HAL_SPI_Init(&hspi1) != HAL_OK) Error_Handler();
}

static HAL_StatusTypeDef DrawDashboard(void)
{
  if (AliceSIM_ST7789_Fill(&display, 0x0841U) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_DrawString(&display, 24, 20, "ALICESIM", 3,
      ALICESIM_ST7789_COLOR_WHITE, 0x0841U) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_DrawString(&display, 24, 58, "SPI COLOR DISPLAY", 1,
      ALICESIM_ST7789_COLOR_CYAN, 0x0841U) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_FillRect(&display, 24, 82, 60, 28,
      ALICESIM_ST7789_COLOR_RED) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_FillRect(&display, 90, 82, 60, 28,
      ALICESIM_ST7789_COLOR_GREEN) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_FillRect(&display, 156, 82, 60, 28,
      ALICESIM_ST7789_COLOR_BLUE) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_DrawString(&display, 24, 130, "ST7789 240 X 240", 1,
      ALICESIM_ST7789_COLOR_WHITE, 0x0841U) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_DrawString(&display, 24, 157, "PROGRESS", 1,
      ALICESIM_ST7789_COLOR_WHITE, 0x0841U) != HAL_OK) return HAL_ERROR;
  if (AliceSIM_ST7789_FillRect(&display, 22, 178, 196, 14,
      ALICESIM_ST7789_COLOR_WHITE) != HAL_OK) return HAL_ERROR;
  return AliceSIM_ST7789_FillRect(&display, 24, 180, 192, 10, 0x0841U);
}

static HAL_StatusTypeDef UpdateProgress(void)
{
  char text[12];
  if (progress == 0U) {
    if (AliceSIM_ST7789_FillRect(&display, 24, 180, 192, 10, 0x0841U) != HAL_OK)
      return HAL_ERROR;
  } else {
    if (AliceSIM_ST7789_FillRect(&display, 24, 180, progress * 192U / 100U, 10,
        ALICESIM_ST7789_COLOR_CYAN) != HAL_OK) return HAL_ERROR;
  }
  snprintf(text, sizeof(text), "%3lu%%", (unsigned long)progress);
  return AliceSIM_ST7789_DrawString(&display, 180, 157, text, 1,
      ALICESIM_ST7789_COLOR_CYAN, 0x0841U);
}

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_SPI1_Init();
  if (AliceSIM_ST7789_Init(&display, &hspi1,
      GPIOA, GPIO_PIN_4, GPIOB, GPIO_PIN_0, GPIOB, GPIO_PIN_1, 100U) != HAL_OK)
    Error_Handler();
  if (DrawDashboard() != HAL_OK) Error_Handler();
  while (1)
  {
    if (UpdateProgress() == HAL_OK) ++frame_count;
    else ++error_count;
    HAL_Delay(250U);
    progress += 5U;
    if (progress > 100U) progress = 0U;
  }
}

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clocks = {0};
  osc.OscillatorType = RCC_OSCILLATORTYPE_HSI;
  osc.HSIState = RCC_HSI_ON;
  osc.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  osc.PLL.PLLState = RCC_PLL_NONE;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
  clocks.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                    RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clocks.SYSCLKSource = RCC_SYSCLKSOURCE_HSI;
  clocks.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clocks.APB1CLKDivider = RCC_HCLK_DIV1;
  clocks.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clocks, FLASH_LATENCY_0) != HAL_OK) Error_Handler();
}

void SysTick_Handler(void) { HAL_IncTick(); }
void Error_Handler(void) { __disable_irq(); while (1) {} }
