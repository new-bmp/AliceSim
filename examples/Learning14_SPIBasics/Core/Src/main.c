#include "main.h"

SPI_HandleTypeDef hspi1;
uint8_t packet[2];
uint32_t row, phase, frame_count, initialized, error_count;
/* Two bytes are one 16-bit MAX7219 word: address first, data second, MSB first. */
static HAL_StatusTypeDef WriteRegister(uint8_t address, uint8_t value)
{
  HAL_StatusTypeDef status;
  packet[0] = address;
  packet[1] = value;
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
  status = HAL_SPI_Transmit(&hspi1, packet, 2U, 100U);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_SET); /* LOAD rising edge latches. */
  return status;
}
static HAL_StatusTypeDef InitializeMatrix(void)
{
  if (WriteRegister(0x0FU, 0U) != HAL_OK) return HAL_ERROR;
  if (WriteRegister(0x0CU, 0U) != HAL_OK) return HAL_ERROR;
  if (WriteRegister(0x09U, 0U) != HAL_OK) return HAL_ERROR;
  if (WriteRegister(0x0BU, 7U) != HAL_OK) return HAL_ERROR;
  if (WriteRegister(0x0AU, 3U) != HAL_OK) return HAL_ERROR;
  for (row = 1U; row <= 8U; ++row)
    if (WriteRegister(row, 0U) != HAL_OK) return HAL_ERROR;
  return WriteRegister(0x0CU, 1U);
}
static HAL_StatusTypeDef DrawDiagonal(void)
{
  uint8_t value;
  for (row = 0U; row < 8U; ++row)
  {
    if (phase == 0U) value = 1U << row;
    else value = 128U >> row;
    if (WriteRegister(row + 1U, value) != HAL_OK) return HAL_ERROR;
  }
  return HAL_OK;
}
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_SET);
  gpio.Pin = GPIO_PIN_0;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
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
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_16;
  hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
  hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
  hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
  hspi1.Init.CRCPolynomial = 7;
  if (HAL_SPI_Init(&hspi1) != HAL_OK) Error_Handler();
}
int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_SPI1_Init();
  while (1)
  {
    if (!initialized)
    {
      if (InitializeMatrix() == HAL_OK) initialized = 1U;
      else ++error_count;
    }
    if (initialized)
    {
      if (DrawDiagonal() == HAL_OK) { ++frame_count; phase = 1U - phase; }
      else { ++error_count; initialized = 0U; }
    }
    HAL_Delay(500U);
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
