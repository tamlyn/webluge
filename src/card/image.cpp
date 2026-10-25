#include "card/image.h"
#include "hal/disk.h"
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <map>
#include <optional>
#include <unistd.h>

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
// FatFs addresses sectors with 32 bits (FF_LBA64 is off).
constexpr uint64_t kMaxImageSectors = UINT32_MAX;

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

// An upper bound on the volume size, in sectors, that holds the entries and leaves the free space.
uint64_t sectorsFor(const std::vector<Entry>& entries, uint64_t freeBytes) {
	uint64_t clusters = clustersFor(freeBytes);
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

void appendUtf8(std::string& utf8, DWORD codePoint) {
	if (codePoint < 0x80) {
		utf8 += static_cast<char>(codePoint);
	}
	else if (codePoint < 0x800) {
		utf8 += static_cast<char>(0xC0 | codePoint >> 6);
		utf8 += static_cast<char>(0x80 | (codePoint & 0x3F));
	}
	else {
		utf8 += static_cast<char>(0xE0 | codePoint >> 12);
		utf8 += static_cast<char>(0x80 | (codePoint >> 6 & 0x3F));
		utf8 += static_cast<char>(0x80 | (codePoint & 0x3F));
	}
}

std::string toHostName(const char* cardName) {
	std::string name;
	for (const char* c = cardName; *c; c++) {
		appendUtf8(name, ff_oem2uni(static_cast<uint8_t>(*c), FF_CODE_PAGE));
	}
	return name;
}

std::string describe(const Entry& entry, FRESULT result) {
	return entry.hostPath.string() + ": FatFs error " + std::to_string(result);
}

// Allocates the file's clusters in one run without writing them, and has the image read them from the host file.
// On an empty volume, f_expand lays files out as writing them would.
std::expected<void, std::string> allocateFile(CardImage& image, const Entry& entry) {
	FIL file;
	FRESULT result = f_open(&file, entry.cardPath.c_str(), FA_WRITE | FA_CREATE_NEW);
	if (result != FR_OK) {
		return std::unexpected(describe(entry, result));
	}
	if (entry.size) {
		result = f_expand(&file, entry.size, 1);
		if (result == FR_OK) {
			FATFS* fileSystem = file.obj.fs;
			uint32_t numClusters = clustersFor(entry.size);
			image.addFile(fileSystem->database + (file.obj.sclust - 2) * fileSystem->csize,
			              numClusters * fileSystem->csize, entry.hostPath);
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
		if (sectors > kMaxImageSectors) {
			return std::unexpected("needs a " + std::to_string(sectors * WEBLUGE_SECTOR_SIZE >> 20)
			                       + "MB image, more than FAT32 can address");
		}
		image = CardImage(sectors);
		image.insert();
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

std::expected<void, std::string> fill(CardImage& image, const std::vector<Entry>& entries) {
	for (const Entry& entry : entries) {
		std::expected<void, std::string> added;
		if (entry.isFolder) {
			FRESULT result = f_mkdir(entry.cardPath.c_str());
			if (result != FR_OK) {
				added = std::unexpected(describe(entry, result));
			}
		}
		else {
			added = allocateFile(image, entry);
		}
		if (!added) {
			return added;
		}
	}
	return {};
}

std::string describe(const std::string& cardPath, FRESULT result) {
	return cardPath + ": FatFs error " + std::to_string(result);
}

std::expected<void, std::string> copyFileFromCard(const std::string& cardPath, const fs::path& hostPath,
                                                  HostVector<char>& buffer) {
	FIL file;
	FRESULT result = f_open(&file, cardPath.c_str(), FA_READ);
	if (result != FR_OK) {
		return std::unexpected(describe(cardPath, result));
	}
	std::ofstream out(hostPath, std::ios::binary);
	UINT length = buffer.size();
	while (result == FR_OK && length == buffer.size() && out) {
		result = f_read(&file, buffer.data(), buffer.size(), &length);
		out.write(buffer.data(), length);
	}
	f_close(&file);
	if (result != FR_OK) {
		return std::unexpected(describe(cardPath, result));
	}
	if (!out) {
		return std::unexpected(hostPath.string() + ": can't write");
	}
	return {};
}

std::expected<void, std::string> copyFolderFromCard(const std::string& cardFolder, const fs::path& hostFolder,
                                                    HostVector<char>& buffer) {
	std::error_code error;
	fs::create_directories(hostFolder, error);
	if (error) {
		return std::unexpected(hostFolder.string() + ": " + error.message());
	}
	DIR folder;
	FRESULT result = f_opendir(&folder, cardFolder.c_str());
	if (result != FR_OK) {
		return std::unexpected(describe(cardFolder, result));
	}
	std::expected<void, std::string> copied;
	FILINFO info;
	while (copied && (result = f_readdir(&folder, &info)) == FR_OK && info.fname[0]) {
		std::string cardPath = cardFolder + "/" + info.fname;
		fs::path hostPath = hostFolder / toHostName(info.fname);
		copied = info.fattrib & AM_DIR ? copyFolderFromCard(cardPath, hostPath, buffer)
		                               : copyFileFromCard(cardPath, hostPath, buffer);
	}
	f_closedir(&folder);
	if (result != FR_OK) {
		return std::unexpected(describe(cardFolder, result));
	}
	return copied;
}

} // namespace

bool CardImage::read(uint8_t* buffer, uint32_t sector, uint32_t count) const {
	uint32_t end = sector + count;
	auto nextWritten = written.lower_bound(sector);
	auto nextExtent = std::ranges::upper_bound(extents, sector, {}, &Extent::firstSector);
	while (sector < end) {
		while (nextExtent != extents.end() && nextExtent->firstSector <= sector) {
			++nextExtent;
		}
		if (nextWritten != written.end() && nextWritten->first == sector) {
			std::memcpy(buffer, nextWritten->second.data(), WEBLUGE_SECTOR_SIZE);
			++nextWritten;
			sector++;
			buffer += WEBLUGE_SECTOR_SIZE;
			continue;
		}
		uint32_t runEnd = nextWritten == written.end() ? end : std::min(end, nextWritten->first);
		const Extent* extent = nextExtent == extents.begin() ? nullptr : &*std::prev(nextExtent);
		if (extent && sector < extent->firstSector + extent->numSectors) {
			runEnd = std::min(runEnd, extent->firstSector + extent->numSectors);
			if (!readFile(buffer, *extent, sector, runEnd - sector)) {
				return false;
			}
		}
		else {
			if (nextExtent != extents.end()) {
				runEnd = std::min(runEnd, nextExtent->firstSector);
			}
			std::memset(buffer, 0, (runEnd - sector) * WEBLUGE_SECTOR_SIZE);
		}
		buffer += (runEnd - sector) * WEBLUGE_SECTOR_SIZE;
		sector = runEnd;
	}
	return true;
}

bool CardImage::readFile(uint8_t* buffer, const Extent& extent, uint32_t sector, uint32_t count) const {
	int file = open(extent.hostPath.c_str(), O_RDONLY);
	if (file < 0) {
		return false;
	}
	size_t length = count * WEBLUGE_SECTOR_SIZE;
	off_t offset = off_t{sector - extent.firstSector} * WEBLUGE_SECTOR_SIZE;
	size_t done = 0;
	ssize_t n = 1;
	while (done < length && (n = pread(file, buffer + done, length - done, offset + done)) > 0) {
		done += n;
	}
	close(file);
	if (n < 0) {
		return false;
	}
	// Past the file's end, to the end of its last cluster.
	std::memset(buffer + done, 0, length - done);
	return true;
}

void CardImage::write(const uint8_t* buffer, uint32_t sector, uint32_t count) {
	for (uint32_t end = sector + count; sector < end; sector++, buffer += WEBLUGE_SECTOR_SIZE) {
		std::memcpy(written[sector].data(), buffer, WEBLUGE_SECTOR_SIZE);
	}
}

void CardImage::insert() {
	webluge_disk_insert({
	    .card = this,
	    .numSectors = sectors,
	    .read = [](void* card, uint8_t* buffer, uint32_t sector, uint32_t count) {
		    return static_cast<CardImage*>(card)->read(buffer, sector, count);
	    },
	    .write = [](void* card, const uint8_t* buffer, uint32_t sector, uint32_t count) {
		    static_cast<CardImage*>(card)->write(buffer, sector, count);
		    return true;
	    },
	});
}

void CardImage::addFile(uint32_t firstSector, uint32_t numSectors, const fs::path& hostPath) {
	Extent extent{firstSector, numSectors, hostPath.c_str()};
	extents.insert(std::ranges::upper_bound(extents, firstSector, {}, &Extent::firstSector), std::move(extent));
}

std::expected<CardImage, std::string> openCardImage(const fs::path& imageFile) {
	std::error_code error;
	uintmax_t size = fs::file_size(imageFile, error);
	if (error || !size || size % WEBLUGE_SECTOR_SIZE || size / WEBLUGE_SECTOR_SIZE > kMaxImageSectors) {
		return std::unexpected(imageFile.string() + ": not a card image");
	}
	CardImage image(size / WEBLUGE_SECTOR_SIZE);
	image.addFile(0, image.numSectors(), imageFile);
	return image;
}

std::expected<void, std::string> saveCardImage(const CardImage& image, const fs::path& imageFile) {
	std::ofstream out(imageFile, std::ios::binary);
	HostVector<uint8_t> buffer(kClusterSize);
	uint32_t sectorsPerBuffer = kClusterSize / WEBLUGE_SECTOR_SIZE;
	for (uint32_t sector = 0; out && sector < image.numSectors(); sector += sectorsPerBuffer) {
		uint32_t count = std::min(sectorsPerBuffer, image.numSectors() - sector);
		if (!image.read(buffer.data(), sector, count)) {
			return std::unexpected(imageFile.string() + ": can't read the card's files");
		}
		out.write(reinterpret_cast<const char*>(buffer.data()), count * WEBLUGE_SECTOR_SIZE);
	}
	if (!out) {
		return std::unexpected(imageFile.string() + ": can't write");
	}
	return {};
}

std::expected<void, std::string> copyFromCard(const std::string& cardFolder, const fs::path& hostFolder) {
	HostVector<char> buffer(1 << 20);
	return copyFolderFromCard(cardFolder, hostFolder, buffer);
}

std::expected<CardImage, std::string> buildCardImage(const fs::path& folder, uint64_t freeBytes) {
	auto entries = scan(folder);
	if (!entries) {
		return std::unexpected(entries.error());
	}
	CardImage image;
	auto formatted = format(image, sectorsFor(*entries, freeBytes));
	std::expected<void, std::string> filled;
	if (formatted) {
		FATFS fileSystem;
		FRESULT result = f_mount(&fileSystem, "", 1);
		filled = result == FR_OK ? fill(image, *entries)
		                         : std::unexpected("f_mount: FatFs error " + std::to_string(result));
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
