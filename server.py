from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import re
import shutil
import sys
import subprocess
import tempfile
import threading
import time
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath


SOURCE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = Path(getattr(sys, "_MEIPASS", SOURCE_ROOT))
VENDOR_ROOT = PROJECT_ROOT / ".vendor"
if not VENDOR_ROOT.exists():
    VENDOR_ROOT = SOURCE_ROOT / ".vendor"
SERVICE_NAME = "AliceSIM"
API_VERSION = 1
INSTANCE_SOURCE = "AliceSIM-packaged" if getattr(sys, "frozen", False) else os.path.normcase(str(PROJECT_ROOT))
INSTANCE_ID = hashlib.sha256(INSTANCE_SOURCE.encode("utf-8")).hexdigest()[:12]
if VENDOR_ROOT.exists():
    sys.path.insert(0, str(VENDOR_ROOT))

try:
    from spice_solver import solve_circuit as solve_spice_circuit, spice_status
except Exception as exc:  # Optional simulator; the built-in browser solver remains available.
    solve_spice_circuit = None
    SPICE_IMPORT_ERROR = str(exc)

    def spice_status() -> dict:
        return {"available": False, "engine": "unavailable", "detail": SPICE_IMPORT_ERROR}

try:
    from datasheet_parser import (
        DatasheetError,
        parse_datasheet_request,
        parser_status as datasheet_parser_status,
        validate_datasheet_draft,
    )
except Exception as exc:
    DATASHEET_IMPORT_ERROR = str(exc)

    class DatasheetError(ValueError):
        pass

    def datasheet_parser_status() -> dict:
        return {"available": False, "engine": "unavailable", "detail": DATASHEET_IMPORT_ERROR}

    def parse_datasheet_request(payload: object) -> dict:
        raise DatasheetError(DATASHEET_IMPORT_ERROR or "Datasheet parser is unavailable")

    def validate_datasheet_draft(payload: object) -> dict:
        raise DatasheetError(DATASHEET_IMPORT_ERROR or "Datasheet validator is unavailable")

CLANG_AVAILABLE = False
CLANG_ENGINE = "Clang unavailable"
CLANG_ERROR = ""
clang_index = None
clang_cindex = None
CLANG_LOCK = threading.Lock()

MAX_REQUEST_BYTES = 192 * 1024 * 1024
MAX_PROJECT_TEXT_BYTES = 128 * 1024 * 1024
MAX_PROJECT_FILES = 8_000
MAX_PROJECT_FILE_BYTES = 4 * 1024 * 1024
MAX_CLANG_TARGETS = 1_024
HEADER_SUFFIXES = {".h", ".hh", ".hpp", ".hxx", ".inc"}
SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".cxx"}
CPP_SOURCE_SUFFIXES = {".cc", ".cpp", ".cxx"}
WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
DEFINE_PATTERN = re.compile(r"^[A-Za-z_]\w*(?:=[^\r\n\x00]*)?$")

try:
    from clang import cindex as clang_cindex  # type: ignore

    bundled_library = VENDOR_ROOT / "clang" / "native" / "libclang.dll"
    if bundled_library.exists():
        clang_cindex.Config.set_library_file(str(bundled_library))
    clang_index = clang_cindex.Index.create()
    CLANG_AVAILABLE = True
    CLANG_ENGINE = "Clang 18.1.1"
except Exception as exc:  # The browser still has a local fallback analyzer.
    CLANG_ERROR = str(exc)


def _find_arm_cxx() -> Path | None:
    candidates: list[Path] = []
    for name in ("ALICESIM_ARM_GXX", "ARM_NONE_EABI_GXX", "CXX"):
        value = os.environ.get(name, "").strip()
        if value:
            candidates.append(Path(value))
    for name in ("arm-none-eabi-g++.exe", "arm-none-eabi-g++"):
        located = shutil.which(name)
        if located:
            candidates.append(Path(located))

    roots = [Path("C:/ST")]
    program_files = os.environ.get("ProgramFiles", "").strip()
    if program_files:
        roots.append(Path(program_files))
    for root in roots:
        if not root.exists():
            continue
        patterns = (
            "STM32CubeIDE*/STM32CubeIDE/plugins/*/tools/bin/arm-none-eabi-g++.exe",
            "*/STM32CubeIDE/plugins/*/tools/bin/arm-none-eabi-g++.exe",
            "GNU Arm Embedded Toolchain*/**/bin/arm-none-eabi-g++.exe",
        )
        for pattern in patterns:
            candidates.extend(root.glob(pattern))

    for candidate in candidates:
        try:
            resolved = candidate.expanduser().resolve()
        except OSError:
            continue
        if resolved.is_file() and resolved.name.casefold() in {"arm-none-eabi-g++.exe", "arm-none-eabi-g++"}:
            return resolved
    return None


ARM_CXX_PATH = _find_arm_cxx()
ARM_CXX_ENGINE = "GNU Arm C++" if ARM_CXX_PATH else "GNU Arm C++ unavailable"


