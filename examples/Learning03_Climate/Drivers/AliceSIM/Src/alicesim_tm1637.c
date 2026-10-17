#include "alicesim_tm1637.h"

#define ALICESIM_TM1637_COMMAND_DATA_AUTO 0x40U
#define ALICESIM_TM1637_COMMAND_ADDRESS   0xC0U
#define ALICESIM_TM1637_COMMAND_DISPLAY   0x80U
#define ALICESIM_TM1637_DISPLAY_ON        0x08U
#define ALICESIM_TM1637_FALLBACK_LOOPS_PER_US 8U

static const uint8_t alice_tm1637_digit_segments[10] = {
  0x3FU, 0x06U, 0x5BU, 0x4FU, 0x66U,
  0x6DU, 0x7DU, 0x07U, 0x7FU, 0x6FU
};

static void alice_tm1637_delay(const AliceSIM_TM1637 *display) {
  uint32_t delay_us;
  volatile uint32_t index;
  volatile uint32_t sink = 0U;
  if (display == NULL) return;
  delay_us = display->bit_delay_us == 0U ? ALICESIM_TM1637_DEFAULT_BIT_DELAY_US : display->bit_delay_us;
  if (display->delay_us != NULL) {
    display->delay_us(delay_us);
    return;
  }
  for (index = 0U; index < delay_us * ALICESIM_TM1637_FALLBACK_LOOPS_PER_US; index += 1U) sink += index;
  (void)sink;
}

static void alice_tm1637_clk(const AliceSIM_TM1637 *display, GPIO_PinState state) {
  HAL_GPIO_WritePin(display->clk_port, display->clk_pin, state);
}

static void alice_tm1637_dio(const AliceSIM_TM1637 *display, GPIO_PinState state) {
  HAL_GPIO_WritePin(display->dio_port, display->dio_pin, state);
}

static void alice_tm1637_start(const AliceSIM_TM1637 *display) {
  alice_tm1637_clk(display, GPIO_PIN_SET);
  alice_tm1637_dio(display, GPIO_PIN_SET);
  alice_tm1637_delay(display);
  alice_tm1637_dio(display, GPIO_PIN_RESET);
  alice_tm1637_delay(display);
  alice_tm1637_clk(display, GPIO_PIN_RESET);
  alice_tm1637_delay(display);
}

static void alice_tm1637_stop(const AliceSIM_TM1637 *display) {
  alice_tm1637_clk(display, GPIO_PIN_RESET);
  alice_tm1637_dio(display, GPIO_PIN_RESET);
  alice_tm1637_delay(display);
  alice_tm1637_clk(display, GPIO_PIN_SET);
  alice_tm1637_delay(display);
  alice_tm1637_dio(display, GPIO_PIN_SET);
  alice_tm1637_delay(display);
}

static uint8_t alice_tm1637_write_byte(const AliceSIM_TM1637 *display, uint8_t value) {
  uint8_t bit;
  GPIO_PinState acknowledge;
  for (bit = 0U; bit < 8U; bit += 1U) {
    alice_tm1637_clk(display, GPIO_PIN_RESET);
    alice_tm1637_dio(display, (value & 0x01U) != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET);
    alice_tm1637_delay(display);
    alice_tm1637_clk(display, GPIO_PIN_SET);
    alice_tm1637_delay(display);
    value >>= 1U;
  }
  alice_tm1637_clk(display, GPIO_PIN_RESET);
  alice_tm1637_dio(display, GPIO_PIN_SET);
  alice_tm1637_delay(display);
  alice_tm1637_clk(display, GPIO_PIN_SET);
  alice_tm1637_delay(display);
  acknowledge = HAL_GPIO_ReadPin(display->dio_port, display->dio_pin);
  alice_tm1637_clk(display, GPIO_PIN_RESET);
  alice_tm1637_delay(display);
  return acknowledge == GPIO_PIN_RESET ? 1U : 0U;
}

