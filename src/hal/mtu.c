// MTU2 timers. TIMER_SYSTEM_SLOW, _FAST and _SUPERFAST are free-running counters that the firmware reads for
// delays and timing; main.c sets their prescalers, which are repeated here. TIMER_MIDI_GATE_OUTPUT's interrupt
// never fires.

#include "RZA1/mtu/mtu.h"
#include "clock.h"
#include "definitions.h"

struct st_mtu2 webluge_mtu2;

static volatile uint16_t* const counters[] = {&webluge_mtu2.TCNT_0, &webluge_mtu2.TCNT_1, &webluge_mtu2.TCNT_2,
                                              &webluge_mtu2.TCNT_3, &webluge_mtu2.TCNT_4};

volatile uint16_t* const* webluge_mtu2_counters(void) {
	uint64_t cycles = webluge_clock_cycles();
	*counters[TIMER_SYSTEM_SLOW] = (uint16_t)(cycles / 1024);
	*counters[TIMER_SYSTEM_FAST] = (uint16_t)(cycles / 64);
	*counters[TIMER_SYSTEM_SUPERFAST] = (uint16_t)cycles;
	return counters;
}
