/* AliceSIM 学习 05：双通道滤波记录仪，历史曲线与回差报警。 */
#include "main.h"
#include "alicesim_ssd1306.h"
#include <stdio.h>

#define FILTER_SIZE       32U
#define HISTORY_SIZE      32U
#define SAMPLE_MS         20U
#define DISPLAY_MS       100U
#define ALARM_ON_MV10  25000U
#define ALARM_OFF_MV10 23000U

ADC_HandleTypeDef hadc1;
ADC_HandleTypeDef hadc2;
I2C_HandleTypeDef hi2c1;
TIM_HandleTypeDef htim1;
UART_HandleTypeDef huart2;
AliceSIM_SSD1306 oled;

uint16_t filter_a[FILTER_SIZE];
uint16_t filter_b[FILTER_SIZE];
uint32_t sum_a = 0U, sum_b = 0U;
uint32_t filter_index = 0U, filter_count = 0U;
uint16_t history_a[HISTORY_SIZE];
uint16_t history_b[HISTORY_SIZE];
uint32_t history_head = 0U, history_count = 0U;
uint32_t mv10_a = 0U, mv10_b = 0U;
uint32_t sample_count = 0U, frame_count = 0U;
uint32_t running = 0U, alarm_active = 0U, sensor_fault = 0U;
uint32_t oled_status = HAL_OK;
uint32_t last_sample = 0U, last_display = 0U;
char line_a[24], line_b[24], report[96];
uint8_t csv_header[] = "tick_ms,a_mV,b_mV,alarm,state\r\n";

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  gpio.Pin = GPIO_PIN_0;
  gpio.Mode = GPIO_MODE_ANALOG;
  HAL_GPIO_Init(GPIOA, &gpio);
  HAL_GPIO_Init(GPIOB, &gpio);
  gpio.Pin = GPIO_PIN_1;
  gpio.Mode = GPIO_MODE_INPUT;
  gpio.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(GPIOA, &gpio);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_13, GPIO_PIN_SET);
  gpio.Pin = GPIO_PIN_12 | GPIO_PIN_13;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &gpio);
  gpio.Pin = GPIO_PIN_8 | GPIO_PIN_2;
  gpio.Mode = GPIO_MODE_AF_PP;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOA, &gpio);
  gpio.Pin = GPIO_PIN_3;
  gpio.Mode = GPIO_MODE_INPUT;
  HAL_GPIO_Init(GPIOA, &gpio);
  gpio.Pin = GPIO_PIN_6 | GPIO_PIN_7;
  gpio.Mode = GPIO_MODE_AF_OD;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOB, &gpio);
}

static void MX_ADC1_Init(void)
{
  ADC_ChannelConfTypeDef channel = {0};
  __HAL_RCC_ADC1_CLK_ENABLE();
  hadc1.Instance = ADC1;
  hadc1.Init.ScanConvMode = ADC_SCAN_DISABLE;
  hadc1.Init.ContinuousConvMode = DISABLE;
  hadc1.Init.DiscontinuousConvMode = DISABLE;
  hadc1.Init.ExternalTrigConv = ADC_SOFTWARE_START;
  hadc1.Init.DataAlign = ADC_DATAALIGN_RIGHT;
  hadc1.Init.NbrOfConversion = 1;
  if (HAL_ADC_Init(&hadc1) != HAL_OK) Error_Handler();
  channel.Channel = ADC_CHANNEL_0;
  channel.Rank = ADC_REGULAR_RANK_1;
  channel.SamplingTime = ADC_SAMPLETIME_55CYCLES_5;
  if (HAL_ADC_ConfigChannel(&hadc1, &channel) != HAL_OK) Error_Handler();
}

