#include "card/image.h"
#include "hal/disk.h"
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <map>
#include <optional>

extern "C" {
#include "ff.h"
}

namespace fs = std::filesystem;

namespace webluge {
namespace {

// Matches how SD cards are usually formatted. The firmware streams samples a cluster at a time, so the cluster
// size shapes its loading.
constexpr uint32_t kClusterSize = 32768;
constexpr uint32_t kDirectoryEntrySize = 32;
// Room for files the firmware writes, such as the startup song's crash canary.
constexpr uint32_t kFreeClusters = 64;
// wasm32 memory tops out at 4GB, part of which the firmware's own memory map takes.
constexpr uint64_t kMaxImageBytes = 2ull << 30;

struct Entry {
	fs::path hostPath;
	std::string cardPath;
	bool isFolder;
	uintmax_t size;
};

// The firmware sees file names in code page 437 (ffconf.h), as it would a real card's long names.
std::optional<std::string> toCardName(const std::string& utf8) {
	std::string name;
	for (size_t i = 0; i < utf8.size();) {
		uint8_t lead = utf8[i];
		int length = lead < 0x80 ? 1 : lead >> 5 == 6 ? 2 : lead >> 4 == 14 ? 3 : lead >> 3 == 30 ? 4 : 0;
		if (!length || i + length > utf8.size()) {
			return std::nullopt;
		}
		DWORD codePoint = length == 1 ? lead : lead & (0x7F >> length);
		for (int j = 1; j < length; j++) {
			codePoint = codePoint << 6 | (utf8[i + j] & 0x3F);
		}
		WCHAR oem = ff_uni2oem(codePoint, FF_CODE_PAGE);
		if (!oem) {
			return std::nullopt;
		}
		name += static_cast<char>(oem);
		i += length;
	}
	return name;
}

std::expected<std::vector<Entry>, std::string> scan(const fs::path& folder) {
	std::vector<Entry> entries;
	std::error_code error;
	auto it = fs::recursive_directory_iterator(folder, error);
	for (; !error && it != fs::recursive_directory_iterator(); it.increment(error)) {
		const fs::path& hostPath = it->path();
		std::string hostName = hostPath.filename().string();
		bool isFolder = it->is_directory(error);
		// Hidden files are host metadata (.DS_Store, sync state), not card content.
		std::optional<std::string> cardName = hostName.starts_with('.') ? std::nullopt : toCardName(hostName);
		if (!cardName) {
			if (!hostName.starts_with('.')) {
				std::fprintf(stderr, "Skipping %s: name can't be written in code page %d\n", hostPath.c_str(),
				             FF_CODE_PAGE);
			}
			if (isFolder) {
				it.disable_recursion_pending();
			}
			continue;
		}
		if (!isFolder && !it->is_regular_file(error)) {
			continue;
		}
		// Every parent folder's name converted, or the iterator wouldn't have gone into it.
		std::string parent;
		for (const fs::path& part : hostPath.lexically_relative(folder).parent_path()) {
			parent += *toCardName(part.string()) + "/";
		}
		entries.push_back({hostPath, parent + *cardName, isFolder, isFolder ? 0 : it->file_size(error)});
	}
	if (error) {
		return std::unexpected(folder.string() + ": " + error.message());
	}
	// Host folder order varies, so sort to make images reproducible. A folder sorts before its contents.
	std::ranges::sort(entries, {}, &Entry::cardPath);
	return entries;
}

uint64_t clustersFor(uint64_t bytes) {
	return (bytes + kClusterSize - 1) / kClusterSize;
}

// An upper bound on the volume size, in sectors, that holds the entries.
uint64_t sectorsFor(const std::vector<Entry>& entries) {
	uint64_t clusters = kFreeClusters;
	std::map<std::string, uint64_t> folderEntries{{"", 0}};
	for (const Entry& entry : entries) {
		size_t slash = entry.cardPath.rfind('/');
		std::string parent = slash == std::string::npos ? "" : entry.cardPath.substr(0, slash);
		size_t nameLength = entry.cardPath.size() - (slash == std::string::npos ? 0 : slash + 1);
		// A short name entry plus long name entries of 13 characters each.
		folderEntries[parent] += 1 + (nameLength + 12) / 13;
		if (entry.isFolder) {
			folderEntries[entry.cardPath] += 2; // "." and ".."
		}
		else {
			clusters += clustersFor(entry.size);
		}
	}
	for (const auto& [_, count] : folderEntries) {
		clusters += std::max<uint64_t>(1, clustersFor(count * kDirectoryEntrySize));
	}
	uint64_t sectorsPerCluster = kClusterSize / WEBLUGE_SECTOR_SIZE;
	uint64_t reservedSectors = 32;
	uint64_t fatSectors = 2 * ((clusters + 2) * 4 + WEBLUGE_SECTOR_SIZE - 1) / WEBLUGE_SECTOR_SIZE;
	uint64_t rootSectors = 512 * kDirectoryEntrySize / WEBLUGE_SECTOR_SIZE;
	return reservedSectors + fatSectors + rootSectors + clusters * sectorsPerCluster;
}

std::string describe(const Entry& entry, FRESULT result) {
	return entry.hostPath.string() + ": FatFs error " + std::to_string(result);
}

std::expected<void, std::string> copyFile(const Entry& entry, HostVector<char>& buffer) {
	std::ifstream in(entry.hostPath, std::ios::binary);
	if (!in) {
		return std::unexpected(entry.hostPath.string() + ": can't read");
	}
	FIL file;
	FRESULT result = f_open(&file, entry.cardPath.c_str(), FA_WRITE | FA_CREATE_NEW);
	if (result != FR_OK) {
		return std::unexpected(describe(entry, result));
	}
	while (result == FR_OK && in) {
		in.read(buffer.data(), buffer.size());
		UINT length = in.gcount();
		UINT written;
		result = f_write(&file, buffer.data(), length, &written);
		if (result == FR_OK && written != length) {
			result = FR_DENIED; // Volume full
		}
	}
	FRESULT closeResult = f_close(&file);
	if (result == FR_OK) {
		result = closeResult;
	}
	if (result != FR_OK) {
		return std::unexpected(describe(entry, result));
	}
	return {};
}

std::expected<void, std::string> format(CardImage& image, uint64_t sectors) {
	MKFS_PARM options{.fmt = FM_FAT | FM_FAT32 | FM_SFD, .n_fat = 2, .align = 0, .n_root = 0, .au_size = kClusterSize};
	HostVector<uint8_t> work(kClusterSize);
	// f_mkfs picks FAT12, 16 or 32 from the cluster count, and gives up when the count after its own overhead lands
	// on the other side of a boundary between them. A little more space moves it clear.
	for (int attempt = 0; attempt < 8; attempt++, sectors += sectors / 16) {
		if (sectors * WEBLUGE_SECTOR_SIZE > kMaxImageBytes) {
			return std::unexpected("needs a " + std::to_string(sectors * WEBLUGE_SECTOR_SIZE >> 20)
			                       + "MB image, more than the " + std::to_string(kMaxImageBytes >> 20) + "MB limit");
		}
		image.assign(sectors * WEBLUGE_SECTOR_SIZE, 0);
		webluge_disk_insert(image.data(), sectors);
		FRESULT result = f_mkfs("", &options, work.data(), work.size());
		if (result == FR_OK) {
			return {};
		}
		if (result != FR_MKFS_ABORTED) {
			return std::unexpected("f_mkfs: FatFs error " + std::to_string(result));
		}
	}
	return std::unexpected("f_mkfs found no valid layout");
}

std::expected<void, std::string> fill(const std::vector<Entry>& entries) {
	HostVector<char> buffer(1 << 20);
	for (const Entry& entry : entries) {
		std::expected<void, std::string> copied;
		if (entry.isFolder) {
			FRESULT result = f_mkdir(entry.cardPath.c_str());
			if (result != FR_OK) {
				copied = std::unexpected(describe(entry, result));
			}
		}
		else {
			copied = copyFile(entry, buffer);
		}
		if (!copied) {
			return copied;
		}
	}
	return {};
}

} // namespace

std::expected<CardImage, std::string> buildCardImage(const fs::path& folder) {
	auto entries = scan(folder);
	if (!entries) {
		return std::unexpected(entries.error());
	}
	CardImage image;
	auto formatted = format(image, sectorsFor(*entries));
	std::expected<void, std::string> filled;
	if (formatted) {
		FATFS fileSystem;
		FRESULT result = f_mount(&fileSystem, "", 1);
		filled = result == FR_OK ? fill(*entries) : std::unexpected("f_mount: FatFs error " + std::to_string(result));
		f_mount(nullptr, "", 0);
	}
	webluge_disk_eject();
	if (!formatted) {
		return std::unexpected(formatted.error());
	}
	if (!filled) {
		return std::unexpected(filled.error());
	}
	return image;
}

} // namespace webluge
