// Renders the blank song through the virtual audio clock: the metronome's timing (docs/PLAN.md 4.1), a synth note's
// pitch (4.2) and a sample played off its own pitch. The firmware boots once per process, so each scenario runs in its
// own: render_test <scenario>.

#include "boot.h"
#include "card/image.h"
#include "hal/audio.h"
#include "hal/disk.h"
#include "host_allocator.h"
#include "model/clip/clip.h"
#include "model/instrument/melodic_instrument.h"
#include "model/model_stack.h"
#include "model/song/song.h"
#include "playback/playback_handler.h"
#include "render.h"
#include "wav.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <numbers>

extern int16_t zeroMPEValues[];

namespace fs = std::filesystem;

namespace {

int failures = 0;

#define CHECK(condition)                                                                                               \
	do {                                                                                                               \
		if (!(condition)) {                                                                                            \
			std::fprintf(stderr, "%s:%d: CHECK(%s) failed\n", __FILE__, __LINE__, #condition);                         \
			failures++;                                                                                                \
		}                                                                                                              \
	} while (0)

webluge::HostVector<int32_t> played;

fs::path emptyCardFolder() {
	fs::path folder = fs::temp_directory_path() / "webluge_render_test";
	fs::remove_all(folder);
	fs::create_directories(folder);
	return folder;
}

void bootWithCard(const fs::path& folder) {
	static auto image = webluge::buildCardImage(folder);
	if (!image) {
		std::fprintf(stderr, "%s\n", image.error().c_str());
		std::_Exit(1);
	}
	webluge_disk_insert(image->data(), image->size() / WEBLUGE_SECTOR_SIZE);
	webluge::boot();
	webluge_audio_set_sink([](int32_t left, int32_t right, void*) { played.push_back(left); }, nullptr);
}

void bootWithEmptyCard() {
	bootWithCard(emptyCardFolder());
}

void testMetronome() {
	bootWithEmptyCard();
	playbackHandler.metronomeOn = true;
	webluge::startPlayback();
	webluge::run(5 * WEBLUGE_SAMPLE_RATE);

	double beat = (double)currentSong->timePerTimerTickBig * currentSong->getQuarterNoteLength() / 4294967296.0;
	constexpr int32_t kThreshold = 1 << 20;
	constexpr size_t kQuietBefore = 1000;
	webluge::HostVector<size_t> clicks;
	size_t lastLoud = 0;
	bool everLoud = false;
	for (size_t i = 0; i < played.size(); i++) {
		if (std::abs(played[i]) > kThreshold) {
			if (!everLoud || i - lastLoud > kQuietBefore) {
				clicks.push_back(i);
			}
			lastLoud = i;
			everLoud = true;
		}
	}
	std::fprintf(stdout, "metronome: %zu clicks, beat %.3f frames\n", clicks.size(), beat);
	CHECK(clicks.size() >= 9);
	for (size_t i = 1; i < clicks.size(); i++) {
		double interval = (double)(clicks[i] - clicks[i - 1]);
		if (std::abs(interval - beat) > 1) {
			std::fprintf(stderr, "click %zu: %.0f frames after the last\n", i, interval);
			failures++;
		}
	}
}

// Magnitude of a Hann-windowed DFT of the signal at the frequency.
double magnitudeAt(const webluge::HostVector<double>& windowed, double hz) {
	double w = 2 * std::numbers::pi * hz / WEBLUGE_SAMPLE_RATE;
	double re = 0;
	double im = 0;
	for (size_t n = 0; n < windowed.size(); n++) {
		re += windowed[n] * std::cos(w * n);
		im -= windowed[n] * std::sin(w * n);
	}
	return std::hypot(re, im);
}

void testNote() {
	bootWithEmptyCard();
	Output* output = currentSong->firstOutput;
	CHECK(output && output->type == OutputType::SYNTH);
	if (!output || output->type != OutputType::SYNTH) {
		return;
	}

	constexpr int32_t kNote = 60;
	char modelStackMemory[MODEL_STACK_MAX_SIZE];
	ModelStack* modelStack = setupModelStackWithSong(modelStackMemory, currentSong);
	static_cast<MelodicInstrument*>(output)->beginAuditioningForNote(modelStack, kNote, 64, zeroMPEValues);
	size_t noteOn = played.size();
	webluge::run(2 * WEBLUGE_SAMPLE_RATE);

	// A second of the sustain, well clear of the attack.
	size_t start = noteOn + WEBLUGE_SAMPLE_RATE / 2;
	webluge::HostVector<double> windowed(WEBLUGE_SAMPLE_RATE);
	double peak = 0;
	for (size_t n = 0; n < windowed.size(); n++) {
		double hann = 0.5 - 0.5 * std::cos(2 * std::numbers::pi * n / (windowed.size() - 1));
		windowed[n] = hann * played[start + n];
		peak = std::max(peak, std::abs((double)played[start + n]));
	}
	CHECK(peak > (1 << 24));

	// The strongest partial, to the nearest hertz, must be the fundamental...
	double expected = 440 * std::exp2((kNote - 69) / 12.0);
	double strongest = 0;
	double strongestMagnitude = 0;
	for (double hz = 20; hz < 5000; hz += 1) {
		double magnitude = magnitudeAt(windowed, hz);
		if (magnitude > strongestMagnitude) {
			strongest = hz;
			strongestMagnitude = magnitude;
		}
	}
	CHECK(std::abs(strongest - expected) <= 1);

	// ...and its peak within a cent of the note.
	double best = expected;
	double bestMagnitude = 0;
	for (double hz = expected - 2; hz <= expected + 2; hz += 0.005) {
		double magnitude = magnitudeAt(windowed, hz);
		if (magnitude > bestMagnitude) {
			best = hz;
			bestMagnitude = magnitude;
		}
	}
	double cents = 1200 * std::log2(best / expected);
	std::fprintf(stdout, "note: peak %.0f, fundamental %.3f Hz, %+.3f cents from %.3f Hz\n", peak, best, cents,
	             expected);
	CHECK(std::abs(cents) <= 1);
}

// Fundamental of a sustained note (within ±2 Hz of the expected one) to a few thousandths of a hertz, and its RMS level,
// over a second starting half a second after the note-on.
struct Measured {
	double hz;
	double rms;
};

Measured measure(size_t noteOn, double expectedHz) {
	size_t start = noteOn + WEBLUGE_SAMPLE_RATE / 2;
	webluge::HostVector<double> windowed(WEBLUGE_SAMPLE_RATE);
	double sumOfSquares = 0;
	for (size_t n = 0; n < windowed.size(); n++) {
		double hann = 0.5 - 0.5 * std::cos(2 * std::numbers::pi * n / (windowed.size() - 1));
		windowed[n] = hann * played[start + n];
		sumOfSquares += (double)played[start + n] * played[start + n];
	}
	Measured measured{expectedHz, std::sqrt(sumOfSquares / windowed.size())};
	double bestMagnitude = 0;
	for (double hz = expectedHz - 2; hz <= expectedHz + 2; hz += 0.005) {
		double magnitude = magnitudeAt(windowed, hz);
		if (magnitude > bestMagnitude) {
			measured.hz = hz;
			bestMagnitude = magnitude;
		}
	}
	return measured;
}

// A sample synth played at the sample's own pitch reads the sample as it is; played a fifth up, it goes through the
// windowed sinc interpolation. Both must come out at the same level, a fifth apart.
void testSample() {
	constexpr double kSineHz = 441;
	fs::path folder = emptyCardFolder();
	fs::create_directories(folder / "SAMPLES");
	fs::create_directories(folder / "SYNTHS");
	webluge::WavWriter wav(folder / "SAMPLES" / "SINE.WAV");
	for (int32_t n = 0; n < 4 * WEBLUGE_SAMPLE_RATE; n++) {
		int32_t value = std::lround(std::sin(2 * std::numbers::pi * kSineHz * n / WEBLUGE_SAMPLE_RATE) * (1 << 30));
		wav.write(value, value);
	}
	CHECK(wav.close());
	std::ofstream(folder / "SYNTHS" / "SINE.XML") << R"(<?xml version="1.0" encoding="UTF-8"?>
<sound polyphonic="poly" mode="subtractive" lpfMode="24dB" modFXType="none">
	<osc1 type="sample" fileName="SAMPLES/SINE.WAV" />
	<osc2 type="square" />
	<defaultParams oscAVolume="0x7FFFFFFF" oscBVolume="0x80000000" noiseVolume="0x80000000" volume="0x00000000"
		lpfFrequency="0x7FFFFFFF" lpfResonance="0x80000000" hpfFrequency="0x80000000">
		<envelope1 attack="0x80000000" decay="0x00000000" sustain="0x7FFFFFFF" release="0x80000000" />
	</defaultParams>
</sound>
)";
	bootWithCard(folder);
	CHECK(webluge::loadPreset("SYNTHS/SINE.XML"));
	auto* synth = static_cast<MelodicInstrument*>(currentSong->sessionClips.getClipAtIndex(0)->output);

	char modelStackMemory[MODEL_STACK_MAX_SIZE];
	ModelStack* modelStack = setupModelStackWithSong(modelStackMemory, currentSong);
	auto play = [&](int32_t note) {
		synth->beginAuditioningForNote(modelStack, note, 64, zeroMPEValues);
		size_t noteOn = played.size();
		webluge::run(2 * WEBLUGE_SAMPLE_RATE);
		synth->endAuditioningForNote(modelStack, note);
		webluge::run(WEBLUGE_SAMPLE_RATE / 2);
		return noteOn;
	};
	Measured own = measure(play(60), kSineHz);
	Measured fifth = measure(play(67), kSineHz * std::exp2(7 / 12.0));

	double cents = 1200 * std::log2(fifth.hz / own.hz) - 700;
	double db = 20 * std::log10(fifth.rms / own.rms);
	std::fprintf(stdout, "sample: own pitch %.3f Hz at RMS %.0f, a fifth up %+.3f cents and %+.2f dB\n", own.hz,
	             own.rms, cents, db);
	CHECK(own.rms > (1 << 24));
	CHECK(std::abs(cents) <= 1);
	CHECK(std::abs(db) <= 0.5);
}

} // namespace

int main(int argc, char** argv) {
	if (argc == 2 && !std::strcmp(argv[1], "metronome")) {
		testMetronome();
	}
	else if (argc == 2 && !std::strcmp(argv[1], "note")) {
		testNote();
	}
	else if (argc == 2 && !std::strcmp(argv[1], "sample")) {
		testSample();
	}
	else {
		std::fprintf(stderr, "Usage: render_test metronome|note|sample\n");
		failures++;
	}
	std::fprintf(stdout, "%s\n", failures ? "FAILED" : "OK");
	std::fflush(stdout);
	std::fflush(stderr);
	std::_Exit(failures != 0);
}
