// Entry points for the browser build, which previews songs, kits and synths: web/src/preview/worker.ts drives them. The
// firmware boots once per instance, so the page makes a new one for each.

#include "boot.h"
#include "card/image.h"
#include "definitions_cxx.hpp"
#include "gui/colour/rgb.h"
#include "hal/audio.h"
#include "hal/disk.h"
#include "host_allocator.h"
#include "model/clip/audio_clip.h"
#include "model/clip/clip_instance.h"
#include "model/clip/instrument_clip.h"
#include "extern.h"
#include "model/drum/drum.h"
#include "model/instrument/kit.h"
#include "model/instrument/melodic_instrument.h"
#include "model/model_stack.h"
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
webluge::HostVector<int32_t> states;
// Where the arrangement was when the session took over, to go back to.
int32_t arrangementPosLeft = 0;

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
		json += ",\"length\":";
		appendNumber(json, row->loopLengthIfIndependent ? row->loopLengthIfIndependent : clip->loopLength);
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

// The arrangement as the arranger view shows it: a track per output that has clip instances, each coloured as on
// the pads.
void appendTracks(HostString& json) {
	json += "\"tracks\":[";
	bool first = true;
	for (Output* output = currentSong->firstOutput; output; output = output->next) {
		if (!output->clipInstances.getNumElements()) {
			continue;
		}
		json += first ? "{" : ",{";
		first = false;
		json += "\"name\":";
		appendString(json, output->name.get());
		json += ",\"type\":";
		appendString(json, typeName(output->type));
		json += ",\"instances\":[";
		for (int32_t i = 0; i < output->clipInstances.getNumElements(); i++) {
			ClipInstance* instance = output->clipInstances.getElement(i);
			json += i ? ",[" : "[";
			appendNumber(json, instance->pos);
			json += ",";
			appendNumber(json, instance->length);
			json += ",";
			appendColour(json, instance->getColour());
			json += "]";
		}
		json += "]}";
	}
	json += "]";
}

// Where the clip is in its longest row, which may loop independently over longer than the clip. Ignores the row
// playing reversed.
int32_t livePos(Clip* clip) {
	int32_t length = clip->getMaxLength();
	if (clip->type == ClipType::INSTRUMENT && length > clip->loopLength) {
		auto* instrumentClip = static_cast<InstrumentClip*>(clip);
		for (int32_t r = 0; r < instrumentClip->noteRows.getNumElements(); r++) {
			NoteRow* row = instrumentClip->noteRows.getElement(r);
			if (row->loopLengthIfIndependent == length) {
				// Rows only catch up with the clip at their next event.
				int32_t pos = row->lastProcessedPosIfIndependent + instrumentClip->noteRowsNumTicksBehindClip
				              + playbackHandler.getNumSwungTicksInSinceLastActionedSwungTick();
				return pos % length;
			}
		}
	}
	return clip->getLivePos();
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
		description += ",\"length\":";
		appendNumber(description, clip->getMaxLength());
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
	description += "],";
	appendTracks(description);
	description += "}";
}

// As the device does when a session view pad is pressed while the arrangement plays. The clips the arrangement was
// playing play on in the session.
// The device's own test: the flag is left set once the switch is done.
bool switchingToArrangement() {
	return currentPlaybackMode == &session && session.launchEventAtSwungTickCount
	       && session.switchToArrangementAtLaunchEvent;
}

bool switchedToSession() {
	if (!playbackHandler.playbackState || currentPlaybackMode != &arrangement) {
		return false;
	}
	arrangementPosLeft = arrangement.getLivePos();
	playbackHandler.switchToSession();
	return true;
}

Clip* sessionClip(int32_t index) {
	if (index < 0 || index >= currentSong->sessionClips.getNumElements()) {
		return nullptr;
	}
	return currentSong->sessionClips.getClipAtIndex(index);
}

// Builds a card image from a folder in the in-memory filesystem and boots with it.
bool boot(const char* cardFolder) {
	auto image = webluge::buildCardImage(cardFolder);
	if (!image) {
		std::fprintf(stderr, "%s\n", image.error().c_str());
		return false;
	}
	card = std::move(*image);
	webluge_disk_insert(card.data(), card.size() / WEBLUGE_SECTOR_SIZE);
	webluge::boot();
	webluge_audio_set_sink(collect, nullptr);
	return true;
}

} // namespace

