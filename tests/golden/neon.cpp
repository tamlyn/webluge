// Runs every integer NEON intrinsic used by the firmware and its NE10 FFT over a fixed set of inputs, one line
// per result. Built for ARMv7 it uses the real instructions and produces the golden file; built with
// Emscripten it uses Emscripten's arm_neon.h (SIMDe), which must match exactly.
//
// Float intrinsics are left out: the firmware is built with -funsafe-math-optimizations, so float code on the
// device can't be matched bit for bit anyway.

#include <arm_neon.h>
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <iterator>
#include <utility>

namespace {

uint64_t rngState = 0x4E304E304E304E30ull;
uint64_t next() {
	uint64_t z = (rngState += 0x9E3779B97F4A7C15ull);
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
	z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
	return z ^ (z >> 31);
}

const int32_t edges32[] = {0,          1,           -1,        2,         0x7FFF,        0x8000, -0x8000,
                           0x10000,    0x40000000,  -0x40000000, INT32_MAX, INT32_MIN, INT32_MIN + 1,
                           (int32_t)0xAAAAAAAA};
const int16_t edges16[] = {0, 1, -1, 2, 0x3FFF, 0x4000, -0x4000, INT16_MAX, INT16_MIN, INT16_MIN + 1, (int16_t)0xAAAA,
                           0x00FF};

constexpr int numRandom = 100;

// A quarter edge values, the rest random with random magnitude.
int32_t random32() {
	if (next() % 4 == 0) {
		return edges32[next() % std::size(edges32)];
	}
	return (int32_t)(uint32_t)next() >> (next() % 32);
}
int16_t random16() {
	if (next() % 4 == 0) {
		return edges16[next() % std::size(edges16)];
	}
	return (int16_t)((int16_t)(uint16_t)next() >> (next() % 16));
}

int32x2_t s32x2() {
	int32_t a[2] = {random32(), random32()};
	return vld1_s32(a);
}
int32x4_t s32x4() {
	int32_t a[4];
	for (int32_t& x : a) {
		x = random32();
	}
	return vld1q_s32(a);
}
uint32x4_t u32x4() {
	return vreinterpretq_u32_s32(s32x4());
}
int16x4_t s16x4() {
	int16_t a[4];
	for (int16_t& x : a) {
		x = random16();
	}
	return vld1_s16(a);
}
int16x8_t s16x8() {
	int16_t a[8];
	for (int16_t& x : a) {
		x = random16();
	}
	return vld1q_s16(a);
}
uint16x4_t u16x4() {
	return vreinterpret_u16_s16(s16x4());
}

void lanes(const uint32_t* a, int n) {
	for (int i = 0; i < n; i++) {
		printf(" %08" PRIx32, a[i]);
	}
}
void lanes(const uint16_t* a, int n) {
	for (int i = 0; i < n; i++) {
		printf(" %04" PRIx16, a[i]);
	}
}

void out(int32x2_t v) {
	uint32_t a[2];
	vst1_u32(a, vreinterpret_u32_s32(v));
	lanes(a, 2);
}
void out(int32x4_t v) {
	uint32_t a[4];
	vst1q_u32(a, vreinterpretq_u32_s32(v));
	lanes(a, 4);
}
void out(uint32x4_t v) {
	uint32_t a[4];
	vst1q_u32(a, v);
	lanes(a, 4);
}
void out(int16x4_t v) {
	uint16_t a[4];
	vst1_u16(a, vreinterpret_u16_s16(v));
	lanes(a, 4);
}
void out(uint16x4_t v) {
	uint16_t a[4];
	vst1_u16(a, v);
	lanes(a, 4);
}
void out(int16x8_t v) {
	uint16_t a[8];
	vst1q_u16(a, vreinterpretq_u16_s16(v));
	lanes(a, 8);
}
void out(int32x4x2_t v) {
	out(v.val[0]);
	out(v.val[1]);
}
void out(int16x8x4_t v) {
	for (int16x8_t x : v.val) {
		out(x);
	}
}

// Inputs are generated into variables before each call, as argument evaluation order differs between compilers.
template <typename F>
void run(const char* op, F f) {
	for (int i = 0; i < numRandom; i++) {
		printf("%s %d:", op, i);
		out(f());
		printf("\n");
	}
}

// Every pair of edge values, four pairs per vector.
template <typename F>
void edgePairs32(const char* op, F f) {
	constexpr int n = std::size(edges32);
	for (int i = 0; i < n * n; i += 4) {
		int32_t a[4], b[4];
		for (int lane = 0; lane < 4; lane++) {
			a[lane] = edges32[(i + lane) / n % n];
			b[lane] = edges32[(i + lane) % n];
		}
		printf("%s edges %d:", op, i);
		out(f(vld1q_s32(a), vld1q_s32(b)));
		printf("\n");
	}
}
template <typename F>
void edgePairs16(const char* op, F f) {
	constexpr int n = std::size(edges16);
	for (int i = 0; i < n * n; i += 4) {
		int16_t a[4], b[4];
		for (int lane = 0; lane < 4; lane++) {
			a[lane] = edges16[(i + lane) / n % n];
			b[lane] = edges16[(i + lane) % n];
		}
		printf("%s edges %d:", op, i);
		out(f(vld1_s16(a), vld1_s16(b)));
		printf("\n");
	}
}

template <int imm>
void shifts() {
	auto runImm = [&](const char* name, auto f) {
		for (int i = 0; i < 20; i++) {
			printf("%s#%d %d:", name, imm, i);
			out(f());
			printf("\n");
		}
	};
	if constexpr (imm >= 1 && imm <= 16) {
		runImm("vshll_n_s16", [] { int16x4_t a = s16x4(); return vshll_n_s16(a, imm); });
		runImm("vshr_n_u16", [] { uint16x4_t a = u16x4(); return vshr_n_u16(a, imm); });
		runImm("vshrn_n_s32", [] { int32x4_t a = s32x4(); return vshrn_n_s32(a, imm); });
		runImm("vshrn_n_u32", [] { uint32x4_t a = u32x4(); return vshrn_n_u32(a, imm); });
	}
	if constexpr (imm <= 31) {
		runImm("vshlq_n_s32", [] { int32x4_t a = s32x4(); return vshlq_n_s32(a, imm); });
		runImm("vshlq_n_u32", [] { uint32x4_t a = u32x4(); return vshlq_n_u32(a, imm); });
	}
}

template <int... imm>
void allShifts(std::integer_sequence<int, imm...>) {
	(shifts<imm>(), ...);
}

} // namespace

