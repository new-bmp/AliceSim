#include "main.h"
#include <string.h>

#define RX_CAPACITY 128U
#define LINE_CAPACITY 32U

UART_HandleTypeDef huart2;
uint8_t rx_byte;
volatile uint8_t rx_ring[RX_CAPACITY];
volatile uint32_t rx_write, rx_read, rx_overflow, rx_at_boundary;
char line[LINE_CAPACITY];
uint32_t line_length, line_discard, line_invalid;
uint32_t led_on, command_count, error_count;

static void Send(const char *text)
{
  HAL_UART_Transmit(&huart2, (uint8_t *)text, (uint16_t)strlen(text), 100U);
}

/* One producer (ISR), one consumer (main); each callback does bounded work. */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *uart)
{
  uint32_t next;
  if (uart->Instance == USART2)
  {
    if (rx_overflow) rx_at_boundary = rx_byte == '\n';
    else
    {
      next = (rx_write + 1U) % RX_CAPACITY;
      if (next == rx_read)
      {
        rx_overflow = 1U;
        rx_at_boundary = rx_byte == '\n';
      }
      else
      {
        rx_ring[rx_write] = rx_byte;
        rx_write = next;
      }
    }
    HAL_UART_Receive_IT(&huart2, &rx_byte, 1U);
  }
}

static void ExecuteLine(void)
{
  if (line_discard)
  {
    Send("ERR TOO_LONG\r\n");
    ++error_count;
  }
  else if (line_length != 0U)
  {
    line[line_length] = '\0';
    ++command_count;
    if (line_invalid) { Send("ERR UNKNOWN\r\n"); ++error_count; }
    else if (strcmp(line, "LED ON") == 0)
    {
      led_on = 1U;
      HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_SET);
      Send("OK LED=ON\r\n");
    }
    else if (strcmp(line, "LED OFF") == 0)
    {
      led_on = 0U;
      HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
      Send("OK LED=OFF\r\n");
    }
    else if (strcmp(line, "STATUS") == 0)
    {
      if (led_on) Send("LED=ON\r\n");
      else Send("LED=OFF\r\n");
    }
    else { Send("ERR UNKNOWN\r\n"); ++error_count; }
  }
  line_length = 0U;
  line_discard = 0U;
  line_invalid = 0U;
}

static void ProcessRx(void)
{
  uint8_t byte;
  if (rx_overflow)
  {
    /* Only the queue reset is protected; parsing and transmitting stay in main. */
    __disable_irq();
    rx_read = rx_write;
    line_length = 0U;
    line_invalid = 0U;
    line_discard = !rx_at_boundary;
    rx_overflow = 0U;
    __enable_irq();
    Send("ERR RX_OVERFLOW\r\n");
    ++error_count;
  }
  while (rx_read != rx_write)
  {
    byte = rx_ring[rx_read];
    rx_read = (rx_read + 1U) % RX_CAPACITY;
    if (byte == '\n') ExecuteLine();
    else if (byte != '\r')
    {
      if (byte < 32U || byte > 126U) line_invalid = 1U;
      if (!line_discard)
      {
        if (line_length < LINE_CAPACITY - 1U) line[line_length++] = (char)byte;
        else line_discard = 1U; /* Never execute a truncated command. */
      }
    }
  }
}

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef gpio = {0};
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
  gpio.Pin = GPIO_PIN_12;
  gpio.Mode = GPIO_MODE_OUTPUT_PP;
  gpio.Pull = GPIO_NOPULL;
  gpio.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &gpio);
  gpio.Pin = GPIO_PIN_2;
  gpio.Mode = GPIO_MODE_AF_PP;
  gpio.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOA, &gpio);
  gpio.Pin = GPIO_PIN_3;
  gpio.Mode = GPIO_MODE_INPUT;
  gpio.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(GPIOA, &gpio);
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
  HAL_NVIC_SetPriority(USART2_IRQn, 1U, 0U);
  HAL_NVIC_EnableIRQ(USART2_IRQn);
}
int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART2_UART_Init();
  if (HAL_UART_Receive_IT(&huart2, &rx_byte, 1U) != HAL_OK) Error_Handler();
  Send("READY: LED ON | LED OFF | STATUS; finish with LF\r\n");
  while (1) { ProcessRx(); HAL_Delay(1U); }
}
void USART2_IRQHandler(void) { HAL_UART_IRQHandler(&huart2); }

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
