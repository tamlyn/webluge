// Booting follows deluge_main (deluge.cpp) but leaves out the steps that only configure hardware: deluge_main starts
// by reading DMA registers, so it can't run here as is. When upgrading the firmware, compare boot() with deluge_main
// for new initialisation steps.

#include "boot.h"
#include "definitions_cxx.hpp"
#include "gui/ui/load/load_song_ui.h"
#include "gui/ui/ui.h"
#include "gui/ui_timer_manager.h"
#include "hid/display/display.h"
#include "hid/encoders.h"
#include "host_display.h"
#include "io/midi/midi_device_manager.h"
#include "io/midi/midi_follow.h"
#include "model/clip/audio_clip.h"
#include "model/instrument/kit.h"
#include "model/settings/runtime_feature_settings.h"
#include "model/song/clip_iterators.h"
#include "model/song/song.h"
#include "playback/mode/session.h"
#include "processing/engines/audio_engine.h"
#include "processing/engines/cv_engine.h"
#include "processing/sound/sound_drum.h"
#include "processing/sound/sound_instrument.h"
#include "storage/audio/audio_file_holder.h"
#include "storage/audio/audio_file_manager.h"
#include "storage/flash_storage.h"
#include "storage/multi_range/multi_range.h"
#include "storage/storage_manager.h"
#include "util/functions.h"
#include "util/pack.h"
#include <cstdio>

void setupBlankSong();
void registerTasks();

namespace webluge {
namespace {

HostDisplay* hostDisplay;

int32_t reportIfMissing(AudioFileHolder* holder) {
	if (holder->filePath.isEmpty() || holder->audioFile) {
		return 0;
	}
	std::fprintf(stderr, "Missing %s\n", holder->filePath.get());
	return 1;
}

int32_t reportMissingAudioFiles(Sound* sound) {
	int32_t numMissing = 0;
	for (Source& source : sound->sources) {
		if (source.oscType == OscType::SAMPLE || source.oscType == OscType::WAVETABLE) {
			for (int32_t i = 0; i < source.ranges.getNumElements(); i++) {
				numMissing += reportIfMissing(source.ranges.getElement(i)->getAudioFileHolder());
			}
		}
	}
	return numMissing;
}

// The device carries on without a missing sample, which goes quiet, so the song loads without an error. Finds them
// the way Song::loadAllSamples does.
int32_t reportMissingAudioFiles() {
	int32_t numMissing = 0;
	for (Output* output = currentSong->firstOutput; output; output = output->next) {
		if (output->type == OutputType::SYNTH) {
			numMissing += reportMissingAudioFiles(static_cast<SoundInstrument*>(output));
		}
		else if (output->type == OutputType::KIT) {
			for (Drum* drum = static_cast<Kit*>(output)->firstDrum; drum; drum = drum->next) {
				if (drum->type == DrumType::SOUND) {
					numMissing += reportMissingAudioFiles(static_cast<SoundDrum*>(drum));
				}
			}
		}
	}
	for (Clip* clip : AllClips::everywhere(currentSong)) {
		if (clip->type == ClipType::AUDIO) {
			numMissing += reportIfMissing(&static_cast<AudioClip*>(clip)->sampleHolder);
		}
	}
	return numMissing;
}

} // namespace

void boot() {
	functionsInit();
	currentPlaybackMode = &session;
	display = hostDisplay = new HostDisplay;
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

	runtimeFeatureSettings.readSettingsFromFile(storageManager);
	MIDIDeviceManager::readDevicesFromFile(storageManager);
	midiFollow.readDefaultsFromFile(storageManager);
	setupBlankSong();

	uiTimerManager.setTimer(TimerName::GRAPHICS_ROUTINE, 50);
	registerTasks();
}

// As setupStartupSong does, so the song loads through the same UI path as on the device.
bool loadSong(const char* path) {
	// Otherwise the browser would pick the nearest song.
	if (!storageManager.fileExists(path)) {
		std::fprintf(stderr, "%s: not on the card\n", path);
		return false;
	}
	currentSong->setSongFullPath(path);
	if (!openUI(&loadSongUI)) {
		return false;
	}
	loadSongUI.performLoad(storageManager);
	return hostDisplay->errorCount() == 0;
}

int32_t reportSong() {
	int32_t numMissing = reportMissingAudioFiles();
	std::fprintf(stdout, "Loaded %s: %d clips, %d instruments, %d audio files, %d missing\n", currentSong->name.get(),
	             (int)(currentSong->sessionClips.getNumElements() + currentSong->arrangementOnlyClips.getNumElements()),
	             (int)currentSong->getNumOutputs(), (int)audioFileManager.audioFiles.getNumElements(), (int)numMissing);
	return numMissing;
}

} // namespace webluge
