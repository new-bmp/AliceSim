#include "alicesim_ssd1306.h"

#ifndef I2C_MEMADD_SIZE_8BIT
#define I2C_MEMADD_SIZE_8BIT 0x00000001U
#endif

static const uint8_t alice_ssd1306_digits[10][5] = {
  {0x3EU, 0x51U, 0x49U, 0x45U, 0x3EU},
  {0x00U, 0x42U, 0x7FU, 0x40U, 0x00U},
  {0x42U, 0x61U, 0x51U, 0x49U, 0x46U},
  {0x21U, 0x41U, 0x45U, 0x4BU, 0x31U},
  {0x18U, 0x14U, 0x12U, 0x7FU, 0x10U},
  {0x27U, 0x45U, 0x45U, 0x45U, 0x39U},
  {0x3CU, 0x4AU, 0x49U, 0x49U, 0x30U},
  {0x01U, 0x71U, 0x09U, 0x05U, 0x03U},
  {0x36U, 0x49U, 0x49U, 0x49U, 0x36U},
  {0x06U, 0x49U, 0x49U, 0x29U, 0x1EU}
};

static const uint8_t alice_ssd1306_letters[26][5] = {
  {0x7EU, 0x11U, 0x11U, 0x11U, 0x7EU},
  {0x7FU, 0x49U, 0x49U, 0x49U, 0x36U},
  {0x3EU, 0x41U, 0x41U, 0x41U, 0x22U},
  {0x7FU, 0x41U, 0x41U, 0x22U, 0x1CU},
  {0x7FU, 0x49U, 0x49U, 0x49U, 0x41U},
  {0x7FU, 0x09U, 0x09U, 0x09U, 0x01U},
  {0x3EU, 0x41U, 0x49U, 0x49U, 0x7AU},
  {0x7FU, 0x08U, 0x08U, 0x08U, 0x7FU},
  {0x00U, 0x41U, 0x7FU, 0x41U, 0x00U},
  {0x20U, 0x40U, 0x41U, 0x3FU, 0x01U},
  {0x7FU, 0x08U, 0x14U, 0x22U, 0x41U},
  {0x7FU, 0x40U, 0x40U, 0x40U, 0x40U},
  {0x7FU, 0x02U, 0x0CU, 0x02U, 0x7FU},
  {0x7FU, 0x04U, 0x08U, 0x10U, 0x7FU},
  {0x3EU, 0x41U, 0x41U, 0x41U, 0x3EU},
  {0x7FU, 0x09U, 0x09U, 0x09U, 0x06U},
  {0x3EU, 0x41U, 0x51U, 0x21U, 0x5EU},
  {0x7FU, 0x09U, 0x19U, 0x29U, 0x46U},
  {0x46U, 0x49U, 0x49U, 0x49U, 0x31U},
  {0x01U, 0x01U, 0x7FU, 0x01U, 0x01U},
  {0x3FU, 0x40U, 0x40U, 0x40U, 0x3FU},
  {0x1FU, 0x20U, 0x40U, 0x20U, 0x1FU},
  {0x3FU, 0x40U, 0x38U, 0x40U, 0x3FU},
  {0x63U, 0x14U, 0x08U, 0x14U, 0x63U},
  {0x07U, 0x08U, 0x70U, 0x08U, 0x07U},
  {0x61U, 0x51U, 0x49U, 0x45U, 0x43U}
};

static const uint8_t alice_ssd1306_question[5] = {0x02U, 0x01U, 0x51U, 0x09U, 0x06U};
static const uint8_t alice_ssd1306_dash[5] = {0x08U, 0x08U, 0x08U, 0x08U, 0x08U};
static const uint8_t alice_ssd1306_dot[5] = {0x00U, 0x60U, 0x60U, 0x00U, 0x00U};
static const uint8_t alice_ssd1306_colon[5] = {0x00U, 0x36U, 0x36U, 0x00U, 0x00U};
static const uint8_t alice_ssd1306_slash[5] = {0x20U, 0x10U, 0x08U, 0x04U, 0x02U};
static const uint8_t alice_ssd1306_space[5] = {0x00U, 0x00U, 0x00U, 0x00U, 0x00U};

