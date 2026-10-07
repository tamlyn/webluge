// Wraps DelugeFirmware/src/RZA1/mtu/mtu.h. The firmware reads and writes the MTU2 timer registers directly, so
// they're moved into host memory, and every read of a counter (TCNT) first brings it up to date with the host
// clock (src/hal/mtu.c). That way busy-waits such as delayMS finish.
#pragma once

#include "RZA1/system/iodefine.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
extern struct st_mtu2 webluge_mtu2;
volatile uint16_t* const* webluge_mtu2_counters(void);
#ifdef __cplusplus
}
#endif

#undef MTU2
#define MTU2 webluge_mtu2

#include_next "RZA1/mtu/mtu.h"

#define TCNT (webluge_mtu2_counters())
