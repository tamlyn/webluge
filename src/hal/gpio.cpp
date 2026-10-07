// GPIO. Pin direction and muxing mean nothing on the host. Inputs report a fixed set of jacks, chosen to match
// how the device is recorded: headphones in (so the engine renders in stereo) and nothing else.

#include "definitions_cxx.hpp"

extern "C" {
#include "RZA1/gpio/gpio.h"
}

namespace {

bool is(Pin pin, uint8_t p, uint8_t q) {
	return pin.port == p && pin.pin == q;
}

} // namespace

extern "C" {

void setPinMux(uint8_t, uint8_t, uint8_t) {
}

void setPinAsOutput(uint8_t, uint8_t) {
}

void setPinAsInput(uint8_t, uint8_t) {
}

void setOutputState(uint8_t, uint8_t, uint16_t) {
}

uint16_t readInput(uint8_t p, uint8_t q) {
	if (is(HEADPHONE_DETECT, p, q)) {
		return 1;
	}
	// Active low: high means no mic.
	if (is(MIC_DETECT, p, q)) {
		return 1;
	}
	return 0;
}
}