static const uint8_t *alice_ssd1306_glyph(char character) {
  unsigned char code = (unsigned char)character;
  if (code >= (unsigned char)'a' && code <= (unsigned char)'z') {
    code = (unsigned char)(code - (unsigned char)'a' + (unsigned char)'A');
  }
  if (code >= (unsigned char)'0' && code <= (unsigned char)'9') {
    return alice_ssd1306_digits[code - (unsigned char)'0'];
  }
  if (code >= (unsigned char)'A' && code <= (unsigned char)'Z') {
    return alice_ssd1306_letters[code - (unsigned char)'A'];
  }
  if (code == (unsigned char)' ') return alice_ssd1306_space;
  if (code == (unsigned char)'-') return alice_ssd1306_dash;
  if (code == (unsigned char)'.') return alice_ssd1306_dot;
  if (code == (unsigned char)':') return alice_ssd1306_colon;
  if (code == (unsigned char)'/') return alice_ssd1306_slash;
  return alice_ssd1306_question;
}

static HAL_StatusTypeDef alice_ssd1306_write(
  AliceSIM_SSD1306 *display,
  uint8_t control,
  const uint8_t *bytes,
  uint16_t length
) {
  if (display == NULL || display->i2c == NULL || (bytes == NULL && length != 0U)) return HAL_ERROR;
  if (length == 0U) return HAL_OK;
  return HAL_I2C_Mem_Write(
    display->i2c,
    display->hal_address,
    control,
    I2C_MEMADD_SIZE_8BIT,
    (uint8_t *)bytes,
    length,
    display->timeout_ms
  );
}

HAL_StatusTypeDef AliceSIM_SSD1306_WriteCommand(
  AliceSIM_SSD1306 *display,
  const uint8_t *commands,
  uint16_t length
) {
  return alice_ssd1306_write(display, ALICESIM_SSD1306_CONTROL_COMMAND, commands, length);
}

HAL_StatusTypeDef AliceSIM_SSD1306_WriteData(
  AliceSIM_SSD1306 *display,
  const uint8_t *data,
  uint16_t length
) {
  return alice_ssd1306_write(display, ALICESIM_SSD1306_CONTROL_DATA, data, length);
}

HAL_StatusTypeDef AliceSIM_SSD1306_Init(
  AliceSIM_SSD1306 *display,
  I2C_HandleTypeDef *i2c,
  uint8_t address_7bit,
  uint32_t timeout_ms
) {
  static const uint8_t init_commands[] = {
    0xAEU, 0xD5U, 0x80U, 0xA8U, 0x3FU, 0xD3U, 0x00U, 0x40U,
    0x8DU, 0x14U, 0x20U, 0x00U, 0xA1U, 0xC8U, 0xDAU, 0x12U,
    0x81U, 0xCFU, 0xD9U, 0xF1U, 0xDBU, 0x40U, 0xA4U, 0xA6U, 0xAFU
  };
  HAL_StatusTypeDef status;

  if (display == NULL || i2c == NULL) return HAL_ERROR;
  if (address_7bit == 0U) address_7bit = ALICESIM_SSD1306_DEFAULT_ADDRESS;
  if (address_7bit < 0x03U || address_7bit > 0x77U) return HAL_ERROR;

  display->i2c = i2c;
  display->hal_address = (uint16_t)((uint16_t)address_7bit << 1U);
  display->timeout_ms = timeout_ms == 0U ? HAL_MAX_DELAY : timeout_ms;
  display->initialized = 0U;
  display->display_on = 0U;
  display->dirty = 0U;
  AliceSIM_SSD1306_Clear(display);

  status = AliceSIM_SSD1306_WriteCommand(display, init_commands, (uint16_t)sizeof(init_commands));
  if (status != HAL_OK) return status;
  display->initialized = 1U;
  display->display_on = 1U;
  return AliceSIM_SSD1306_Update(display);
}

HAL_StatusTypeDef AliceSIM_SSD1306_Update(AliceSIM_SSD1306 *display) {
  static const uint8_t window_commands[] = {0x21U, 0x00U, 0x7FU, 0x22U, 0x00U, 0x07U};
  HAL_StatusTypeDef status;
  if (display == NULL || display->i2c == NULL) return HAL_ERROR;
  status = AliceSIM_SSD1306_WriteCommand(display, window_commands, (uint16_t)sizeof(window_commands));
  if (status != HAL_OK) return status;
  status = AliceSIM_SSD1306_WriteData(display, display->framebuffer, ALICESIM_SSD1306_BUFFER_SIZE);
  if (status == HAL_OK) display->dirty = 0U;
  return status;
}

