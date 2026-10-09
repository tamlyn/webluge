// Checks the in-memory card (docs/PLAN.md 3.1) and the card image builder (3.2) through FatFs, including the raw
// cluster reads that sample streaming uses.

#include "card/image.h"
#include "hal/disk.h"
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <string>
#include <vector>

extern "C" {
#include "diskio.h"
#include "ff.h"
DWORD get_fat_from_fs(FATFS* fs, DWORD clst);
LBA_t clst2sect(FATFS* fs, DWORD clst);
DRESULT disk_read_without_streaming_first(BYTE pdrv, BYTE* buff, DWORD sector, UINT count);
}

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

std::vector<uint8_t> pattern(size_t size, uint32_t seed) {
	std::vector<uint8_t> data(size);
	for (uint8_t& byte : data) {
		seed = seed * 1664525 + 1013904223;
		byte = seed >> 24;
	}
	return data;
}

std::vector<uint8_t> readFile(const char* path) {
	FIL file;
	if (f_open(&file, path, FA_READ) != FR_OK) {
		return {};
	}
	std::vector<uint8_t> data(f_size(&file));
	UINT read = 0;
	f_read(&file, data.data(), data.size(), &read);
	f_close(&file);
	data.resize(read);
	return data;
}

// Reads a file the way the firmware streams samples: follow its cluster chain and read each cluster's sectors.
std::vector<uint8_t> readClusters(FATFS* fileSystem, const char* path) {
	FIL file;
	if (f_open(&file, path, FA_READ) != FR_OK) {
		return {};
	}
	size_t size = f_size(&file);
	DWORD cluster = file.obj.sclust;
	f_close(&file);
	size_t clusterBytes = fileSystem->csize * WEBLUGE_SECTOR_SIZE;
	std::vector<uint8_t> data;
	while (data.size() < size) {
		LBA_t sector = clst2sect(fileSystem, cluster);
		if (!sector) {
			return {};
		}
		data.resize(data.size() + clusterBytes);
		if (disk_read_without_streaming_first(0, data.data() + data.size() - clusterBytes, sector, fileSystem->csize)
		    != RES_OK) {
			return {};
		}
		cluster = get_fat_from_fs(fileSystem, cluster);
	}
	data.resize(size);
	return data;
}

const size_t kSizes[] = {0, 1, 511, 512, 32767, 32768, 32769, 100000, (1 << 20) + 3};

void testDisk() {
	webluge::CardImage image(64 << 20);
	webluge_disk_insert(image.data(), image.size() / WEBLUGE_SECTOR_SIZE);

	MKFS_PARM options{.fmt = FM_FAT | FM_FAT32 | FM_SFD, .n_fat = 2, .align = 0, .n_root = 0, .au_size = 32768};
	webluge::HostVector<uint8_t> work(32768);
	CHECK(f_mkfs("", &options, work.data(), work.size()) == FR_OK);

	FATFS fileSystem;
	CHECK(f_mount(&fileSystem, "", 1) == FR_OK);
	CHECK(fileSystem.csize * WEBLUGE_SECTOR_SIZE == 32768);
	CHECK(f_mkdir("SAMPLES") == FR_OK);

	std::map<std::string, std::vector<uint8_t>> files;
	for (size_t size : kSizes) {
		std::string path = "SAMPLES/file " + std::to_string(size) + ".wav";
		files[path] = pattern(size, size);
		FIL file;
		UINT written = 0;
		CHECK(f_open(&file, path.c_str(), FA_WRITE | FA_CREATE_NEW) == FR_OK);
		CHECK(f_write(&file, files[path].data(), size, &written) == FR_OK && written == size);
		CHECK(f_close(&file) == FR_OK);
	}

	// Remount, so reads come from the image rather than FatFs's buffers.
	f_mount(nullptr, "", 0);
	CHECK(f_mount(&fileSystem, "", 1) == FR_OK);
	for (const auto& [path, data] : files) {
		CHECK(readFile(path.c_str()) == data);
		CHECK(readClusters(&fileSystem, path.c_str()) == data);
	}

	std::vector<uint8_t> sector(WEBLUGE_SECTOR_SIZE);
	LBA_t numSectors = image.size() / WEBLUGE_SECTOR_SIZE;
	CHECK(disk_read_without_streaming_first(0, sector.data(), numSectors - 1, 1) == RES_OK);
	CHECK(disk_read_without_streaming_first(0, sector.data(), numSectors, 1) == RES_ERROR);
	CHECK(disk_read_without_streaming_first(0, sector.data(), numSectors - 1, 2) == RES_ERROR);

	f_mount(nullptr, "", 0);
	webluge_disk_eject();
	CHECK(disk_status(0) & STA_NODISK);
}

void writeHostFile(const fs::path& path, const std::vector<uint8_t>& data) {
	fs::create_directories(path.parent_path());
	std::ofstream(path, std::ios::binary).write(reinterpret_cast<const char*>(data.data()), data.size());
}

void testImageBuilder() {
	fs::path folder = fs::temp_directory_path() / "webluge_storage_test";
	fs::remove_all(folder);
	std::map<std::string, std::vector<uint8_t>> files{
	    {"SONGS/SONG001.XML", pattern(4000, 1)},
	    {"SAMPLES/DRUMS/Kick.wav", pattern(70000, 2)},
	    {"SAMPLES/Caf\xc3\xa9.wav", pattern(10, 3)},
	};
	for (const auto& [path, data] : files) {
		writeHostFile(folder / path, data);
	}
	writeHostFile(folder / ".DS_Store", pattern(10, 4));
	writeHostFile(folder / "SAMPLES/\xe0\xb8\x82.wav", pattern(10, 5)); // Thai, not in code page 437
	fs::create_directories(folder / "SYNTHS");

	auto image = webluge::buildCardImage(folder);
	CHECK(image.has_value());
	if (!image) {
		std::fprintf(stderr, "%s\n", image.error().c_str());
		return;
	}
	webluge_disk_insert(image->data(), image->size() / WEBLUGE_SECTOR_SIZE);
	FATFS fileSystem;
	CHECK(f_mount(&fileSystem, "", 1) == FR_OK);
	CHECK(fileSystem.csize * WEBLUGE_SECTOR_SIZE == 32768);
	for (const auto& [path, data] : files) {
		std::string cardPath = path == "SAMPLES/Caf\xc3\xa9.wav" ? "SAMPLES/Caf\x82.wav" : path;
		CHECK(readClusters(&fileSystem, cardPath.c_str()) == data);
	}
	FILINFO info;
	CHECK(f_stat("SYNTHS", &info) == FR_OK && (info.fattrib & AM_DIR));
	CHECK(f_stat(".DS_Store", &info) == FR_NO_FILE);

	DIR dir;
	int numSamples = 0;
	CHECK(f_opendir(&dir, "SAMPLES") == FR_OK);
	while (f_readdir(&dir, &info) == FR_OK && info.fname[0]) {
		numSamples++;
	}
	f_closedir(&dir);
	CHECK(numSamples == 2); // DRUMS and Café.wav

	f_mount(nullptr, "", 0);
	webluge_disk_eject();
	fs::remove_all(folder);
}

} // namespace

int main() {
	testDisk();
	testImageBuilder();
	std::printf("%s\n", failures ? "FAILED" : "OK");
	std::fflush(stdout);
	std::_Exit(failures != 0);
}
