// Runs the DX7 FM operator kernel over a fixed set of inputs and prints one line per case. Linked against
// neon_fm_kernel.s on ARMv7 it produces the golden file; linked against the host port the output must match.

#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <initializer_list>

extern "C" void neon_fm_kernel(const int32_t* in, const int32_t* busin, int32_t* out, int n, int32_t phase0,
                               int32_t freq, int32_t gain, int32_t dgain);

namespace {

// Matches DX_MAX_N in fm_core.h.
constexpr int maxN = 132;

uint64_t rngState = 0xD7D7D7D7D7D7D7D7ull;
uint64_t next() {
	uint64_t z = (rngState += 0x9E3779B97F4A7C15ull);
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
	z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
	return z ^ (z >> 31);
}

int32_t randomIn(int32_t range) {
	return (int32_t)(next() % (2 * (uint64_t)range + 1)) - range;
}

alignas(16) const int32_t zeros[maxN] = {};
alignas(16) int32_t in[maxN];
alignas(16) int32_t out[maxN];

// The block sizes FmCore::render passes for each n it can be given.
int simdN(int n) {
	int nmod = 1 + (n + 11) % 12;
	return nmod == 8 ? n + 4 : (n + 3) & ~3;
}

void runCase(int caseIndex, int n, int32_t gain1, int32_t gain2, bool modulated, bool accumulate) {
	int32_t phase0 = (int32_t)next();
	int32_t freq = (int32_t)(next() >> 40); // Up to about a quarter of the sample rate
	int32_t dgain = (gain2 - gain1) / n;

	for (int i = 0; i < maxN; i++) {
		in[i] = modulated ? randomIn(1 << 26) : 0;
		out[i] = accumulate ? randomIn(1 << 27) : (int32_t)0xDEADBEEF;
	}

	// As FmOpKernel calls it: accumulating mixes into the output in place, otherwise it mixes in zeros.
	neon_fm_kernel(in, accumulate ? out : zeros, out, simdN(n), phase0, freq, gain1, dgain);

	printf("%d n=%d phase=%08" PRIx32 " freq=%08" PRIx32 " gain=%08" PRIx32 " dgain=%08" PRIx32 " %s%s:", caseIndex,
	       n, (uint32_t)phase0, (uint32_t)freq, (uint32_t)gain1, (uint32_t)dgain, modulated ? "mod" : "pure",
	       accumulate ? "+add" : "");
	for (int i = 0; i < maxN; i++) {
		printf(" %08" PRIx32, (uint32_t)out[i]);
	}
	printf("\n");
}

} // namespace

int main() {
	int caseIndex = 0;
	for (int n = 1; n <= 128; n++) {
		// Typical operator levels, ramping up or down over the block
		runCase(caseIndex++, n, (int32_t)(next() % (1 << 26)), (int32_t)(next() % (1 << 26)), n % 2, n / 2 % 2);
	}
	// Extremes, to exercise saturation and gains near zero
	for (int32_t gain : {0, 1, 2, INT32_MAX / 2, INT32_MAX}) {
		for (int32_t gain2 : {0, 1, INT32_MAX}) {
			runCase(caseIndex++, 64, gain, gain2, true, false);
		}
	}
	return 0;
}
