// Renders the blank song through the virtual audio clock: the metronome's timing (PLAN.md 4.1) and a synth note's
// pitch (4.2). The firmware boots once per process, so each scenario runs in its own: render_test <scenario>.

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
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
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

void bootWithEmptyCard() {
	fs::path folder = fs::temp_directory_path() / "webluge_render_test";
	fs::remove_all(folder);
	fs::create_directories(folder);
	static auto image = webluge::buildCardImage(folder);
	if (!image) {
		std::fprintf(stderr, "%s\n", image.error().c_str());
		std::_Exit(1);
	}
	webluge_disk_insert(image->data(), image->size() / WEBLUGE_SECTOR_SIZE);
	webluge::boot();
	webluge_audio_set_sink([](int32_t left, int32_t right, void*) { played.push_back(left); }, nullptr);
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

} // namespace

int main(int argc, char** argv) {
	if (argc == 2 && !std::strcmp(argv[1], "metronome")) {
		testMetronome();
	}
	else if (argc == 2 && !std::strcmp(argv[1], "note")) {
		testNote();
	}
	else {
		std::fprintf(stderr, "Usage: render_test metronome|note\n");
		failures++;
	}
	std::fprintf(stdout, "%s\n", failures ? "FAILED" : "OK");
	std::fflush(stdout);
	std::fflush(stderr);
	std::_Exit(failures != 0);
}
