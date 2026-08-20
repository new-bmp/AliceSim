#ifndef ALICESIM_SSD1306_H
#define ALICESIM_SSD1306_H

#include <stddef.h>
#include <stdint.h>

#ifndef ALICESIM_HAL_HEADER
#define ALICESIM_HAL_HEADER "stm32f1xx_hal.h"
#endif
#include ALICESIM_HAL_HEADER

#ifdef __cplusplus
extern "C" {
#endif

#define ALICESIM_SSD1306_WIDTH             128U
#define ALICESIM_SSD1306_HEIGHT             64U
#define ALICESIM_SSD1306_PAGE_COUNT          8U
#define ALICESIM_SSD1306_BUFFER_SIZE       1024U
#define ALICESIM_SSD1306_DEFAULT_ADDRESS   0x3CU
#define ALICESIM_SSD1306_CONTROL_COMMAND   0x00U
#define ALICESIM_SSD1306_CONTROL_DATA      0x40U

typedef enum {
  ALICESIM_SSD1306_COLOR_BLACK = 0,
  ALICESIM_SSD1306_COLOR_WHITE = 1,
  ALICESIM_SSD1306_COLOR_XOR = 2
} AliceSIM_SSD1306_Color;

typedef struct {
  I2C_HandleTypeDef *i2c;
  uint16_t hal_address;
  uint32_t timeout_ms;
  uint8_t framebuffer[ALICESIM_SSD1306_BUFFER_SIZE];
  uint8_t initialized;
  uint8_t display_on;
  uint8_t dirty;
} AliceSIM_SSD1306;

/**
 * Initialize an SSD1306 on an already configured STM32 HAL I2C handle.
 * address_7bit is normally 0x3C. Passing 0 selects that default.
 */
HAL_StatusTypeDef AliceSIM_SSD1306_Init(
  AliceSIM_SSD1306 *display,
  I2C_HandleTypeDef *i2c,
  uint8_t address_7bit,
  uint32_t timeout_ms
);

HAL_StatusTypeDef AliceSIM_SSD1306_WriteCommand(
  AliceSIM_SSD1306 *display,
  const uint8_t *commands,
  uint16_t length
);

HAL_StatusTypeDef AliceSIM_SSD1306_WriteData(
  AliceSIM_SSD1306 *display,
  const uint8_t *data,
  uint16_t length
);

HAL_StatusTypeDef AliceSIM_SSD1306_Update(AliceSIM_SSD1306 *display);
HAL_StatusTypeDef AliceSIM_SSD1306_SetDisplay(AliceSIM_SSD1306 *display, uint8_t enabled);
HAL_StatusTypeDef AliceSIM_SSD1306_SetInvert(AliceSIM_SSD1306 *display, uint8_t enabled);
HAL_StatusTypeDef AliceSIM_SSD1306_SetContrast(AliceSIM_SSD1306 *display, uint8_t contrast);

void AliceSIM_SSD1306_Fill(AliceSIM_SSD1306 *display, AliceSIM_SSD1306_Color color);
void AliceSIM_SSD1306_Clear(AliceSIM_SSD1306 *display);
void AliceSIM_SSD1306_DrawPixel(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  AliceSIM_SSD1306_Color color
);
uint8_t AliceSIM_SSD1306_GetPixel(const AliceSIM_SSD1306 *display, uint16_t x, uint16_t y);
void AliceSIM_SSD1306_DrawHorizontalLine(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t width,
  AliceSIM_SSD1306_Color color
);
void AliceSIM_SSD1306_DrawVerticalLine(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t height,
  AliceSIM_SSD1306_Color color
);
void AliceSIM_SSD1306_DrawRectangle(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t width,
  uint16_t height,
  AliceSIM_SSD1306_Color color
);
void AliceSIM_SSD1306_DrawBitmap(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t width,
  uint16_t height,
  const uint8_t *row_major_bitmap,
  AliceSIM_SSD1306_Color color
);
void AliceSIM_SSD1306_DrawChar(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  char character,
  uint8_t scale,
  AliceSIM_SSD1306_Color color
);
size_t AliceSIM_SSD1306_DrawString(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  const char *text,
  uint8_t scale,
  AliceSIM_SSD1306_Color color
);

#ifdef __cplusplus
}
#endif

#endif
