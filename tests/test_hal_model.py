import json
import math
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
        if operation["op"] == "expression" and operation.get("expression", {}).get("kind") == "inlineCall":
            yield from walk_operations(operation["expression"]["operations"])
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
        self.assertEqual("dereference", adc_value["target"]["kind"])
        bindings = {item["target"]: item for item in operations if item["op"] == "assign" and isinstance(item.get("target"), str)}
        raw_binding = bindings[adc_value["target"]["pointer"]["name"]]
        self.assertEqual("uint32_t*", raw_binding["cType"])
        self.assertEqual({"kind": "addressOf", "value": {"kind": "variable", "name": "raw_value"}}, raw_binding["value"])
        display_binding = bindings[display_assignment["value"]["name"]]
        outer_binding = bindings[display_binding["value"]["name"]]
        self.assertEqual({"kind": "variable", "name": "raw_value"}, outer_binding["value"])
        self.assertEqual("huart2", uart_send["uart"])
        self.assertEqual({"kind": "variable", "name": "tx_data"}, bindings[uart_send["buffer"]]["value"])
        self.assertEqual(8, bindings[uart_send["length"]["name"]]["value"]["value"])

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
        buffer = next(item for item in operations if item["op"] == "assign" and str(item.get("target", "")).endswith("_buf"))
        formatted = next(item for item in operations if item["op"] == "formatString")

        self.assertEqual(2048, raw_initializer["value"]["value"])
        self.assertEqual(0, millivolts_initializer["value"]["value"])
        self.assertEqual("inlineCall", converted["value"]["kind"])
        self.assertEqual("Convert_Raw_To_mV_x10", converted["value"]["function"])
        returned = converted["value"]["operations"][-1]
        self.assertEqual("return", returned["op"])
        self.assertEqual(("cast", "uint16_t"), (returned["value"]["kind"], returned["value"]["cType"]))
        quotient = returned["value"]["value"]
        self.assertEqual("div", quotient["kind"])
        self.assertEqual(3300, quotient["left"]["left"]["right"]["value"])
        self.assertEqual(4095, quotient["right"]["value"])
        self.assertEqual(32, len(buffer["value"]))
        self.assertEqual(buffer["target"], formatted["buffer"])

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
        self.assertEqual("halCall", condition["left"]["kind"])
        self.assertEqual("status", condition["left"]["returnKind"])
        self.assertEqual("adcPollForConversion", condition["left"]["operation"]["op"])
        self.assertEqual("hadc1", condition["left"]["operation"]["adc"])

    def test_common_hal_return_values_are_lowered_inside_conditions_and_arithmetic(self) -> None:
        """Status and value-returning HAL calls must share the expression IR path.

        This protects the common pattern ``if (HAL_Foo(...) == HAL_OK)`` from
        regressing into a generic unsupported-expression diagnostic.  The ADC
        value case is deliberately nested in arithmetic because a complete
        assignment RHS takes a different parser path.
        """
        source = r'''
#include "main.h"

ADC_HandleTypeDef hadc1;
DMA_HandleTypeDef hdma_adc1;
UART_HandleTypeDef huart2;
TIM_HandleTypeDef htim2;
uint32_t samples[4];
uint8_t tx_data[1] = {0x55U};
uint32_t raw = 0U;
HAL_StatusTypeDef start_status;
uint32_t adc_started = 0U;
uint32_t switch_high = 0U;
uint32_t sample_above_limit = 0U;
uint32_t dma_started = 0U;
uint32_t uart_started = 0U;
uint32_t pwm_started = 0U;

int main(void)
{
  start_status = HAL_ADC_Start(&hadc1);

  if (HAL_ADC_Start(&hadc1) == HAL_OK)
    adc_started = 1U;

  if (HAL_GPIO_ReadPin(RED_GPIO_Port, RED_Pin) == GPIO_PIN_SET)
    switch_high = 1U;

  if (HAL_ADC_GetValue(&hadc1) + 1U > 1024U)
    sample_above_limit = 1U;

  if (HAL_ADC_Start_DMA(&hadc1, samples, 4U) == HAL_OK)
    dma_started = 1U;

  if (HAL_UART_Transmit_IT(&huart2, tx_data, 1U) == HAL_OK)
    uart_started = 1U;

  if (HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1) == HAL_OK)
    pwm_started = 1U;

  if (HAL_ADC_Stop(&hadc1) == HAL_OK)
    adc_started += 1U;

  while (1) { HAL_Delay(10U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)

        operations = list(walk_operations(model["program"]["operations"]))
        direct_start = next(
            item
            for item in operations
            if item["op"] == "adcStart" and item.get("resultTarget") == "start_status"
        )
        self.assertEqual("hadc1", direct_start["adc"])

        conditions = [item["condition"] for item in operations if item["op"] == "if"]
        self.assertEqual(7, len(conditions))

        expected_call_conditions = [
            (conditions[0], "adcStart", "status"),
            (conditions[1], "gpioRead", "value"),
            (conditions[3], "adcStartDma", "status"),
            (conditions[4], "uartTransmitIt", "status"),
            (conditions[5], "pwmStart", "status"),
            (conditions[6], "adcStop", "status"),
        ]
        for condition, expected_operation, expected_return_kind in expected_call_conditions:
            self.assertEqual("eq", condition["op"])
            self.assertEqual("halCall", condition["left"]["kind"])
            self.assertEqual(expected_operation, condition["left"]["operation"]["op"])
            self.assertEqual(expected_return_kind, condition["left"]["returnKind"])

        adc_value_condition = conditions[2]
        self.assertEqual("gt", adc_value_condition["op"])
        self.assertEqual("add", adc_value_condition["left"]["kind"])
        adc_value_call = adc_value_condition["left"]["left"]
        self.assertEqual("halCall", adc_value_call["kind"])
        self.assertEqual("value", adc_value_call["returnKind"])
        self.assertEqual("adcGetValue", adc_value_call["operation"]["op"])

        # HAL calls nested in an expression still receive normal peripheral
        # metadata. Without this, the runtime could execute them while the
        # schematic binder incorrectly showed no configured ADC activity.
        conditional_start = conditions[0]["left"]["operation"]
        self.assertIn("id", conditional_start)
        self.assertTrue(any(
            item["operationId"] == conditional_start["id"]
            for item in model["adcs"]["hadc1"]["startCalls"]
        ))

    def test_common_hal_initialization_status_calls_are_valid_expressions(self) -> None:
        source = r'''
