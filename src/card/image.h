#pragma once

#include "hal/disk.h"
#include "host_allocator.h"
#include <array>
#include <cstdint>
#include <expected>
#include <filesystem>
#include <map>
#include <string>

namespace webluge {

// A FAT card image. Sectors written to it, such as its FATs and folders and whatever the firmware saves, are kept in
// memory. The rest are read from the host files the card was made from when they're needed, so a card's memory
// grows with its folders, not its samples. The files must stay as they are while the card is in use.
class CardImage {
public:
	// A blank, unformatted card.
	explicit CardImage(uint32_t numSectors = 0) : sectors(numSectors) {}

	uint32_t numSectors() const { return sectors; }
	bool read(uint8_t* buffer, uint32_t sector, uint32_t count) const;
	void write(const uint8_t* buffer, uint32_t sector, uint32_t count);

	// Into the SD card slot. It mustn't move until it's ejected.
	void insert();

	// A run of sectors holding a host file, from its start, padded with zeros.
	void addFile(uint32_t firstSector, uint32_t numSectors, const std::filesystem::path& hostPath);

private:
	struct Extent {
		uint32_t firstSector;
		uint32_t numSectors;
		HostString hostPath;
	};
	using Sector = std::array<uint8_t, WEBLUGE_SECTOR_SIZE>;

	bool readFile(uint8_t* buffer, const Extent& extent, uint32_t sector, uint32_t count) const;

	uint32_t sectors;
	// By first sector, and never overlapping.
	HostVector<Extent> extents;
	std::map<uint32_t, Sector, std::less<>, HostAllocator<std::pair<const uint32_t, Sector>>> written;
};

// Room for files the firmware writes, such as the startup song's crash canary.
constexpr uint64_t kDefaultFreeBytes = 2 << 20;

// Builds a FAT card image of a folder laid out like the Deluge's SD card (SONGS/, SAMPLES/, …).
std::expected<CardImage, std::string> buildCardImage(const std::filesystem::path& folder,
                                                     uint64_t freeBytes = kDefaultFreeBytes);

// A card image file, such as `webluge image` writes.
std::expected<CardImage, std::string> openCardImage(const std::filesystem::path& imageFile);

// Writes out every sector of the card, as a card image file.
std::expected<void, std::string> saveCardImage(const CardImage& image, const std::filesystem::path& imageFile);

// Copies a folder, and everything in it, from the card the firmware has mounted.
std::expected<void, std::string> copyFromCard(const std::string& cardFolder, const std::filesystem::path& hostFolder);

} // namespace webluge
