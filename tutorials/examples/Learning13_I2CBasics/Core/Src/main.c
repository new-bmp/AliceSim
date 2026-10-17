#include "main.h"

#define OLED_ADDRESS_7BIT 0x3CU
#define OLED_HAL_ADDRESS (OLED_ADDRESS_7BIT << 1U)
I2C_HandleTypeDef hi2c1;
uint8_t command[2];
uint8_t pixels[129];
uint8_t init_commands[] = {
  0x00, 0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40,
  0x8D, 0x14, 0x20, 0x02, 0xA1, 0xC8, 0xDA, 0x12,
  0x81, 0x7F, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6, 0xAF
};
uint32_t initialized, phase, frame_count, error_count, transfer_count;

static HAL_StatusTypeDef WriteBytes(uint8_t *bytes, uint16_t count)
{
  HAL_StatusTypeDef status = HAL_I2C_Master_Transmit(
    &hi2c1, OLED_HAL_ADDRESS, bytes, count, 100U);
  ++transfer_count;
  return status;
}
static HAL_StatusTypeDef Command(uint8_t value)
{
  command[0] = 0x00U; /* Co=0, D/C#=0: following bytes are commands. */
  command[1] = value;
  return WriteBytes(command, 2U);
}
static HAL_StatusTypeDef SelectPage(uint8_t page)
{
  if (Command(0xB0U + page) != HAL_OK) return HAL_ERROR;
  if (Command(0x00U) != HAL_OK) return HAL_ERROR;
  return Command(0x10U); /* lower/upper column address nibbles = zero */
}
static HAL_StatusTypeDef InitializeDisplay(void)
{
  uint32_t page, column;
  if (WriteBytes(init_commands, sizeof(init_commands)) != HAL_OK) return HAL_ERROR;
  pixels[0] = 0x40U; /* Co=0, D/C#=1: following bytes go to display RAM. */
  for (column = 1U; column <= 128U; ++column) pixels[column] = 0U;
  for (page = 0U; page < 8U; ++page)
  {
    if (SelectPage(page) != HAL_OK) return HAL_ERROR;
    if (WriteBytes(pixels, sizeof(pixels)) != HAL_OK) return HAL_ERROR;
  }
  return HAL_OK;
}
static HAL_StatusTypeDef DrawDiagonal(void)
{
  uint32_t column;
  if (SelectPage(0U) != HAL_OK) return HAL_ERROR;
  pixels[0] = 0x40U;
  for (column = 0U; column < 8U; ++column)
  {
    if (phase == 0U) pixels[column + 1U] = 1U << column;
    else pixels[column + 1U] = 128U >> column;
  }
  return WriteBytes(pixels, 9U);
}
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOB_CLK_ENABLE();
  gpio.Pin = GPIO_PIN_6 | GPIO_PIN_7;
  gpio.Mode = GPIO_MODE_AF_OD; /* I2C releases HIGH; the external resistors pull up. */
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOB, &gpio);
}
static void MX_I2C1_Init(void)
{
  __HAL_RCC_I2C1_CLK_ENABLE();
  hi2c1.Instance = I2C1;
  hi2c1.Init.ClockSpeed = 100000;
  hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
  hi2c1.Init.OwnAddress1 = 0;
  hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
  hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
  hi2c1.Init.OwnAddress2 = 0;
  hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
  hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
  if (HAL_I2C_Init(&hi2c1) != HAL_OK) Error_Handler();
}
int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_I2C1_Init();
  HAL_Delay(20U);
  while (1)
  {
    if (!initialized)
    {
      if (InitializeDisplay() == HAL_OK) initialized = 1U;
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
