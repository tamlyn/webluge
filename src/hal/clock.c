#include "clock.h"
#include "audio.h"

static uint64_t cycles;

static void advanceTo(uint64_t newCycles) {
	cycles = newCycles;
	webluge_audio_play_until(cycles * WEBLUGE_SAMPLE_RATE / WEBLUGE_P0_HZ);
}

uint64_t webluge_clock_cycles(void) {
	advanceTo(cycles + 1);
	return cycles;
}

// Moving on a frame at a time would make the scheduler render a frame at a time, which the device, taking time to
// render, never does. deluge_main asks for the audio routine every 16 frames.
#define IDLE_FRAMES 16

void webluge_scheduler_idle(void) {
	uint64_t frame = cycles * WEBLUGE_SAMPLE_RATE / WEBLUGE_P0_HZ;
	uint64_t nextFrame = (frame / IDLE_FRAMES + 1) * IDLE_FRAMES;
	advanceTo((nextFrame * WEBLUGE_P0_HZ + WEBLUGE_SAMPLE_RATE - 1) / WEBLUGE_SAMPLE_RATE);
}