static void MX_ADC2_Init(void)
{
  ADC_ChannelConfTypeDef channel = {0};
  __HAL_RCC_ADC2_CLK_ENABLE();
  hadc2.Instance = ADC2;
  hadc2.Init.ScanConvMode = ADC_SCAN_DISABLE;
  hadc2.Init.ContinuousConvMode = DISABLE;
  hadc2.Init.DiscontinuousConvMode = DISABLE;
  hadc2.Init.ExternalTrigConv = ADC_SOFTWARE_START;
  hadc2.Init.DataAlign = ADC_DATAALIGN_RIGHT;
  hadc2.Init.NbrOfConversion = 1;
  if (HAL_ADC_Init(&hadc2) != HAL_OK) Error_Handler();
  channel.Channel = ADC_CHANNEL_8;
  channel.Rank = ADC_REGULAR_RANK_1;
  channel.SamplingTime = ADC_SAMPLETIME_55CYCLES_5;
  if (HAL_ADC_ConfigChannel(&hadc2, &channel) != HAL_OK) Error_Handler();
}

static void MX_I2C1_Init(void)
{
  __HAL_RCC_I2C1_CLK_ENABLE();
  hi2c1.Instance = I2C1;
  hi2c1.Init.ClockSpeed = 400000;
  hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
  hi2c1.Init.OwnAddress1 = 0;
  hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
  hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
  hi2c1.Init.OwnAddress2 = 0;
  hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
  hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
  if (HAL_I2C_Init(&hi2c1) != HAL_OK) Error_Handler();
}

static void MX_TIM1_Init(void)
{
  TIM_OC_InitTypeDef output = {0};
  __HAL_RCC_TIM1_CLK_ENABLE();
  htim1.Instance = TIM1;
  htim1.Init.Prescaler = 71;
  htim1.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim1.Init.Period = 499;
  htim1.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim1.Init.RepetitionCounter = 0;
  htim1.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_PWM_Init(&htim1) != HAL_OK) Error_Handler();
  output.OCMode = TIM_OCMODE_PWM1;
  output.Pulse = 250;
  output.OCPolarity = TIM_OCPOLARITY_HIGH;
  output.OCNPolarity = TIM_OCNPOLARITY_HIGH;
  output.OCFastMode = TIM_OCFAST_DISABLE;
  output.OCIdleState = TIM_OCIDLESTATE_RESET;
  output.OCNIdleState = TIM_OCNIDLESTATE_RESET;
  if (HAL_TIM_PWM_ConfigChannel(&htim1, &output, TIM_CHANNEL_1) != HAL_OK)
    Error_Handler();
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

/* 先读到局部变量，只有两路均成功才把同一帧样本加入滤波。 */
static uint32_t ReadPair(uint16_t *a, uint16_t *b)
{
  if (HAL_ADC_Start(&hadc1) != HAL_OK) return 0U;
  if (HAL_ADC_PollForConversion(&hadc1, 10U) != HAL_OK)
  {
    HAL_ADC_Stop(&hadc1);
    return 0U;
  }
  *a = (uint16_t)HAL_ADC_GetValue(&hadc1);
  HAL_ADC_Stop(&hadc1);
  if (HAL_ADC_Start(&hadc2) != HAL_OK) return 0U;
  if (HAL_ADC_PollForConversion(&hadc2, 10U) != HAL_OK)
  {
    HAL_ADC_Stop(&hadc2);
    return 0U;
  }
  *b = (uint16_t)HAL_ADC_GetValue(&hadc2);
  HAL_ADC_Stop(&hadc2);
  return 1U;
}

static void AddSample(uint16_t a, uint16_t b)
{
  if (filter_count == FILTER_SIZE)
  {
    sum_a -= filter_a[filter_index];
    sum_b -= filter_b[filter_index];
  }
  else ++filter_count;
  filter_a[filter_index] = a;
  filter_b[filter_index] = b;
  sum_a += a;
  sum_b += b;
  filter_index = (filter_index + 1U) % FILTER_SIZE;
  /* 先在累加和上换算，避免先除 32 丢掉有效的小数位。 */
  mv10_a = (uint32_t)(((uint64_t)sum_a * 33000U + filter_count * 2047U) / (filter_count * 4095U));
  mv10_b = (uint32_t)(((uint64_t)sum_b * 33000U + filter_count * 2047U) / (filter_count * 4095U));
  ++sample_count;
}