static HAL_StatusTypeDef alice_tm1637_write_command(
  const AliceSIM_TM1637 *display,
  uint8_t command
) {
  uint8_t acknowledged;
  alice_tm1637_start(display);
  acknowledged = alice_tm1637_write_byte(display, command);
  alice_tm1637_stop(display);
  return acknowledged != 0U ? HAL_OK : HAL_ERROR;
}

uint8_t AliceSIM_TM1637_EncodeDigit(uint8_t digit) {
  return digit < 10U ? alice_tm1637_digit_segments[digit] : 0U;
}

void AliceSIM_TM1637_SetBitDelay(
  AliceSIM_TM1637 *display,
  uint16_t bit_delay_us
) {
  if (display == NULL) return;
  display->bit_delay_us = bit_delay_us == 0U ? ALICESIM_TM1637_DEFAULT_BIT_DELAY_US : bit_delay_us;
}

HAL_StatusTypeDef AliceSIM_TM1637_WriteSegments(
  AliceSIM_TM1637 *display,
  uint8_t start_position,
  const uint8_t *segments,
  uint8_t count
) {
  uint8_t index;
  uint8_t acknowledged = 1U;
  HAL_StatusTypeDef status;
  if (display == NULL || display->clk_port == NULL || display->dio_port == NULL || segments == NULL || count == 0U) return HAL_ERROR;
  if (start_position >= ALICESIM_TM1637_DIGIT_COUNT || count > ALICESIM_TM1637_DIGIT_COUNT - start_position) return HAL_ERROR;

  status = alice_tm1637_write_command(display, ALICESIM_TM1637_COMMAND_DATA_AUTO);
  if (status != HAL_OK) return status;
  alice_tm1637_start(display);
  if (alice_tm1637_write_byte(display, (uint8_t)(ALICESIM_TM1637_COMMAND_ADDRESS + start_position)) == 0U) acknowledged = 0U;
  for (index = 0U; index < count; index += 1U) {
    if (alice_tm1637_write_byte(display, segments[index]) == 0U) acknowledged = 0U;
  }
  alice_tm1637_stop(display);
  if (acknowledged == 0U) return HAL_ERROR;
  for (index = 0U; index < count; index += 1U) display->segments[start_position + index] = segments[index];
  return HAL_OK;
}

HAL_StatusTypeDef AliceSIM_TM1637_SetBrightness(
  AliceSIM_TM1637 *display,
  uint8_t brightness,
  uint8_t enabled
) {
  HAL_StatusTypeDef status;
  uint8_t command;
  if (display == NULL || display->clk_port == NULL || display->dio_port == NULL) return HAL_ERROR;
  if (brightness > 7U) brightness = 7U;
  command = (uint8_t)(ALICESIM_TM1637_COMMAND_DISPLAY | brightness);
  if (enabled != 0U) command |= ALICESIM_TM1637_DISPLAY_ON;
  status = alice_tm1637_write_command(display, command);
  if (status == HAL_OK) {
    display->brightness = brightness;
    display->enabled = enabled != 0U ? 1U : 0U;
  }
  return status;
}

HAL_StatusTypeDef AliceSIM_TM1637_DisplayRaw(
  AliceSIM_TM1637 *display,
  const uint8_t segments[ALICESIM_TM1637_DIGIT_COUNT],
  uint8_t colon
) {
  uint8_t buffer[ALICESIM_TM1637_DIGIT_COUNT];
  uint8_t index;
  if (display == NULL || segments == NULL) return HAL_ERROR;
  for (index = 0U; index < ALICESIM_TM1637_DIGIT_COUNT; index += 1U) buffer[index] = segments[index];
  buffer[1] &= (uint8_t)~ALICESIM_TM1637_SEGMENT_COLON;
  if (colon != 0U) buffer[1] |= ALICESIM_TM1637_SEGMENT_COLON;
  return AliceSIM_TM1637_WriteSegments(display, 0U, buffer, ALICESIM_TM1637_DIGIT_COUNT);
}