STM32_STUB_HEADER = r"""
#ifndef ALICE_STM32_MAIN_H
#define ALICE_STM32_MAIN_H

typedef unsigned char uint8_t;
typedef unsigned short uint16_t;
typedef unsigned int uint32_t;
typedef signed int int32_t;
typedef int HAL_StatusTypeDef;

typedef struct { volatile uint32_t ODR; } GPIO_TypeDef;
typedef struct {
  uint32_t Direction;
  uint32_t PeriphInc;
  uint32_t MemInc;
  uint32_t PeriphDataAlignment;
  uint32_t MemDataAlignment;
  uint32_t Mode;
  uint32_t Priority;
} DMA_InitTypeDef;
typedef struct DMA_HandleTypeDef { void *Instance; DMA_InitTypeDef Init; } DMA_HandleTypeDef;
typedef struct ADC_HandleTypeDef { void *Instance; DMA_HandleTypeDef *DMA_Handle; } ADC_HandleTypeDef;
typedef struct I2C_HandleTypeDef { void *Instance; } I2C_HandleTypeDef;
typedef struct TIM_HandleTypeDef { void *Instance; } TIM_HandleTypeDef;
typedef struct UART_HandleTypeDef { void *Instance; DMA_HandleTypeDef *hdmatx; DMA_HandleTypeDef *hdmarx; } UART_HandleTypeDef;
typedef struct {
  uint32_t Pin;
  uint32_t Mode;
  uint32_t Pull;
  uint32_t Speed;
} GPIO_InitTypeDef;

typedef struct {
  uint32_t PLLState;
  uint32_t PLLSource;
  uint32_t PLLMUL;
} RCC_PLLInitTypeDef;

typedef struct {
  uint32_t OscillatorType;
  uint32_t HSEState;
  uint32_t HSEPredivValue;
  uint32_t HSIState;
  RCC_PLLInitTypeDef PLL;
} RCC_OscInitTypeDef;

typedef struct {
  uint32_t ClockType;
  uint32_t SYSCLKSource;
  uint32_t AHBCLKDivider;
  uint32_t APB1CLKDivider;
  uint32_t APB2CLKDivider;
} RCC_ClkInitTypeDef;

typedef struct {
  uint32_t PeriphClockSelection;
  uint32_t AdcClockSelection;
} RCC_PeriphCLKInitTypeDef;

#if !defined(ALICE_STM32_GPIO_PORTS)
#define ALICE_STM32_GPIO_PORTS
extern GPIO_TypeDef alice_gpio_a;
extern GPIO_TypeDef alice_gpio_b;
extern GPIO_TypeDef alice_gpio_c;
#define GPIOA (&alice_gpio_a)
#define GPIOB (&alice_gpio_b)
#define GPIOC (&alice_gpio_c)
#endif
#define GPIO_PIN_1             (1U << 1)
#define GPIO_PIN_12            (1U << 12)
#define GPIO_PIN_13            (1U << 13)
#define GPIO_PIN_RESET         0U
#define GPIO_PIN_SET           1U
#define RUN_SWITCH_Pin         GPIO_PIN_1
#define RUN_SWITCH_GPIO_Port   GPIOA
#define STATUS_LED_Pin         GPIO_PIN_12
#define STATUS_LED_GPIO_Port   GPIOB
#define HAL_OK                 0
#define DMA_NORMAL             0U
#define DMA_CIRCULAR           1U
#define DMA_PERIPH_TO_MEMORY   0U
#define DMA_MEMORY_TO_PERIPH   1U
#define DMA_MEMORY_TO_MEMORY   2U
#define DMA_PINC_DISABLE       0U
#define DMA_PINC_ENABLE        1U
#define DMA_MINC_DISABLE       0U
#define DMA_MINC_ENABLE        1U
#define DMA_PDATAALIGN_BYTE    0U
#define DMA_PDATAALIGN_HALFWORD 1U
#define DMA_PDATAALIGN_WORD    2U
#define DMA_MDATAALIGN_BYTE    0U
#define DMA_MDATAALIGN_HALFWORD 1U
#define DMA_MDATAALIGN_WORD    2U
#define DMA_PRIORITY_LOW       0U
#define DMA_PRIORITY_MEDIUM    1U
#define DMA_PRIORITY_HIGH      2U
#define DMA_PRIORITY_VERY_HIGH 3U
#define GPIO_MODE_OUTPUT_PP    1U
#define GPIO_MODE_INPUT        0U
#define GPIO_PULLUP            1U
#define GPIO_NOPULL            0U
#define GPIO_SPEED_FREQ_LOW    0U
#define RCC_OSCILLATORTYPE_HSE 1U
#define RCC_HSE_ON             1U
#define RCC_HSE_PREDIV_DIV1    1U
#define RCC_HSI_ON             1U
#define RCC_PLL_ON             1U
#define RCC_PLLSOURCE_HSE      1U
#define RCC_PLL_MUL9           9U
#define RCC_CLOCKTYPE_HCLK     (1U << 0)
#define RCC_CLOCKTYPE_SYSCLK   (1U << 1)
#define RCC_CLOCKTYPE_PCLK1    (1U << 2)
#define RCC_CLOCKTYPE_PCLK2    (1U << 3)
#define RCC_SYSCLKSOURCE_PLLCLK 2U
#define RCC_SYSCLK_DIV1        1U
#define RCC_HCLK_DIV1          1U
#define RCC_HCLK_DIV2          2U
#define FLASH_LATENCY_2        2U
#define RCC_PERIPHCLK_ADC      1U
#define RCC_ADCPCLK2_DIV6      6U
#define __HAL_RCC_GPIOC_CLK_ENABLE() ((void)0)
#define __HAL_RCC_GPIOA_CLK_ENABLE() ((void)0)
#define __HAL_RCC_GPIOB_CLK_ENABLE() ((void)0)
#define __disable_irq() ((void)0)
#define __HAL_LINKDMA(handle, field, dma) ((handle)->field = &(dma))

static inline void HAL_Init(void) {}
static inline void HAL_Delay(uint32_t delay) { (void)delay; }
static inline uint32_t HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint32_t pin) { (void)port; (void)pin; return GPIO_PIN_SET; }
static inline void HAL_GPIO_TogglePin(GPIO_TypeDef *port, uint32_t pin) { (void)port; (void)pin; }
static inline void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint32_t pin, uint32_t state) { (void)port; (void)pin; (void)state; }
static inline void HAL_GPIO_Init(GPIO_TypeDef *port, GPIO_InitTypeDef *config) { (void)port; (void)config; }
static inline int HAL_RCC_OscConfig(RCC_OscInitTypeDef *config) { (void)config; return 0; }
static inline int HAL_RCC_ClockConfig(RCC_ClkInitTypeDef *config, uint32_t latency) { (void)config; (void)latency; return 0; }
static inline int HAL_RCCEx_PeriphCLKConfig(RCC_PeriphCLKInitTypeDef *config) { (void)config; return 0; }
void Error_Handler(void);

#endif
"""


STM32_CUBEMX_MODULE_STUB_HEADERS = {
    "adc.h": r"""
#ifndef ALICE_STM32_ADC_H
#define ALICE_STM32_ADC_H
#include "main.h"
extern ADC_HandleTypeDef hadc1;
extern ADC_HandleTypeDef hadc2;
void MX_ADC1_Init(void);
void MX_ADC2_Init(void);
HAL_StatusTypeDef HAL_ADC_Start(ADC_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_ADC_Start_DMA(ADC_HandleTypeDef *handle, uint32_t *data, uint32_t length);
HAL_StatusTypeDef HAL_ADC_Stop_DMA(ADC_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_ADC_PollForConversion(ADC_HandleTypeDef *handle, uint32_t timeout);
uint32_t HAL_ADC_GetValue(ADC_HandleTypeDef *handle);
#endif
""",
    "i2c.h": r"""
#ifndef ALICE_STM32_I2C_H
#define ALICE_STM32_I2C_H
#include "main.h"
extern I2C_HandleTypeDef hi2c1;
extern I2C_HandleTypeDef hi2c2;
void MX_I2C1_Init(void);
void MX_I2C2_Init(void);
#endif
""",
    "tim.h": r"""
#ifndef ALICE_STM32_TIM_H
#define ALICE_STM32_TIM_H
#include "main.h"
extern TIM_HandleTypeDef htim1;
extern TIM_HandleTypeDef htim2;
extern TIM_HandleTypeDef htim3;
extern TIM_HandleTypeDef htim4;
void MX_TIM1_Init(void);
void MX_TIM2_Init(void);
void MX_TIM3_Init(void);
void MX_TIM4_Init(void);
#endif
""",
    "usart.h": r"""
#ifndef ALICE_STM32_USART_H
#define ALICE_STM32_USART_H
#include "main.h"
extern UART_HandleTypeDef huart1;
extern UART_HandleTypeDef huart2;
extern UART_HandleTypeDef huart3;
void MX_USART1_UART_Init(void);
void MX_USART2_UART_Init(void);
void MX_USART3_UART_Init(void);
HAL_StatusTypeDef HAL_UART_Receive(UART_HandleTypeDef *handle, uint8_t *data, uint16_t length, uint32_t timeout);
HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *handle, const uint8_t *data, uint16_t length, uint32_t timeout);
HAL_StatusTypeDef HAL_UART_Receive_DMA(UART_HandleTypeDef *handle, uint8_t *data, uint16_t length);
HAL_StatusTypeDef HAL_UART_Transmit_DMA(UART_HandleTypeDef *handle, const uint8_t *data, uint16_t length);
HAL_StatusTypeDef HAL_UART_DMAStop(UART_HandleTypeDef *handle);
#endif
""",
    "dma.h": r"""
#ifndef ALICE_STM32_DMA_H
#define ALICE_STM32_DMA_H
#include "main.h"
extern DMA_HandleTypeDef hdma_adc1;
extern DMA_HandleTypeDef hdma_usart1_tx;
extern DMA_HandleTypeDef hdma_usart1_rx;
extern DMA_HandleTypeDef hdma_usart2_tx;
extern DMA_HandleTypeDef hdma_usart2_rx;
void MX_DMA_Init(void);
HAL_StatusTypeDef HAL_DMA_Init(DMA_HandleTypeDef *handle);
HAL_StatusTypeDef HAL_DMA_DeInit(DMA_HandleTypeDef *handle);
void HAL_DMA_IRQHandler(DMA_HandleTypeDef *handle);
#endif
""",
    "gpio.h": r"""
#ifndef ALICE_STM32_GPIO_H
#define ALICE_STM32_GPIO_H
#include "main.h"
void MX_GPIO_Init(void);
#endif
""",
    "alicesim_ssd1306.h": r"""
#ifndef ALICE_STM32_SSD1306_H
#define ALICE_STM32_SSD1306_H
#include <stddef.h>
#include <stdint.h>
typedef struct I2C_HandleTypeDef I2C_HandleTypeDef;
typedef struct { I2C_HandleTypeDef *i2c; uint8_t framebuffer[1024]; } AliceSIM_SSD1306;
typedef enum {
  ALICESIM_SSD1306_COLOR_BLACK = 0,
  ALICESIM_SSD1306_COLOR_WHITE = 1,
  ALICESIM_SSD1306_COLOR_XOR = 2
} AliceSIM_SSD1306_Color;
#define ALICESIM_SSD1306_DEFAULT_ADDRESS 0x3CU
HAL_StatusTypeDef AliceSIM_SSD1306_Init(AliceSIM_SSD1306 *display, I2C_HandleTypeDef *i2c, uint8_t address, uint32_t timeout);
void AliceSIM_SSD1306_Clear(AliceSIM_SSD1306 *display);
void AliceSIM_SSD1306_DrawChar(AliceSIM_SSD1306 *display, uint16_t x, uint16_t y, char character, uint8_t scale, AliceSIM_SSD1306_Color color);
size_t AliceSIM_SSD1306_DrawString(AliceSIM_SSD1306 *display, uint16_t x, uint16_t y, const char *text, uint8_t scale, AliceSIM_SSD1306_Color color);
HAL_StatusTypeDef AliceSIM_SSD1306_Update(AliceSIM_SSD1306 *display);
#endif
""",
}


