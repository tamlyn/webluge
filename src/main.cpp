// The webluge command line.

#include "boot.h"
#include "card/image.h"
#include "hal/disk.h"
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

std::expected<webluge::CardImage, std::string> readCard(const fs::path& path) {
	std::error_code error;
	if (fs::is_directory(path, error)) {
		return webluge::buildCardImage(path);
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

int load(const char* cardPath, const char* songPath) {
	auto card = readCard(cardPath);
	if (!card) {
		std::fprintf(stderr, "%s\n", card.error().c_str());
		return 1;
	}
	webluge_disk_insert(card->data(), card->size() / WEBLUGE_SECTOR_SIZE);
	webluge::boot();
	if (!webluge::loadSong(songPath)) {
		std::fprintf(stderr, "Couldn't load %s\n", songPath);
		return 1;
	}
	return webluge::reportSong() ? 1 : 0;
}

int run(int argc, char** argv) {
	if (argc == 4 && !std::strcmp(argv[1], "image")) {
		return image(argv[2], argv[3]);
	}
	if (argc == 4 && !std::strcmp(argv[1], "load")) {
		return load(argv[2], argv[3]);
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
