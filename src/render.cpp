#include "render.h"
#include "definitions_cxx.hpp"
#include "hal/audio.h"
#include "playback/playback_handler.h"
#include "processing/stem_export/stem_export.h"
#include "task_scheduler.h"

extern "C" {
#include "ff.h"
}

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

void exportClipStems() {
	// A device's card always has one. Stem export makes only the folders inside it, and without it never stops looking
	// for a folder name it can create.
	f_mkdir("SAMPLES");
	stemExport.startStemExportProcess(StemExportType::CLIP);
}

} // namespace webluge
