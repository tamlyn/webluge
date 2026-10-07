#include "wav.h"
#include "hal/audio.h"

namespace webluge {
namespace {

constexpr uint16_t kNumChannels = 2;
constexpr uint16_t kBytesPerSample = 3;
constexpr uint32_t kHeaderBytes = 44;

void put16(std::ofstream& out, uint16_t value) {
	char bytes[] = {static_cast<char>(value), static_cast<char>(value >> 8)};
	out.write(bytes, sizeof bytes);
}

void put32(std::ofstream& out, uint32_t value) {
	put16(out, value);
	put16(out, value >> 16);
}

void putSample(std::ofstream& out, int32_t sample) {
	char bytes[] = {static_cast<char>(sample >> 8), static_cast<char>(sample >> 16), static_cast<char>(sample >> 24)};
	out.write(bytes, sizeof bytes);
}

void putHeader(std::ofstream& out, uint32_t numFrames) {
	uint32_t dataBytes = numFrames * kNumChannels * kBytesPerSample;
	out.write("RIFF", 4);
	put32(out, kHeaderBytes - 8 + dataBytes);
	out.write("WAVEfmt ", 8);
	put32(out, 16);
	put16(out, 1); // PCM
	put16(out, kNumChannels);
	put32(out, WEBLUGE_SAMPLE_RATE);
	put32(out, WEBLUGE_SAMPLE_RATE * kNumChannels * kBytesPerSample);
	put16(out, kNumChannels * kBytesPerSample);
	put16(out, kBytesPerSample * 8);
	out.write("data", 4);
	put32(out, dataBytes);
}

} // namespace

WavWriter::WavWriter(const std::filesystem::path& path) : out_(path, std::ios::binary) {
	putHeader(out_, 0);
}

void WavWriter::write(int32_t left, int32_t right) {
	putSample(out_, left);
	putSample(out_, right);
	numFrames_++;
}

bool WavWriter::close() {
	out_.seekp(0);
	putHeader(out_, numFrames_);
	out_.close();
	return !out_.fail();
}

} // namespace webluge
