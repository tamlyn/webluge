#pragma once

#include <stdint.h>

// The device's peripheral clock (P0), which drives its timers.
#define WEBLUGE_P0_HZ 33330000

// Host stand-in for the passage of time, in P0 cycles. It's virtual rather than real time, so a run is
// deterministic: the firmware seeds its random numbers from a timer.
//
// Time moves on when the scheduler has nothing due, a block of audio frames at a time, and the codec plays the
// block. Otherwise the CPU is nearly infinitely fast: rendering audio costs a little time, and reading the clock a
// cycle, so that code polling a timer in a loop, outside the scheduler, sees time pass.
#ifdef __cplusplus
extern "C" {
#endif

uint64_t webluge_clock_cycles(void);

#ifdef __cplusplus
}
#endif
