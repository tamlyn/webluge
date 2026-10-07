// Boots the firmware on the host. This follows deluge_main (deluge.cpp) but leaves out the steps that only
// configure hardware: deluge_main starts by reading DMA registers, so it can't run here as is. When upgrading
// the firmware, compare this with deluge_main for new initialisation steps.

#include "definitions_cxx.hpp"
#include "host_display.h"
#include "hid/display/display.h"
#include "hid/encoders.h"
#include "model/settings/runtime_feature_settings.h"
#include "model/song/song.h"
#include "playback/mode/session.h"
#include "processing/engines/audio_engine.h"
#include "processing/engines/cv_engine.h"
#include "storage/audio/audio_file_manager.h"
#include "storage/flash_storage.h"
#include "util/functions.h"
#include "util/pack.h"
#include <cstdio>
#include <cstdlib>

void setupBlankSong();

int main() {
	functionsInit();
	currentPlaybackMode = &session;
	display = new HostDisplay;
	deluge::hid::encoders::init();
	init_crc_table();
	cvEngine.init();
	AudioEngine::init();
	audioFileManager.init();
	FlashStorage::readSettings();
	runtimeFeatureSettings.init();

	// What inputRoutine would set from the jack-detect pins, given the jacks the GPIO layer reports.
	AudioEngine::headphonesPluggedIn = true;
	AudioEngine::renderInStereo = true;

	setupBlankSong();
	std::printf("Blank song set up: %d bpm\n", (int)currentSong->calculateBPM());
	// The device never tears its globals down, and they can't be: the memory allocator is destroyed before
	// objects that free memory through it.
	std::fflush(stdout);
	std::_Exit(0);
}
