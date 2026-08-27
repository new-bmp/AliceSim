import json
from pathlib import Path
import unittest

from hal_model import build_hal_model


IOC = """\
#MicroXplorer Configuration settings - do not modify
Mcu.CPN=STM32F103C8T6
Mcu.Name=STM32F103C8Tx
Mcu.Pin0=PA2
Mcu.Pin1=PA3
Mcu.Pin2=PA6
Mcu.Pin3=PA7
Mcu.Pin4=PB0
PA2.Mode=Asynchronous
PA2.Signal=USART2_TX
PA3.Mode=Asynchronous
PA3.Signal=USART2_RX
PA6.GPIOParameters=GPIO_Label
PA6.GPIO_Label=RED
PA6.Signal=GPIO_Output
PA7.GPIOParameters=GPIO_Label
PA7.GPIO_Label=GREEN
PA7.Signal=GPIO_Output
PB0.GPIOParameters=GPIO_Label
PB0.GPIO_Label=BLUE
PB0.Signal=GPIO_Output
USART2.BaudRate=115200
USART2.WordLength=WORDLENGTH_8B
USART2.StopBits=STOPBITS_1
USART2.Parity=PARITY_NONE
"""


MAIN_H = """\
#ifndef __MAIN_H
#define __MAIN_H
#include "stm32f1xx_hal.h"
#define RED_Pin GPIO_PIN_6
#define RED_GPIO_Port GPIOA
#define GREEN_Pin (GPIO_PIN_7)
#define GREEN_GPIO_Port GPIOA
#define BLUE_Pin ((uint16_t)(1U << 0))
#define BLUE_GPIO_Port GPIOB
#endif
"""


MAIN_C = r"""
#include "main.h"

UART_HandleTypeDef huart2;
uint8_t rx_data[2];

static void MX_USART2_UART_Init(void)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  HAL_UART_Init(&huart2);
}

int main(void)
{
  HAL_Init();
  MX_USART2_UART_Init();

  while (1)
  {
    HAL_UART_Receive(&huart2, rx_data, 2, HAL_MAX_DELAY);
    GPIO_PinState state = GPIO_PIN_SET;
    if (rx_data[1] == '0')
    {
      state = GPIO_PIN_RESET;
    }
    if (rx_data[0] == 'R')
    {
      HAL_GPIO_WritePin(RED_GPIO_Port, RED_Pin, state);
    }
    else if (rx_data[0] == 'G')
    {
      HAL_GPIO_WritePin(GREEN_GPIO_Port, GREEN_Pin, state);
    }
    else if (rx_data[0] == 'B')
    {
      HAL_GPIO_WritePin(BLUE_GPIO_Port, BLUE_Pin, state);
    }
    HAL_UART_Transmit(&huart2, rx_data, 2, HAL_MAX_DELAY);
  }
}
"""


def fixture_files(main_h: str = MAIN_H, main_c: str = MAIN_C):
    return [
        (Path("UART_RGB.ioc"), IOC),
        (Path("Core/Inc/main.h"), main_h),
        (Path("Core/Src/main.c"), main_c),
    ]


def walk_operations(operations):
    for operation in operations:
        yield operation
        if operation["op"] == "while":
            yield from walk_operations(operation["body"])
        elif operation["op"] == "for":
            yield from walk_operations(operation["init"])
            yield from walk_operations(operation["body"])
            yield from walk_operations(operation["increment"])
        elif operation["op"] == "if":
            yield from walk_operations(operation["then"])
            yield from walk_operations(operation["else"])
        elif operation["op"] == "switch":
            for case in operation["cases"]:
                yield from walk_operations(case["body"])
            yield from walk_operations(operation["default"])


def command_gpio_map(model):
    result = {}
    for operation in walk_operations(model["program"]["operations"]):
        if operation["op"] != "if":
            continue
        condition = operation["condition"]
        if condition.get("op") != "eq":
            continue
        left, right = condition["left"], condition["right"]
        if left.get("kind") != "arrayIndex" or left.get("name") != "rx_data" or left.get("index") != 0:
            continue
        if right.get("kind") != "char":
            continue
        writes = [item for item in walk_operations(operation["then"]) if item["op"] == "gpioWrite"]
        if writes:
            result[right["value"]] = writes[0]["pin"]
    return result


