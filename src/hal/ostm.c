// OS timers, which the task scheduler uses as its clock.

#include "RZA1/ostm/ostm.h"
#include "clock.h"

void enableTimer(int timerNo) {
}

void disableTimer(int timerNo) {
}

void setOperatingMode(int timerNo, enum OSTimerOperatingMode mode, bool enable_interrupt) {
}

void setTimerValue(int timerNo, uint32_t timerValue) {
}

double getTimerValueSeconds(int timerNo) {
	return (double)webluge_clock_cycles() / WEBLUGE_P0_HZ;
}