extern "C" {

// Boots with a card folder and loads a song. Returns the number of audio files the song uses that aren't on the
// card, or -1 if it didn't load.
EMSCRIPTEN_KEEPALIVE int32_t webluge_web_load(const char* cardFolder, const char* songPath) {
	if (!boot(cardFolder) || !webluge::loadSong(songPath)) {
		return -1;
	}
	return webluge::reportSong();
}

// Boots with a card folder and loads a kit or synth into the blank song, to audition. Returns as webluge_web_load.
EMSCRIPTEN_KEEPALIVE int32_t webluge_web_load_preset(const char* cardFolder, const char* presetPath) {
	if (!boot(cardFolder) || !webluge::loadPreset(presetPath)) {
		return -1;
	}
	return webluge::reportSong();
}

EMSCRIPTEN_KEEPALIVE void webluge_web_play() {
	webluge::startPlayback();
}

// As holding an audition pad of the preset's clip, the song's only one: a kit's drum, by its row, or a synth's note.
EMSCRIPTEN_KEEPALIVE void webluge_web_audition(int32_t y, bool on) {
	auto* clip = static_cast<InstrumentClip*>(currentSong->sessionClips.getClipAtIndex(0));
	char modelStackMemory[MODEL_STACK_MAX_SIZE];
	ModelStack* modelStack = setupModelStackWithSong(modelStackMemory, currentSong);
	if (clip->output->type == OutputType::KIT) {
		auto* kit = static_cast<Kit*>(clip->output);
		NoteRow* row = y >= 0 && y < clip->noteRows.getNumElements() ? clip->noteRows.getElement(y) : nullptr;
		if (!row || !row->drum) {
			return;
		}
		ModelStackWithNoteRow* modelStackWithNoteRow =
		    modelStack->addTimelineCounter(clip)->addNoteRow(clip->getNoteRowId(row, y), row);
		if (on) {
			kit->beginAuditioningforDrum(modelStackWithNoteRow, row->drum, kit->defaultVelocity, zeroMPEValues);
		}
		else {
			kit->endAuditioningForDrum(modelStackWithNoteRow, row->drum);
		}
	}
	else if (clip->output->type == OutputType::SYNTH) {
		auto* synth = static_cast<MelodicInstrument*>(clip->output);
		if (on) {
			synth->beginAuditioningForNote(modelStack, y, synth->defaultVelocity, zeroMPEValues);
		}
		else {
			synth->endAuditioningForNote(modelStack, y);
		}
	}
}

// The song's session clips and their notes, and its arrangement, as JSON, valid until the next call. Call after
// play, which decides whether the song plays its arrangement; webluge_web_description_length says how many bytes.
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
// (shift on the device). While the arrangement plays, it only switches to the session, as on the device.
EMSCRIPTEN_KEEPALIVE void webluge_web_toggle_clip(int32_t index, bool instant) {
	if (switchedToSession()) {
		return;
	}
	if (Clip* clip = sessionClip(index)) {
		session.toggleClipStatus(clip, &index, instant, kInternalButtonPressLatency);
	}
}

EMSCRIPTEN_KEEPALIVE void webluge_web_solo_clip(int32_t index) {
	if (switchedToSession()) {
		return;
	}
	if (Clip* clip = sessionClip(index)) {
		session.soloClipAction(clip, kInternalButtonPressLatency);
	}
}

EMSCRIPTEN_KEEPALIVE void webluge_web_switch_to_session() {
	switchedToSession();
}

// Back to the arrangement from where it was left, once the longest clip playing reaches the end of its loop, as with
// the device's switch from session to arranger.
EMSCRIPTEN_KEEPALIVE void webluge_web_switch_to_arrangement() {
	if (playbackHandler.playbackState && currentPlaybackMode == &session && !switchingToArrangement()) {
		playbackHandler.arrangementPosToStartAtOnSwitch = arrangementPosLeft;
		session.armForSwitchToArrangement();
	}
}

// The playback state (kPlaying and so on) and the arrangement's position in ticks, then for each session clip its
// position and its state (kClipActive and so on), valid until the next call.
EMSCRIPTEN_KEEPALIVE int32_t* webluge_web_states() {
	constexpr int32_t kPlaying = 1, kArrangement = 2, kSwitchingToArrangement = 4;
	constexpr int32_t kClipActive = 1, kClipArmed = 2, kClipSoloing = 4;
	bool playing = playbackHandler.isEitherClockActive();
	bool inArrangement = currentPlaybackMode == &arrangement;
	states.clear();
	states.push_back((playing ? kPlaying : 0) | (inArrangement ? kArrangement : 0)
	                 | (switchingToArrangement() ? kSwitchingToArrangement : 0));
	if (!inArrangement) {
		states.push_back(arrangementPosLeft);
	}
	else {
		states.push_back(playing ? arrangement.getLivePos() : arrangement.lastProcessedPos);
	}
	for (int32_t c = 0; c < currentSong->sessionClips.getNumElements(); c++) {
		Clip* clip = currentSong->sessionClips.getClipAtIndex(c);
		states.push_back(livePos(clip));
		states.push_back((currentSong->isClipActive(clip) ? kClipActive : 0)
		                 | (clip->armState != ArmState::OFF ? kClipArmed : 0)
		                 | (clip->soloingInSessionMode ? kClipSoloing : 0));
	}
	return states.data();
}

// Audio frames per tick at the current tempo, to move play heads on between states.
EMSCRIPTEN_KEEPALIVE float webluge_web_frames_per_tick() {
	return playbackHandler.getTimePerInternalTickFloat();
}
}