HAL_StatusTypeDef AliceSIM_SSD1306_SetDisplay(AliceSIM_SSD1306 *display, uint8_t enabled) {
  uint8_t command = enabled != 0U ? 0xAFU : 0xAEU;
  HAL_StatusTypeDef status = AliceSIM_SSD1306_WriteCommand(display, &command, 1U);
  if (status == HAL_OK && display != NULL) display->display_on = enabled != 0U ? 1U : 0U;
  return status;
}

HAL_StatusTypeDef AliceSIM_SSD1306_SetInvert(AliceSIM_SSD1306 *display, uint8_t enabled) {
  uint8_t command = enabled != 0U ? 0xA7U : 0xA6U;
  return AliceSIM_SSD1306_WriteCommand(display, &command, 1U);
}

HAL_StatusTypeDef AliceSIM_SSD1306_SetContrast(AliceSIM_SSD1306 *display, uint8_t contrast) {
  uint8_t commands[2] = {0x81U, contrast};
  return AliceSIM_SSD1306_WriteCommand(display, commands, 2U);
}

void AliceSIM_SSD1306_Fill(AliceSIM_SSD1306 *display, AliceSIM_SSD1306_Color color) {
  uint16_t index;
  uint8_t value;
  if (display == NULL) return;
  value = color == ALICESIM_SSD1306_COLOR_WHITE ? 0xFFU : 0x00U;
  for (index = 0U; index < ALICESIM_SSD1306_BUFFER_SIZE; index += 1U) {
    if (color == ALICESIM_SSD1306_COLOR_XOR) display->framebuffer[index] ^= 0xFFU;
    else display->framebuffer[index] = value;
  }
  display->dirty = 1U;
}

void AliceSIM_SSD1306_Clear(AliceSIM_SSD1306 *display) {
  AliceSIM_SSD1306_Fill(display, ALICESIM_SSD1306_COLOR_BLACK);
}

void AliceSIM_SSD1306_DrawPixel(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  AliceSIM_SSD1306_Color color
) {
  uint16_t index;
  uint8_t mask;
  if (display == NULL || x >= ALICESIM_SSD1306_WIDTH || y >= ALICESIM_SSD1306_HEIGHT) return;
  index = (uint16_t)(x + (uint16_t)((y >> 3U) * ALICESIM_SSD1306_WIDTH));
  mask = (uint8_t)(1U << (y & 7U));
  if (color == ALICESIM_SSD1306_COLOR_WHITE) display->framebuffer[index] |= mask;
  else if (color == ALICESIM_SSD1306_COLOR_XOR) display->framebuffer[index] ^= mask;
  else display->framebuffer[index] &= (uint8_t)~mask;
  display->dirty = 1U;
}

uint8_t AliceSIM_SSD1306_GetPixel(const AliceSIM_SSD1306 *display, uint16_t x, uint16_t y) {
  uint16_t index;
  uint8_t mask;
  if (display == NULL || x >= ALICESIM_SSD1306_WIDTH || y >= ALICESIM_SSD1306_HEIGHT) return 0U;
  index = (uint16_t)(x + (uint16_t)((y >> 3U) * ALICESIM_SSD1306_WIDTH));
  mask = (uint8_t)(1U << (y & 7U));
  return (display->framebuffer[index] & mask) != 0U ? 1U : 0U;
}

void AliceSIM_SSD1306_DrawHorizontalLine(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t width,
  AliceSIM_SSD1306_Color color
) {
  uint16_t offset;
  for (offset = 0U; offset < width && (uint32_t)x + offset < ALICESIM_SSD1306_WIDTH; offset += 1U) {
    AliceSIM_SSD1306_DrawPixel(display, (uint16_t)(x + offset), y, color);
  }
}

void AliceSIM_SSD1306_DrawVerticalLine(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t height,
  AliceSIM_SSD1306_Color color
) {
  uint16_t offset;
  for (offset = 0U; offset < height && (uint32_t)y + offset < ALICESIM_SSD1306_HEIGHT; offset += 1U) {
    AliceSIM_SSD1306_DrawPixel(display, x, (uint16_t)(y + offset), color);
  }
}