static void SetAlarm(uint32_t next)
{
  if (next == alarm_active) return;
  alarm_active = next;
  if (next)
  {
    if (HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1) != HAL_OK) Error_Handler();
  }
  else HAL_TIM_PWM_Stop(&htim1, TIM_CHANNEL_1);
}

/* 窗口最多 32 点，4 像素间距；线段按 x 插值，没有后期伪造曲线。 */
static void DrawTrend(const uint16_t *history, uint16_t top)
{
  uint32_t i, j, slot;
  int32_t x, y, old_y = 0;
  AliceSIM_SSD1306_DrawHorizontalLine(&oled, 1U, top + 20U, 126U, ALICESIM_SSD1306_COLOR_WHITE);
  for (i = 0U; i < 128U; i += 8U)
    AliceSIM_SSD1306_DrawPixel(&oled, (uint16_t)i, top + 5U, ALICESIM_SSD1306_COLOR_WHITE);
  for (i = 0U; i < history_count; ++i)
  {
    slot = (history_head + HISTORY_SIZE - history_count + i) % HISTORY_SIZE;
    x = 126 - (int32_t)(history_count - 1U - i) * 4;
    y = (int32_t)top + 20 - (int32_t)((uint32_t)history[slot] * 20U / 33000U);
    if (i == 0U)
      AliceSIM_SSD1306_DrawPixel(&oled, (uint16_t)x, (uint16_t)y, ALICESIM_SSD1306_COLOR_WHITE);
    else
    {
      for (j = 1U; j <= 4U; ++j)
        AliceSIM_SSD1306_DrawPixel(&oled, (uint16_t)(x - 4 + (int32_t)j),
          (uint16_t)((old_y * (int32_t)(4U - j) + y * (int32_t)j) / 4),
          ALICESIM_SSD1306_COLOR_WHITE);
    }
    old_y = y;
  }
}

static void SendCSV(const char *state)
{
  int length = snprintf(report, sizeof(report), "%lu,%lu.%lu,%lu.%lu,%lu,%s\r\n",
    (unsigned long)HAL_GetTick(),
    (unsigned long)(mv10_a / 10U), (unsigned long)(mv10_a % 10U),
    (unsigned long)(mv10_b / 10U), (unsigned long)(mv10_b % 10U),
    (unsigned long)alarm_active, state);
  if (length > 0 && length < (int)sizeof(report))
    HAL_UART_Transmit(&huart2, (uint8_t *)report, length, 100U);
}

static void DrawReady(void)
{
  AliceSIM_SSD1306_Clear(&oled);
  AliceSIM_SSD1306_DrawString(&oled, 34U, 14U, "READY", 2U, ALICESIM_SSD1306_COLOR_WHITE);
  AliceSIM_SSD1306_DrawString(&oled, 16U, 42U, "CLOSE SW TO LOG", 1U, ALICESIM_SSD1306_COLOR_WHITE);
  oled_status = AliceSIM_SSD1306_Update(&oled);
  if (oled_status != HAL_OK) Error_Handler();
}

static void DrawRecord(void)
{
  history_a[history_head] = (uint16_t)mv10_a;
  history_b[history_head] = (uint16_t)mv10_b;
  history_head = (history_head + 1U) % HISTORY_SIZE;
  if (history_count < HISTORY_SIZE) ++history_count;
  snprintf(line_a, sizeof(line_a), "A %lu.%lu mV", (unsigned long)(mv10_a / 10U), (unsigned long)(mv10_a % 10U));
  snprintf(line_b, sizeof(line_b), "B %lu.%lumV %s", (unsigned long)(mv10_b / 10U), (unsigned long)(mv10_b % 10U), alarm_active ? "ALARM" : "RUN");
  AliceSIM_SSD1306_Clear(&oled);
  AliceSIM_SSD1306_DrawString(&oled, 0U, 0U, line_a, 1U, ALICESIM_SSD1306_COLOR_WHITE);
  AliceSIM_SSD1306_DrawString(&oled, 0U, 10U, line_b, 1U, ALICESIM_SSD1306_COLOR_WHITE);
  DrawTrend(history_a, 21U);
  DrawTrend(history_b, 43U);
  oled_status = AliceSIM_SSD1306_Update(&oled);
  if (oled_status != HAL_OK) Error_Handler();
  SendCSV(alarm_active ? "ALARM" : "RUN");
  ++frame_count;
}

