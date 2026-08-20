/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2026 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "adc.h"
#include "i2c.h"
#include "tim.h"
#include "usart.h"
#include "gpio.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "alicesim_ssd1306.h"

/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/

/* USER CODE BEGIN PV */
AliceSIM_SSD1306 oled;
uint32_t adc1_raw = 0U;
uint32_t adc2_raw = 0U;
uint32_t adc1_mv10 = 0U;
uint32_t adc2_mv10 = 0U;
uint32_t uart_status = 1U;
uint32_t run_switch_state = GPIO_PIN_SET;
char oled_line_pa0[14U] = "PA0 0000.0 mV";
char oled_line_pb0[14U] = "PB0 0000.0 mV";
uint8_t uart_report[28U] = "PA0=0000.0mV PB0=0000.0mV\r\n";

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_ADC1_Init();
  MX_ADC2_Init();
  MX_I2C1_Init();
  MX_TIM1_Init();
  MX_USART2_UART_Init();
  MX_USART3_UART_Init();
  /* USER CODE BEGIN 2 */
  uart_status = AliceSIM_SSD1306_Init(
    &oled,
    &hi2c1,
    ALICESIM_SSD1306_DEFAULT_ADDRESS,
    100U
  );
  if (uart_status != HAL_OK)
  {
    Error_Handler();
  }

  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
    run_switch_state = HAL_GPIO_ReadPin(RUN_SWITCH_GPIO_Port, RUN_SWITCH_Pin);
    if (run_switch_state == GPIO_PIN_RESET)
    {
      /* PB12 high sources the green branch and switches the red branch off. */
      HAL_GPIO_WritePin(STATUS_LED_GPIO_Port, STATUS_LED_Pin, GPIO_PIN_SET);

      HAL_ADC_Start(&hadc1);
      HAL_ADC_PollForConversion(&hadc1, 2U);
      adc1_raw = HAL_ADC_GetValue(&hadc1);

      HAL_ADC_Start(&hadc2);
      HAL_ADC_PollForConversion(&hadc2, 2U);
      adc2_raw = HAL_ADC_GetValue(&hadc2);

      /* Values are stored in tenths of a millivolt for one decimal place. */
      adc1_mv10 = ((adc1_raw * 33000U) + 2047U) / 4095U;
      adc2_mv10 = ((adc2_raw * 33000U) + 2047U) / 4095U;

      oled_line_pa0[4U] = '0' + ((adc1_mv10 / 10000U) % 10U);
      oled_line_pa0[5U] = '0' + ((adc1_mv10 / 1000U) % 10U);
      oled_line_pa0[6U] = '0' + ((adc1_mv10 / 100U) % 10U);
      oled_line_pa0[7U] = '0' + ((adc1_mv10 / 10U) % 10U);
      oled_line_pa0[9U] = '0' + (adc1_mv10 % 10U);

      oled_line_pb0[4U] = '0' + ((adc2_mv10 / 10000U) % 10U);
      oled_line_pb0[5U] = '0' + ((adc2_mv10 / 1000U) % 10U);
      oled_line_pb0[6U] = '0' + ((adc2_mv10 / 100U) % 10U);
      oled_line_pb0[7U] = '0' + ((adc2_mv10 / 10U) % 10U);
      oled_line_pb0[9U] = '0' + (adc2_mv10 % 10U);

      uart_report[4U] = '0' + ((adc1_mv10 / 10000U) % 10U);
      uart_report[5U] = '0' + ((adc1_mv10 / 1000U) % 10U);
      uart_report[6U] = '0' + ((adc1_mv10 / 100U) % 10U);
      uart_report[7U] = '0' + ((adc1_mv10 / 10U) % 10U);
      uart_report[9U] = '0' + (adc1_mv10 % 10U);
      uart_report[17U] = '0' + ((adc2_mv10 / 10000U) % 10U);
      uart_report[18U] = '0' + ((adc2_mv10 / 1000U) % 10U);
      uart_report[19U] = '0' + ((adc2_mv10 / 100U) % 10U);
      uart_report[20U] = '0' + ((adc2_mv10 / 10U) % 10U);
      uart_report[22U] = '0' + (adc2_mv10 % 10U);

      HAL_UART_Transmit(&huart2, uart_report, 27U, 10U);

      AliceSIM_SSD1306_Clear(&oled);
      AliceSIM_SSD1306_DrawString(&oled, 0U, 0U, "DUAL ADC INPUT", 1U, ALICESIM_SSD1306_COLOR_WHITE);
      AliceSIM_SSD1306_DrawString(&oled, 0U, 16U, oled_line_pa0, 1U, ALICESIM_SSD1306_COLOR_WHITE);
      AliceSIM_SSD1306_DrawString(&oled, 0U, 32U, oled_line_pb0, 1U, ALICESIM_SSD1306_COLOR_WHITE);
      AliceSIM_SSD1306_DrawString(&oled, 0U, 48U, "UART2 115200", 1U, ALICESIM_SSD1306_COLOR_WHITE);
      AliceSIM_SSD1306_Update(&oled);
    }
    else
    {
      /* PB12 low sinks the red branch and switches the green branch off. */
      HAL_GPIO_WritePin(STATUS_LED_GPIO_Port, STATUS_LED_Pin, GPIO_PIN_RESET);
      AliceSIM_SSD1306_Clear(&oled);
      AliceSIM_SSD1306_DrawString(&oled, 49U, 24U, "READY", 1U, ALICESIM_SSD1306_COLOR_WHITE);
      AliceSIM_SSD1306_Update(&oled);
    }

    HAL_Delay(100U);
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};
  RCC_PeriphCLKInitTypeDef PeriphClkInit = {0};

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
  PeriphClkInit.PeriphClockSelection = RCC_PERIPHCLK_ADC;
  PeriphClkInit.AdcClockSelection = RCC_ADCPCLK2_DIV6;
  if (HAL_RCCEx_PeriphCLKConfig(&PeriphClkInit) != HAL_OK)
  {
    Error_Handler();
  }
}

/* USER CODE BEGIN 4 */

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}
#ifdef USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
