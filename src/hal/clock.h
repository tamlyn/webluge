#pragma once

#include <stdint.h>

// The device's peripheral clock (P0), which drives its timers.
#define WEBLUGE_P0_HZ 33330000

// Host stand-in for the passage of time, in P0 cycles. It's virtual rather than real time, so a run is
// deterministic: the firmware seeds its random numbers from a timer. Each call moves it on a little, so code that
// polls a timer in a loop sees time pass. Phase 4.1 drives it from rendered audio instead.
uint64_t webluge_clock_cycles(void);
