#ifndef ALICESIM_TIMING_H
#define ALICESIM_TIMING_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Delay for at least the requested number of microseconds. */
typedef void (*AliceSIM_DelayUsFn)(uint32_t microseconds);

/** Return a free-running 32-bit microsecond counter. Wraparound is supported. */
typedef uint32_t (*AliceSIM_MicrosFn)(void);

#ifdef __cplusplus
}
#endif

#endif