int main(void)
{
  uint16_t a = 0U, b = 0U;
  uint32_t now;
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_ADC1_Init();
  MX_ADC2_Init();
  MX_I2C1_Init();
  MX_TIM1_Init();
  MX_USART2_UART_Init();
  if (HAL_ADCEx_Calibration_Start(&hadc1) != HAL_OK) Error_Handler();
  if (HAL_ADCEx_Calibration_Start(&hadc2) != HAL_OK) Error_Handler();
  oled_status = AliceSIM_SSD1306_Init(&oled, &hi2c1, 0x3CU, 100U);
  if (oled_status != HAL_OK) Error_Handler();
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_13, GPIO_PIN_SET);
  HAL_UART_Transmit(&huart2, csv_header, sizeof(csv_header) - 1U, 100U);
  DrawReady();
  SendCSV("READY");

  while (1)
  {
    now = HAL_GetTick();
    if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_1) == GPIO_PIN_RESET)
    {
      if (!running)
      {
        running = 1U;
        filter_index = 0U;
        filter_count = 0U;
        sum_a = 0U;
        sum_b = 0U;
        history_head = 0U;
        history_count = 0U;
        last_sample = now;
        last_display = now;
      }
      if (now - last_sample >= SAMPLE_MS)
      {
        last_sample = now;
        sensor_fault = !ReadPair(&a, &b);
        if (!sensor_fault)
        {
          AddSample(a, b);
          if (!alarm_active && (mv10_a >= ALARM_ON_MV10 || mv10_b >= ALARM_ON_MV10)) SetAlarm(1U);
          else if (alarm_active && mv10_a <= ALARM_OFF_MV10 && mv10_b <= ALARM_OFF_MV10) SetAlarm(0U);
        }
        else SetAlarm(1U);
        HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, alarm_active ? GPIO_PIN_RESET : GPIO_PIN_SET);
        HAL_GPIO_WritePin(GPIOB, GPIO_PIN_13, alarm_active ? GPIO_PIN_SET : GPIO_PIN_RESET);
      }
      if (now - last_display >= DISPLAY_MS)
      {
        last_display = now;
        if (sensor_fault)
        {
          AliceSIM_SSD1306_Clear(&oled);
          AliceSIM_SSD1306_DrawString(&oled, 10U, 26U, "ADC READ ERROR", 1U, ALICESIM_SSD1306_COLOR_WHITE);
          oled_status = AliceSIM_SSD1306_Update(&oled);
          if (oled_status != HAL_OK) Error_Handler();
          SendCSV("ADC_ERROR");
        }
        else DrawRecord();
      }
    }
    else if (running)
    {
      running = 0U;
      sensor_fault = 0U;
      SetAlarm(0U);
      HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
      HAL_GPIO_WritePin(GPIOB, GPIO_PIN_13, GPIO_PIN_SET);
      DrawReady();
      SendCSV("READY");
    }
    HAL_Delay(5U);
  }
}

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clock = {0};
  RCC_PeriphCLKInitTypeDef peripheral = {0};
  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState = RCC_HSE_ON;
  osc.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  osc.HSIState = RCC_HSI_ON;
  osc.PLL.PLLState = RCC_PLL_ON;
  osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();
  clock.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clock.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  clock.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clock.APB1CLKDivider = RCC_HCLK_DIV2;
  clock.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clock, FLASH_LATENCY_2) != HAL_OK) Error_Handler();
  peripheral.PeriphClockSelection = RCC_PERIPHCLK_ADC;
  peripheral.AdcClockSelection = RCC_ADCPCLK2_DIV6;
  if (HAL_RCCEx_PeriphCLKConfig(&peripheral) != HAL_OK) Error_Handler();
}

void SysTick_Handler(void) { HAL_IncTick(); }

void Error_Handler(void)
{
  __disable_irq();
  while (1) {}
}
