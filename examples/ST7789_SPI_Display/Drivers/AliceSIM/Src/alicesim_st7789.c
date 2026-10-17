#include "alicesim_st7789.h"

/* Compact 5x7 font: digits followed by uppercase letters. */
static const uint8_t alice_st7789_font[] = {
  0x3E,0x51,0x49,0x45,0x3E, 0x00,0x42,0x7F,0x40,0x00,
  0x42,0x61,0x51,0x49,0x46, 0x21,0x41,0x45,0x4B,0x31,
  0x18,0x14,0x12,0x7F,0x10, 0x27,0x45,0x45,0x45,0x39,
  0x3C,0x4A,0x49,0x49,0x30, 0x01,0x71,0x09,0x05,0x03,
  0x36,0x49,0x49,0x49,0x36, 0x06,0x49,0x49,0x29,0x1E,
  0x7E,0x11,0x11,0x11,0x7E, 0x7F,0x49,0x49,0x49,0x36,
  0x3E,0x41,0x41,0x41,0x22, 0x7F,0x41,0x41,0x22,0x1C,
  0x7F,0x49,0x49,0x49,0x41, 0x7F,0x09,0x09,0x09,0x01,
  0x3E,0x41,0x49,0x49,0x7A, 0x7F,0x08,0x08,0x08,0x7F,
  0x00,0x41,0x7F,0x41,0x00, 0x20,0x40,0x41,0x3F,0x01,
  0x7F,0x08,0x14,0x22,0x41, 0x7F,0x40,0x40,0x40,0x40,
  0x7F,0x02,0x0C,0x02,0x7F, 0x7F,0x04,0x08,0x10,0x7F,
  0x3E,0x41,0x41,0x41,0x3E, 0x7F,0x09,0x09,0x09,0x06,
  0x3E,0x41,0x51,0x21,0x5E, 0x7F,0x09,0x19,0x29,0x46,
  0x46,0x49,0x49,0x49,0x31, 0x01,0x01,0x7F,0x01,0x01,
  0x3F,0x40,0x40,0x40,0x3F, 0x1F,0x20,0x40,0x20,0x1F,
  0x3F,0x40,0x38,0x40,0x3F, 0x63,0x14,0x08,0x14,0x63,
  0x07,0x08,0x70,0x08,0x07, 0x61,0x51,0x49,0x45,0x43
};

static uint8_t alice_st7789_glyph(uint8_t code, uint8_t column) {
  if (column >= 5U) return 0U;
  if (code >= 'a' && code <= 'z') code = (uint8_t)(code - 'a' + 'A');
  if (code >= '0' && code <= '9') return alice_st7789_font[(code - '0') * 5U + column];
  if (code >= 'A' && code <= 'Z') return alice_st7789_font[(code - 'A' + 10U) * 5U + column];
  if (code == ' ') return 0U;
  if (code == '.') return column == 1U || column == 2U ? 0x60U : 0U;
  if (code == ':') return column == 1U || column == 2U ? 0x36U : 0U;
  if (code == '-') return 0x08U;
  if (code == '_') return 0x40U;
  if (code == '+') return column == 2U ? 0x3EU : 0x08U;
  if (code == '/') return (uint8_t)(0x20U >> column);
  if (code == '%') return column == 0U ? 0x63U : column == 4U ? 0x63U : (uint8_t)(0x10U >> (column - 1U));
  if (code == '=') return 0x14U;
  if (code == '!') return column == 2U ? 0x5FU : 0U;
  return column == 0U ? 0x02U : column == 1U ? 0x01U : column == 2U ? 0x51U : column == 3U ? 0x09U : 0x06U;
}

static uint8_t alice_st7789_valid(AliceSIM_ST7789 *display) {
  return display != NULL && display->spi != NULL && display->cs_port != NULL &&
    display->dc_port != NULL && display->rst_port != NULL;
}