FREESTANDING_HEADERS = {
    "stdc++.h": r"""
#ifndef ALICE_STDCXX_UMBRELLA_H
#define ALICE_STDCXX_UMBRELLA_H
#include <bits/stdc++.h>
#endif
""",
    "stdint.h": r"""
#ifndef ALICE_FREESTANDING_STDINT_H
#define ALICE_FREESTANDING_STDINT_H
#include <stddef.h>
typedef __INT8_TYPE__ int8_t;
typedef __UINT8_TYPE__ uint8_t;
typedef __INT16_TYPE__ int16_t;
typedef __UINT16_TYPE__ uint16_t;
typedef __INT32_TYPE__ int32_t;
typedef __UINT32_TYPE__ uint32_t;
typedef __INT64_TYPE__ int64_t;
typedef __UINT64_TYPE__ uint64_t;
typedef __INTPTR_TYPE__ intptr_t;
typedef __UINTPTR_TYPE__ uintptr_t;
typedef __INTMAX_TYPE__ intmax_t;
typedef __UINTMAX_TYPE__ uintmax_t;
#define INT8_MIN (-127 - 1)
#define INT16_MIN (-32767 - 1)
#define INT32_MIN (-2147483647 - 1)
#define INT8_MAX 127
#define INT16_MAX 32767
#define INT32_MAX 2147483647
#define UINT8_MAX 255U
#define UINT16_MAX 65535U
#define UINT32_MAX 4294967295U
#define INT8_C(value) value
#define UINT8_C(value) value##U
#define INT16_C(value) value
#define UINT16_C(value) value##U
#define INT32_C(value) value
#define UINT32_C(value) value##U
#endif
""",
    "stddef.h": r"""
#ifndef ALICE_FREESTANDING_STDDEF_H
#define ALICE_FREESTANDING_STDDEF_H
typedef __SIZE_TYPE__ size_t;
typedef __PTRDIFF_TYPE__ ptrdiff_t;
typedef __WCHAR_TYPE__ wchar_t;
#define NULL ((void *)0)
#define offsetof(type, member) __builtin_offsetof(type, member)
#endif
""",
    "stdbool.h": r"""
#ifndef ALICE_FREESTANDING_STDBOOL_H
#define ALICE_FREESTANDING_STDBOOL_H
#define bool _Bool
#define true 1
#define false 0
#define __bool_true_false_are_defined 1
#endif
""",
    "stdarg.h": r"""
#ifndef ALICE_FREESTANDING_STDARG_H
#define ALICE_FREESTANDING_STDARG_H
typedef __builtin_va_list va_list;
#define va_start(arguments, last) __builtin_va_start(arguments, last)
#define va_end(arguments) __builtin_va_end(arguments)
#define va_arg(arguments, type) __builtin_va_arg(arguments, type)
#define va_copy(destination, source) __builtin_va_copy(destination, source)
#endif
""",
    "limits.h": r"""
#ifndef ALICE_FREESTANDING_LIMITS_H
#define ALICE_FREESTANDING_LIMITS_H
#define CHAR_BIT __CHAR_BIT__
#define SCHAR_MAX __SCHAR_MAX__
#define SHRT_MAX __SHRT_MAX__
#define INT_MAX __INT_MAX__
#define LONG_MAX __LONG_MAX__
#define LLONG_MAX __LONG_LONG_MAX__
#define UCHAR_MAX (__SCHAR_MAX__ * 2U + 1U)
#define USHRT_MAX (__SHRT_MAX__ * 2U + 1U)
#define UINT_MAX (__INT_MAX__ * 2U + 1U)
#define ULONG_MAX (__LONG_MAX__ * 2UL + 1UL)
#define ULLONG_MAX (__LONG_LONG_MAX__ * 2ULL + 1ULL)
#endif
""",
    "errno.h": r"""
#ifndef ALICE_FREESTANDING_ERRNO_H
#define ALICE_FREESTANDING_ERRNO_H
#include <stddef.h>
extern int errno;
#define EPERM 1
#define ENOENT 2
#define ESRCH 3
#define EINTR 4
#define EIO 5
#define ENXIO 6
#define E2BIG 7
#define ENOEXEC 8
#define EBADF 9
#define ECHILD 10
#define EAGAIN 11
#define ENOMEM 12
#define EACCES 13
#define EFAULT 14
#define EBUSY 16
#define EEXIST 17
#define EXDEV 18
#define ENODEV 19
#define ENOTDIR 20
#define EISDIR 21
#define EINVAL 22
#define ENFILE 23
#define EMFILE 24
#define ENOTTY 25
#define EFBIG 27
#define ENOSPC 28
#define ESPIPE 29
#define EROFS 30
#define EMLINK 31
#define EPIPE 32
#define EDOM 33
#define ERANGE 34
#define ENOSYS 88
#endif
""",
    "sys/types.h": r"""
#ifndef ALICE_FREESTANDING_SYS_TYPES_H
#define ALICE_FREESTANDING_SYS_TYPES_H
#include <stddef.h>
typedef __PTRDIFF_TYPE__ ssize_t;
typedef long off_t;
typedef int pid_t;
typedef unsigned int mode_t;
typedef unsigned long dev_t;
typedef unsigned long ino_t;
typedef unsigned int uid_t;
typedef unsigned int gid_t;
typedef unsigned long nlink_t;
typedef long clock_t;
typedef long time_t;
typedef long suseconds_t;
typedef unsigned int useconds_t;
#endif
""",
    "sys/stat.h": r"""
#ifndef ALICE_FREESTANDING_SYS_STAT_H
#define ALICE_FREESTANDING_SYS_STAT_H
#include <sys/types.h>
struct stat {
  dev_t st_dev;
  ino_t st_ino;
  mode_t st_mode;
  nlink_t st_nlink;
  uid_t st_uid;
  gid_t st_gid;
  dev_t st_rdev;
  off_t st_size;
  time_t st_atime;
  time_t st_mtime;
  time_t st_ctime;
};
#define S_IFMT 0170000
#define S_IFDIR 0040000
#define S_IFCHR 0020000
#define S_IFBLK 0060000
#define S_IFREG 0100000
#define S_IFIFO 0010000
#define S_IFLNK 0120000
#define S_IFSOCK 0140000
#define S_IRUSR 0000400
#define S_IWUSR 0000200
#define S_IXUSR 0000100
#define S_ISDIR(mode) (((mode) & S_IFMT) == S_IFDIR)
#define S_ISCHR(mode) (((mode) & S_IFMT) == S_IFCHR)
#define S_ISBLK(mode) (((mode) & S_IFMT) == S_IFBLK)
#define S_ISREG(mode) (((mode) & S_IFMT) == S_IFREG)
#define S_ISFIFO(mode) (((mode) & S_IFMT) == S_IFIFO)
int stat(const char *path, struct stat *buffer);
int fstat(int descriptor, struct stat *buffer);
int chmod(const char *path, mode_t mode);
int mkdir(const char *path, mode_t mode);
#endif
""",
    "unistd.h": r"""
#ifndef ALICE_FREESTANDING_UNISTD_H
#define ALICE_FREESTANDING_UNISTD_H
#include <stddef.h>
#include <sys/types.h>
#define STDIN_FILENO 0
#define STDOUT_FILENO 1
#define STDERR_FILENO 2
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
extern char **environ;
int close(int descriptor);
ssize_t read(int descriptor, void *buffer, size_t count);
ssize_t write(int descriptor, const void *buffer, size_t count);
off_t lseek(int descriptor, off_t offset, int origin);
int unlink(const char *path);
int isatty(int descriptor);
pid_t getpid(void);
int usleep(useconds_t microseconds);
unsigned int sleep(unsigned int seconds);
void *sbrk(ptrdiff_t increment);
#endif
""",
    "stdio.h": r"""
#ifndef ALICE_FREESTANDING_STDIO_H
#define ALICE_FREESTANDING_STDIO_H
#include <stdarg.h>
#include <stddef.h>
typedef struct __alice_file FILE;
typedef long fpos_t;
#define EOF (-1)
#define BUFSIZ 1024
#define FILENAME_MAX 256
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
#define _IOFBF 0
#define _IOLBF 1
#define _IONBF 2
extern FILE *stdin;
extern FILE *stdout;
extern FILE *stderr;
int remove(const char *path);
int rename(const char *old_path, const char *new_path);
FILE *fopen(const char *path, const char *mode);
FILE *freopen(const char *path, const char *mode, FILE *stream);
int fclose(FILE *stream);
int fflush(FILE *stream);
void setbuf(FILE *stream, char *buffer);
int setvbuf(FILE *stream, char *buffer, int mode, size_t size);
size_t fread(void *buffer, size_t size, size_t count, FILE *stream);
size_t fwrite(const void *buffer, size_t size, size_t count, FILE *stream);
int fgetc(FILE *stream);
int getc(FILE *stream);
int getchar(void);
int fputc(int character, FILE *stream);
int putc(int character, FILE *stream);
int putchar(int character);
char *fgets(char *buffer, int count, FILE *stream);
int fputs(const char *text, FILE *stream);
int puts(const char *text);
int printf(const char *format, ...);
int fprintf(FILE *stream, const char *format, ...);
int sprintf(char *buffer, const char *format, ...);
int snprintf(char *buffer, size_t size, const char *format, ...);
int vprintf(const char *format, va_list arguments);
int vfprintf(FILE *stream, const char *format, va_list arguments);
int vsprintf(char *buffer, const char *format, va_list arguments);
int vsnprintf(char *buffer, size_t size, const char *format, va_list arguments);
int scanf(const char *format, ...);
int fscanf(FILE *stream, const char *format, ...);
int sscanf(const char *text, const char *format, ...);
#endif
""",
    "stdlib.h": r"""
#ifndef ALICE_FREESTANDING_STDLIB_H
#define ALICE_FREESTANDING_STDLIB_H
#include <stddef.h>
typedef struct { int quot; int rem; } div_t;
typedef struct { long quot; long rem; } ldiv_t;
#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define RAND_MAX 2147483647
void *malloc(size_t size);
void *calloc(size_t count, size_t size);
void *realloc(void *memory, size_t size);
void free(void *memory);
void abort(void);
void exit(int status);
void _Exit(int status);
int atexit(void (*function)(void));
int atoi(const char *text);
long atol(const char *text);
long long atoll(const char *text);
double atof(const char *text);
long strtol(const char *text, char **end, int base);
unsigned long strtoul(const char *text, char **end, int base);
long long strtoll(const char *text, char **end, int base);
unsigned long long strtoull(const char *text, char **end, int base);
double strtod(const char *text, char **end);
int abs(int value);
long labs(long value);
div_t div(int numerator, int denominator);
ldiv_t ldiv(long numerator, long denominator);
int rand(void);
void srand(unsigned int seed);
void qsort(void *base, size_t count, size_t size, int (*compare)(const void *, const void *));
void *bsearch(const void *key, const void *base, size_t count, size_t size, int (*compare)(const void *, const void *));
#endif
""",
    "string.h": r"""
#ifndef ALICE_FREESTANDING_STRING_H
#define ALICE_FREESTANDING_STRING_H
#include <stddef.h>
void *memcpy(void *destination, const void *source, size_t count);
void *memmove(void *destination, const void *source, size_t count);
void *memset(void *destination, int value, size_t count);
int memcmp(const void *left, const void *right, size_t count);
void *memchr(const void *memory, int value, size_t count);
char *strcpy(char *destination, const char *source);
char *strncpy(char *destination, const char *source, size_t count);
char *strcat(char *destination, const char *source);
char *strncat(char *destination, const char *source, size_t count);
int strcmp(const char *left, const char *right);
int strncmp(const char *left, const char *right, size_t count);
size_t strlen(const char *text);
char *strchr(const char *text, int character);
char *strrchr(const char *text, int character);
char *strstr(const char *text, const char *needle);
char *strtok(char *text, const char *delimiters);
size_t strspn(const char *text, const char *accept);
size_t strcspn(const char *text, const char *reject);
char *strpbrk(const char *text, const char *accept);
char *strerror(int error_number);
#endif
""",
    "signal.h": r"""
#ifndef ALICE_FREESTANDING_SIGNAL_H
#define ALICE_FREESTANDING_SIGNAL_H
typedef int sig_atomic_t;
typedef void (*alice_signal_handler_t)(int);
#define SIG_DFL ((alice_signal_handler_t)0)
#define SIG_IGN ((alice_signal_handler_t)1)
#define SIG_ERR ((alice_signal_handler_t)-1)
#define SIGINT 2
#define SIGILL 4
#define SIGABRT 6
#define SIGFPE 8
#define SIGSEGV 11
#define SIGTERM 15
alice_signal_handler_t signal(int signal_number, alice_signal_handler_t handler);
int raise(int signal_number);
#endif
""",
    "time.h": r"""
#ifndef ALICE_FREESTANDING_TIME_H
#define ALICE_FREESTANDING_TIME_H
#include <stddef.h>
#include <sys/types.h>
#define CLOCKS_PER_SEC 1000L
struct tm {
  int tm_sec;
  int tm_min;
  int tm_hour;
  int tm_mday;
  int tm_mon;
  int tm_year;
  int tm_wday;
  int tm_yday;
  int tm_isdst;
};
struct timespec { time_t tv_sec; long tv_nsec; };
clock_t clock(void);
time_t time(time_t *result);
double difftime(time_t end, time_t beginning);
time_t mktime(struct tm *time_value);
char *asctime(const struct tm *time_value);
char *ctime(const time_t *time_value);
struct tm *gmtime(const time_t *time_value);
struct tm *localtime(const time_t *time_value);
size_t strftime(char *buffer, size_t size, const char *format, const struct tm *time_value);
#endif
""",
    "sys/time.h": r"""
#ifndef ALICE_FREESTANDING_SYS_TIME_H
#define ALICE_FREESTANDING_SYS_TIME_H
#include <sys/types.h>
struct timeval { time_t tv_sec; suseconds_t tv_usec; };
struct timezone { int tz_minuteswest; int tz_dsttime; };
int gettimeofday(struct timeval *time_value, void *timezone_value);
#endif
""",
    "sys/times.h": r"""
#ifndef ALICE_FREESTANDING_SYS_TIMES_H
#define ALICE_FREESTANDING_SYS_TIMES_H
#include <sys/types.h>
struct tms {
  clock_t tms_utime;
  clock_t tms_stime;
  clock_t tms_cutime;
  clock_t tms_cstime;
};
clock_t times(struct tms *buffer);
#endif
""",
    "ctype.h": r"""
#ifndef ALICE_FREESTANDING_CTYPE_H
#define ALICE_FREESTANDING_CTYPE_H
int isalnum(int character);
int isalpha(int character);
int isblank(int character);
int iscntrl(int character);
int isdigit(int character);
int isgraph(int character);
int islower(int character);
int isprint(int character);
int ispunct(int character);
int isspace(int character);
int isupper(int character);
int isxdigit(int character);
int tolower(int character);
int toupper(int character);
#endif
""",
    "assert.h": r"""
#ifndef ALICE_FREESTANDING_ASSERT_H
#define ALICE_FREESTANDING_ASSERT_H
#ifdef NDEBUG
#define assert(expression) ((void)0)
#else
void __alice_assert_fail(const char *expression, const char *file, int line);
#define assert(expression) ((expression) ? (void)0 : __alice_assert_fail(#expression, __FILE__, __LINE__))
#endif
#endif
""",
    "fcntl.h": r"""
#ifndef ALICE_FREESTANDING_FCNTL_H
#define ALICE_FREESTANDING_FCNTL_H
#include <sys/types.h>
#define O_RDONLY 0x0000
#define O_WRONLY 0x0001
#define O_RDWR 0x0002
#define O_APPEND 0x0008
#define O_CREAT 0x0200
#define O_TRUNC 0x0400
#define O_EXCL 0x0800
int open(const char *path, int flags, ...);
int creat(const char *path, mode_t mode);
#endif
""",
    "malloc.h": r"""
#ifndef ALICE_FREESTANDING_MALLOC_H
#define ALICE_FREESTANDING_MALLOC_H
#include <stdlib.h>
#endif
""",
    "sys/errno.h": r"""
#ifndef ALICE_FREESTANDING_SYS_ERRNO_H
#define ALICE_FREESTANDING_SYS_ERRNO_H
#include <errno.h>
#endif
""",
    "sys/unistd.h": r"""
#ifndef ALICE_FREESTANDING_SYS_UNISTD_H
#define ALICE_FREESTANDING_SYS_UNISTD_H
#include <unistd.h>
#endif
""",
}


