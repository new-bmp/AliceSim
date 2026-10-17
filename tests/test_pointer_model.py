"""Compile real C into the model and run it through the browser firmware engine."""

import json
from pathlib import Path
import shutil
import subprocess
import unittest

from hal_model import build_hal_model


ROOT = Path(__file__).resolve().parents[1]
PROBE = r"""
const fs = require('node:fs');
const Runtime = require('./firmware-runtime.js');
const model = JSON.parse(fs.readFileSync(0, 'utf8'));
const runtime = Runtime.create(model, {
  onAdcRead(event) { return event.instance === 'ADC2' ? 1024 : 2048; },
  onUartTx() { return { accepted: true }; }
});
const states = [];
for (let pass = 0; pass < 2; pass++) {
  if (pass) runtime.reset();
  runtime.start();
  states.push(runtime.step(50));
}
process.stdout.write(JSON.stringify(states));
"""


@unittest.skipUnless(shutil.which("node"), "Node.js is required for model/runtime integration")
class PointerModelTests(unittest.TestCase):
    def run_c(self, source, *, extra=(), error=None):
        model = build_hal_model([
            ("test.ioc", "Mcu.CPN=STM32F103C8T6\nPA0.Signal=ADC1_IN0\nPB0.Signal=ADC2_IN8\n"),
            ("Core/Src/main.c", source),
            *extra,
        ])
        errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
        self.assertFalse(errors, errors)
        result = subprocess.run(
            [shutil.which("node"), "-e", PROBE], input=json.dumps(model),
            text=True, capture_output=True, cwd=ROOT, timeout=15,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        states = json.loads(result.stdout)
        self.assertEqual(states[0], states[1], "Reset must restore the complete C storage state")
        state = states[0]
        if error:
            self.assertIsNotNone(state["error"], state)
            self.assertRegex(state["error"]["message"], error)
        else:
            self.assertIsNone(state["error"], state["error"])
            self.assertEqual("completed", state["status"])
        return state

    def test_adc_hal_and_libc_results_write_to_actual_lvalues(self):
        state = self.run_c(r'''
ADC_HandleTypeDef hadc1;
ADC_HandleTypeDef hadc2;
uint16_t samples[3] = {11, 22, 33};
uint16_t *cursor;
int status[2] = {9, 9};
char text[16];
void Read(uint16_t *first, uint16_t *second) {
  *first = HAL_ADC_GetValue(&hadc1);
  *second = HAL_ADC_GetValue(&hadc2);
}
int main(void) {
  HAL_ADC_Start(&hadc1);
  HAL_ADC_Start(&hadc2);
  cursor = &samples[1];
  Read(cursor, &samples[2]);
  status[0] = HAL_ADC_Stop(&hadc1);
  *(status + 1) = snprintf(text, sizeof(text), "%u", *cursor);
  return *cursor + samples[2];
}
''')
        self.assertEqual([11, 2048, 1024], state["variables"]["samples"])
        self.assertEqual([0, 4], state["variables"]["status"])
        self.assertEqual(3072, state["returnValue"])

    def test_helper_arguments_are_values_and_local_names_do_not_alias_the_caller(self):
        state = self.run_c(r'''
uint16_t data[4] = {10, 20, 30, 40};
uint16_t *cursor;
int index = 0;
int total = 5;
int output = 0;
int Width(uint16_t values[]) { return sizeof(values); }
int Twice(int value) { return value + value; }
void Fill(uint16_t *p, unsigned count) {
  int total = 99;
  while (count--) *p++ = total++;
}
void Maybe(uint16_t *p) { if (!p) return; *p = 7; }
uint16_t *Next(uint16_t *p) { return p + 1; }
int main(void) {
  cursor = data;
  Fill(cursor, 2);
  output = Twice(index++);
  Maybe(0);
  *Next(cursor) += 1;
  return Width(data) + total;
}
''')
        self.assertEqual([99, 101, 30, 40], state["variables"]["data"])
        self.assertEqual(0, state["variables"]["cursor"]["offset"])
        self.assertEqual(1, state["variables"]["index"])
        self.assertEqual(0, state["variables"]["output"])
        self.assertEqual(9, state["returnValue"])

    def test_pointer_to_pointer_rebinds_the_callers_pointer(self):
        state = self.run_c(r'''
uint16_t data[3] = {100, 200, 300};
uint16_t *cursor;
void Advance(uint16_t **p) { ++*p; **p += 5; }
int main(void) {
  cursor = data;
  Advance(&cursor);
  return *cursor;
}
''')
        self.assertEqual(205, state["returnValue"])
        self.assertEqual([100, 205, 300], state["variables"]["data"])

    def test_struct_pointer_and_member_addresses_preserve_field_types(self):
        state = self.run_c(r'''
typedef struct { uint16_t raw; uint8_t ready; uint16_t values[2]; } Sample;
Sample sample;
void Set(uint16_t *out) { *out = 2048; }
void Read(Sample *s) {
  Set(&s->raw);
  s->ready = 257;
  s->values[1] = s->raw + 1;
}
int main(void) {
  Read(&sample);
  return sample.raw + sample.ready + sample.values[1] + sizeof(Sample);
}
''')
        self.assertEqual({"raw": 2048, "ready": 1, "values": [0, 2049]}, state["variables"]["sample"])
        self.assertEqual(4106, state["returnValue"])

    def test_pointer_casts_arithmetic_comparison_and_postincrement(self):
        state = self.run_c(r'''
uint32_t word = 0x12345678;
uint16_t values[3] = {10, 20, 30};
uint16_t *p;
int total = 0;
int byte = 0;
int main(void) {
  byte = ((const uint8_t *)&word)[1];
  p = values;
  if (p != values) return -1;
  while (p < values + 3) total += *p++;
  --p;
  (*p)++;
  return byte + total + *p;
}
''')
        self.assertEqual(177, state["returnValue"])
        self.assertEqual([10, 20, 31], state["variables"]["values"])

    def test_pointer_cast_only_applies_to_its_unary_operand(self):
        state = self.run_c(r'''
uint32_t word = 0x12345678;
uint8_t *p;
int main(void) {
  p = (uint8_t *)&word + 1;
  return *p;
}
''')
        self.assertEqual(0x56, state["returnValue"])

    def test_pointer_casts_and_address_of_in_conditions(self):
        state = self.run_c(r'''
uint32_t word = 0x12345678;
uint8_t *p;
int main(void) {
  p = (const uint8_t *)&word - -1;
  if (&word != NULL && (uint8_t *)&word + 1 == p)
    return *p + sizeof(uint16_t) * 2;
  return 0;
}
''')
        self.assertEqual(0x56 + 4, state["returnValue"])

    def test_pointer_typedefs_preserve_byte_offsets(self):
        state = self.run_c(r'''
typedef uint8_t *BytePointer;
uint32_t word = 0x12345678;
int main(void) {
  BytePointer p = (BytePointer)&word + 1;
  return *p;
}
''')
        self.assertEqual(0x56, state["returnValue"])

    def test_global_initializers_keep_pointer_aliases_and_multiple_declarators(self):
        state = self.run_c(r'''
typedef uint16_t *SamplePointer;
uint16_t first = 10, second = 20;
uint16_t data[2] = {30, 40};
SamplePointer p = data + 1;
uint16_t *addresses[] = {&first, &second};
int main(void) { return *p + *addresses[0] + *addresses[1]; }
''')
        self.assertEqual(70, state["returnValue"])

    def test_struct_initializers_and_arrays_are_distinct_objects(self):
        state = self.run_c(r'''
typedef struct { uint16_t value; uint8_t ready; uint16_t pair[2]; } Sample;
Sample global = {10, 1, {20, 30}};
Sample table[2] = {{40, 2, {50, 60}}, {70, 3, {80, 90}}};
int main(void) {
  Sample local = {100, 4, {110, 120}};
  Sample *p = &local;
  p->pair[1]++;
  p = table + 1;
  return global.value + global.pair[1] + local.value + local.pair[1] + p->value;
}
''')
        self.assertEqual(331, state["returnValue"])

    def test_nested_struct_pointer_copy_uses_member_alignment_and_aliases(self):
        state = self.run_c(r'''
typedef uint16_t Reading;
typedef struct { Reading x; Reading y; Reading z; } Inner;
typedef struct { uint16_t tag; Inner value; } Outer;
int main(void) {
  Outer object = {1, {10, 20, 30}};
  Inner *p = &object.value;
  Inner copy = *p;
  copy.z = 40;
  *p = copy;
  return object.value.z;
}
''')
        self.assertEqual(40, state["returnValue"])

    def test_nested_helpers_keep_global_and_local_pointer_names_separate(self):
        state = self.run_c(r'''
uint16_t data[2] = {10, 20};
uint16_t *p = data;
int Global(void) { return *p; }
int Read(const uint16_t *p) { return *p; }
int Local(void) {
  uint16_t *p = data + 1;
  return Read(p) + Global();
}
int main(void) { return Local(); }
''')
        self.assertEqual(30, state["returnValue"])

    def test_pointer_storage_survives_interrupt_callback_and_reset(self):
        source = r'''
ADC_HandleTypeDef hadc1;
uint16_t data[2] = {4, 8};
uint16_t *p = data;
int Count(void) { static int count = 0; return ++count; }
void Read(uint16_t **pp) { **pp += Count(); }
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *adc) { Read(&p); }
int main(void) {
  p++;
  HAL_ADC_Start_IT(&hadc1);
  HAL_Delay(3);
  return *p;
}
'''
        state = self.run_c(source)
        self.assertEqual(9, state["returnValue"])

    def test_dma_rejects_buffer_whose_local_lifetime_ended(self):
        self.run_c(r'''
ADC_HandleTypeDef hadc1;
void Start(void) {
  uint16_t buffer[2];
  HAL_ADC_Start_DMA(&hadc1, (uint32_t *)buffer, 2);
}
int main(void) { Start(); HAL_Delay(10); return 0; }
''', error=r"[Ll]ifetime|[Dd]angling")

    def test_pointer_helpers_can_live_in_another_source_file(self):
        state = self.run_c('''
uint16_t result = 0;
void Read(uint16_t *out);
int main(void) { Read(&result); return result; }
''', extra=[("Core/Src/sample.c", "void Read(uint16_t *out) { *out = 321; }")])
        self.assertEqual(321, state["returnValue"])

    def test_uart_uses_the_incremented_const_buffer_parameter(self):
        state = self.run_c(r'''
UART_HandleTypeDef huart2;
uint8_t bytes[4] = {'A', 'B', 'C', 0};
void Send(const uint8_t data[], uint16_t count) {
  data++;
  HAL_UART_Transmit(&huart2, (uint8_t *)data, count - 1, 10);
}
int main(void) { Send(bytes, 3); return 0; }
''')
        self.assertEqual("BC", state["uartTx"][0]["text"])
        self.assertEqual([65, 66, 67, 0], state["variables"]["bytes"])

    def test_returned_local_pointer_is_diagnosed(self):
        self.run_c('''
uint16_t *Bad(void) { uint16_t value = 3; return &value; }
int main(void) { uint16_t *p = Bad(); return *p; }
''', error=r"[Ll]ifetime|[Ss]cope|[Dd]angling")

    def test_dma_keeps_the_address_after_helper_returns(self):
        state = self.run_c(r'''
ADC_HandleTypeDef hadc1;
DMA_HandleTypeDef hdma_adc1;
uint16_t samples[4] = {17, 0, 0, 23};
void MX_DMA_Init(void) {
  hdma_adc1.Init.MemDataAlignment = DMA_MDATAALIGN_HALFWORD;
  __HAL_LINKDMA(&hadc1, DMA_Handle, hdma_adc1);
}
void Start(uint16_t *destination) {
  HAL_ADC_Start_DMA(&hadc1, (uint32_t *)destination, 2);
  destination++;
}
int main(void) { Start(&samples[1]); HAL_Delay(10); return samples[1]; }
''')
        self.assertEqual([17, 2048, 2048, 23], state["variables"]["samples"])

    def test_async_i2c_keeps_pointer_and_length_values(self):
        state = self.run_c(r'''
I2C_HandleTypeDef hi2c1;
uint8_t data[3] = {65, 66, 67};
void Send(const uint8_t *p, int n) {
  HAL_I2C_Master_Transmit_IT(&hi2c1, 0x78, (uint8_t *)p, n);
  p++;
  n = 0;
}
int main(void) { Send(data, 3); HAL_Delay(10); return 0; }
''')
        self.assertEqual([65, 66, 67], state["i2cTx"][0]["bytes"])

    def test_heap_structs_void_pointer_and_static_helper_storage(self):
        state = self.run_c(r'''
typedef struct Node { uint16_t value; struct Node *next; } Node;
int Count(void) { static int count = 0; return ++count; }
void Allocate(Node **out) { *out = (Node *)calloc(1, sizeof(Node)); }
int main(void) {
  Node *first = 0;
  Node *second = 0;
  Allocate(&first);
  Allocate(&second);
  first->value = Count();
  second->value = Count();
  first->next = second;
  void *opaque = first;
  Node *p = (Node *)opaque;
  int result = p->value + p->next->value;
  free(second);
  free(first);
  return result;
}
''')
        self.assertEqual(3, state["returnValue"])
        self.assertEqual(0, state["heap"]["usedBytes"])

    def test_invalid_pointer_access_still_stops(self):
        for source, message in [
            ("int main(void) { int *p = 0; return *p; }", r"[Nn]ull pointer"),
            ("int main(void) { uint8_t *p = calloc(2, 1); return p[-1]; }", r"out of bounds"),
            ("int main(void) { uint8_t *p = calloc(2, 1); free(p); return *p; }", r"freed"),
            ("int main(void) { uint16_t a[2] = {1, 2}; return a[2]; }", r"out of bounds"),
        ]:
            with self.subTest(source=source):
                self.run_c(source, error=message)


if __name__ == "__main__":
    unittest.main()
