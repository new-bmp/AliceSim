#ifndef ALICESIM_ST7789_H
#define ALICESIM_ST7789_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>
#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#define ALICESIM_ST7789_WIDTH 240U
#define ALICESIM_ST7789_HEIGHT 240U
#define ALICESIM_ST7789_COLOR_BLACK 0x0000U
#define ALICESIM_ST7789_COLOR_WHITE 0xFFFFU
#define ALICESIM_ST7789_COLOR_RED 0xF800U
#define ALICESIM_ST7789_COLOR_GREEN 0x07E0U
#define ALICESIM_ST7789_COLOR_BLUE 0x001FU
#define ALICESIM_ST7789_COLOR_CYAN 0x07FFU
#define ALICESIM_ST7789_COLOR_YELLOW 0xFFE0U
#define ALICESIM_ST7789_COLOR_MAGENTA 0xF81FU

/* AliceSIM original driver. RGB565, no full-screen RAM framebuffer. */
typedef struct {
  SPI_HandleTypeDef *spi;
  GPIO_TypeDef *cs_port;
  GPIO_TypeDef *dc_port;
  GPIO_TypeDef *rst_port;
  uint16_t cs_pin;
  uint16_t dc_pin;
  uint16_t rst_pin;
  uint32_t timeout_ms;
  uint8_t initialized;
} AliceSIM_ST7789;

HAL_StatusTypeDef AliceSIM_ST7789_Init(AliceSIM_ST7789 *display, SPI_HandleTypeDef *spi,
  GPIO_TypeDef *cs_port, uint16_t cs_pin, GPIO_TypeDef *dc_port, uint16_t dc_pin,
  GPIO_TypeDef *rst_port, uint16_t rst_pin, uint32_t timeout_ms);
HAL_StatusTypeDef AliceSIM_ST7789_Fill(AliceSIM_ST7789 *display, uint16_t color);
/* Rectangles are clipped to 240x240; a fully clipped or empty rectangle is a no-op. */
HAL_StatusTypeDef AliceSIM_ST7789_FillRect(AliceSIM_ST7789 *display, int16_t x, int16_t y,
  uint16_t width, uint16_t height, uint16_t color);
HAL_StatusTypeDef AliceSIM_ST7789_DrawPixel(AliceSIM_ST7789 *display, int16_t x, int16_t y, uint16_t color);
/* 5x7 glyphs in 6x8 cells. Scale 1..8, opaque background, newline supported. */
HAL_StatusTypeDef AliceSIM_ST7789_DrawString(AliceSIM_ST7789 *display, int16_t x, int16_t y,
  const char *text, uint8_t scale, uint16_t foreground, uint16_t background);
HAL_StatusTypeDef AliceSIM_ST7789_SetDisplay(AliceSIM_ST7789 *display, uint8_t enabled);

#ifdef __cplusplus
}
#endif
#endif
