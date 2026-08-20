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
