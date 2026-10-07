#pragma once

#include <cstdint>
#include <filesystem>
#include <fstream>

namespace webluge {

// Writes stereo 44.1kHz 24-bit PCM, keeping each sample's top 24 bits as the device's recorder does.
class WavWriter {
public:
	explicit WavWriter(const std::filesystem::path& path);
	void write(int32_t left, int32_t right);
	// Fills in the header's sizes. Returns false if anything failed to write.
	bool close();

private:
	std::ofstream out_;
	uint32_t numFrames_ = 0;
};

} // namespace webluge
