// Entry points for the browser build, which previews songs: web/src/preview/worker.ts drives them. The firmware boots
// once per instance, so the page makes a new one for each song.

#include "boot.h"
#include "card/image.h"
#include "definitions_cxx.hpp"
#include "gui/colour/rgb.h"
#include "hal/audio.h"
#include "hal/disk.h"
#include "host_allocator.h"
#include "model/clip/audio_clip.h"
#include "model/clip/instrument_clip.h"
#include "model/drum/drum.h"
#include "model/note/note.h"
#include "model/note/note_row.h"
#include "model/output.h"
#include "model/sample/sample.h"
#include "model/song/song.h"
#include "playback/mode/arrangement.h"
#include "playback/mode/session.h"
#include "playback/playback_handler.h"
#include "processing/sound/sound_drum.h"
#include "render.h"
#include <cstdio>
#include <emscripten/emscripten.h>
#include <string>

namespace {

using HostString = std::basic_string<char, std::char_traits<char>, webluge::HostAllocator<char>>;

webluge::CardImage card;
// Interleaved stereo.
webluge::HostVector<float> rendered;
HostString description;
webluge::HostVector<int32_t> clipStates;

void collect(int32_t left, int32_t right, void*) {
	rendered.push_back(left / 2147483648.f);
	rendered.push_back(right / 2147483648.f);
}

// Names are in code page 437, as on the card, and go out as they are: the page decodes the JSON's bytes as that.
void appendString(HostString& json, const char* text) {
	json += '"';
	for (const char* c = text; *c; c++) {
		if (*c == '"' || *c == '\\') {
			json += '\\';
		}
		if (static_cast<uint8_t>(*c) >= 0x20) {
			json += *c;
		}
	}
	json += '"';
}

void appendColour(HostString& json, RGB colour) {
	char hex[10];
	std::snprintf(hex, sizeof hex, "\"#%02x%02x%02x\"", colour.r, colour.g, colour.b);
	json += hex;
}

void appendNumber(HostString& json, int64_t number) {
	json += std::to_string(number).c_str();
}

const char* typeName(OutputType type) {
	switch (type) {
	case OutputType::SYNTH:
		return "synth";
	case OutputType::KIT:
		return "kit";
	case OutputType::MIDI_OUT:
		return "midi";
	case OutputType::CV:
		return "cv";
	case OutputType::AUDIO:
		return "audio";
	default:
		return "none";
	}
}

const char* drumName(Drum* drum) {
	if (!drum) {
		return "";
	}
	switch (drum->type) {
	case DrumType::SOUND:
		return static_cast<SoundDrum*>(drum)->name.get();
	case DrumType::MIDI:
		return "MIDI";
	case DrumType::GATE:
		return "Gate";
	}
	return "";
}

// Rows as the clip view shows them, bottom first, coloured as on the pads.
void appendRows(HostString& json, InstrumentClip* clip) {
	json += "\"rows\":[";
	for (int32_t r = 0; r < clip->noteRows.getNumElements(); r++) {
		NoteRow* row = clip->noteRows.getElement(r);
		json += r ? ",{" : "{";
		json += "\"y\":";
		appendNumber(json, row->y);
		json += ",\"name\":";
		appendString(json, drumName(row->drum));
		json += ",\"muted\":";
		json += row->muted ? "true" : "false";
		json += ",\"colour\":";
		appendColour(json, clip->getMainColourFromY(row->y, row->getColourOffset(clip)));
		json += ",\"notes\":[";
		for (int32_t n = 0; n < row->notes.getNumElements(); n++) {
			Note* note = row->notes.getElement(n);
			json += n ? ",[" : "[";
			appendNumber(json, note->pos);
			json += ",";
			appendNumber(json, note->length);
			json += ",";
			appendNumber(json, note->velocity);
			json += "]";
		}
		json += "]}";
	}
	json += "]";
}

void appendSample(HostString& json, AudioClip* clip) {
	SampleHolder& holder = clip->sampleHolder;
	auto* sample = static_cast<Sample*>(holder.audioFile);
	json += "\"sample\":{\"path\":";
	// Where the firmware found it, which may be the song's own folder rather than the path in the song.
	appendString(json, sample ? sample->filePath.get() : holder.filePath.get());
	json += ",\"start\":";
	appendNumber(json, holder.startPos);
	json += ",\"end\":";
	appendNumber(json, sample ? holder.getEndPos() : holder.endPos);
	json += ",\"rate\":";
	appendNumber(json, sample ? sample->sampleRate : 0);
	json += "}";
}

void describeSong() {
	description = "{\"arrangement\":";
	description += currentPlaybackMode == &arrangement ? "true" : "false";
	description += ",\"ticksPerQuarterNote\":";
	appendNumber(description, currentSong->getQuarterNoteLength());
	description += ",\"clips\":[";
	for (int32_t c = 0; c < currentSong->sessionClips.getNumElements(); c++) {
		Clip* clip = currentSong->sessionClips.getClipAtIndex(c);
		description += c ? ",{" : "{";
		description += "\"name\":";
		appendString(description, clip->clipName.get());
		description += ",\"output\":";
		appendString(description, clip->output->name.get());
		description += ",\"type\":";
		appendString(description, typeName(clip->output->type));
		description += ",\"section\":";
		appendNumber(description, clip->section);
		description += ",\"loopLength\":";
		appendNumber(description, clip->loopLength);
		description += ",\"colour\":";
		if (clip->type == ClipType::AUDIO) {
			appendColour(description, static_cast<AudioClip*>(clip)->getColour());
			description += ",";
			appendSample(description, static_cast<AudioClip*>(clip));
		}
		else {
			appendColour(description, static_cast<InstrumentClip*>(clip)->getMainColourFromY(0, 0));
			description += ",";
			appendRows(description, static_cast<InstrumentClip*>(clip));
		}
		description += "}";
	}
	description += "]}";
}

Clip* sessionClip(int32_t index) {
	if (index < 0 || index >= currentSong->sessionClips.getNumElements()) {
		return nullptr;
	}
	return currentSong->sessionClips.getClipAtIndex(index);
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

// The song's session clips and their notes, as JSON, valid until the next call. Call after play, which decides
// whether the song plays its arrangement; webluge_web_description_length says how many bytes.
EMSCRIPTEN_KEEPALIVE const char* webluge_web_describe() {
	describeSong();
	return description.data();
}

EMSCRIPTEN_KEEPALIVE uint32_t webluge_web_description_length() {
	return description.size();
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

// As pressing a clip's pad in session view: it starts or stops at the end of its loop, or straight away if instant
// (shift on the device).
EMSCRIPTEN_KEEPALIVE void webluge_web_toggle_clip(int32_t index, bool instant) {
	if (Clip* clip = sessionClip(index)) {
		session.toggleClipStatus(clip, &index, instant, kInternalButtonPressLatency);
	}
}

EMSCRIPTEN_KEEPALIVE void webluge_web_solo_clip(int32_t index) {
	if (Clip* clip = sessionClip(index)) {
		session.soloClipAction(clip, kInternalButtonPressLatency);
	}
}

// For each session clip, its position in ticks and its state (kClipActive and so on), valid until the next call.
EMSCRIPTEN_KEEPALIVE int32_t* webluge_web_clip_states() {
	constexpr int32_t kClipActive = 1, kClipArmed = 2, kClipSoloing = 4;
	clipStates.clear();
	for (int32_t c = 0; c < currentSong->sessionClips.getNumElements(); c++) {
		Clip* clip = currentSong->sessionClips.getClipAtIndex(c);
		clipStates.push_back(clip->getLivePos());
		clipStates.push_back((currentSong->isClipActive(clip) ? kClipActive : 0)
		                     | (clip->armState != ArmState::OFF ? kClipArmed : 0)
		                     | (clip->soloingInSessionMode ? kClipSoloing : 0));
	}
	return clipStates.data();
}

// Audio frames per tick at the current tempo, to move play heads on between states.
EMSCRIPTEN_KEEPALIVE float webluge_web_frames_per_tick() {
	return playbackHandler.getTimePerInternalTickFloat();
}
}