class HalModelTests(unittest.TestCase):
    def test_gpio_read_pin_is_lowered_into_a_runtime_input_operation(self) -> None:
        header = MAIN_H + """
#define RUN_SWITCH_Pin GPIO_PIN_1
#define RUN_SWITCH_GPIO_Port GPIOA
"""
        source = """\
#include "main.h"
uint32_t switch_state = GPIO_PIN_SET;
int main(void)
{
  while (1)
  {
    switch_state = HAL_GPIO_ReadPin(RUN_SWITCH_GPIO_Port, RUN_SWITCH_Pin);
    if (switch_state == GPIO_PIN_RESET)
    {
      HAL_GPIO_WritePin(RED_GPIO_Port, RED_Pin, GPIO_PIN_SET);
    }
    HAL_Delay(10U);
  }
}
"""
        model = build_hal_model(fixture_files(main_h=header, main_c=source))
        self.assertFalse([item for item in model["diagnostics"] if item["severity"] == "error"])
        read = next(item for item in walk_operations(model["program"]["operations"]) if item["op"] == "gpioRead")
        self.assertEqual("PA1", read["pin"])
        self.assertEqual("RUN_SWITCH", read["alias"])
        self.assertEqual("switch_state", read["resultTarget"])

    def test_c_control_flow_statements_are_lowered(self) -> None:
        source = """\
#include "main.h"
int main(void)
{
  int total = 0;
  for (int i = 0; i < 4; i++)
  {
    if (i == 1) continue;
    total += i;
    if (total > 2) break;
  }
  switch (total)
  {
    case 5:
      total = 50;
      break;
    default:
      total = 99;
  }
  return total;
}
"""
        model = build_hal_model(fixture_files(main_c=source))
        self.assertFalse([item for item in model["diagnostics"] if item["severity"] == "error"])
        operations = model["program"]["operations"]
        self.assertEqual(["assign", "for", "switch", "return"], [item["op"] for item in operations])
        loop = operations[1]
        self.assertEqual("assign", loop["init"][0]["op"])
        self.assertEqual("assign", loop["increment"][0]["op"])
        self.assertEqual("continue", loop["body"][0]["then"][0]["op"])
        self.assertEqual("break", loop["body"][2]["then"][0]["op"])
        self.assertEqual(1, len(operations[2]["cases"]))
        self.assertEqual("break", operations[2]["cases"][0]["body"][1]["op"])
        self.assertEqual("return", operations[3]["op"])

    def test_cpp_stdlib_blink_example_binds_control_flow_to_pc13(self) -> None:
        example_root = Path(__file__).resolve().parents[1] / "examples" / "CppStdlibBlink"
        files = [
            (path.relative_to(example_root), path.read_text(encoding="utf-8"))
            for path in example_root.rglob("*")
            if path.is_file()
        ]
        model = build_hal_model(files)

        self.assertFalse([item for item in model["diagnostics"] if item["severity"] == "error"])
        self.assertEqual("PC13", model["gpioAliases"]["STATUS_LED"]["physicalPin"])
        self.assertEqual("PC13", next(iter(model["outputs"])))
        self.assertEqual(["for", "return"], [item["op"] for item in model["program"]["operations"]])

        loop = model["program"]["operations"][0]
        self.assertEqual("for", loop["op"])
        self.assertEqual("assign", loop["init"][0]["op"])
        self.assertEqual("assign", loop["increment"][0]["op"])
        self.assertEqual("continue", loop["body"][1]["then"][-1]["op"])

        switch = next(item for item in loop["body"] if item["op"] == "switch")
        self.assertEqual([0, 2], [item["value"]["value"] for item in switch["cases"]])
        self.assertEqual([], switch["cases"][0]["body"], "case 0 intentionally falls through to case 2")
        self.assertEqual("break", switch["cases"][1]["body"][-1]["op"])
        self.assertEqual("break", switch["default"][-1]["op"])
        self.assertEqual({"kind": "literal", "value": 0}, model["program"]["operations"][1]["value"])

        writes = [item for item in walk_operations(model["program"]["operations"]) if item["op"] == "gpioWrite"]
        self.assertEqual({"PC13"}, {item["pin"] for item in writes})
        delays = [item for item in walk_operations(model["program"]["operations"]) if item["op"] == "delay"]
        self.assertEqual(2, len(delays))
        self.assertTrue(all(item["expression"].get("kind") == "arrayIndex" for item in delays))

    def test_cubemx_clock_wrapper_is_ignored_and_error_handler_is_a_runtime_fault(self) -> None:
        source = """\
#include "main.h"
int main(void)
{
  SystemClock_Config();
  if (HAL_Init() != HAL_OK) Error_Handler();
  while (1) { HAL_Delay(1); }
}
"""
        model = build_hal_model(fixture_files(main_c=source))
        self.assertFalse([item for item in model["diagnostics"] if item["severity"] == "error"])
        self.assertNotIn("unsupported", [item["op"] for item in walk_operations(model["program"]["operations"])])
        fault = next(item for item in walk_operations(model["program"]["operations"]) if item["op"] == "fault")
        self.assertEqual("Firmware entered Error_Handler()", fault["message"])

    def test_uart_rgb_model_uses_physical_pins(self) -> None:
        model = build_hal_model(fixture_files())

        self.assertEqual(1, model["schemaVersion"])
        self.assertEqual("STM32F103C8T6", model["mcu"])
        self.assertEqual("PA6", model["gpioAliases"]["RED"]["physicalPin"])
        self.assertEqual("PA7", model["gpioAliases"]["GREEN"]["physicalPin"])
        self.assertEqual("PB0", model["gpioAliases"]["BLUE"]["physicalPin"])
        self.assertEqual("verified", model["gpioAliases"]["RED"]["confidence"])
        self.assertEqual("verified", model["gpioAliases"]["GREEN"]["confidence"])
        self.assertEqual("verified", model["gpioAliases"]["BLUE"]["confidence"])
        self.assertEqual({"R": "PA6", "G": "PA7", "B": "PB0"}, command_gpio_map(model))
        self.assertEqual({"PA6", "PA7", "PB0"}, set(model["outputs"]))
        self.assertFalse([item for item in model["diagnostics"] if item["severity"] == "error"])
        json.dumps(model)

    def test_uart2_configuration_and_blocking_receive_metadata(self) -> None:
        model = build_hal_model(fixture_files())
        uart = model["uarts"]["huart2"]

        self.assertEqual("USART2", uart["instance"])
        self.assertEqual(115200, uart["baudRate"])
        self.assertEqual("PA2", uart["txPin"])
        self.assertEqual("PA3", uart["rxPin"])
        self.assertEqual({"dataBits": 8, "stopBits": 1, "parity": "none"}, uart["frame"])
        self.assertEqual(1, len(uart["receiveCalls"]))
        self.assertEqual(1, len(uart["transmitCalls"]))

        receive = model["program"]["blockingReceives"][0]
        self.assertEqual("huart2", receive["uart"])
        self.assertEqual("rx_data", receive["buffer"])
        self.assertEqual(2, receive["length"])
        self.assertEqual("HAL_MAX_DELAY", receive["timeout"])
        # A runtime can therefore see that a single input byte is insufficient.
        self.assertGreater(receive["length"], 1)

    def test_second_byte_zero_selects_reset_state(self) -> None:
        model = build_hal_model(fixture_files())
        reset_conditions = []
        for operation in walk_operations(model["program"]["operations"]):
            if operation["op"] != "if" or operation["condition"].get("op") != "eq":
                continue
            condition = operation["condition"]
            if condition["left"] == {"kind": "arrayIndex", "name": "rx_data", "index": 1}:
                reset_conditions.append(operation)

        self.assertEqual(1, len(reset_conditions))
        condition = reset_conditions[0]
        self.assertEqual({"kind": "char", "value": "0", "code": 48}, condition["condition"]["right"])
        self.assertEqual("assign", condition["then"][0]["op"])
        self.assertEqual("state", condition["then"][0]["target"])
        self.assertEqual(0, condition["then"][0]["value"]["value"])

    def test_compound_conditions_preserve_c_precedence(self) -> None:
        source = MAIN_C.replace(
            "if (rx_data[1] == '0')",
            "if (rx_data[1] != '0' && rx_data[0] >= 'A')",
        )
        model = build_hal_model(fixture_files(main_c=source))
        conditions = [
            operation["condition"]
            for operation in walk_operations(model["program"]["operations"])
            if operation["op"] == "if"
        ]
        compound = next(condition for condition in conditions if condition.get("op") == "and")

        self.assertEqual("ne", compound["left"]["op"])
        self.assertEqual("ge", compound["right"]["op"])
        self.assertEqual(
            {"kind": "arrayIndex", "name": "rx_data", "index": 1},
            compound["left"]["left"],
        )
        self.assertEqual({"kind": "char", "value": "A", "code": 65}, compound["right"]["right"])

    def test_ioc_macro_conflict_is_explicit_and_source_controls_program(self) -> None:
        conflicting_header = MAIN_H.replace("#define RED_GPIO_Port GPIOA", "#define RED_GPIO_Port GPIOB")
        model = build_hal_model(fixture_files(main_h=conflicting_header))

        red = model["gpioAliases"]["RED"]
        self.assertEqual("PB6", red["physicalPin"])
        self.assertEqual("PA6", red["iocPhysicalPin"])
        self.assertEqual("conflict", red["confidence"])
        conflict = [item for item in model["diagnostics"] if item["code"] == "GPIO_IOC_MACRO_CONFLICT"]
        self.assertEqual(1, len(conflict))
        self.assertEqual("PB6", command_gpio_map(model)["R"])

    def test_toggle_and_delay_are_serialized_without_evaluation(self) -> None:
        source = MAIN_C.replace(
            "HAL_UART_Transmit(&huart2, rx_data, 2, HAL_MAX_DELAY);",
            "HAL_GPIO_TogglePin(BLUE_GPIO_Port, BLUE_Pin);\n    HAL_Delay(25U);\n    HAL_UART_Transmit(&huart2, rx_data, 2, HAL_MAX_DELAY);",
        )
        model = build_hal_model(fixture_files(main_c=source))
        operations = list(walk_operations(model["program"]["operations"]))
        toggles = [item for item in operations if item["op"] == "gpioToggle"]
        delays = [item for item in operations if item["op"] == "delay"]

        self.assertEqual("PB0", toggles[0]["pin"])
        self.assertEqual(25, delays[0]["milliseconds"])

    def test_cmsis_rtos2_tasks_and_middleware_configuration_are_registered(self) -> None:
        source = r'''
#include "main.h"
#include "cmsis_os2.h"
const osThreadAttr_t sensorTask_attributes = {
  .name = "SensorTask",
  .stack_size = 512,
  .priority = (osPriority_t) osPriorityAboveNormal,
};

void StartSensorTask(void *argument)
{
  while (1)
  {
    HAL_GPIO_TogglePin(BLUE_GPIO_Port, BLUE_Pin);
    osDelay(20);
  }
}

int main(void)
{
  HAL_Init();
  osKernelInitialize();
  osThreadNew(StartSensorTask, NULL, &sensorTask_attributes);
  osKernelStart();
  while (1) {}
}
'''
        model = build_hal_model(fixture_files(main_c=source) + [(Path("Core/Inc/FreeRTOSConfig.h"), """
#define configTICK_RATE_HZ 1000
#define configTOTAL_HEAP_SIZE (16 * 1024)
#define configMAX_PRIORITIES 7
""")])
        freertos = model["middlewares"]["freertos"]

        self.assertTrue(freertos["detected"])
        self.assertEqual("CMSIS-RTOS2", freertos["api"])
        self.assertEqual(1000, freertos["tickRateHz"])
        self.assertEqual(16384, freertos["heapBytes"])
        self.assertEqual(7, freertos["maxPriorities"])
        self.assertEqual(1, len(freertos["tasks"]))
        task = freertos["tasks"][0]
        self.assertEqual("SensorTask", task["name"])
        self.assertEqual("StartSensorTask", task["entry"])
        self.assertEqual(128, task["stackWords"])
        self.assertEqual(32, task["priority"])
        task_operations = list(walk_operations(task["operations"]))
        self.assertEqual("PB0", next(item for item in task_operations if item["op"] == "gpioToggle")["pin"])
        self.assertEqual("rtosDelay", next(item for item in task_operations if item["op"] == "rtosDelay")["op"])
        self.assertIn("PB0", model["outputs"], "task-driven GPIO must be bound to the schematic")

    def test_native_freertos_task_creation_and_pdms_delay_are_registered(self) -> None:
        source = r'''
#include "main.h"
#include "FreeRTOS.h"
#include "task.h"
static void LedTask(void *argument)
{
  while (1)
  {
    HAL_GPIO_TogglePin(RED_GPIO_Port, RED_Pin);
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

int main(void)
{
  HAL_Init();
  xTaskCreate(LedTask, "LED", 192, NULL, 3, NULL);
  vTaskStartScheduler();
  while (1) {}
}
'''
        model = build_hal_model(fixture_files(main_c=source) + [(Path("FreeRTOSConfig.h"), """
#define configTICK_RATE_HZ 250
#define configTOTAL_HEAP_SIZE 4096
""")])
        task = model["middlewares"]["freertos"]["tasks"][0]
        delay = next(item for item in walk_operations(task["operations"]) if item["op"] == "rtosDelay")

        self.assertEqual("FreeRTOS", model["middlewares"]["freertos"]["api"])
        self.assertEqual("LED", task["name"])
        self.assertEqual(192, task["stackWords"])
        self.assertEqual(3, task["priority"])
        self.assertEqual({"kind": "literal", "value": 100}, delay["milliseconds"])

    def test_generated_helpers_tick_calibration_and_typedef_locals_are_supported(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
uint32_t raw_value = 0;
uint32_t last_tick = 0;

static void Read_ADC_Values(void)
{
  HAL_ADC_Start(&hadc1);
  HAL_ADC_PollForConversion(&hadc1, 10U);
  raw_value = HAL_ADC_GetValue(&hadc1);
}

static void OLED_Show_Data(void)
{
  HAL_GPIO_TogglePin(RED_GPIO_Port, RED_Pin);
}

void SystemClock_Config(void)
{
  HAL_RCC_OscConfig(0);
}

int main(void)
{
  GPIO_PinState sw_run;
  HAL_ADCEx_Calibration_Start(&hadc1);
  SystemClock_Config();
  last_tick = HAL_GetTick();
  while (1)
  {
    if ((HAL_GetTick() - last_tick) >= 100U)
    {
      Read_ADC_Values();
      OLED_Show_Data();
      last_tick = HAL_GetTick();
    }
    HAL_Delay(1U);
  }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        self.assertIn("adcStart", {item["op"] for item in operations})
        self.assertIn("adcGetValue", {item["op"] for item in operations})
        self.assertIn("gpioToggle", {item["op"] for item in operations})
        tick_assignments = [item for item in operations if item["op"] == "assign" and item.get("target") == "last_tick"]
        self.assertTrue(any(item["value"].get("kind") == "tick" for item in tick_assignments))

    def test_parameterized_helpers_bind_handles_values_buffers_and_output_pointers(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
UART_HandleTypeDef huart2;
uint32_t raw_value = 0;
uint32_t display_value = 0;
uint8_t tx_data[8] = {0};

static void Read_ADC_Values(ADC_HandleTypeDef *adc, uint32_t *raw)
{
  HAL_ADC_Start(adc);
  HAL_ADC_PollForConversion(adc, 10U);
  *raw = HAL_ADC_GetValue(adc);
}

static void OLED_Write_Value(uint32_t value)
{
  display_value = value;
}

static void OLED_Show_Data(uint32_t millivolts)
{
  OLED_Write_Value(millivolts);
}

static void UART_Send_Data(UART_HandleTypeDef *uart, uint8_t *data, uint16_t length)
{
  HAL_UART_Transmit(uart, data, length, 100U);
}

int main(void)
{
  Read_ADC_Values(&hadc1, &raw_value);
  OLED_Show_Data(raw_value);
  UART_Send_Data(&huart2, tx_data, 8U);
  while (1) HAL_Delay(1U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        adc_start = next(item for item in operations if item["op"] == "adcStart")
        adc_value = next(item for item in operations if item["op"] == "adcGetValue")
        uart_send = next(item for item in operations if item["op"] == "uartTransmit")
        display_assignment = next(item for item in operations if item["op"] == "assign" and item.get("target") == "display_value")

        self.assertEqual("hadc1", adc_start["adc"])
        self.assertEqual("hadc1", adc_value["adc"])
        self.assertEqual("raw_value", adc_value["target"])
        self.assertEqual({"kind": "variable", "name": "raw_value"}, display_assignment["value"])
        self.assertEqual("huart2", uart_send["uart"])
        self.assertEqual("tx_data", uart_send["buffer"])
        self.assertEqual(8, uart_send["length"])

    def test_local_multi_declarations_returning_helpers_and_source_macros_are_lowered(self) -> None:
        source = r'''
#include "main.h"
#include <stdio.h>
#define ADC_RAW_MAX 4095
#define VREF_MV 3300

uint16_t Convert_Raw_To_mV_x10(uint16_t raw)
{
  return (uint16_t)((raw * VREF_MV * 10UL) / ADC_RAW_MAX);
}

void OLED_Show_Data(uint16_t millivolts)
{
  char buf[32];
  snprintf(buf, sizeof(buf), "PA0 %u.%u mV", millivolts / 10U, millivolts % 10U);
}

int main(void)
{
  uint16_t raw = 2048U, millivolts = 0U;
  millivolts = Convert_Raw_To_mV_x10(raw);
  OLED_Show_Data(millivolts);
  while (1) HAL_Delay(10U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        raw_initializer = next(item for item in operations if item["op"] == "assign" and item.get("target") == "raw")
        millivolts_initializer = next(
            item for item in operations
            if item["op"] == "assign" and item.get("target") == "millivolts" and item["value"].get("kind") == "literal"
        )
        converted = [item for item in operations if item["op"] == "assign" and item.get("target") == "millivolts"][-1]
        buffer = next(item for item in operations if item["op"] == "assign" and item.get("target") == "buf")
        formatted = next(item for item in operations if item["op"] == "formatString")

        self.assertEqual(2048, raw_initializer["value"]["value"])
        self.assertEqual(0, millivolts_initializer["value"]["value"])
        self.assertEqual("div", converted["value"]["kind"])
        self.assertEqual(3300, converted["value"]["left"]["left"]["right"]["value"])
        self.assertEqual(4095, converted["value"]["right"]["value"])
        self.assertEqual(32, len(buffer["value"]))
        self.assertEqual("buf", formatted["buffer"])

    def test_adc_poll_call_inside_a_condition_is_lowered_as_a_runtime_expression(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
uint16_t raw = 0U;

void Read_ADC(uint16_t *destination)
{
  HAL_ADC_Start(&hadc1);
  if (HAL_ADC_PollForConversion(&hadc1, 10U) == HAL_OK)
    *destination = HAL_ADC_GetValue(&hadc1);
}

int main(void)
{
  Read_ADC(&raw);
  while (1) HAL_Delay(10U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        condition = next(item for item in walk_operations(model["program"]["operations"]) if item["op"] == "if")["condition"]
        self.assertEqual("eq", condition["op"])
        self.assertEqual("adcPoll", condition["left"]["kind"])
        self.assertEqual("hadc1", condition["left"]["adc"])

    def test_parameterized_helper_argument_count_mismatch_is_reported(self) -> None:
        source = r'''
#include "main.h"
static void Show_Two(uint32_t first, uint32_t second)
{
  HAL_Delay(first + second);
}
int main(void)
{
  Show_Two(1U);
  while (1) {}
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertTrue(any(item["code"] == "C_UNSUPPORTED_FUNCTION_ARGUMENTS" for item in errors), errors)
        self.assertTrue(any("expects 2 arguments but received 1" in item["message"] for item in errors), errors)

    def test_snprintf_strlen_and_dynamic_uart_length_are_lowered(self) -> None:
        source = r'''
#include "main.h"
#include <stdio.h>
#include <string.h>
UART_HandleTypeDef huart2;
uint32_t adc1_mv10 = 11000U;
uint32_t adc2_mv10 = 22005U;
char oled_line[24U] = {0};
uint8_t uart_report[64U] = {0};
int report_length = 0;

static void OLED_Show_Data(uint32_t mv10)
{
  snprintf(oled_line, sizeof(oled_line), "PA0 %lu.%01lu mV", mv10 / 10U, mv10 % 10U);
}

static void UART_Send_Data(uint32_t first, uint32_t second)
{
  report_length = snprintf((char *)uart_report, sizeof(uart_report),
                           "PA0=%lu.%01lumV PB0=%lu.%01lumV\r\n",
                           first / 10U, first % 10U, second / 10U, second % 10U);
  HAL_UART_Transmit(&huart2, uart_report, (uint16_t)strlen((char *)uart_report), 100U);
}

int main(void)
{
  OLED_Show_Data(adc1_mv10);
  UART_Send_Data(adc1_mv10, adc2_mv10);
  while (1) HAL_Delay(100U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        formats = [item for item in operations if item["op"] == "formatString"]
        transmit = next(item for item in operations if item["op"] == "uartTransmit")

        self.assertEqual(2, len(formats))
        self.assertEqual(("oled_line", "sizeOf"), (formats[0]["buffer"], formats[0]["capacity"]["kind"]))
        self.assertEqual("report_length", formats[1]["resultTarget"])
        self.assertEqual("uart_report", transmit["buffer"])
        self.assertEqual("stringLength", transmit["length"]["kind"])
        self.assertEqual("uart_report", transmit["length"]["value"]["name"])

    def test_adc_float_math_and_c_float_literals_are_lowered(self) -> None:
        source = r'''
#include "main.h"
#include <stdio.h>
uint32_t raw = 2048U;
float adc_reference = 3.3f;
double calibration = 1.0e-3;
char line[32] = {0};

int main(void)
{
  float millivolts = ((float)raw * 3300.0f) / 4095.0f;
  snprintf(line, sizeof(line), "%.2f mV", millivolts);
  while (1) HAL_Delay(10U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        self.assertAlmostEqual(3.3, model["variables"]["adc_reference"])
        self.assertAlmostEqual(0.001, model["variables"]["calibration"])
        self.assertEqual("float", model["variableTypes"]["millivolts"])

        operations = list(walk_operations(model["program"]["operations"]))
        calculation = next(item for item in operations if item.get("target") == "millivolts")
        self.assertEqual("div", calculation["value"]["kind"])
        self.assertEqual("float", calculation["value"]["right"]["numericType"])
        self.assertEqual("cast", calculation["value"]["left"]["left"]["kind"])
        self.assertEqual("float", calculation["value"]["left"]["right"]["numericType"])

    def test_unmodeled_expression_fails_the_build_with_source_location(self) -> None:
        source = r'''
#include "main.h"
uint32_t raw = 1U;
uint32_t selected = 0U;
int main(void)
{
  selected = raw ? 1U : 0U;
  while (1) HAL_Delay(10U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        error = next(item for item in model["diagnostics"] if item["code"] == "C_UNSUPPORTED_EXPRESSION")
        self.assertIn("raw ? 1U : 0U", error["message"])
        self.assertEqual("Core/Src/main.c", error["file"])
        self.assertEqual(7, error["line"])

    def test_common_stdio_string_stdlib_and_heap_calls_are_lowered(self) -> None:
        source = r'''
#include "main.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
char source_text[8] = "abc";
char destination[16] = {0};
int *heap_value = NULL;
int compare_result = 9;
int parsed_value = 0;
int scanned_value = 0;
float scanned_voltage = 0.0f;
int scan_count = 0;

int main(void)
{
  memset(destination, 0, sizeof(destination));
  strcpy(destination, source_text);
  strcat(destination, "!");
  compare_result = strcmp(destination, "abc!");
  parsed_value = atoi("1234");
  scan_count = sscanf("17 2.5", "%d %f", &scanned_value, &scanned_voltage);
  heap_value = malloc(sizeof(int));
  if (heap_value != NULL)
  {
    *heap_value = parsed_value;
    printf("heap=%d %s\n", *heap_value, destination);
    puts("done");
    free(heap_value);
  }
  while (1) HAL_Delay(10U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        operation_names = {item["op"] for item in operations}

        self.assertTrue({"libcMemory", "heapAllocate", "heapFree", "stdioWrite", "stdioScan"}.issubset(operation_names))
        self.assertEqual("libcCall", next(item for item in operations if item.get("target") == "compare_result")["value"]["kind"])
        self.assertEqual("atoi", next(item for item in operations if item.get("target") == "parsed_value")["value"]["function"])
        self.assertEqual("int*", model["variableTypes"]["heap_value"])
        pointer_write = next(item for item in operations if item["op"] == "assign" and isinstance(item.get("target"), dict))
        self.assertEqual("dereference", pointer_write["target"]["kind"])

    def test_exti_adc_uart_and_timer_interrupts_are_lowered_with_callbacks(self) -> None:
        header = MAIN_H + r'''
#define BUTTON_Pin GPIO_PIN_0
#define BUTTON_GPIO_Port GPIOA
'''
        ioc = IOC + r'''
Mcu.Pin5=PA0
PA0.GPIOParameters=GPIO_ModeDefaultEXTI,GPIO_Label
PA0.GPIO_Label=BUTTON
PA0.GPIO_ModeDefaultEXTI=GPIO_MODE_IT_RISING_FALLING
PA0.Signal=GPXTI0
RCC.HCLKFreq_Value=72000000
RCC.APB1Freq_Value=36000000
RCC.APB1CLKDivider=2
'''
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
UART_HandleTypeDef huart2;
TIM_HandleTypeDef htim2;
uint8_t tx_data[2] = {'O', 'K'};
uint8_t rx_data[2];
uint32_t adc_value = 0;
uint32_t timer_ticks = 0;

static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
  GPIO_InitStruct.Pin = BUTTON_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_RISING_FALLING;
  HAL_GPIO_Init(BUTTON_GPIO_Port, &GPIO_InitStruct);
  HAL_NVIC_SetPriority(EXTI0_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(EXTI0_IRQn);
}

void HAL_GPIO_EXTI_Callback(uint16_t selected_pin)
{
  if (selected_pin == BUTTON_Pin) HAL_GPIO_TogglePin(RED_GPIO_Port, RED_Pin);
}

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *adcHandle)
{
  adc_value = HAL_ADC_GetValue(adcHandle);
}

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *uartHandle)
{
  HAL_UART_Receive_IT(uartHandle, rx_data, 2U);
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *timerHandle)
{
  if (timerHandle->Instance == TIM2) timer_ticks++;
}

int main(void)
{
  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 7199;
  htim2.Init.Period = 9;
  MX_GPIO_Init();
  HAL_ADC_Start_IT(&hadc1);
  HAL_UART_Transmit_IT(&huart2, tx_data, 2U);
  HAL_UART_Receive_IT(&huart2, rx_data, 2U);
  HAL_TIM_Base_Start_IT(&htim2);
  while (1) HAL_Delay(10U);
}
'''
        model = build_hal_model([
            (Path("Interrupts.ioc"), ioc),
            (Path("Core/Inc/main.h"), header),
            (Path("Core/Src/main.c"), source),
        ])
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        operation_names = {item["op"] for item in operations}
        self.assertTrue({"adcStartIt", "uartTransmitIt", "uartReceiveIt", "timerStartIt"}.issubset(operation_names))
        self.assertEqual("both", model["pins"]["PA0"]["interruptEdge"])
        self.assertGreater(next(item for item in operations if item["op"] == "timerStartIt")["frequencyHz"], 0)
        self.assertEqual(["selected_pin"], model["callbacks"]["HAL_GPIO_EXTI_Callback"]["parameters"])
        self.assertEqual(["adcHandle"], model["callbacks"]["HAL_ADC_ConvCpltCallback"]["parameters"])
        self.assertIn("HAL_UART_RxCpltCallback", model["callbacks"])
        self.assertIn("HAL_TIM_PeriodElapsedCallback", model["callbacks"])

    def test_adc_and_uart_dma_calls_links_and_callbacks_are_lowered(self) -> None:
        source = r'''
#include "main.h"

ADC_HandleTypeDef hadc1;
UART_HandleTypeDef huart2;
DMA_HandleTypeDef hdma_adc1;
DMA_HandleTypeDef hdma_usart2_tx;
DMA_HandleTypeDef hdma_usart2_rx;
uint32_t adc_samples[4];
uint8_t tx_data[4] = {'D', 'M', 'A', '\n'};
uint8_t rx_data[4];
volatile uint32_t adc_half_count = 0;
volatile uint32_t uart_tx_done = 0;

static void MX_DMA_Init(void)
{
  hdma_adc1.Instance = DMA1_Channel1;
  hdma_adc1.Init.Mode = DMA_CIRCULAR;
  hdma_usart2_tx.Instance = DMA1_Channel7;
  hdma_usart2_tx.Init.Mode = DMA_NORMAL;
  hdma_usart2_rx.Instance = DMA1_Channel6;
  hdma_usart2_rx.Init.Mode = DMA_CIRCULAR;
  __HAL_LINKDMA(&hadc1, DMA_Handle, hdma_adc1);
  __HAL_LINKDMA(&huart2, hdmatx, hdma_usart2_tx);
  __HAL_LINKDMA(&huart2, hdmarx, hdma_usart2_rx);
}

void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef *hadc)
{
  if (hadc->Instance == ADC1)
  {
    adc_half_count++;
  }
}

void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart)
{
  uart_tx_done = 1;
}

int main(void)
{
  HAL_Init();
  MX_DMA_Init();
  HAL_ADC_Start_DMA(&hadc1, adc_samples, 4U);
  HAL_UART_Transmit_DMA(&huart2, tx_data, 4U);
  HAL_UART_Receive_DMA(&huart2, rx_data, 4U);
  while (1) { HAL_Delay(10U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))

        self.assertTrue(model["dmas"]["hdma_adc1"]["circular"])
        self.assertEqual("hdma_adc1", model["adcs"]["hadc1"]["dmaHandle"])
        self.assertEqual("hdma_usart2_tx", model["uarts"]["huart2"]["txDmaHandle"])
        self.assertEqual("hdma_usart2_rx", model["uarts"]["huart2"]["rxDmaHandle"])
        adc_dma = next(item for item in operations if item["op"] == "adcStartDma")
        tx_dma = next(item for item in operations if item["op"] == "uartTransmitDma")
        rx_dma = next(item for item in operations if item["op"] == "uartReceiveDma")
        self.assertEqual(("adc_samples", 4, True), (adc_dma["buffer"], adc_dma["length"], adc_dma["circular"]))
        self.assertEqual(("hdma_usart2_tx", False), (tx_dma["dmaHandle"], tx_dma["circular"]))
        self.assertEqual(("hdma_usart2_rx", True), (rx_dma["dmaHandle"], rx_dma["circular"]))
        self.assertIn("HAL_ADC_ConvHalfCpltCallback", model["callbacks"])
        self.assertIn("HAL_UART_TxCpltCallback", model["callbacks"])

    def test_cubemx_msp_parameter_dma_link_resolves_to_global_handle(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
DMA_HandleTypeDef hdma_adc1;
uint32_t samples[4];

void MX_ADC1_Init(void)
{
  hadc1.Instance = ADC1;
}

void HAL_ADC_MspInit(ADC_HandleTypeDef *adcHandle)
{
  if (adcHandle->Instance == ADC1)
  {
    hdma_adc1.Instance = DMA1_Channel1;
    hdma_adc1.Init.Mode = DMA_CIRCULAR;
    __HAL_LINKDMA(adcHandle, DMA_Handle, hdma_adc1);
  }
}

int main(void)
{
  MX_ADC1_Init();
  HAL_ADC_Start_DMA(&hadc1, samples, 4U);
  while (1) { HAL_Delay(10U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operation = next(item for item in walk_operations(model["program"]["operations"]) if item["op"] == "adcStartDma")
        self.assertEqual("hdma_adc1", model["adcs"]["hadc1"]["dmaHandle"])
        self.assertEqual("hdma_adc1", operation["dmaHandle"])
        self.assertTrue(operation["circular"])


if __name__ == "__main__":
    unittest.main()
