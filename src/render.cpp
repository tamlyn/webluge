#include "render.h"
#include "definitions_cxx.hpp"
#include "hal/audio.h"
#include "playback/playback_handler.h"
#include "task_scheduler.h"

namespace webluge {

void startPlayback() {
	playbackHandler.playButtonPressed(kInternalButtonPressLatency);
}

namespace {
uint64_t runUntil;
}

void run(uint64_t numFrames) {
	runUntil = webluge_audio_frames_played() + numFrames;
	yield([]() { return webluge_audio_frames_played() >= runUntil; });
}

} // namespace webluge
