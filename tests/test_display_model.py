from pathlib import Path
import unittest

from hal_model import build_hal_model


class DisplayDriverModelTests(unittest.TestCase):
    def test_tm1637_raw_and_partial_segments_keep_pointer_and_bounds_expressions(self):
        source = """
AliceSIM_TM1637 display;
uint8_t segments[4] = {0x76, 0x79, 0x38, 0x38};
int main(void) {
  AliceSIM_TM1637_Init(&display, GPIOB, GPIO_PIN_0, GPIOB, GPIO_PIN_1, 0);
  AliceSIM_TM1637_DisplayRaw(&display, segments, 1);
  AliceSIM_TM1637_WriteSegments(&display, 2, &segments[1], 2);
  AliceSIM_TM1637_SetColon(&display, 0);
  while (1) {}
}
"""
        model = build_hal_model([(Path("Core/Src/main.c"), source)])
        errors = [diagnostic for diagnostic in model["diagnostics"] if diagnostic["severity"] == "error"]
        self.assertEqual([], errors)
        operations = model["program"]["operations"]
        self.assertEqual("aliceTm1637DisplayRaw", operations[1]["op"])
        self.assertEqual("segments", operations[1]["buffer"])
        self.assertEqual("aliceTm1637WriteSegments", operations[2]["op"])
        self.assertEqual(2, operations[2]["startPosition"]["value"])
        self.assertEqual(2, operations[2]["count"]["value"])
        self.assertEqual("addressOf", operations[2]["buffer"]["kind"])
        self.assertEqual("aliceTm1637SetColon", operations[3]["op"])

    def test_tm1637_raw_status_can_control_a_firmware_branch(self):
        source = """
AliceSIM_TM1637 display;
uint8_t segments[4] = {0x76, 0x79, 0x38, 0x38};
int sent;
int main(void) {
  if (AliceSIM_TM1637_DisplayRaw(&display, segments, 1) == 0) sent = 1;
}
"""
        model = build_hal_model([(Path("Core/Src/main.c"), source)])
        errors = [diagnostic for diagnostic in model["diagnostics"] if diagnostic["severity"] == "error"]
        self.assertEqual([], errors)
        condition = model["program"]["operations"][0]["condition"]
        self.assertEqual("aliceTm1637DisplayRaw", condition["left"]["operation"]["op"])

    def test_ws2812_driver_binds_its_pwm_dma_callback_to_the_configured_timer_pin(self):
        source = """
TIM_HandleTypeDef htim2;
AliceSIM_WS2812 strip;
uint8_t rgb[3] = {255, 0, 0};
uint16_t pulses[72];
uint32_t count;
static HAL_StatusTypeDef send_leds(void *context, const uint16_t *data, uint32_t length) {
  return HAL_TIM_PWM_Start_DMA((TIM_HandleTypeDef *)context, TIM_CHANNEL_1, (uint32_t *)data, length);
}
int main(void) {
  AliceSIM_WS2812_Init(&strip, &htim2, send_leds, 28, 56, 48);
  uint32_t required = AliceSIM_WS2812_RequiredPulseCount(1, 48);
  AliceSIM_WS2812_Encode(&strip, rgb, 1, pulses, 72, &count);
  AliceSIM_WS2812_Show(&strip, rgb, 1, pulses, 72);
  HAL_TIM_PWM_Start_DMA(&htim2, TIM_CHANNEL_1, (uint32_t *)pulses, 72);
  while (1) {}
}
"""
        ioc = "Mcu.CPN=STM32F103C8T6\nPA0.Signal=TIM2_CH1\nRCC.HCLKFreq_Value=72000000\nRCC.APB1Freq_Value=36000000\nRCC.APB1CLKDivider=RCC_HCLK_DIV2\nTIM2.Prescaler=0\nTIM2.Period=89\n"
        model = build_hal_model([(Path("Led.ioc"), ioc), (Path("Core/Src/main.c"), source)])
        errors = [diagnostic for diagnostic in model["diagnostics"] if diagnostic["severity"] == "error"]
        self.assertEqual([], errors)
        operations = model["program"]["operations"]
        init = next(item for item in operations if item["op"] == "aliceWs2812Init")
        self.assertEqual("htim2", init["timer"])
        self.assertEqual(1, init["channel"])
        dma = next(item for item in operations if item["op"] == "pwmStartDma")
        self.assertEqual("PA0", dma["pin"])
        self.assertEqual(800000, dma["frequencyHz"])
        self.assertEqual(89, dma["period"])

    def test_ws2812_rejects_an_unknown_callback_instead_of_inventing_a_transport(self):
        source = "int main(void) { AliceSIM_WS2812_Init(&strip, &htim2, unknown_output, 28, 56, 48); }"
        model = build_hal_model([(Path("main.c"), source)])
        self.assertIn("ALICESIM_WS2812_TRANSPORT_UNSUPPORTED", [item["code"] for item in model["diagnostics"]])


if __name__ == "__main__":
    unittest.main()
