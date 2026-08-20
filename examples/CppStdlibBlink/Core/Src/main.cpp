#include <stdc++.h>
#include "main.h"

// The HAL semantic runtime reads this ordinary C-style array.  Keeping the
// waveform data simple lets the same source drive the AliceSIM circuit.
static const uint32_t phase_delay_ms[4] = {80U, 120U, 180U, 240U};

// This function is intentionally not called by the semantic runtime.  It is
// compiled by the GNU Arm C++ checker to demonstrate that <stdc++.h> exposes
// normal C++ library facilities, including malloc/free from <cstdlib>.
[[maybe_unused]] static int standard_library_compile_probe()
{
  std::array<int, 4> fixed_values = {1, 2, 3, 4};
  std::vector<int> values(fixed_values.begin(), fixed_values.end());
  int *heap_value = static_cast<int *>(std::malloc(sizeof(int)));

  if (heap_value == nullptr)
  {
    return -1;
  }

  *heap_value = std::accumulate(values.begin(), values.end(), 0);
  const int result = *heap_value;
  std::free(heap_value);
  return result;
}

int main(void)
{
  HAL_Init();

  for (uint32_t phase = 0U;; phase++)
  {
    const uint32_t slot = phase % 4U;

    // The fourth phase is a short low interval.  continue jumps to phase++.
    if (slot == 3U)
    {
      HAL_GPIO_WritePin(STATUS_LED_GPIO_Port, STATUS_LED_Pin, GPIO_PIN_RESET);
      HAL_Delay(phase_delay_ms[slot]);
      continue;
    }

    switch (slot)
    {
      case 0U:
      case 2U:
        HAL_GPIO_WritePin(STATUS_LED_GPIO_Port, STATUS_LED_Pin, GPIO_PIN_SET);
        break;

      default:
        HAL_GPIO_WritePin(STATUS_LED_GPIO_Port, STATUS_LED_Pin, GPIO_PIN_RESET);
        break;
    }

    HAL_Delay(phase_delay_ms[slot]);
  }

  return 0;
}