static HAL_StatusTypeDef alice_st7789_write(AliceSIM_ST7789 *display, uint8_t data_mode,
  const uint8_t *bytes, uint16_t length) {
  HAL_StatusTypeDef status;
  if (!alice_st7789_valid(display) || (bytes == NULL && length != 0U)) return HAL_ERROR;
  if (length == 0U) return HAL_OK;
  HAL_GPIO_WritePin(display->cs_port, display->cs_pin, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(display->dc_port, display->dc_pin, data_mode != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET);
  status = HAL_SPI_Transmit(display->spi, (uint8_t *)bytes, length, display->timeout_ms);
  HAL_GPIO_WritePin(display->cs_port, display->cs_pin, GPIO_PIN_SET);
  return status;
}

static HAL_StatusTypeDef alice_st7789_command(AliceSIM_ST7789 *display, uint8_t command,
  const uint8_t *parameters, uint16_t length) {
  HAL_StatusTypeDef status = alice_st7789_write(display, 0U, &command, 1U);
  if (status == HAL_OK && length != 0U) status = alice_st7789_write(display, 1U, parameters, length);
  return status;
}

static HAL_StatusTypeDef alice_st7789_window(AliceSIM_ST7789 *display,
  uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1) {
  uint8_t data[4];
  HAL_StatusTypeDef status;
  data[0] = (uint8_t)(x0 >> 8U); data[1] = (uint8_t)x0;
  data[2] = (uint8_t)(x1 >> 8U); data[3] = (uint8_t)x1;
  status = alice_st7789_command(display, 0x2AU, data, 4U);
  if (status != HAL_OK) return status;
  data[0] = (uint8_t)(y0 >> 8U); data[1] = (uint8_t)y0;
  data[2] = (uint8_t)(y1 >> 8U); data[3] = (uint8_t)y1;
  status = alice_st7789_command(display, 0x2BU, data, 4U);
  if (status != HAL_OK) return status;
  return alice_st7789_command(display, 0x2CU, NULL, 0U);
}

HAL_StatusTypeDef AliceSIM_ST7789_Init(AliceSIM_ST7789 *display, SPI_HandleTypeDef *spi,
  GPIO_TypeDef *cs_port, uint16_t cs_pin, GPIO_TypeDef *dc_port, uint16_t dc_pin,
  GPIO_TypeDef *rst_port, uint16_t rst_pin, uint32_t timeout_ms) {
  HAL_StatusTypeDef status;
  uint8_t parameter;
  if (display == NULL) return HAL_ERROR;
  display->initialized = 0U;
  if (spi == NULL || cs_port == NULL || dc_port == NULL || rst_port == NULL ||
    cs_pin == 0U || dc_pin == 0U || rst_pin == 0U) return HAL_ERROR;
  display->spi = spi; display->cs_port = cs_port; display->cs_pin = cs_pin;
  display->dc_port = dc_port; display->dc_pin = dc_pin;
  display->rst_port = rst_port; display->rst_pin = rst_pin;
  display->timeout_ms = timeout_ms == 0U ? 100U : timeout_ms;
  HAL_GPIO_WritePin(display->cs_port, display->cs_pin, GPIO_PIN_SET);
  HAL_GPIO_WritePin(display->dc_port, display->dc_pin, GPIO_PIN_SET);
  HAL_GPIO_WritePin(display->rst_port, display->rst_pin, GPIO_PIN_RESET);
  HAL_Delay(20U);
  HAL_GPIO_WritePin(display->rst_port, display->rst_pin, GPIO_PIN_SET);
  HAL_Delay(120U);
  status = alice_st7789_command(display, 0x01U, NULL, 0U);
  if (status != HAL_OK) return status;
  HAL_Delay(150U);
  status = alice_st7789_command(display, 0x11U, NULL, 0U);
  if (status != HAL_OK) return status;
  HAL_Delay(120U);
  parameter = 0x55U;
  status = alice_st7789_command(display, 0x3AU, &parameter, 1U);
  if (status != HAL_OK) return status;
  parameter = 0x00U;
  status = alice_st7789_command(display, 0x36U, &parameter, 1U);
  if (status != HAL_OK) return status;
  status = alice_st7789_command(display, 0x20U, NULL, 0U);
  if (status != HAL_OK) return status;
  status = alice_st7789_command(display, 0x13U, NULL, 0U);
  if (status != HAL_OK) return status;
  status = alice_st7789_command(display, 0x29U, NULL, 0U);
  if (status == HAL_OK) display->initialized = 1U;
  return status;
}

HAL_StatusTypeDef AliceSIM_ST7789_FillRect(AliceSIM_ST7789 *display, int16_t x, int16_t y,
  uint16_t width, uint16_t height, uint16_t color) {
  int32_t x0 = x, y0 = y, x1 = (int32_t)x + width, y1 = (int32_t)y + height;
  uint32_t remaining;
  uint16_t index, count;
  uint8_t chunks = 0U;
  uint8_t data[128];
  HAL_StatusTypeDef status;
  if (!alice_st7789_valid(display) || display->initialized == 0U) return HAL_ERROR;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > 240) x1 = 240;
  if (y1 > 240) y1 = 240;
  if (width == 0U || height == 0U || x0 >= x1 || y0 >= y1) return HAL_OK;
  status = alice_st7789_window(display, (uint16_t)x0, (uint16_t)y0, (uint16_t)(x1 - 1), (uint16_t)(y1 - 1));
  if (status != HAL_OK) return status;
  for (index = 0U; index < 128U; index += 2U) {
    data[index] = (uint8_t)(color >> 8U); data[index + 1U] = (uint8_t)color;
  }
  remaining = (uint32_t)(x1 - x0) * (uint32_t)(y1 - y0);
  while (remaining != 0U) {
    count = remaining > 64U ? 64U : (uint16_t)remaining;
    status = alice_st7789_write(display, 1U, data, (uint16_t)(count * 2U));
    if (status != HAL_OK) return status;
    remaining -= count;
    /* Bound CPU-only work for cooperative main loops and semantic simulation. */
    chunks += 1U;
    if (remaining != 0U && chunks == 64U) { HAL_Delay(1U); chunks = 0U; }
  }
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_ST7789_Fill(AliceSIM_ST7789 *display, uint16_t color) {
  return AliceSIM_ST7789_FillRect(display, 0, 0, 240U, 240U, color);
}

HAL_StatusTypeDef AliceSIM_ST7789_DrawPixel(AliceSIM_ST7789 *display, int16_t x, int16_t y, uint16_t color) {
  return AliceSIM_ST7789_FillRect(display, x, y, 1U, 1U, color);
}

static HAL_StatusTypeDef alice_st7789_character(AliceSIM_ST7789 *display, int32_t x, int32_t y,
  uint8_t character, uint8_t scale, uint16_t foreground, uint16_t background) {
  int32_t left = x < 0 ? 0 : x, top = y < 0 ? 0 : y;
  int32_t right = x + 6 * scale, bottom = y + 8 * scale;
  int32_t row, column;
  uint16_t count, color;
  uint8_t bits;
  uint8_t glyph[6];
  uint8_t data[96];
  HAL_StatusTypeDef status;
  if (right > 240) right = 240;
  if (bottom > 240) bottom = 240;
  if (left >= right || top >= bottom) return HAL_OK;
  for (column = 0; column < 6; column += 1) glyph[column] = alice_st7789_glyph(character, (uint8_t)column);
  status = alice_st7789_window(display, (uint16_t)left, (uint16_t)top, (uint16_t)(right - 1), (uint16_t)(bottom - 1));
  if (status != HAL_OK) return status;
  for (row = top; row < bottom; row += 1) {
    count = 0U;
    for (column = left; column < right; column += 1) {
      bits = glyph[(column - x) / scale];
      color = ((bits >> ((row - y) / scale)) & 1U) != 0U ? foreground : background;
      data[count] = (uint8_t)(color >> 8U); data[count + 1U] = (uint8_t)color;
      count += 2U;
    }
    status = alice_st7789_write(display, 1U, data, count);
    if (status != HAL_OK) return status;
    if ((row - top + 1) % 8 == 0 && row + 1 < bottom) HAL_Delay(1U);
  }
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_ST7789_DrawString(AliceSIM_ST7789 *display, int16_t x, int16_t y,
  const char *text, uint8_t scale, uint16_t foreground, uint16_t background) {
  int32_t cursor_x = x, cursor_y = y;
  HAL_StatusTypeDef status;
  if (!alice_st7789_valid(display) || display->initialized == 0U || text == NULL || scale == 0U || scale > 8U) return HAL_ERROR;
  while (*text != '\0') {
    if (*text == '\n') { cursor_x = x; cursor_y += 8 * scale; }
    else if (*text != '\r') {
      status = alice_st7789_character(display, cursor_x, cursor_y, (uint8_t)*text, scale, foreground, background);
      if (status != HAL_OK) return status;
      cursor_x += 6 * scale;
      HAL_Delay(1U);
    }
    if (cursor_y >= 240) break;
    text += 1;
  }
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_ST7789_SetDisplay(AliceSIM_ST7789 *display, uint8_t enabled) {
  if (!alice_st7789_valid(display) || display->initialized == 0U) return HAL_ERROR;
  return alice_st7789_command(display, enabled != 0U ? 0x29U : 0x28U, NULL, 0U);
}
