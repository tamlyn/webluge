#pragma once

#include <stdint.h>

// The device's peripheral clock (P0), which drives its timers.
#define WEBLUGE_P0_HZ 33330000

// Host stand-in for the passage of time, in P0 cycles. It's virtual rather than real time, so a run is
// deterministic: the firmware seeds its random numbers from a timer.
//
// Time moves on only when the scheduler has nothing due, a block of audio frames at a time, as if the device's CPU
// were infinitely fast. The codec plays the block. Reading the clock also costs a cycle, so that code polling a
// timer in a loop, outside the scheduler, sees time pass.
uint64_t webluge_clock_cycles(void);
