#pragma once

#include "host_allocator.h"
#include <cstdint>
#include <expected>
#include <filesystem>
#include <string>

namespace webluge {

using CardImage = HostVector<uint8_t>;

// Room for files the firmware writes, such as the startup song's crash canary.
constexpr uint64_t kDefaultFreeBytes = 2 << 20;

// Builds a FAT card image holding a copy of a folder laid out like the Deluge's SD card (SONGS/, SAMPLES/, …).
std::expected<CardImage, std::string> buildCardImage(const std::filesystem::path& folder,
                                                     uint64_t freeBytes = kDefaultFreeBytes);

// Copies a folder, and everything in it, from the card the firmware has mounted.
std::expected<void, std::string> copyFromCard(const std::string& cardFolder, const std::filesystem::path& hostFolder);

} // namespace webluge