#include "main.h"

ADC_HandleTypeDef hadc1;
DMA_HandleTypeDef hdma_adc1;
I2C_HandleTypeDef hi2c1;
UART_HandleTypeDef huart2;
TIM_HandleTypeDef htim2;
HAL_StatusTypeDef init_status = HAL_ERROR;
HAL_StatusTypeDef calibration_status = HAL_ERROR;

int main(void)
{
  init_status = HAL_Init();
  calibration_status = HAL_ADCEx_Calibration_Start(&hadc1);

  if (HAL_DMA_Init(&hdma_adc1) != HAL_OK) return 1;
  if (HAL_I2C_Init(&hi2c1) != HAL_OK) return 2;
  if (HAL_UART_Init(&huart2) != HAL_OK) return 3;
  if (HAL_ADC_Init(&hadc1) != HAL_OK) return 4;
  if (HAL_TIM_Base_Init(&htim2) != HAL_OK) return 5;
  if (HAL_TIM_PWM_Init(&htim2) != HAL_OK) return 6;
  if (HAL_TIM_PWM_ConfigChannel(&htim2, 0, TIM_CHANNEL_1) != HAL_OK) return 7;
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        assignments = {
            item["target"]: item["value"]
            for item in operations
            if item["op"] == "assign" and item.get("target") in {"init_status", "calibration_status"}
        }
        self.assertEqual({"kind": "constant", "name": "HAL_OK", "value": 0}, assignments["init_status"])
        self.assertEqual({"kind": "constant", "name": "HAL_OK", "value": 0}, assignments["calibration_status"])

    def test_hal_timeout_suffixes_keep_source_text_and_runtime_expression(self) -> None:
        source = r'''
#include "main.h"

ADC_HandleTypeDef hadc1;
UART_HandleTypeDef huart2;
I2C_HandleTypeDef hi2c1;
SPI_HandleTypeDef hspi1;
uint8_t rx[2];
uint8_t tx[2] = {1U, 2U};

int main(void)
{
  if (HAL_UART_Receive(&huart2, rx, 2U, 10U) == HAL_TIMEOUT) return 1;
  HAL_ADC_Start(&hadc1);
  HAL_ADC_PollForConversion(&hadc1, 50UL);
  HAL_I2C_Master_Transmit(&hi2c1, 0x78U, tx, 2U, 100U);
  HAL_SPI_Transmit(&hspi1, tx, 2U, 0U);
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        receive = next(item for item in operations if item["op"] == "if")["condition"]["left"]["operation"]
        poll = next(item for item in operations if item["op"] == "adcPollForConversion")
        i2c = next(item for item in operations if item["op"] == "i2cMasterTransmit")
        spi = next(item for item in operations if item["op"] == "spiTransmit")

        self.assertEqual(("10U", {"kind": "literal", "value": 10}), (receive["timeout"], receive["timeoutExpression"]))
        self.assertEqual(("50UL", {"kind": "literal", "value": 50}), (poll["timeout"], poll["timeoutExpression"]))
        self.assertEqual(("100U", {"kind": "literal", "value": 100}), (i2c["timeout"], i2c["timeoutExpression"]))
        self.assertEqual(("0U", {"kind": "literal", "value": 0}, False), (spi["timeout"], spi["timeoutExpression"], spi["blocking"]))

    def test_negated_hal_conditions_preserve_a_short_circuit_expression_tree(self) -> None:
        source = r'''
#include "main.h"

ADC_HandleTypeDef hadc1;
uint32_t handled = 0U;

int main(void)
{
  if (!(0U && HAL_ADC_Start(&hadc1) == HAL_OK))
    handled = 1U;
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        condition = next(item for item in walk_operations(model["program"]["operations"]) if item["op"] == "if")["condition"]
        self.assertEqual("logicalNot", condition["kind"])
        self.assertEqual("and", condition["value"]["op"])
        self.assertEqual("halCall", condition["value"]["right"]["left"]["kind"])

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
        self.assertEqual(("cast", "uint16_t"), (transmit["length"]["kind"], transmit["length"]["cType"]))
        length = transmit["length"]["value"]
        self.assertEqual("stringLength", length["kind"])
        self.assertEqual("char*", length["value"]["cType"])
        self.assertEqual("uart_report", length["value"]["value"]["name"])

    def test_snprintf_preserves_an_addressed_destination_offset(self) -> None:
        source = r'''
#include "main.h"
#include <stdio.h>
char line[16] = {0};

int main(void)
{
  snprintf(&line[3], sizeof(line) - 3U, "%s", "ADC");
  return 0;
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        formatted = next(item for item in model["program"]["operations"] if item["op"] == "formatString")
        self.assertEqual("addressOf", formatted["buffer"]["kind"])
        self.assertEqual("arrayIndex", formatted["buffer"]["value"]["kind"])
        self.assertEqual("line", formatted["buffer"]["value"]["name"])

    def test_unresolvable_uart_length_reports_a_diagnostic_without_crashing(self) -> None:
        source = r'''
#include "main.h"
UART_HandleTypeDef huart2;
uint8_t tx_data[4] = {0};
extern uint16_t External_Length(void);

int main(void)
{
  HAL_UART_Transmit(&huart2, tx_data, External_Length(), 100U);
  while (1) HAL_Delay(1U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]

        self.assertTrue(any(item["code"] == "UART_LENGTH_UNRESOLVED" for item in errors), errors)
        self.assertTrue(any("External_Length" in item["message"] or "External_Length" in str(item.get("details")) for item in errors), errors)

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

    def test_external_expression_fails_the_build_with_source_location(self) -> None:
        source = r'''
#include "main.h"
uint32_t raw = 1U;
uint32_t selected = 0U;
int main(void)
{
  selected = External_Value(raw);
  while (1) HAL_Delay(10U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        error = next(item for item in model["diagnostics"] if item["code"] == "C_UNSUPPORTED_EXPRESSION")
        self.assertIn("External_Value ( raw )", error["message"])
        self.assertEqual("Core/Src/main.c", error["file"])
        self.assertEqual(7, error["line"])

    def test_conditional_expressions_lower_hal_calls_and_dynamic_hal_arguments(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
uint32_t selected = 0U;

int main(void)
{
  selected = HAL_ADC_Start(&hadc1) == HAL_OK
    ? HAL_ADC_GetValue(&hadc1)
    : HAL_GPIO_ReadPin(RED_GPIO_Port, RED_Pin) ? 7U : 9U;
  HAL_Delay(selected ? 2U : 5U);
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)

        operations = list(walk_operations(model["program"]["operations"]))
        selected = next(item for item in operations if item.get("target") == "selected")
        conditional = selected["value"]
        self.assertEqual("conditional", conditional["kind"])
        self.assertEqual("eq", conditional["condition"]["op"])
        self.assertEqual("halCall", conditional["condition"]["left"]["kind"])
        self.assertEqual("adcStart", conditional["condition"]["left"]["operation"]["op"])
        self.assertEqual("halCall", conditional["consequent"]["kind"])
        self.assertEqual("adcGetValue", conditional["consequent"]["operation"]["op"])
        self.assertEqual("conditional", conditional["alternate"]["kind"])
        self.assertEqual("halCall", conditional["alternate"]["condition"]["kind"])
        self.assertEqual("gpioRead", conditional["alternate"]["condition"]["operation"]["op"])

        delay = next(item for item in operations if item["op"] == "delay" and item["milliseconds"] is None)
        self.assertEqual("conditional", delay["expression"]["kind"])

    def test_prefix_not_binds_before_comparison_and_keeps_compound_short_circuiting(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
uint32_t first = 0U;
uint32_t second = 0U;

int main(void)
{
  if (!HAL_ADC_GetValue(&hadc1) == 1U)
    first = 1U;
  if (!(0U && HAL_ADC_Start(&hadc1) == HAL_OK))
    second = 1U;
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        conditions = [item["condition"] for item in walk_operations(model["program"]["operations"]) if item["op"] == "if"]

        self.assertEqual("eq", conditions[0]["op"])
        self.assertEqual("logicalNot", conditions[0]["left"]["kind"])
        self.assertEqual("halCall", conditions[0]["left"]["value"]["kind"])
        self.assertEqual("adcGetValue", conditions[0]["left"]["value"]["operation"]["op"])

        self.assertEqual("logicalNot", conditions[1]["kind"])
        self.assertEqual("and", conditions[1]["value"]["op"])
        self.assertEqual("halCall", conditions[1]["value"]["right"]["left"]["kind"])

    def test_increment_expressions_and_compound_array_pointer_targets_are_lowered(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
UART_HandleTypeDef huart2;
I2C_HandleTypeDef hi2c1;
SPI_HandleTypeDef hspi1;
uint8_t tx[4U] = {0};
uint16_t samples[4U] = {0};
uint16_t *cursor;
uint32_t index = 0U;

int main(void)
{
  if (index++ < 3U && HAL_ADC_Start(&hadc1) == HAL_OK)
    samples[index] += HAL_ADC_GetValue(&hadc1);
  HAL_UART_Transmit(&huart2, tx, index++, 0U);
  HAL_I2C_Master_Transmit(&hi2c1, 0x78U, tx, index++, 0U);
  HAL_SPI_Transmit(&hspi1, tx, index++, 0U);
  HAL_ADC_Start_DMA(&hadc1, samples, index++);
  HAL_Delay(--index);
  HAL_Delay(index--);
  for (index = 0U; index++ < 2U; ++index)
    samples[index] += HAL_ADC_GetValue(&hadc1);
  (*cursor) += HAL_ADC_GetValue(&hadc1);
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))

        first_condition = next(item for item in operations if item["op"] == "if")["condition"]
        self.assertEqual("postIncrement", first_condition["left"]["left"]["kind"])
        self.assertEqual("index", first_condition["left"]["left"]["target"]["name"])

        transfers = [
            next(item for item in operations if item["op"] == operation_name)
            for operation_name in ("uartTransmit", "i2cMasterTransmit", "spiTransmit", "adcStartDma")
        ]
        for transfer in transfers:
            self.assertEqual("postIncrement", transfer["length"]["kind"])
            self.assertEqual("index", transfer["length"]["target"]["name"])

        dynamic_delays = [item for item in operations if item["op"] == "delay" and item["milliseconds"] is None]
        self.assertEqual(["preDecrement", "postDecrement"], [item["expression"]["kind"] for item in dynamic_delays])

        loop = next(item for item in operations if item["op"] == "for")
        self.assertEqual("postIncrement", loop["condition"]["left"]["kind"])
        self.assertEqual("assign", loop["increment"][0]["op"])

        compound = [item for item in operations if item["op"] == "compoundAssign"]
        array_targets = [item for item in compound if item["target"]["kind"] == "arrayIndex"]
        pointer_target = next(item for item in compound if item["target"]["kind"] == "dereference")
        self.assertGreaterEqual(len(array_targets), 2)
        self.assertEqual("add", array_targets[0]["operator"])
        self.assertEqual("cursor", pointer_target["target"]["pointer"]["name"])

    def test_value_helpers_are_lowered_inside_control_flow_and_composite_expressions(self) -> None:
        source = r'''
#include "main.h"
ADC_HandleTypeDef hadc1;
uint32_t selected = 0U;
uint32_t result = 0U;
uint32_t loops = 0U;

static HAL_StatusTypeDef Start_Checked(void)
{
  if (HAL_ADC_Start(&hadc1) != HAL_OK)
    return HAL_ERROR;
  return HAL_OK;
}

static uint32_t Read_Or(uint32_t fallback)
{
  if (Start_Checked() == HAL_OK)
    return HAL_ADC_GetValue(&hadc1);
  return fallback;
}

int main(void)
{
  if (Start_Checked() == HAL_OK && Read_Or(7U) > 0U)
    selected = 1U;
  while (Read_Or(0U) > 0U && loops < 1U)
  {
    loops++;
    break;
  }
  for (loops = 0U; Read_Or(0U) > 0U && loops < 1U; loops++)
    break;
  switch (Start_Checked())
  {
    case HAL_OK: result = Read_Or(2U) + 1U; break;
    default: result = 0U; break;
  }
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = model["program"]["operations"]

        first_if = next(item for item in operations if item["op"] == "if")
        self.assertEqual("inlineCall", first_if["condition"]["left"]["left"]["kind"])
        self.assertEqual("Start_Checked", first_if["condition"]["left"]["left"]["function"])
        self.assertEqual("inlineCall", first_if["condition"]["right"]["left"]["kind"])
        self.assertEqual("Read_Or", first_if["condition"]["right"]["left"]["function"])

        while_operation = next(item for item in operations if item["op"] == "while" and item["condition"].get("op") == "and")
        self.assertEqual("inlineCall", while_operation["condition"]["left"]["left"]["kind"])
        for_operation = next(item for item in operations if item["op"] == "for")
        self.assertEqual("inlineCall", for_operation["condition"]["left"]["left"]["kind"])
        switch_operation = next(item for item in operations if item["op"] == "switch")
        self.assertEqual("inlineCall", switch_operation["expression"]["kind"])
        switch_value = switch_operation["cases"][0]["body"][0]["value"]
        self.assertEqual("inlineCall", switch_value["left"]["kind"])

        inlined_start = first_if["condition"]["left"]["left"]["operations"][0]["condition"]["left"]["operation"]
        self.assertEqual("adcStart", inlined_start["op"])
        self.assertIn("id", inlined_start, "HAL operations inside a value helper still receive ids and metadata traversal")

    def test_value_helpers_are_accepted_as_hal_delay_and_transfer_arguments(self) -> None:
        source = r'''
#include "main.h"
UART_HandleTypeDef huart2;
uint8_t tx[8] = {0};

static uint32_t Sample_Period(void)
{
  return 25U;
}

static uint16_t Transfer_Length(void)
{
  return 4U;
}

int main(void)
{
  HAL_Delay(Sample_Period());
  HAL_UART_Transmit(&huart2, tx, Transfer_Length(), 10U);
  while (1) HAL_Delay(1U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        delay = next(item for item in operations if item["op"] == "delay" and item["milliseconds"] is None)
        transmit = next(item for item in operations if item["op"] == "uartTransmit")
        self.assertEqual("inlineCall", delay["expression"]["kind"])
        self.assertEqual("Sample_Period", delay["expression"]["function"])
        self.assertEqual("inlineCall", transmit["length"]["kind"])
        self.assertEqual("Transfer_Length", transmit["length"]["function"])

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

    def test_extended_math_and_string_calls_are_lowered_as_real_expressions(self) -> None:
        source = r'''
#include "main.h"
#include <math.h>
#include <string.h>
char text[24] = "alpha,beta";
char *found = 0;
char *token = 0;
char *message = 0;
int exponent = 0;
double integral = 0.0;
double result = 0.0;

int main(void)
{
  rand();
  found = memchr(text, 'p', sizeof(text));
  token = strtok(text, ",");
  message = strerror(22);
  result = cosh(0.0) + exp2(3.0) + log2(8.0) + cbrt(27.0);
  result += nearbyint(2.5) + rint(3.5) + remainder(7.0, 2.0);
  result += frexp(8.0, &exponent) + modf(-2.75, &integral);
  while (1) HAL_Delay(1U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        functions = set()

        def collect(value):
            if isinstance(value, dict):
                if value.get("kind") == "libcCall":
                    functions.add(value["function"])
                for nested in value.values():
                    collect(nested)
            elif isinstance(value, list):
                for nested in value:
                    collect(nested)

        collect(operations)
        self.assertTrue(
            {
                "memchr", "strtok", "strerror", "cosh", "exp2", "log2", "cbrt",
                "nearbyint", "rint", "remainder", "frexp", "modf",
            }.issubset(functions),
            functions,
        )
        standalone = next(item for item in operations if item.get("op") == "expression")
        self.assertEqual("rand", standalone["expression"]["function"])

    def test_standard_header_constants_are_available_to_the_semantic_model(self) -> None:
        source = r'''
#include "main.h"
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
double pi_value = 0.0;
double epsilon_value = 0.0;
double infinity_value = 0.0;
double nan_value = 0.0;
int eof_value = 0;
int random_limit = 0;

int main(void)
{
  pi_value = M_PI;
  epsilon_value = DBL_EPSILON;
  infinity_value = INFINITY;
  nan_value = NAN;
  eof_value = EOF;
  random_limit = RAND_MAX;
  while (1) HAL_Delay(1U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        assignments = {
            item["target"]: item["value"]
            for item in walk_operations(model["program"]["operations"])
            if item.get("op") == "assign" and isinstance(item.get("target"), str)
        }
        self.assertAlmostEqual(math.pi, assignments["pi_value"]["value"])
        self.assertEqual(-1, assignments["eof_value"]["value"])
        self.assertEqual(2147483647, assignments["random_limit"]["value"])
        self.assertEqual("INFINITY", assignments["infinity_value"]["name"])
        self.assertNotIn("value", assignments["infinity_value"])
        self.assertEqual("NAN", assignments["nan_value"]["name"])

    def test_integer_format_macros_concatenate_with_c_strings(self) -> None:
        source = r'''
#include "main.h"
#include <stdio.h>
#include <inttypes.h>
#define LABEL "raw="
uint32_t raw = 2048;
char line[64];
int main(void)
{
  snprintf(line, sizeof(line), LABEL "%" PRIu32 " hex=%" PRIX16 "\n", raw, raw);
  printf("value=%" PRIu32 "\n", raw);
  sscanf("4095", "%" SCNu32, &raw);
  return 0;
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))
        formats = [item["format"] for item in operations if item["op"] in {"formatString", "stdioWrite", "stdioScan"}]
        self.assertEqual(["raw=%u hex=%X\n", "value=%u\n", "%u"], [item["value"] for item in formats])
        for item in formats:
            self.assertEqual(list(item["value"].encode("ascii")), item["bytes"])

    def test_declaration_call_initializers_lower_hal_heap_and_format_results(self) -> None:
        source = r'''
#include "main.h"
#include <stdio.h>
#include <stdlib.h>
ADC_HandleTypeDef hadc1;

int main(void)
{
  uint32_t *samples = (uint32_t *)malloc(sizeof(uint32_t) * 4U);
  uint16_t *zeroed = calloc(3U, sizeof(uint16_t));
  uint16_t *grown = (uint16_t *)realloc(zeroed, sizeof(uint16_t) * 8U);
  char line[24U] = {0};
  int rendered = snprintf(line, sizeof(line), "samples=%u", 4U);
  HAL_StatusTypeDef start_status = HAL_ADC_Start(&hadc1);
  (void)samples;
  (void)grown;
  (void)rendered;
  (void)start_status;
  while (1) HAL_Delay(1U);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = list(walk_operations(model["program"]["operations"]))

        allocations = [item for item in operations if item["op"] == "heapAllocate"]
        self.assertEqual(
            [("malloc", "samples"), ("calloc", "zeroed"), ("realloc", "grown")],
            [(item["function"], item["resultTarget"]) for item in allocations],
        )
        formatted = next(item for item in operations if item["op"] == "formatString")
        self.assertEqual(("line", "rendered"), (formatted["buffer"], formatted["resultTarget"]))
        status = next(item for item in operations if item["op"] == "adcStart")
        self.assertEqual("start_status", status["resultTarget"])

    def test_cmsis_irq_mask_calls_are_explicit_operations_and_mask_is_a_value(self) -> None:
        source = r'''
uint32_t previous_mask = 0;
uint32_t inside_mask = 0;
int main(void)
{
  previous_mask = __get_PRIMASK();
  __disable_irq();
  inside_mask = __get_PRIMASK();
  __set_PRIMASK(previous_mask);
  __enable_irq();
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        self.assertEqual([], [item for item in model["diagnostics"] if item["severity"] == "error"])
        operations = model["program"]["operations"]
        self.assertEqual(["assign", "irqDisable", "assign", "irqSetMask", "irqEnable", "while"],
                         [item["op"] for item in operations])
        self.assertEqual({"kind": "irqMask"}, operations[0]["value"])
        self.assertEqual({"kind": "irqMask"}, operations[2]["value"])
        self.assertEqual({"kind": "variable", "name": "previous_mask"}, operations[3]["value"])

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

    def test_hal_status_comparisons_are_values_in_assignments_and_returns(self) -> None:
        source = r'''
#include "main.h"
#include <stdbool.h>

ADC_HandleTypeDef hadc1;
uint32_t result = 0U;

static bool ADC_Is_Ready(void)
{
  return HAL_ADC_Start(&hadc1) == HAL_OK;
}

int main(void)
{
  bool adc_ready = HAL_ADC_Start(&hadc1) == HAL_OK;
  bool input_high = HAL_GPIO_ReadPin(RED_GPIO_Port, RED_Pin) == GPIO_PIN_SET;
  bool should_sample = adc_ready && !input_high;
  bool enabled = true;
  bool disabled = false;
  result = should_sample || enabled;

  if (ADC_Is_Ready() && !disabled)
    return HAL_ADC_Start(&hadc1) == HAL_OK;
  return false;
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)

        operations = model["program"]["operations"]
        assignments = {
            item["target"]: item["value"]
            for item in operations
            if item["op"] == "assign" and isinstance(item.get("target"), str)
        }
        self.assertEqual("eq", assignments["adc_ready"]["op"])
        self.assertEqual("halCall", assignments["adc_ready"]["left"]["kind"])
        self.assertEqual("eq", assignments["input_high"]["op"])
        self.assertEqual("halCall", assignments["input_high"]["left"]["kind"])
        self.assertEqual("and", assignments["should_sample"]["op"])
        self.assertEqual("or", assignments["result"]["op"])
        self.assertEqual({"kind": "constant", "name": "true", "value": True}, assignments["enabled"])
        self.assertEqual({"kind": "constant", "name": "false", "value": False}, assignments["disabled"])

        conditional_return = operations[-2]["then"][0]
        self.assertEqual("return", conditional_return["op"])
        self.assertEqual("eq", conditional_return["value"]["op"])
        self.assertEqual("halCall", conditional_return["value"]["left"]["kind"])
        self.assertEqual({"kind": "constant", "name": "false", "value": False}, operations[-1]["value"])

    def test_hal_get_tick_is_supported_in_declaration_and_arithmetic(self) -> None:
        source = r'''
#include "main.h"

uint32_t elapsed = 0U;

int main(void)
{
  uint32_t started_at = HAL_GetTick();
  uint32_t deadline = HAL_GetTick() + 25U;
  elapsed = deadline - started_at;
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = model["program"]["operations"]
        started = next(item for item in operations if item.get("target") == "started_at")
        deadline = next(item for item in operations if item.get("target") == "deadline")
        self.assertEqual({"kind": "tick"}, started["value"])
        self.assertEqual("add", deadline["value"]["kind"])
        self.assertEqual({"kind": "tick"}, deadline["value"]["left"])

    def test_parenthesis_free_sizeof_is_supported_in_transfer_and_arithmetic(self) -> None:
        source = r'''
#include "main.h"

UART_HandleTypeDef huart2;
uint8_t tx[4U] = {0};
uint32_t total = 0U;

int main(void)
{
  uint32_t length = sizeof tx;
  total = sizeof tx + 1U;
  HAL_UART_Transmit(&huart2, tx, sizeof tx, 10U);
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = model["program"]["operations"]
        length = next(item for item in operations if item.get("target") == "length")
        total = next(item for item in operations if item.get("target") == "total")
        transmit = next(item for item in operations if item["op"] == "uartTransmit")
        self.assertEqual("sizeOf", length["value"]["kind"])
        self.assertEqual("add", total["value"]["kind"])
        self.assertEqual("sizeOf", total["value"]["left"]["kind"])
        self.assertEqual("sizeOf", transmit["length"]["kind"])

    def test_array_size_and_parenthesized_array_pointer_expressions_are_lowered(self) -> None:
        source = r'''
#include "main.h"
#define ARRAY_SIZE(value) (sizeof(value) / sizeof((value)[0]))

uint16_t samples[4] = {0};
uint16_t *cursor = 0;
uint32_t sample_count = 0U;
uint32_t element_bytes = 0U;

int main(void)
{
  sample_count = ARRAY_SIZE(samples);
  element_bytes = sizeof(uint16_t);
  cursor = &((samples))[0];
  cursor = cursor + 1;
  *cursor = 7U;
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        operations = model["program"]["operations"]
        count = next(item for item in operations if item.get("target") == "sample_count")
        width = next(item for item in operations if item.get("target") == "element_bytes")
        pointer = next(item for item in operations if item.get("target") == "cursor" and item["value"].get("kind") == "addressOf")
        self.assertEqual("div", count["value"]["kind"])
        self.assertEqual("sizeOf", count["value"]["left"]["kind"])
        self.assertEqual("arrayIndex", count["value"]["right"]["value"]["kind"])
        self.assertEqual({"kind": "sizeOf", "cType": "uint16_t"}, width["value"])
        self.assertEqual("arrayIndex", pointer["value"]["value"]["kind"])
        self.assertEqual("samples", pointer["value"]["value"]["name"])

    def test_pointer_cast_followed_by_address_of_is_not_mistaken_for_bitwise_and(self) -> None:
        source = r'''
#include "main.h"

uint16_t sample = 0U;
uint8_t *bytes = 0;

int main(void)
{
  bytes = (uint8_t *)&sample;
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        assignment = next(item for item in model["program"]["operations"] if item.get("target") == "bytes")
        self.assertEqual("cast", assignment["value"]["kind"])
        self.assertEqual("uint8_t*", assignment["value"]["cType"])
        self.assertEqual("addressOf", assignment["value"]["value"]["kind"])
        self.assertEqual("sample", assignment["value"]["value"]["value"]["name"])

    def test_hal_buffer_arguments_preserve_literal_and_pointer_expressions(self) -> None:
        source = r'''
#include "main.h"

uint8_t frame[4] = { 'A', 'B', 'C', 0 };
uint32_t offset = 1U;

int main(void)
{
  HAL_UART_Transmit(&huart2, (uint8_t*)"OK", sizeof("OK") - 1U, 10U);
  HAL_UART_Transmit(&huart2, &frame[offset], 2U, 10U);
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        transfers = [item for item in model["program"]["operations"] if item["op"] == "uartTransmit"]
        self.assertEqual(2, len(transfers))
        self.assertEqual("uint8_t*", transfers[0]["buffer"]["cType"])
        self.assertEqual({"kind": "string", "value": "OK", "bytes": [79, 75]}, transfers[0]["buffer"]["value"])
        self.assertEqual("addressOf", transfers[1]["buffer"]["kind"])

    def test_common_embedded_c_idioms_work_together_without_false_unsupported_errors(self) -> None:
        source = r'''
#include "main.h"
#define ARRAY_SIZE(value) (sizeof(value) / sizeof((value)[0]))

typedef enum
{
  MODE_IDLE,
  MODE_RUN = 4,
  MODE_ERROR
} RunMode;

typedef struct
{
  uint16_t millivolts;
  uint8_t ready;
} Sample;

uint16_t samples[4] = {0};
Sample current;

static uint32_t Select_Result(uint8_t active)
{
  if (active)
    return ARRAY_SIZE(samples);
  else
    return MODE_ERROR;
}

int main(void)
{
  uint32_t index = 0U;
  uint32_t count = ARRAY_SIZE(samples);

#if 0
  Unsupported_Peripheral_That_Must_Not_Be_Parsed();
#endif

  current.millivolts = 1234U;
  current.ready = 1U;

  do
  {
    samples[index] = current.millivolts;
    index++;
    if (index == 2U)
      continue;
    if (index > 2U)
      break;
  } while (index < count);

  return Select_Result(current.ready);
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)

        operations = model["program"]["operations"]
        count = next(item for item in operations if item.get("target") == "count")
        loop = next(item for item in operations if item["op"] == "doWhile")
        returned = next(item for item in operations if item["op"] == "return")

        self.assertEqual("div", count["value"]["kind"])
        self.assertEqual("sizeOf", count["value"]["left"]["kind"])
        self.assertEqual("sizeOf", count["value"]["right"]["kind"])
        self.assertEqual("member", loop["body"][0]["value"]["kind"])
        self.assertTrue(any(item["op"] == "continue" for item in loop["body"][2]["then"]))
        self.assertTrue(any(item["op"] == "break" for item in loop["body"][3]["then"]))
        self.assertEqual("inlineCall", returned["value"]["kind"])
        helper_branch = next(item for item in returned["value"]["operations"] if item["op"] == "if")
        self.assertEqual("samples", helper_branch["then"][0]["value"]["left"]["value"]["name"])
        self.assertEqual(5, helper_branch["else"][0]["value"]["value"])

    def test_comparison_equality_and_bitwise_precedence_matches_c(self) -> None:
        source = r'''
#include "main.h"

uint32_t a = 1U;
uint32_t b = 2U;
uint32_t c = 3U;
uint32_t mask = 1U;
uint32_t chained = 0U;
uint32_t mixed = 0U;

int main(void)
{
  chained = a < b < c;
  mixed = a & mask == 0U;
  while (1) { HAL_Delay(1U); }
}
'''
        model = build_hal_model(fixture_files(main_c=source))
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        assignments = {
            item["target"]: item["value"]
            for item in model["program"]["operations"]
            if item.get("op") == "assign" and isinstance(item.get("target"), str)
        }

        # Relational operators associate left-to-right: (a < b) < c.
        self.assertEqual("lt", assignments["chained"]["op"])
        self.assertEqual("lt", assignments["chained"]["left"]["op"])
        self.assertEqual("c", assignments["chained"]["right"]["name"])

        # Equality binds tighter than bitwise AND: a & (mask == 0U).
        self.assertEqual("bitAnd", assignments["mixed"]["op"])
        self.assertEqual("a", assignments["mixed"]["left"]["name"])
        self.assertEqual("eq", assignments["mixed"]["right"]["op"])


if __name__ == "__main__":
    unittest.main()
