// Entry points for the browser build, which previews songs: web/src/preview/worker.ts drives them. The firmware boots
// once per instance, so the page makes a new one for each song.

#include "boot.h"
#include "card/image.h"
#include "hal/audio.h"
#include "hal/disk.h"
#include "host_allocator.h"
#include "render.h"
#include <cstdio>
#include <emscripten/emscripten.h>

namespace {

webluge::CardImage card;
// Interleaved stereo.
webluge::HostVector<float> rendered;

void collect(int32_t left, int32_t right, void*) {
	rendered.push_back(left / 2147483648.f);
	rendered.push_back(right / 2147483648.f);
}

} // namespace

extern "C" {

// Builds a card image from a folder in the in-memory filesystem, boots with it and loads a song. Returns the number
// of audio files the song uses that aren't on the card, or -1 if it didn't load.
EMSCRIPTEN_KEEPALIVE int32_t webluge_web_load(const char* cardFolder, const char* songPath) {
	auto image = webluge::buildCardImage(cardFolder);
	if (!image) {
		std::fprintf(stderr, "%s\n", image.error().c_str());
		return -1;
	}
	card = std::move(*image);
	webluge_disk_insert(card.data(), card.size() / WEBLUGE_SECTOR_SIZE);
	webluge::boot();
	if (!webluge::loadSong(songPath)) {
		return -1;
	}
	return webluge::reportSong();
}

EMSCRIPTEN_KEEPALIVE void webluge_web_play() {
	webluge_audio_set_sink(collect, nullptr);
	webluge::startPlayback();
}

// Plays the song on for at least this many frames: the codec plays in blocks, so it may overshoot. Returns the
// frames played as interleaved stereo, valid until the next call; webluge_web_rendered_frames says how many.
EMSCRIPTEN_KEEPALIVE float* webluge_web_render(uint32_t numFrames) {
	rendered.clear();
	rendered.reserve(2 * (numFrames + 32));
	webluge::run(numFrames);
	return rendered.data();
}

EMSCRIPTEN_KEEPALIVE uint32_t webluge_web_rendered_frames() {
	return rendered.size() / 2;
}
}
