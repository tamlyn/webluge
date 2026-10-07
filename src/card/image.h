#pragma once

#include "host_allocator.h"
#include <cstdint>
#include <expected>
#include <filesystem>
#include <string>

namespace webluge {

using CardImage = HostVector<uint8_t>;

// Builds a FAT card image holding a copy of a folder laid out like the Deluge's SD card (SONGS/, SAMPLES/, …).
std::expected<CardImage, std::string> buildCardImage(const std::filesystem::path& folder);

} // namespace webluge