int main() {
	// Wrapping arithmetic and logic
	run("vaddq_s32", [] { int32x4_t a = s32x4(), b = s32x4(); return vaddq_s32(a, b); });
	run("vsubq_s32", [] { int32x4_t a = s32x4(), b = s32x4(); return vsubq_s32(a, b); });
	run("vaddq_u32", [] { uint32x4_t a = u32x4(), b = u32x4(); return vaddq_u32(a, b); });
	run("vadd_s32", [] { int32x2_t a = s32x2(), b = s32x2(); return vadd_s32(a, b); });
	run("vpadd_s32", [] { int32x2_t a = s32x2(), b = s32x2(); return vpadd_s32(a, b); });
	run("vaddq_s16", [] { int16x8_t a = s16x8(), b = s16x8(); return vaddq_s16(a, b); });
	run("vsubq_s16", [] { int16x8_t a = s16x8(), b = s16x8(); return vsubq_s16(a, b); });
	run("vsub_s16", [] { int16x4_t a = s16x4(), b = s16x4(); return vsub_s16(a, b); });
	run("vand_s16", [] { int16x4_t a = s16x4(), b = s16x4(); return vand_s16(a, b); });
	run("vorr_s16", [] { int16x4_t a = s16x4(), b = s16x4(); return vorr_s16(a, b); });
	run("vnegq_s32", [] { int32x4_t a = s32x4(); return vnegq_s32(a); });

	// Halving, doubling, saturating and rounding
	auto vhaddq = [](int32x4_t a, int32x4_t b) { return vhaddq_s32(a, b); };
	auto vhsubq = [](int32x4_t a, int32x4_t b) { return vhsubq_s32(a, b); };
	auto vqdmulhq = [](int32x4_t a, int32x4_t b) { return vqdmulhq_s32(a, b); };
	auto vqrdmulhq = [](int32x4_t a, int32x4_t b) { return vqrdmulhq_s32(a, b); };
	auto vshlq = [](int32x4_t a, int32x4_t b) { return vshlq_s32(a, b); };
	edgePairs32("vhaddq_s32", vhaddq);
	edgePairs32("vhsubq_s32", vhsubq);
	edgePairs32("vqdmulhq_s32", vqdmulhq);
	edgePairs32("vqrdmulhq_s32", vqrdmulhq);
	run("vhaddq_s32", [&] { int32x4_t a = s32x4(), b = s32x4(); return vhaddq(a, b); });
	run("vhsubq_s32", [&] { int32x4_t a = s32x4(), b = s32x4(); return vhsubq(a, b); });
	run("vqdmulhq_s32", [&] { int32x4_t a = s32x4(), b = s32x4(); return vqdmulhq(a, b); });
	run("vqrdmulhq_s32", [&] { int32x4_t a = s32x4(), b = s32x4(); return vqrdmulhq(a, b); });
	run("vqrdmulhq_n_s32", [] { int32x4_t a = s32x4(); int32_t b = random32(); return vqrdmulhq_n_s32(a, b); });
	run("vqdmulhq_n_s16", [] { int16x8_t a = s16x8(); int16_t b = random16(); return vqdmulhq_n_s16(a, b); });

	// Variable shifts use the signed bottom byte of each lane, negative shifting right.
	run("vshlq_s32", [&] {
		int32x4_t a = s32x4();
		int32_t b[4];
		for (int32_t& x : b) {
			x = (int32_t)(next() % 81) - 40;
		}
		return vshlq(a, vld1q_s32(b));
	});

	// Widening and narrowing
	auto vmull = [](int16x4_t a, int16x4_t b) { return vmull_s16(a, b); };
	auto vqdmull = [](int16x4_t a, int16x4_t b) { return vqdmull_s16(a, b); };
	edgePairs16("vmull_s16", vmull);
	edgePairs16("vqdmull_s16", vqdmull);
	run("vmull_s16", [&] { int16x4_t a = s16x4(), b = s16x4(); return vmull(a, b); });
	run("vqdmull_s16", [&] { int16x4_t a = s16x4(), b = s16x4(); return vqdmull(a, b); });
	run("vmlal_s16", [] { int32x4_t acc = s32x4(); int16x4_t a = s16x4(), b = s16x4(); return vmlal_s16(acc, a, b); });
	run("vqdmlal_s16", [] { int32x4_t acc = s32x4(); int16x4_t a = s16x4(), b = s16x4(); return vqdmlal_s16(acc, a, b); });
	run("vmovn_u32", [] { uint32x4_t a = u32x4(); return vmovn_u32(a); });
	allShifts(std::make_integer_sequence<int, 32>());

	// Lane and structure moves
	run("vdupq_n_s32", [] { return vdupq_n_s32(random32()); });
	run("vdupq_n_u32", [] { return vdupq_n_u32((uint32_t)random32()); });
	run("vdup_n_s16", [] { return vdup_n_s16(random16()); });
	run("vcombine_s32", [] { int32x2_t a = s32x2(), b = s32x2(); return vcombine_s32(a, b); });
	run("vget_low_s32", [] { int32x4_t a = s32x4(); return vget_low_s32(a); });
	run("vget_high_s32", [] { int32x4_t a = s32x4(); return vget_high_s32(a); });
	run("vget_low_s16", [] { int16x8_t a = s16x8(); return vget_low_s16(a); });
	run("vget_high_s16", [] { int16x8_t a = s16x8(); return vget_high_s16(a); });
	run("vget_lane_s32", [] { int32x2_t a = s32x2(); return vdup_n_s32(vget_lane_s32(a, 1)); });
	run("vgetq_lane_u32", [] { uint32x4_t a = u32x4(); return vdupq_n_u32(vgetq_lane_u32(a, 2)); });
	run("vset_lane_s16", [] { int16x4_t a = s16x4(); int16_t b = random16(); return vset_lane_s16(b, a, 3); });
	run("vset_lane_u16", [] { uint16x4_t a = u16x4(); uint16_t b = (uint16_t)random16(); return vset_lane_u16(b, a, 1); });
	run("vsetq_lane_s32", [] { int32x4_t a = s32x4(); int32_t b = random32(); return vsetq_lane_s32(b, a, 2); });
	run("vsetq_lane_u32", [] { uint32x4_t a = u32x4(); uint32_t b = (uint32_t)random32(); return vsetq_lane_u32(b, a, 0); });
	run("vld1q_lane_u32", [] { uint32x4_t a = u32x4(); uint32_t b = (uint32_t)random32(); return vld1q_lane_u32(&b, a, 3); });
	run("vrev64q_s32", [] { int32x4_t a = s32x4(); return vrev64q_s32(a); });
	run("vtrnq_s32", [] { int32x4_t a = s32x4(), b = s32x4(); return vtrnq_s32(a, b); });
	run("vzipq_s32", [] { int32x4_t a = s32x4(), b = s32x4(); return vzipq_s32(a, b); });
	run("vld2q_s32", [] {
		int32_t a[8];
		for (int32_t& x : a) {
			x = random32();
		}
		return vld2q_s32(a);
	});
	run("vld4q_s16", [] {
		int16_t a[32];
		for (int16_t& x : a) {
			x = random16();
		}
		return vld4q_s16(a);
	});
	run("vst2q_s32", [] {
		int32x4x2_t v;
		v.val[0] = s32x4();
		v.val[1] = s32x4();
		int32_t a[8];
		vst2q_s32(a, v);
		int32x4x2_t result;
		result.val[0] = vld1q_s32(a);
		result.val[1] = vld1q_s32(a + 4);
		return result;
	});
	return 0;
}
