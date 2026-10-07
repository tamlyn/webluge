#include "clock.h"

// One microsecond per read.
#define CYCLES_PER_READ (WEBLUGE_P0_HZ / 1000000)

static uint64_t cycles;

uint64_t webluge_clock_cycles(void) {
	cycles += CYCLES_PER_READ;
	return cycles;
}