class ProjectRequestError(ValueError):
    """Raised when a project-check request cannot be handled safely."""


class RequestTooLargeError(ProjectRequestError):
    """Raised when a valid request exceeds a configured resource limit."""


def normalize_project_path(value: object, *, allow_root: bool = False) -> Path:
    if not isinstance(value, str):
        raise ProjectRequestError("Project paths must be strings")
    raw_path = value.strip().replace("\\", "/")
    if allow_root and raw_path in {"", "."}:
        return Path(".")
    if not raw_path:
        raise ProjectRequestError("Project file path cannot be empty")
    if len(raw_path) > 512 or "\x00" in raw_path or "\r" in raw_path or "\n" in raw_path:
        raise ProjectRequestError(f"Invalid project path: {value!r}")
    if raw_path.startswith(("/", "//")) or re.match(r"^[A-Za-z]:", raw_path):
        raise ProjectRequestError(f"Absolute project paths are not allowed: {value}")

    pure_path = PurePosixPath(raw_path)
    if pure_path.is_absolute() or not pure_path.parts:
        raise ProjectRequestError(f"Invalid project path: {value}")
    for part in pure_path.parts:
        if part in {"", ".", ".."}:
            raise ProjectRequestError(f"Path traversal is not allowed: {value}")
        if ":" in part or part.endswith((" ", ".")):
            raise ProjectRequestError(f"Unsafe project path segment: {part}")
        if part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES:
            raise ProjectRequestError(f"Reserved project path segment: {part}")
    return Path(*pure_path.parts)


