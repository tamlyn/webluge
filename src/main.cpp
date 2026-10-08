// The webluge command line.

#include "boot.h"
#include "card/image.h"
#include "hal/audio.h"
#include "hal/disk.h"
#include "render.h"
#include "wav.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>

namespace fs = std::filesystem;

namespace {

int usage() {
	std::fprintf(stderr, "Usage:\n"
	                     "  webluge image <card folder> <image file>\n"
	                     "      Build a card image from a copy of an SD card.\n"
	                     "  webluge load <card folder or image> <song>\n"
	                     "      Boot with the card inserted and load a song, e.g. SONGS/SONG001.XML.\n");
	return 2;
}

std::expected<webluge::CardImage, std::string> readCard(const fs::path& path,
                                                       uint64_t freeBytes = webluge::kDefaultFreeBytes) {
	std::error_code error;
	if (fs::is_directory(path, error)) {
		return webluge::buildCardImage(path, freeBytes);
	}
	uintmax_t size = fs::file_size(path, error);
	if (error || !size || size % WEBLUGE_SECTOR_SIZE) {
		return std::unexpected(path.string() + ": not a card image");
	}
	webluge::CardImage image(size);
	std::ifstream in(path, std::ios::binary);
	if (!in.read(reinterpret_cast<char*>(image.data()), size)) {
		return std::unexpected(path.string() + ": can't read");
	}
	return image;
}

int image(const char* folder, const char* imagePath) {
	auto image = webluge::buildCardImage(folder);
	if (!image) {
		std::fprintf(stderr, "%s\n", image.error().c_str());
		return 1;
	}
	std::ofstream out(imagePath, std::ios::binary);
	out.write(reinterpret_cast<const char*>(image->data()), image->size());
	if (!out) {
		std::fprintf(stderr, "%s: can't write\n", imagePath);
		return 1;
	}
	return 0;
}

bool bootAndLoad(const char* cardPath, const char* songPath, webluge::CardImage& card, uint64_t freeBytes) {
	auto read = readCard(cardPath, freeBytes);
	if (!read) {
		std::fprintf(stderr, "%s\n", read.error().c_str());
		return false;
	}
	card = std::move(*read);
	webluge_disk_insert(card.data(), card.size() / WEBLUGE_SECTOR_SIZE);
	webluge::boot();
	if (!webluge::loadSong(songPath)) {
		std::fprintf(stderr, "Couldn't load %s\n", songPath);
		return false;
	}
	// A render without every audio file wouldn't match the device's.
	return webluge::reportSong() == 0;
}

int load(const char* cardPath, const char* songPath) {
	webluge::CardImage card;
	return bootAndLoad(cardPath, songPath, card, webluge::kDefaultFreeBytes) ? 0 : 1;
}

int render(const char* cardPath, const char* songPath, const char* wavPath, const char* secondsText) {
	char* end;
	double seconds = std::strtod(secondsText, &end);
	if (*end || !(seconds > 0)) {
		return usage();
	}
	webluge::CardImage card;
	if (!bootAndLoad(cardPath, songPath, card, webluge::kDefaultFreeBytes)) {
		return 1;
	}
	webluge::WavWriter wav(wavPath);
	webluge_audio_set_sink(
	    [](int32_t left, int32_t right, void* context) { static_cast<webluge::WavWriter*>(context)->write(left, right); },
	    &wav);
	webluge::startPlayback();
	webluge::run(seconds * WEBLUGE_SAMPLE_RATE);
	webluge_audio_set_sink(nullptr, nullptr);
	if (!wav.close()) {
		std::fprintf(stderr, "%s: can't write\n", wavPath);
		return 1;
	}
	return 0;
}

int exportStems(const char* cardPath, const char* songPath, const char* folder, bool includeSongFX) {
	// Room for the stems.
	constexpr uint64_t kExportBytes = 256 << 20;
	webluge::CardImage card;
	if (!bootAndLoad(cardPath, songPath, card, kExportBytes)) {
		return 1;
	}
	webluge::exportClipStems(includeSongFX);
	auto copied = webluge::copyFromCard("SAMPLES/EXPORTS", folder);
	if (!copied) {
		std::fprintf(stderr, "%s\n", copied.error().c_str());
		return 1;
	}
	return 0;
}

int run(int argc, char** argv) {
	if (argc == 4 && !std::strcmp(argv[1], "image")) {
		return image(argv[2], argv[3]);
	}
	if (argc == 4 && !std::strcmp(argv[1], "load")) {
		return load(argv[2], argv[3]);
	}
	if (argc == 6 && !std::strcmp(argv[1], "render")) {
		return render(argv[2], argv[3], argv[4], argv[5]);
	}
	if (argc == 5 && !std::strcmp(argv[1], "export")) {
		return exportStems(argv[2], argv[3], argv[4], false);
	}
	if (argc == 6 && !std::strcmp(argv[1], "export") && !std::strcmp(argv[2], "--song-fx")) {
		return exportStems(argv[3], argv[4], argv[5], true);
	}
	return usage();
}

} // namespace

int main(int argc, char** argv) {
	int status = run(argc, argv);
	// The device never tears its globals down, and they can't be: the memory allocator is destroyed before objects
	// that free memory through it.
	std::fflush(stdout);
	std::fflush(stderr);
	std::_Exit(status);
}
