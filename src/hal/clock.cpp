#include "clock.h"
#include "audio.h"

namespace AudioEngine {
extern uint32_t audioSampleTimer;
}

namespace {

// Moving on a frame at a time would make the scheduler render a frame at a time, which the device, taking time to
// render, never does. deluge_main asks for the audio routine every 16 frames.
constexpr uint64_t kIdleFrames = 16;

// Stem export renders offline, as many frames as it can in a set time, so the frames it renders past a clip's end
// depend on how long rendering takes. This puts the host's overshoot in line with the device's (2000-3000 frames for
// the reference songs).
constexpr uint64_t kCyclesPerRenderedFrame = 14;

uint64_t cycles;
uint32_t framesRendered;

void advanceTo(uint64_t newCycles) {
	cycles = newCycles;
	webluge_audio_play_until(cycles * WEBLUGE_SAMPLE_RATE / WEBLUGE_P0_HZ);
}

} // namespace

uint64_t webluge_clock_cycles(void) {
	uint32_t newlyRendered = AudioEngine::audioSampleTimer - framesRendered;
	framesRendered += newlyRendered;
	advanceTo(cycles + 1 + newlyRendered * kCyclesPerRenderedFrame);
	return cycles;
}

extern "C" void webluge_scheduler_idle(void) {
	uint64_t frame = cycles * WEBLUGE_SAMPLE_RATE / WEBLUGE_P0_HZ;
	uint64_t nextFrame = (frame / kIdleFrames + 1) * kIdleFrames;
	advanceTo((nextFrame * WEBLUGE_P0_HZ + WEBLUGE_SAMPLE_RATE - 1) / WEBLUGE_SAMPLE_RATE);
}