def normalize_project_files(raw_files: object) -> list[tuple[Path, str]]:
    if isinstance(raw_files, dict) and ("path" in raw_files or "filename" in raw_files):
        entries = [raw_files]
    elif isinstance(raw_files, dict):
        entries = [{"path": path, "content": content} for path, content in raw_files.items()]
    elif isinstance(raw_files, list):
        entries = raw_files
    else:
        raise ProjectRequestError("files must be a list or an object keyed by relative path")

    if not entries:
        raise ProjectRequestError("At least one project file is required")
    if len(entries) > MAX_PROJECT_FILES:
        raise ProjectRequestError(f"Project contains more than {MAX_PROJECT_FILES} files")

    normalized: list[tuple[Path, str]] = []
    seen_paths: set[str] = set()
    total_text_bytes = 0
    for entry in entries:
        if isinstance(entry, list) and len(entry) == 2:
            path_value, content = entry
        elif isinstance(entry, dict):
            path_value = entry.get("path", entry.get("filename", entry.get("name")))
            if "content" in entry:
                content = entry["content"]
            else:
                content = entry.get("code")
        else:
            raise ProjectRequestError("Each project file must contain path and content")

        relative_path = normalize_project_path(path_value)
        if not isinstance(content, str):
            raise ProjectRequestError(f"Project file content must be text: {relative_path.as_posix()}")
        content_bytes = len(content.encode("utf-8"))
        if content_bytes > MAX_PROJECT_FILE_BYTES:
            raise RequestTooLargeError(f"Project file is too large: {relative_path.as_posix()}")
        total_text_bytes += content_bytes
        if total_text_bytes > MAX_PROJECT_TEXT_BYTES:
            raise RequestTooLargeError(
                f"Project text exceeds the {MAX_PROJECT_TEXT_BYTES}-byte limit"
            )

        path_key = relative_path.as_posix().casefold()
        if path_key in seen_paths:
            raise ProjectRequestError(f"Duplicate project file path: {relative_path.as_posix()}")
        seen_paths.add(path_key)
        normalized.append((relative_path, content))
    return normalized


def normalize_path_list(value: object, field_name: str) -> list[Path]:
    if value is None:
        return []
    values = [value] if isinstance(value, str) else value
    if not isinstance(values, list):
        raise ProjectRequestError(f"{field_name} must be a list of relative paths")
    max_paths = MAX_CLANG_TARGETS if field_name == "targets" else MAX_PROJECT_FILES
    if len(values) > max_paths:
        raise ProjectRequestError(f"Too many paths in {field_name}")
    return [normalize_project_path(item, allow_root=field_name == "includeDirs") for item in values]


