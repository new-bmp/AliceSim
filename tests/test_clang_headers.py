from pathlib import Path
import unittest

import server


@unittest.skipUnless(server.CLANG_AVAILABLE, "Clang runtime is unavailable")
class ClangCompatibilityHeaderTests(unittest.TestCase):
    def assert_no_diagnostics(self, result: dict) -> None:
        self.assertEqual([], result["diagnostics"], result["diagnostics"])

    def test_stm32cube_sysmem_types_are_available(self) -> None:
        source = r"""
#include <errno.h>
#include <stdint.h>

static uint8_t *__sbrk_heap_end = NULL;

void *_sbrk(ptrdiff_t incr) {
  if (__sbrk_heap_end == NULL) {
    errno = ENOMEM;
  }
  __sbrk_heap_end += incr;
  return __sbrk_heap_end;
}
"""
        self.assert_no_diagnostics(server.clang_check(source, "sysmem.c"))

    def test_stm32cube_newlib_syscall_headers_are_available(self) -> None:
        source = r"""
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/times.h>
#include <time.h>
#include <unistd.h>

int _kill(int pid, int signal_number) {
  (void)pid;
  (void)signal_number;
  errno = EINVAL;
  return -1;
}

int _fstat(int file, struct stat *status) {
  (void)file;
  status->st_mode = S_IFCHR;
  return 0;
}

clock_t _times(struct tms *buffer) {
  (void)buffer;
  return (clock_t)-1;
}
"""
        result = server.clang_check_files(
            [(Path("Core/Src/syscalls.c"), source)],
            [Path("Core/Src/syscalls.c")],
        )
        self.assert_no_diagnostics(result)

    def test_common_math_float_and_integer_format_headers_are_available(self) -> None:
        source = r"""
#include <float.h>
#include <inttypes.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  uint32_t raw = 2048U;
  char text[16] = "alpha,beta";
  char *token = strtok(text, ",");
  int exponent = 0;
  double integral = 0.0;
  double millivolts = sqrt(4.0) + fmin(1.0, 2.0) + sin(M_PI_2)
      + cosh(0.0) + exp2(1.0) + log2(2.0) + cbrt(8.0)
      + nearbyint(2.5) + rint(3.5) + remainder(7.0, 2.0)
      + frexp(8.0, &exponent) + modf(-2.75, &integral);
  const void *match = memchr(text, 'p', sizeof(text));
  long long magnitude = llabs(-4LL);
  float parsed = strtof("1.5", NULL);
  printf("raw=%" PRIu32 " mv=%.1f eps=%g\n", raw, millivolts, DBL_EPSILON);
  return isfinite(millivolts) && token && match && magnitude == 4LL && parsed > 1.0f ? 0 : 1;
}
"""
        self.assert_no_diagnostics(server.clang_check(source, "main.c"))

    def test_single_file_cube_main_gets_common_module_headers(self) -> None:
        source = r"""
#include "main.h"
#include "adc.h"
#include "i2c.h"
#include "tim.h"
#include "usart.h"
#include "gpio.h"

int main(void) {
  HAL_Init();
  MX_GPIO_Init();
  MX_ADC2_Init();
  MX_I2C1_Init();
  MX_TIM1_Init();
  MX_USART2_UART_Init();
  return 0;
}
"""
        result = server.clang_check(source, "main.c")
        self.assert_no_diagnostics(result)

    def test_single_file_dma_hal_calls_get_compatibility_declarations(self) -> None:
        source = r"""
#include "main.h"
#include "adc.h"
#include "usart.h"
#include "dma.h"

DMA_HandleTypeDef hdma_adc1;
uint32_t adc_samples[8];
uint8_t uart_data[4];

int main(void) {
  hdma_adc1.Init.Mode = DMA_CIRCULAR;
  __HAL_LINKDMA(&hadc1, DMA_Handle, hdma_adc1);
  HAL_DMA_Init(&hdma_adc1);
  HAL_ADC_Start_DMA(&hadc1, adc_samples, 8U);
  HAL_UART_Transmit_DMA(&huart2, uart_data, 4U);
  HAL_UART_Receive_DMA(&huart2, uart_data, 4U);
  return 0;
}
"""
        result = server.clang_check(source, "main.c")
        self.assert_no_diagnostics(result)

    def test_single_file_common_hal_status_and_io_calls_get_compatibility_declarations(self) -> None:
        source = r"""
#include "main.h"
#include "adc.h"
#include "i2c.h"
#include "spi.h"
#include "usart.h"

uint8_t tx_data[4];
uint8_t rx_data[4];

int main(void) {
  HAL_StatusTypeDef status = HAL_OK;
  GPIO_PinState switch_level = HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_1);
  uint32_t started_at = HAL_GetTick();

  status = HAL_ADCEx_Calibration_Start(&hadc1);
  status = HAL_Init();
  status = HAL_ADC_Start(&hadc1);
  status = HAL_ADC_Stop(&hadc1);
  status = HAL_ADC_Start_IT(&hadc1);
  status = HAL_ADC_Stop_IT(&hadc1);

  status = HAL_I2C_Master_Transmit(&hi2c1, 0x78U, tx_data, 1U, HAL_MAX_DELAY);
  status = HAL_I2C_Master_Receive(&hi2c1, 0x78U, rx_data, 1U, 10U);
  status = HAL_I2C_Mem_Write(&hi2c1, 0x78U, 0U, I2C_MEMADD_SIZE_8BIT, tx_data, 1U, 10U);
  status = HAL_I2C_Mem_Read(&hi2c1, 0x78U, 0U, I2C_MEMADD_SIZE_16BIT, rx_data, 1U, 10U);
  status = HAL_I2C_Master_Transmit_IT(&hi2c1, 0x78U, tx_data, 1U);
  status = HAL_I2C_Master_Receive_IT(&hi2c1, 0x78U, rx_data, 1U);
  status = HAL_I2C_Mem_Write_IT(&hi2c1, 0x78U, 0U, I2C_MEMADD_SIZE_8BIT, tx_data, 1U);
  status = HAL_I2C_Mem_Read_IT(&hi2c1, 0x78U, 0U, I2C_MEMADD_SIZE_8BIT, rx_data, 1U);
  status = HAL_I2C_Master_Transmit_DMA(&hi2c1, 0x78U, tx_data, 1U);
  status = HAL_I2C_Master_Receive_DMA(&hi2c1, 0x78U, rx_data, 1U);
  status = HAL_I2C_Mem_Write_DMA(&hi2c1, 0x78U, 0U, I2C_MEMADD_SIZE_8BIT, tx_data, 1U);
  status = HAL_I2C_Mem_Read_DMA(&hi2c1, 0x78U, 0U, I2C_MEMADD_SIZE_8BIT, rx_data, 1U);
  status = HAL_I2C_Master_Abort_IT(&hi2c1, 0x78U);

  status = HAL_SPI_Transmit(&hspi1, tx_data, 1U, 10U);
  status = HAL_SPI_Receive(&hspi1, rx_data, 1U, 10U);
  status = HAL_SPI_TransmitReceive(&hspi1, tx_data, rx_data, 1U, 10U);
  status = HAL_SPI_Transmit_IT(&hspi1, tx_data, 1U);
  status = HAL_SPI_Receive_IT(&hspi1, rx_data, 1U);
  status = HAL_SPI_TransmitReceive_IT(&hspi1, tx_data, rx_data, 1U);
  status = HAL_SPI_Transmit_DMA(&hspi1, tx_data, 1U);
  status = HAL_SPI_Receive_DMA(&hspi1, rx_data, 1U);
  status = HAL_SPI_TransmitReceive_DMA(&hspi1, tx_data, rx_data, 1U);
  status = HAL_SPI_Abort_IT(&hspi1);

  status = HAL_UART_Transmit_IT(&huart2, tx_data, 1U);
  status = HAL_UART_Receive_IT(&huart2, rx_data, 1U);
  status = HAL_UART_Abort_IT(&huart2);
  status = HAL_UART_AbortReceive_IT(&huart2);
  status = HAL_UART_AbortTransmit_IT(&huart2);

  if (status == HAL_ERROR || status == HAL_BUSY || status == HAL_TIMEOUT) return 1;
  return switch_level == GPIO_PIN_SET && started_at == 0U ? 0 : 0;
}
"""
        result = server.clang_check(source, "main.c")
        self.assert_no_diagnostics(result)

    def test_direct_stm32_hal_module_includes_get_the_same_compatibility_declarations(self) -> None:
        source = r"""
#include "stm32f1xx_hal.h"
#include "stm32f1xx_hal_adc_ex.h"
#include "stm32f1xx_hal_i2c.h"
#include "stm32f1xx_hal_spi.h"
#include "stm32f1xx_hal_uart.h"

ADC_HandleTypeDef hadc1;
I2C_HandleTypeDef hi2c1;
SPI_HandleTypeDef hspi1;
UART_HandleTypeDef huart2;
uint8_t data[1];

int main(void) {
  HAL_StatusTypeDef status = HAL_ADCEx_Calibration_Start(&hadc1);
  status = HAL_I2C_Mem_Read(&hi2c1, 0x78U, 0U, I2C_MEMADD_SIZE_8BIT, data, 1U, HAL_MAX_DELAY);
  status = HAL_SPI_Receive(&hspi1, data, 1U, HAL_MAX_DELAY);
  status = HAL_UART_Receive_IT(&huart2, data, 1U);
  return status == HAL_OK ? 0 : 1;
}
"""
        result = server.clang_check(source, "main.c")
        self.assert_no_diagnostics(result)

    def test_single_file_full_cube_example_passes_legacy_check(self) -> None:
        example = Path(__file__).resolve().parents[1] / "examples" / "STM32F103_HAL_Init" / "Core" / "Src" / "main.c"
        result = server.clang_check(example.read_text(encoding="utf-8"), "main.c")
        self.assert_no_diagnostics(result)

    def test_uploaded_toolchain_header_takes_precedence(self) -> None:
        source = r"""
#include <sys/stat.h>
#ifndef PROJECT_STAT_HEADER
#error AliceSIM compatibility header shadowed the uploaded project header
#endif
int mode(void) { return PROJECT_STAT_HEADER; }
"""
        project_header = "#define PROJECT_STAT_HEADER 7\n"
        result = server.clang_check_files(
            [
                (Path("Core/Src/main.c"), source),
                (Path("Toolchain/include/sys/stat.h"), project_header),
            ],
            [Path("Core/Src/main.c")],
            [Path("Toolchain/include")],
        )
        self.assert_no_diagnostics(result)

    @unittest.skipUnless(server.ARM_CXX_PATH, "GNU Arm C++ toolchain is unavailable")
    def test_bits_stdcpp_and_standard_library_headers_are_available(self) -> None:
        source = r"""
#include <stdc++.h>

int main() {
  std::vector<int> values{1, 2, 3};
  std::string label = "AliceSIM";
  return std::accumulate(values.begin(), values.end(), static_cast<int>(label.size()));
}
"""
        result = server.clang_check_files(
            [(Path("Core/Src/main.cpp"), source)],
            [Path("Core/Src/main.cpp")],
        )
        self.assert_no_diagnostics(result)
        self.assertEqual("gnu++17", result["languageStandard"])

    @unittest.skipUnless(server.ARM_CXX_PATH, "GNU Arm C++ toolchain is unavailable")
    def test_cpp_stdlib_blink_example_compiles_with_its_compatibility_header(self) -> None:
        example_root = Path(__file__).resolve().parents[1] / "examples" / "CppStdlibBlink"
        files = [
            (path.relative_to(example_root), path.read_text(encoding="utf-8"))
            for path in example_root.rglob("*")
            if path.is_file()
        ]
        result = server.clang_check_files(files, [Path("Core/Src/main.cpp")])

        self.assert_no_diagnostics(result)
        self.assertEqual("gnu++17", result["languageStandard"])


if __name__ == "__main__":
    unittest.main()
