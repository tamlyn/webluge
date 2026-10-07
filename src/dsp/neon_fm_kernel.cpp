// Host version of DelugeFirmware/src/deluge/dsp/dx/neon_fm_kernel.s, which the device uses for the DX7 "modern"
// engine. It computes sine with a float polynomial rather than the lookup table in the C++ fallback, so the
// C++ path sounds different. This follows the assembly operation for operation to give the same output.

#include <cstdint>

// The assembly's multiply-accumulates round the product before adding it. -ffp-contract=fast overrides this
// pragma, so the build must not use it.
#pragma STDC FP_CONTRACT OFF

namespace {

constexpr float c0 = -0.01880853017455781f;
constexpr float c1 = 0.25215252666796095f;
constexpr float c2 = -1.2333439964934032f;
constexpr float c3 = 1.0f;

// vcvt.s32.f32 with 24 fraction bits: truncates towards zero and saturates.
int32_t toFixed24(float value) {
	float scaled = value * 0x1p24f;
	if (scaled != scaled) {
		return 0;
	}
	if (scaled >= 0x1p31f) {
		return INT32_MAX;
	}
	if (scaled < -0x1p31f) {
		return INT32_MIN;
	}
	return (int32_t)scaled;
}

// The assembly works through 12 samples at a time and then, if exactly 4 remain, 4 more, so it can process
// more samples than asked for. Callers allow for this, and the extra samples are part of the output.
int samplesProcessed(int n) {
	int processed = 0;
	int remaining = n - 4;
	do {
		processed += 12;
		remaining -= 12;
	} while (remaining > 0);
	if (remaining == 0) {
		processed += 4;
	}
	return processed;
}

} // namespace

extern "C" void neon_fm_kernel(const int32_t* in, const int32_t* busin, int32_t* out, int n, int32_t phase0,
                               int32_t freq, int32_t gain, int32_t dgain) {
	// Each of the four lanes starts one sample further on, and every group of four steps all lanes by 4 * dgain.
	float laneGain[4];
	for (int lane = 0; lane < 4; lane++) {
		laneGain[lane] = (float)(int32_t)((uint32_t)gain + (uint32_t)dgain * lane) * 0x1p-24f;
	}
	const float gainStep = (float)dgain * 0x1p-22f;

	int processed = samplesProcessed(n);
	for (int group = 0; group < processed; group += 4) {
		for (int lane = 0; lane < 4; lane++) {
			int i = group + lane;
			uint32_t phase = (uint32_t)phase0 + (uint32_t)freq * i + (uint32_t)in[i];

			float x = (float)(int32_t)((phase & 0x7FFFFF) - 0x400000) * 0x1p-22f;
			float x2 = x * x;
			float y = c1 + x2 * c0;
			y = c2 + x2 * y;
			y = c3 + x2 * y;
			y = y * laneGain[lane];

			// The second half of each cycle is negated by inverting the bits, not by negation.
			int32_t signMask = (phase & 0x800000) ? -1 : 0;
			out[i] = (int32_t)((uint32_t)(toFixed24(y) ^ signMask) + (uint32_t)busin[i]);
		}
		for (float& g : laneGain) {
			g = g + gainStep;
		}
	}
}