def normalize_defines(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        raw_defines: list[object] = []
        for name, define_value in value.items():
            if define_value is None or define_value is True:
                raw_defines.append(name)
            elif define_value is False:
                raw_defines.append(f"{name}=0")
            else:
                raw_defines.append(f"{name}={define_value}")
    elif isinstance(value, list):
        raw_defines = value
    else:
        raise ProjectRequestError("defines must be a list or object")
    if len(raw_defines) > 256:
        raise ProjectRequestError("Too many preprocessor defines")

    defines: list[str] = []
    for raw_define in raw_defines:
        if not isinstance(raw_define, str):
            raise ProjectRequestError("Preprocessor defines must be strings")
        define = raw_define[2:] if raw_define.startswith("-D") else raw_define
        if len(define) > 512 or not DEFINE_PATTERN.fullmatch(define):
            raise ProjectRequestError(f"Invalid preprocessor define: {raw_define!r}")
        defines.append(define)
    return defines


def write_project_files(temp_root: Path, files: list[tuple[Path, str]]) -> None:
    resolved_root = temp_root.resolve()
    for relative_path, content in files:
        destination = (temp_root / relative_path).resolve()
        try:
            destination.relative_to(resolved_root)
        except ValueError as exc:
            raise ProjectRequestError(f"Project path escapes the temporary workspace: {relative_path.as_posix()}") from exc
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("w", encoding="utf-8", newline="") as project_file:
            project_file.write(content)


def write_freestanding_headers(temp_root: Path, files: list[tuple[Path, str]]) -> Path:
    existing_paths = {path.as_posix().casefold() for path, _ in files}
    compatibility_root = temp_root / ".alicesim-compat"
    for header_name, content in FREESTANDING_HEADERS.items():
        header_key = PurePosixPath(header_name).as_posix().casefold()
        if any(
            project_path == header_key or project_path.endswith(f"/{header_key}")
            for project_path in existing_paths
        ):
            continue
        header_path = compatibility_root / header_name
        header_path.parent.mkdir(parents=True, exist_ok=True)
        with header_path.open("w", encoding="utf-8", newline="") as header_file:
            header_file.write(content)
    return compatibility_root


def discover_include_dirs(
    temp_root: Path,
    files: list[tuple[Path, str]],
    explicit_dirs: list[Path],
) -> list[Path]:
    include_dirs: dict[str, Path] = {}

    def add_include_dir(path: Path) -> None:
        resolved = path.resolve()
        try:
            resolved.relative_to(temp_root.resolve())
        except ValueError as exc:
            raise ProjectRequestError(f"Include path escapes the temporary workspace: {path}") from exc
        if resolved.is_dir():
            include_dirs.setdefault(str(resolved).casefold(), resolved)

    add_include_dir(temp_root)
    for relative_dir in explicit_dirs:
        directory = temp_root if relative_dir == Path(".") else temp_root / relative_dir
        directory.mkdir(parents=True, exist_ok=True)
        add_include_dir(directory)

    for relative_path, _ in files:
        absolute_path = temp_root / relative_path
        suffix = relative_path.suffix.lower()
        if suffix in HEADER_SUFFIXES or suffix in SOURCE_SUFFIXES:
            add_include_dir(absolute_path.parent)
        for parent in relative_path.parents:
            if parent == Path("."):
                continue
            if parent.name.casefold() in {"inc", "include", "includes"}:
                add_include_dir(temp_root / parent)

    return sorted(include_dirs.values(), key=lambda path: (path != temp_root.resolve(), path.as_posix().casefold()))


def select_project_targets(
    payload: dict,
    files: list[tuple[Path, str]],
) -> list[Path]:
    file_lookup = {path.as_posix().casefold(): path for path, _ in files}
    raw_targets = payload.get("targets")
    if raw_targets is not None:
        requested_targets = normalize_path_list(raw_targets, "targets")
    else:
        active_path = payload.get("activePath")
        requested_targets = []
        if isinstance(active_path, str) and active_path.strip():
            normalized_active = normalize_project_path(active_path)
            if normalized_active.suffix.lower() in SOURCE_SUFFIXES:
                requested_targets.append(normalized_active)
        if not requested_targets:
            requested_targets = [path for path, _ in files if path.suffix.lower() in SOURCE_SUFFIXES]
    if len(requested_targets) > MAX_CLANG_TARGETS:
        raise ProjectRequestError(f"More than {MAX_CLANG_TARGETS} C targets were selected")

    targets: list[Path] = []
    seen_targets: set[str] = set()
    for requested_target in requested_targets:
        key = requested_target.as_posix().casefold()
        project_path = file_lookup.get(key)
        if project_path is None:
            raise ProjectRequestError(f"Clang target is not present in files: {requested_target.as_posix()}")
        if project_path.suffix.lower() not in SOURCE_SUFFIXES:
            raise ProjectRequestError(f"Clang target is not a C/C++ source file: {project_path.as_posix()}")
        if key not in seen_targets:
            seen_targets.add(key)
            targets.append(project_path)
    if not targets:
        raise ProjectRequestError("No C source files were selected for checking")
    return targets


def diagnostic_project_path(location_file: object, temp_root: Path, fallback: Path) -> str | None:
    if location_file is None:
        return fallback.as_posix()
    file_name = getattr(location_file, "name", None)
    if not file_name:
        return fallback.as_posix()
    try:
        absolute_path = Path(file_name).resolve()
        return absolute_path.relative_to(temp_root.resolve()).as_posix()
    except (OSError, ValueError):
        return None


def arm_target_args_unavailable(diagnostics: list) -> bool:
    markers = (
        "unknown target",
        "unknown argument",
        "unsupported option",
        "unknown target cpu",
        "unable to create target",
        "no available targets are compatible",
    )
    for diagnostic in diagnostics:
        location_file = getattr(getattr(diagnostic, "location", None), "file", None)
        spelling = str(getattr(diagnostic, "spelling", "")).casefold()
        if not location_file and any(marker in spelling for marker in markers):
            return True
    return False


def _gcc_diagnostic_path(raw_file: object, temp_root: Path, fallback: Path) -> str | None:
    if not raw_file:
        return fallback.as_posix()
    try:
        absolute = Path(str(raw_file)).resolve()
        return absolute.relative_to(temp_root.resolve()).as_posix()
    except (OSError, ValueError):
        return fallback.as_posix() if str(raw_file).endswith(fallback.as_posix()) else None


def _parse_gcc_diagnostics(output: str, temp_root: Path, fallback: Path) -> list[dict]:
    text = output.strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except (TypeError, ValueError):
        return [{
            "file": fallback.as_posix(),
            "severity": "error",
            "line": 1,
            "column": 1,
            "message": text.splitlines()[0][:1000],
            "source": ARM_CXX_ENGINE,
            "category": "C/C++",
        }]
    if not isinstance(payload, list):
        payload = [payload]
    diagnostics: list[dict] = []
    severity_names = {"error": "error", "fatal error": "error", "warning": "warning", "note": "information"}
    for item in payload:
        if not isinstance(item, dict):
            continue
        severity = severity_names.get(str(item.get("kind", "")).casefold(), "error")
        if severity == "information":
            continue
        caret: dict = {}
        for location in item.get("locations", []) if isinstance(item.get("locations"), list) else []:
            if not isinstance(location, dict):
                continue
            candidate = location.get("caret")
            if isinstance(candidate, dict):
                caret = candidate
                break
        file_name = _gcc_diagnostic_path(caret.get("file"), temp_root, fallback)
        if file_name is None:
            continue
        diagnostics.append({
            "file": file_name,
            "severity": severity,
            "line": max(1, int(caret.get("line") or 1)),
            "column": max(1, int(caret.get("column") or caret.get("display-column") or 1)),
            "message": str(item.get("message") or "C++ compiler diagnostic"),
            "source": ARM_CXX_ENGINE,
            "category": "C/C++",
        })
    return diagnostics


def gcc_cpp_check_files(
    files: list[tuple[Path, str]],
    targets: list[Path],
    explicit_include_dirs: list[Path] | None = None,
    defines: list[str] | None = None,
) -> dict:
    explicit_include_dirs = explicit_include_dirs or []
    defines = defines or []
    with tempfile.TemporaryDirectory(prefix="alicesim-cpp-") as temp_dir:
        temp_root = Path(temp_dir)
        compatibility_root = write_freestanding_headers(temp_root, files)
        write_project_files(temp_root, files)
        include_dirs = discover_include_dirs(temp_root, files, explicit_include_dirs)
        target_labels = [target.as_posix() for target in targets]
        base_response = {
            "checkedFiles": target_labels,
            "includeDirs": [
                "." if path == temp_root.resolve() else path.relative_to(temp_root.resolve()).as_posix()
                for path in include_dirs
            ],
            "languageStandard": "gnu++17",
            "target": "arm-none-eabi",
        }
        if ARM_CXX_PATH is None:
            return {
                "clang": False,
                "engine": ARM_CXX_ENGINE,
                "diagnostics": [{
                    "file": target_labels[0] if target_labels else "main.cpp",
                    "severity": "error",
                    "line": 1,
                    "column": 1,
                    "message": "arm-none-eabi-g++ was not found; install the STM32CubeIDE GNU toolchain or set ALICESIM_ARM_GXX to its path.",
                    "source": "Alice C++ Analyzer",
                    "category": "C/C++",
                }],
                **base_response,
            }

        include_args: list[str] = []
        for directory in include_dirs:
            include_args.extend(["-I", str(directory)])
        # Compatibility headers are a last-resort fallback. The real newlib
        # and libstdc++ headers must win for C++ standard-library includes.
        include_args.extend(["-idirafter", str(compatibility_root)])
        define_args = [f"-D{define}" for define in defines]
        diagnostics: list[dict] = []
        failed_files: list[str] = []
        for target in targets:
            source_path = temp_root / target
            command = [
                str(ARM_CXX_PATH),
                "-std=gnu++17",
                "-fsyntax-only",
                "-fdiagnostics-format=json",
                "-Wpedantic",
                "-Wall",
                "-Wextra",
                "-mcpu=cortex-m3",
                "-mthumb",
                *include_args,
                *define_args,
                str(source_path),
            ]
            try:
                result = subprocess.run(
                    command,
                    cwd=temp_root,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=30,
                    check=False,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                failed_files.append(target.as_posix())
                diagnostics.append({
                    "file": target.as_posix(),
                    "severity": "error",
                    "line": 1,
                    "column": 1,
                    "message": f"GNU C++ syntax check failed to start: {exc}",
                    "source": "Alice C++ Analyzer",
                    "category": "C/C++",
                })
                continue
            compiler_output = result.stderr.strip() or result.stdout.strip()
            file_diagnostics = _parse_gcc_diagnostics(compiler_output, temp_root, target)
            diagnostics.extend(file_diagnostics)
            if result.returncode != 0 and not file_diagnostics:
                failed_files.append(target.as_posix())
                diagnostics.append({
                    "file": target.as_posix(),
                    "severity": "error",
                    "line": 1,
                    "column": 1,
                    "message": f"GNU C++ syntax check failed with exit code {result.returncode}",
                    "source": "Alice C++ Analyzer",
                    "category": "C/C++",
                })
        return {
            "clang": True,
            "engine": ARM_CXX_ENGINE,
            "diagnostics": diagnostics,
            "failedFiles": failed_files,
            **base_response,
        }


def clang_check_files(
    files: list[tuple[Path, str]],
    targets: list[Path],
    explicit_include_dirs: list[Path] | None = None,
    defines: list[str] | None = None,
    *,
    legacy: bool = False,
) -> dict:
    explicit_include_dirs = explicit_include_dirs or []
    defines = defines or []
    cpp_targets = [target for target in targets if target.suffix.lower() in CPP_SOURCE_SUFFIXES]
    c_targets = [target for target in targets if target.suffix.lower() not in CPP_SOURCE_SUFFIXES]
    if cpp_targets:
        cpp_result = gcc_cpp_check_files(files, cpp_targets, explicit_include_dirs, defines)
        if not c_targets:
            return cpp_result
        c_result = clang_check_files(files, c_targets, explicit_include_dirs, defines, legacy=legacy)
        return {
            **c_result,
            "checkedFiles": [*c_result.get("checkedFiles", []), *cpp_result.get("checkedFiles", [])],
            "diagnostics": [*c_result.get("diagnostics", []), *cpp_result.get("diagnostics", [])],
            "engine": f"{c_result.get('engine', 'Alice C Analyzer')} + {cpp_result.get('engine', ARM_CXX_ENGINE)}",
            "languageStandard": f"{c_result.get('languageStandard', 'gnu11')} / {cpp_result.get('languageStandard', 'gnu++17')}",
            "failedFiles": [*c_result.get("failedFiles", []), *cpp_result.get("failedFiles", [])],
        }
    with tempfile.TemporaryDirectory(prefix="alicesim-clang-") as temp_dir:
        temp_root = Path(temp_dir)
        compatibility_root = write_freestanding_headers(temp_root, files)
        write_project_files(temp_root, files)

        if legacy:
            existing_names = {path.name.casefold() for path, _ in files}
            legacy_headers = {
                "main.h": STM32_STUB_HEADER,
                "stm32f1xx_it.h": STM32_STUB_HEADER,
                "stm32f1xx.h": STM32_STUB_HEADER,
                **STM32_CUBEMX_MODULE_STUB_HEADERS,
            }
            for stub_name, stub_content in legacy_headers.items():
                if stub_name.casefold() in existing_names:
                    continue
                stub_path = temp_root / stub_name
                with stub_path.open("w", encoding="utf-8", newline="") as stub_file:
                    stub_file.write(stub_content)

        include_dirs = discover_include_dirs(temp_root, files, explicit_include_dirs)
        include_labels = [
            "." if path == temp_root.resolve() else path.relative_to(temp_root.resolve()).as_posix()
            for path in include_dirs
        ]
        target_labels = [target.as_posix() for target in targets]
        base_response = {
            "checkedFiles": target_labels,
            "includeDirs": include_labels,
            "languageStandard": "c11" if legacy else "gnu11",
            "target": "host" if legacy else "arm-none-eabi",
        }

        if not CLANG_AVAILABLE or clang_index is None or clang_cindex is None:
            return {
                "clang": False,
                "engine": "Alice C Analyzer",
                "diagnostics": [],
                "detail": CLANG_ERROR,
                **base_response,
            }

        severity_names = {
            clang_cindex.Diagnostic.Ignored: "information",
            clang_cindex.Diagnostic.Note: "information",
            clang_cindex.Diagnostic.Warning: "warning",
            clang_cindex.Diagnostic.Error: "error",
            clang_cindex.Diagnostic.Fatal: "error",
        }
        common_args = ["-x", "c", "-fsyntax-only", "-Wpedantic", "-Wall", "-Wextra"]
        common_args.extend(f"-I{include_dir}" for include_dir in [*include_dirs, compatibility_root])
        common_args.extend(f"-D{define}" for define in defines)
        host_args = ["-std=c11" if legacy else "-std=gnu11", *common_args]
        arm_args = ["-std=gnu11", "--target=arm-none-eabi", "-mcpu=cortex-m3", "-mthumb", *common_args]
        active_args = host_args if legacy else arm_args
        using_arm_target = not legacy
        target_fallback = False

        diagnostics: list[dict] = []
        failed_files: list[str] = []
        for target in targets:
            source_path = temp_root / target
            try:
                with CLANG_LOCK:
                    try:
                        translation_unit = clang_index.parse(
                            str(source_path),
                            args=active_args,
                            options=clang_cindex.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD,
                        )
                        clang_diagnostics = list(translation_unit.diagnostics)
                    except Exception:
                        if not using_arm_target:
                            raise
                        translation_unit = clang_index.parse(
                            str(source_path),
                            args=host_args,
                            options=clang_cindex.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD,
                        )
                        clang_diagnostics = list(translation_unit.diagnostics)
                        using_arm_target = False
                        target_fallback = True
                        active_args = host_args

                    if using_arm_target and arm_target_args_unavailable(clang_diagnostics):
                        translation_unit = clang_index.parse(
                            str(source_path),
                            args=host_args,
                            options=clang_cindex.TranslationUnit.PARSE_DETAILED_PROCESSING_RECORD,
                        )
                        clang_diagnostics = list(translation_unit.diagnostics)
                        using_arm_target = False
                        target_fallback = True
                        active_args = host_args
                    for diagnostic in clang_diagnostics:
                        if diagnostic.spelling == "no newline at end of file":
                            continue
                        severity = severity_names.get(diagnostic.severity, "information")
                        if severity == "information":
                            continue
                        location = diagnostic.location
                        relative_file = diagnostic_project_path(location.file, temp_root, target)
                        if relative_file is None:
                            continue
                        if legacy and relative_file.casefold() != target.as_posix().casefold():
                            continue
                        diagnostics.append(
                            {
                                "file": relative_file,
                                "severity": severity,
                                "line": max(1, location.line or 1),
                                "column": max(1, location.column or 1),
                                "message": diagnostic.spelling,
                                "source": CLANG_ENGINE,
                                "category": diagnostic.category_name or "C/C++",
                            }
                        )
            except Exception as exc:
                failed_files.append(target.as_posix())
                diagnostics.append(
                    {
                        "file": target.as_posix(),
                        "severity": "error",
                        "line": 1,
                        "column": 1,
                        "message": f"Clang could not check this file: {exc}",
                        "source": CLANG_ENGINE,
                        "category": "Clang invocation",
                    }
                )

        unique_diagnostics: dict[tuple, dict] = {}
        for diagnostic in diagnostics:
            key = (
                diagnostic["file"].casefold(),
                diagnostic["severity"],
                diagnostic["line"],
                diagnostic["column"],
                diagnostic["message"],
            )
            unique_diagnostics.setdefault(key, diagnostic)
        sorted_diagnostics = sorted(
            unique_diagnostics.values(),
            key=lambda item: (item["file"].casefold(), item["line"], item["column"], item["severity"]),
        )
        response = {
            "clang": True,
            "engine": CLANG_ENGINE,
            "diagnostics": sorted_diagnostics,
            **base_response,
        }
        if target_fallback:
            response["target"] = "host"
            response["targetFallback"] = True
        if failed_files:
            response["failedFiles"] = failed_files
        return response


def clang_check_project(payload: dict) -> dict:
    files = normalize_project_files(payload.get("files"))
    targets = select_project_targets(payload, files)
    include_dirs = normalize_path_list(payload.get("includeDirs"), "includeDirs")
    defines = normalize_defines(payload.get("defines"))
    return clang_check_files(files, targets, include_dirs, defines)


def build_simulation_model(payload: dict) -> dict:
    from hal_model import build_hal_model

    files = normalize_project_files(payload.get("files"))
    return build_hal_model(files)


def clang_check(code: str, filename: str) -> dict:
    requested_name = PurePosixPath(str(filename or "main.c").replace("\\", "/")).name
    try:
        safe_filename = normalize_project_path(requested_name).name
    except ProjectRequestError:
        safe_filename = "main.c"
    if Path(safe_filename).suffix.lower() not in SOURCE_SUFFIXES:
        safe_filename = "main.c"
    source_path = Path(safe_filename)
    return clang_check_files([(source_path, code)], [source_path], legacy=True)


class AliceSIMHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def end_headers(self):
        # AliceSIM is a local development application. HTML and JavaScript must
        # never survive a refresh from an older simulator build, otherwise the
        # browser can keep obsolete button handlers and fake firmware behavior.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            host, port = self.server.server_address[:2]
            self.send_json(
                {
                    "ok": True,
                    "service": SERVICE_NAME,
                    "apiVersion": API_VERSION,
                    "instance": INSTANCE_ID,
                    "pid": os.getpid(),
                    "host": host,
                    "port": port,
                    "clang": CLANG_AVAILABLE,
                    "engine": CLANG_ENGINE,
                    "detail": CLANG_ERROR,
                    "cpp": ARM_CXX_PATH is not None,
                    "cppEngine": ARM_CXX_ENGINE,
                    "spice": spice_status(),
                    "datasheetImport": datasheet_parser_status(),
                }
            )
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in {
            "/api/clang-check",
            "/api/sim-model",
            "/api/spice-solve",
            "/api/datasheet/parse",
            "/api/datasheet/validate",
        }:
            self.send_error(404, "Not found")
            return
        simulation_request = self.path == "/api/sim-model"
        spice_request = self.path == "/api/spice-solve"
        datasheet_parse_request = self.path == "/api/datasheet/parse"
        datasheet_validate_request = self.path == "/api/datasheet/validate"
        datasheet_request = datasheet_parse_request or datasheet_validate_request
        clang_request = self.path == "/api/clang-check"
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                raise ProjectRequestError("Request body is required")
            if content_length > MAX_REQUEST_BYTES:
                payload = {
                    "detail": f"Request exceeds the {MAX_REQUEST_BYTES}-byte limit",
                }
                if clang_request:
                    payload.update({
                        "clang": False,
                        "engine": "Alice C Analyzer",
                        "diagnostics": [],
                    })
                elif datasheet_request:
                    payload["ok"] = False
                self.send_json(payload, status=413)
                return
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ProjectRequestError("Request body must be a JSON object")
            if datasheet_parse_request:
                result = parse_datasheet_request(payload)
            elif datasheet_validate_request:
                result = validate_datasheet_draft(payload)
            elif spice_request:
                if solve_spice_circuit is None:
                    raise ProjectRequestError(spice_status().get("detail") or "PySpice is unavailable")
                result = solve_spice_circuit(payload.get("circuit", payload))
            elif simulation_request:
                if "files" not in payload:
                    code = str(payload.get("code", ""))
                    filename = str(payload.get("filename", "main.c"))
                    payload = {"files": {filename: code}}
                result = build_simulation_model(payload)
            elif "files" in payload:
                result = clang_check_project(payload)
            else:
                code = str(payload.get("code", ""))
                filename = str(payload.get("filename", "main.c"))
                result = clang_check(code, filename)
            self.send_json(result)
        except RequestTooLargeError as exc:
            error_payload = {"detail": str(exc)}
            if clang_request:
                error_payload.update({"clang": False, "engine": "Alice C Analyzer", "diagnostics": []})
            elif datasheet_request:
                error_payload["ok"] = False
            self.send_json(error_payload, status=413)
        except ProjectRequestError as exc:
            error_payload = {"detail": str(exc)}
            if clang_request:
                error_payload.update({"clang": False, "engine": "Alice C Analyzer", "diagnostics": []})
            elif datasheet_request:
                error_payload["ok"] = False
            self.send_json(error_payload, status=400)
        except DatasheetError as exc:
            self.send_json({"ok": False, "detail": str(exc)}, status=400)
        except Exception as exc:
            error_payload = {"detail": str(exc)}
            if clang_request:
                error_payload.update({"clang": False, "engine": "Alice C Analyzer", "diagnostics": []})
            elif datasheet_request:
                error_payload["ok"] = False
            self.send_json(error_payload, status=400)

    def send_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string: str, *args):
        print(f"[AliceSIM] {self.address_string()} - {format_string % args}")


class AliceSIMHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False
    allow_reuse_port = False
    daemon_threads = True


def environment_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def environment_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch the AliceSIM local backend")
    parser.add_argument("--host", default=os.environ.get("ALICESIM_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=environment_int("ALICESIM_PORT", 4173))
    parser.add_argument(
        "--port-span",
        type=int,
        default=environment_int("ALICESIM_PORT_SPAN", 20),
        help="number of additional ports to try when the preferred port is occupied",
    )
    browser_group = parser.add_mutually_exclusive_group()
    browser_group.add_argument("--open-browser", dest="open_browser", action="store_true")
    browser_group.add_argument("--no-browser", dest="open_browser", action="store_false")
    parser.set_defaults(open_browser=environment_flag("ALICESIM_OPEN_BROWSER"))
    display_group = parser.add_mutually_exclusive_group()
    display_group.add_argument("--fullscreen-browser", dest="browser_fullscreen", action="store_true")
    display_group.add_argument("--windowed-browser", dest="browser_fullscreen", action="store_false")
    parser.set_defaults(browser_fullscreen=environment_flag("ALICESIM_BROWSER_FULLSCREEN", True))
    arguments = parser.parse_args(argv)
    if not 0 <= arguments.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    if not 0 <= arguments.port_span <= 100:
        parser.error("--port-span must be between 0 and 100")
    return arguments


def create_http_server(host: str, preferred_port: int, port_span: int) -> AliceSIMHTTPServer:
    ports = [0] if preferred_port == 0 else range(preferred_port, min(65535, preferred_port + port_span) + 1)
    last_error: OSError | None = None
    for port in ports:
        try:
            return AliceSIMHTTPServer((host, port), AliceSIMHandler)
        except OSError as exc:
            if exc.errno != errno.EADDRINUSE and getattr(exc, "winerror", None) != 10048:
                raise
            last_error = exc
    ending_port = min(65535, preferred_port + port_span)
    raise OSError(
        f"AliceSIM could not find an available port in {preferred_port}-{ending_port}"
    ) from last_error


def browser_host(host: str) -> str:
    if host in {"0.0.0.0", "::", ""}:
        return "127.0.0.1"
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


def browser_executable() -> Path | None:
    override = os.environ.get("ALICESIM_BROWSER", "").strip()
    candidates: list[Path] = [Path(override)] if override else []
    if sys.platform == "win32":
        program_files = os.environ.get("ProgramFiles", "").strip()
        program_files_x86 = os.environ.get("ProgramFiles(x86)", "").strip()
        local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
        for root, relative_paths in (
            (program_files, ("Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe")),
            (program_files_x86, ("Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe")),
            (local_app_data, ("Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe")),
        ):
            if root:
                candidates.extend(Path(root) / relative_path for relative_path in relative_paths)
        executable_names = ("msedge.exe", "chrome.exe")
    elif sys.platform == "darwin":
        candidates.extend((
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ))
        executable_names = ("google-chrome", "microsoft-edge", "chromium")
    else:
        executable_names = ("microsoft-edge", "google-chrome", "chromium", "chromium-browser")

    seen: set[str] = set()
    for candidate in candidates:
        key = os.path.normcase(str(candidate))
        if key in seen:
            continue
        seen.add(key)
        if candidate.is_file():
            return candidate
    for name in executable_names:
        located = shutil.which(name)
        if located:
            return Path(located)
    return None


def fullscreen_browser_command(url: str, executable: Path) -> list[str]:
    command = [
        str(executable),
        "--kiosk",
        "--disable-pinch",
        "--overscroll-history-navigation=0",
    ]
    if executable.name.lower() == "msedge.exe":
        command.append("--edge-kiosk-type=fullscreen")
    command.append(url)
    return command


def open_alicesim_browser(url: str, fullscreen: bool = True) -> bool:
    if fullscreen:
        executable = browser_executable()
        if executable is not None:
            try:
                subprocess.Popen(
                    fullscreen_browser_command(url, executable),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return True
            except OSError as exc:
                print(f"AliceSIM could not start the fullscreen browser: {exc}", file=sys.stderr)
        else:
            print("AliceSIM could not find Edge or Chrome; opening the default browser in windowed mode.", file=sys.stderr)
    return bool(webbrowser.open(url, new=2))


def open_browser_when_ready(url: str, timeout: float = 10.0, fullscreen: bool = True) -> None:
    health_url = f"{url}/api/health"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(health_url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=0.75) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if payload.get("service") == SERVICE_NAME and payload.get("instance") == INSTANCE_ID:
                open_alicesim_browser(url, fullscreen=fullscreen)
                return
        except (OSError, ValueError, json.JSONDecodeError):
            time.sleep(0.12)
    print("AliceSIM started, but the browser was not opened because the health check timed out.", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    try:
        server = create_http_server(arguments.host, arguments.port, arguments.port_span)
    except OSError as exc:
        print(f"AliceSIM backend failed to start: {exc}", file=sys.stderr)
        return 1

    host, port = server.server_address[:2]
    url = f"http://{browser_host(host)}:{port}"
    clang_label = CLANG_ENGINE if CLANG_AVAILABLE else f"fallback analyzer ({CLANG_ERROR or 'libclang unavailable'})"
    print(f"AliceSIM backend ready at {url} · {clang_label}", flush=True)
    print("Press Ctrl+C or close this window to stop the backend.", flush=True)
    if arguments.open_browser:
        threading.Thread(
            target=open_browser_when_ready,
            args=(url,),
            kwargs={"fullscreen": arguments.browser_fullscreen},
            daemon=True,
        ).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("AliceSIM backend stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