HAL_StatusTypeDef AliceSIM_TM1637_SetColon(
  AliceSIM_TM1637 *display,
  uint8_t enabled
) {
  uint8_t buffer[ALICESIM_TM1637_DIGIT_COUNT];
  uint8_t index;
  if (display == NULL) return HAL_ERROR;
  for (index = 0U; index < ALICESIM_TM1637_DIGIT_COUNT; index += 1U) buffer[index] = display->segments[index];
  return AliceSIM_TM1637_DisplayRaw(display, buffer, enabled);
}

HAL_StatusTypeDef AliceSIM_TM1637_Clear(AliceSIM_TM1637 *display) {
  uint8_t blank[ALICESIM_TM1637_DIGIT_COUNT] = { 0U, 0U, 0U, 0U };
  if (display == NULL) return HAL_ERROR;
  return AliceSIM_TM1637_WriteSegments(display, 0U, blank, ALICESIM_TM1637_DIGIT_COUNT);
}

HAL_StatusTypeDef AliceSIM_TM1637_DisplayNumber(
  AliceSIM_TM1637 *display,
  int32_t value,
  uint8_t leading_zero,
  uint8_t colon
) {
  uint8_t buffer[ALICESIM_TM1637_DIGIT_COUNT] = { 0U, 0U, 0U, 0U };
  uint32_t magnitude;
  int32_t position;
  int32_t first_position = 0;
  if (display == NULL || value < -999 || value > 9999) return HAL_ERROR;
  if (value < 0) {
    buffer[0] = ALICESIM_TM1637_SEGMENT_MINUS;
    first_position = 1;
    magnitude = (uint32_t)(-value);
  } else {
    magnitude = (uint32_t)value;
  }

  if (leading_zero != 0U) {
    for (position = 3; position >= first_position; position -= 1) {
      buffer[position] = AliceSIM_TM1637_EncodeDigit((uint8_t)(magnitude % 10U));
      magnitude /= 10U;
    }
  } else if (magnitude == 0U) {
    buffer[3] = AliceSIM_TM1637_EncodeDigit(0U);
  } else {
    for (position = 3; position >= first_position && magnitude != 0U; position -= 1) {
      buffer[position] = AliceSIM_TM1637_EncodeDigit((uint8_t)(magnitude % 10U));
      magnitude /= 10U;
    }
  }
  return AliceSIM_TM1637_DisplayRaw(display, buffer, colon);
}

HAL_StatusTypeDef AliceSIM_TM1637_Init(
  AliceSIM_TM1637 *display,
  GPIO_TypeDef *clk_port,
  uint16_t clk_pin,
  GPIO_TypeDef *dio_port,
  uint16_t dio_pin,
  AliceSIM_TM1637_DelayUsFn delay_us
) {
  HAL_StatusTypeDef status;
  uint8_t index;
  if (display == NULL || clk_port == NULL || dio_port == NULL) return HAL_ERROR;
  display->clk_port = clk_port;
  display->clk_pin = clk_pin;
  display->dio_port = dio_port;
  display->dio_pin = dio_pin;
  display->delay_us = delay_us;
  display->bit_delay_us = ALICESIM_TM1637_DEFAULT_BIT_DELAY_US;
  display->brightness = ALICESIM_TM1637_DEFAULT_BRIGHTNESS;
  display->enabled = 1U;
  for (index = 0U; index < ALICESIM_TM1637_DIGIT_COUNT; index += 1U) display->segments[index] = 0U;
  alice_tm1637_clk(display, GPIO_PIN_SET);
  alice_tm1637_dio(display, GPIO_PIN_SET);
  status = AliceSIM_TM1637_Clear(display);
  if (status != HAL_OK) return status;
  return AliceSIM_TM1637_SetBrightness(display, ALICESIM_TM1637_DEFAULT_BRIGHTNESS, 1U);
}
