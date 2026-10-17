/* AliceSIM learning 06: sensing, an SPI matrix, PWM and real relay contacts. */
#include "main.h"
#include "alicesim_hcsr04.h"
#include "alicesim_buzzer.h"
#include <stdio.h>

#define STOP_DISTANCE_MM 500U
#define CAUTION_DISTANCE_MM 1000U

SPI_HandleTypeDef hspi1;
TIM_HandleTypeDef htim2;
UART_HandleTypeDef huart2;
AliceSIM_HCSR04 ranger;
AliceSIM_Buzzer buzzer;
uint32_t distance_mm;
uint32_t measure_status;
uint32_t zone;
uint32_t previous_zone = 99U;
uint8_t row;
uint8_t picture[8];
char report[96];
int report_length;

void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_SPI1_Init(void);
static void MX_TIM2_Init(void);
static void MX_USART2_UART_Init(void);
static void Matrix_WriteRegister(uint8_t address, uint8_t value)
{
  uint8_t packet[2];
  packet[0] = address;
  packet[1] = value;
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
  if (HAL_SPI_Transmit(&hspi1, packet, 2U, 100U) != HAL_OK) Error_Handler();
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_SET);
}

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_SPI1_Init();
  MX_TIM2_Init();
  MX_USART2_UART_Init();
  AliceSIM_HCSR04_Init(&ranger, GPIOB, GPIO_PIN_1,
      GPIOB, GPIO_PIN_10, Timing_DelayUs, Timing_Micros, 30000U);
  AliceSIM_Buzzer_Init(&buzzer, &htim2, TIM_CHANNEL_1, 1000000U);
  Matrix_WriteRegister(0x0f, 0x00); /* display test off */
  Matrix_WriteRegister(0x09, 0x00); /* raw 8 x 8 pixels, not BCD decode */
  Matrix_WriteRegister(0x0b, 0x07); /* all eight rows */
  Matrix_WriteRegister(0x0a, 0x08); /* moderate brightness */
  Matrix_WriteRegister(0x0c, 0x01); /* normal operation */

  while (1)
  {
    measure_status = AliceSIM_HCSR04_MeasureMm(&ranger, &distance_mm);
    /* A missing sensor is an alarm, never a fabricated safe distance. */
    if (measure_status != ALICESIM_HCSR04_OK) zone = 3U;
    else if (distance_mm < STOP_DISTANCE_MM) zone = 2U;
    else if (distance_mm < CAUTION_DISTANCE_MM) zone = 1U;
    else zone = 0U;

    /* Update outputs only on a zone change. Sampling/reporting stays periodic. */
    if (zone != previous_zone)
    {
      if (zone == 0U)
      {
        picture[0]=0x3c; picture[1]=0x42; picture[2]=0xa5; picture[3]=0x81;
        picture[4]=0xa5; picture[5]=0x99; picture[6]=0x42; picture[7]=0x3c;
        AliceSIM_Buzzer_Stop(&buzzer);
        HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_SET); /* active LOW */
      }
      else if (zone == 1U)
      {
        picture[0]=0x18; picture[1]=0x18; picture[2]=0x18; picture[3]=0x18;
        picture[4]=0x18; picture[5]=0x00; picture[6]=0x18; picture[7]=0x18;
        AliceSIM_Buzzer_Set(&buzzer, 1000U, 500U);
        HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_SET);
      }
      else
      {
        picture[0]=0x81; picture[1]=0x42; picture[2]=0x24; picture[3]=0x18;
        picture[4]=0x18; picture[5]=0x24; picture[6]=0x42; picture[7]=0x81;
        AliceSIM_Buzzer_Set(&buzzer, 2000U, 500U);
        HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
      }
      for (row = 0U; row < 8U; row++)
        Matrix_WriteRegister(row + 1U, picture[row]);
      previous_zone = zone;
    }
    if (measure_status == ALICESIM_HCSR04_OK)
      report_length = snprintf(report, sizeof(report),
        "DIST=%lu.%lu cm ZONE=%s RELAY=%s\r\n",
        (unsigned long)(distance_mm / 10U), (unsigned long)(distance_mm % 10U),
        zone == 0U ? "SAFE" : zone == 1U ? "CAUTION" : "STOP",
        zone >= 2U ? "ON" : "OFF");
    else
      report_length = snprintf(report, sizeof(report), "SENSOR ERROR=%lu ALARM=ON\r\n",
                               (unsigned long)measure_status);
    if (report_length > 0 && report_length < (int)sizeof(report))
      HAL_UART_Transmit(&huart2, (uint8_t *)report, report_length, 100U);
    HAL_Delay(100U); /* HC-SR04 requires >=60 ms between triggers. */
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
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0 | GPIO_PIN_12, GPIO_PIN_SET);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_1, GPIO_PIN_RESET);
  gpio.Pin = GPIO_PIN_0 | GPIO_PIN_1 | GPIO_PIN_12;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOB, &gpio);
  gpio.Pin = GPIO_PIN_10;
  gpio.Mode = GPIO_MODE_INPUT;
  HAL_GPIO_Init(GPIOB, &gpio);
  gpio.Pin = GPIO_PIN_0 | GPIO_PIN_2 | GPIO_PIN_5 | GPIO_PIN_7;
  gpio.Mode = GPIO_MODE_AF_PP;
  HAL_GPIO_Init(GPIOA, &gpio);
  gpio.Pin = GPIO_PIN_3;
  gpio.Mode = GPIO_MODE_INPUT;
  HAL_GPIO_Init(GPIOA, &gpio);
}

static void MX_SPI1_Init(void)
{
  __HAL_RCC_SPI1_CLK_ENABLE();
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.Direction = SPI_DIRECTION_2LINES;
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

static void MX_TIM2_Init(void)
{
  TIM_OC_InitTypeDef output = {0};
  __HAL_RCC_TIM2_CLK_ENABLE();
  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 7;
  htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim2.Init.Period = 499;
  htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_PWM_Init(&htim2) != HAL_OK) Error_Handler();
  output.OCMode = TIM_OCMODE_PWM1;
  output.Pulse = 0;
  output.OCPolarity = TIM_OCPOLARITY_HIGH;
  output.OCFastMode = TIM_OCFAST_DISABLE;
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &output, TIM_CHANNEL_1) != HAL_OK) Error_Handler();
}

static void MX_USART2_UART_Init(void)
{
  __HAL_RCC_USART2_CLK_ENABLE();
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

void SysTick_Handler(void) { HAL_IncTick(); }
void Error_Handler(void) { __disable_irq(); while (1) {} }