void AliceSIM_SSD1306_DrawRectangle(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t width,
  uint16_t height,
  AliceSIM_SSD1306_Color color
) {
  if (display == NULL || x >= ALICESIM_SSD1306_WIDTH || y >= ALICESIM_SSD1306_HEIGHT || width == 0U || height == 0U) return;
  if (width > ALICESIM_SSD1306_WIDTH - x) width = (uint16_t)(ALICESIM_SSD1306_WIDTH - x);
  if (height > ALICESIM_SSD1306_HEIGHT - y) height = (uint16_t)(ALICESIM_SSD1306_HEIGHT - y);
  AliceSIM_SSD1306_DrawHorizontalLine(display, x, y, width, color);
  AliceSIM_SSD1306_DrawHorizontalLine(display, x, (uint16_t)(y + height - 1U), width, color);
  AliceSIM_SSD1306_DrawVerticalLine(display, x, y, height, color);
  AliceSIM_SSD1306_DrawVerticalLine(display, (uint16_t)(x + width - 1U), y, height, color);
}

void AliceSIM_SSD1306_DrawBitmap(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  uint16_t width,
  uint16_t height,
  const uint8_t *row_major_bitmap,
  AliceSIM_SSD1306_Color color
) {
  uint16_t row;
  uint16_t column;
  uint16_t bytes_per_row;
  uint16_t draw_width;
  uint16_t draw_height;
  if (display == NULL || row_major_bitmap == NULL || x >= ALICESIM_SSD1306_WIDTH || y >= ALICESIM_SSD1306_HEIGHT) return;
  bytes_per_row = (uint16_t)((width + 7U) / 8U);
  draw_width = width > ALICESIM_SSD1306_WIDTH - x ? (uint16_t)(ALICESIM_SSD1306_WIDTH - x) : width;
  draw_height = height > ALICESIM_SSD1306_HEIGHT - y ? (uint16_t)(ALICESIM_SSD1306_HEIGHT - y) : height;
  for (row = 0U; row < draw_height; row += 1U) {
    for (column = 0U; column < draw_width; column += 1U) {
      uint8_t value = row_major_bitmap[(uint32_t)row * bytes_per_row + (column >> 3U)];
      if ((value & (uint8_t)(0x80U >> (column & 7U))) != 0U) {
        AliceSIM_SSD1306_DrawPixel(display, (uint16_t)(x + column), (uint16_t)(y + row), color);
      }
    }
  }
}

void AliceSIM_SSD1306_DrawChar(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  char character,
  uint8_t scale,
  AliceSIM_SSD1306_Color color
) {
  const uint8_t *glyph;
  uint8_t column;
  uint8_t row;
  uint8_t sx;
  uint8_t sy;
  if (display == NULL || x >= ALICESIM_SSD1306_WIDTH || y >= ALICESIM_SSD1306_HEIGHT) return;
  if (scale == 0U) scale = 1U;
  glyph = alice_ssd1306_glyph(character);
  for (column = 0U; column < 5U; column += 1U) {
    for (row = 0U; row < 7U; row += 1U) {
      if ((glyph[column] & (uint8_t)(1U << row)) == 0U) continue;
      for (sx = 0U; sx < scale; sx += 1U) {
        for (sy = 0U; sy < scale; sy += 1U) {
          AliceSIM_SSD1306_DrawPixel(
            display,
            (uint16_t)(x + (uint16_t)(column * scale) + sx),
            (uint16_t)(y + (uint16_t)(row * scale) + sy),
            color
          );
        }
      }
    }
  }
}

size_t AliceSIM_SSD1306_DrawString(
  AliceSIM_SSD1306 *display,
  uint16_t x,
  uint16_t y,
  const char *text,
  uint8_t scale,
  AliceSIM_SSD1306_Color color
) {
  size_t count = 0U;
  uint16_t cursor = x;
  uint16_t advance;
  if (display == NULL || text == NULL) return 0U;
  if (scale == 0U) scale = 1U;
  advance = (uint16_t)(6U * scale);
  while (text[count] != '\0') {
    if ((uint32_t)cursor + (uint32_t)(5U * scale) > ALICESIM_SSD1306_WIDTH) break;
    AliceSIM_SSD1306_DrawChar(display, cursor, y, text[count], scale, color);
    cursor = (uint16_t)(cursor + advance);
    count += 1U;
  }
  return count;
}
