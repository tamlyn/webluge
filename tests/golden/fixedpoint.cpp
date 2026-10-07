// Prints the result of every fixed-point primitive for a fixed set of inputs, one vector per line.
// Built for ARMv7 it exercises the real instructions and produces the golden file; built for the host it
// exercises the fallbacks, and the output must match the golden file exactly.

#include <algorithm>
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <utility>

#include "util/fixedpoint.h"
#include "util/functions.h"

namespace {

const int32_t edges[] = {
    0,           1,           -1,          2,          -2,         0x7FFF,      0x8000,
    -0x8000,     0x10000,     -0x10000,    0x3FFFFFFF, 0x40000000, -0x40000000, INT32_MAX - 1,
    INT32_MAX,   INT32_MIN,   INT32_MIN + 1, 0x55555555, (int32_t)0xAAAAAAAA, 12345678,
};

// Accumulator values for the multiply-accumulate ops, kept small to bound the file size.
const int32_t sumEdges[] = {0, 1, -1, 0x40000000, INT32_MAX, INT32_MIN};

constexpr int numRandom = 1000;

// splitmix64, so every compiler and platform generates the same inputs.
uint64_t rngState = 0x5EED5EED5EED5EEDull;
uint64_t next() {
	uint64_t z = (rngState += 0x9E3779B97F4A7C15ull);
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
	z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
	return z ^ (z >> 31);
}

// Uniform 32-bit values are almost all huge, so also randomise the magnitude.
int32_t randomValue() {
	return (int32_t)(uint32_t)next() >> (next() % 32);
}

void print(const char* op, int32_t result, int32_t a) {
	printf("%s %08" PRIx32 " %08" PRIx32 "\n", op, (uint32_t)a, (uint32_t)result);
}
void print(const char* op, int32_t result, int32_t a, int32_t b) {
	printf("%s %08" PRIx32 " %08" PRIx32 " %08" PRIx32 "\n", op, (uint32_t)a, (uint32_t)b, (uint32_t)result);
}
void print(const char* op, int32_t result, int32_t a, int32_t b, int32_t c) {
	printf("%s %08" PRIx32 " %08" PRIx32 " %08" PRIx32 " %08" PRIx32 "\n", op, (uint32_t)a, (uint32_t)b,
	       (uint32_t)c, (uint32_t)result);
}

template <typename F>
void binary(const char* op, F f) {
	for (int32_t a : edges) {
		for (int32_t b : edges) {
			print(op, f(a, b), a, b);
		}
	}
	for (int i = 0; i < numRandom; i++) {
		int32_t a = randomValue();
		int32_t b = randomValue();
		print(op, f(a, b), a, b);
	}
}

template <typename F>
void ternary(const char* op, F f) {
	for (int32_t sum : sumEdges) {
		for (int32_t a : edges) {
			for (int32_t b : edges) {
				print(op, f(sum, a, b), sum, a, b);
			}
		}
	}
	for (int i = 0; i < numRandom; i++) {
		int32_t sum = randomValue();
		int32_t a = randomValue();
		int32_t b = randomValue();
		print(op, f(sum, a, b), sum, a, b);
	}
}

template <uint8_t bits>
void ssat() {
	char op[8];
	snprintf(op, sizeof op, "ssat%d", bits);
	auto test = [&](int32_t val) { print(op, signed_saturate<bits>(val), val); };

	for (int32_t val : edges) {
		test(val);
	}
	int64_t limit = int64_t{1} << (bits - 1);
	for (int64_t val : {limit - 1, limit, limit + 1, -limit - 1, -limit, -limit + 1}) {
		test((int32_t)std::clamp<int64_t>(val, INT32_MIN, INT32_MAX));
	}
	for (int i = 0; i < 100; i++) {
		test(randomValue());
	}
}

template <size_t... bits>
void ssatAll(std::index_sequence<bits...>) {
	(ssat<bits + 1>(), ...);
}

} // namespace

int main() {
	binary("smmul", [](int32_t a, int32_t b) { return multiply_32x32_rshift32(a, b); });
	binary("smmulr", [](int32_t a, int32_t b) { return multiply_32x32_rshift32_rounded(a, b); });
	ternary("smmlar", [](int32_t s, int32_t a, int32_t b) { return multiply_accumulate_32x32_rshift32_rounded(s, a, b); });
	ternary("smmlsr", [](int32_t s, int32_t a, int32_t b) { return multiply_subtract_32x32_rshift32_rounded(s, a, b); });
	binary("qadd", [](int32_t a, int32_t b) { return add_saturation(a, b); });
	ssatAll(std::make_index_sequence<32>());

	for (int32_t val : edges) {
		print("clz", clz(val), val);
	}
	for (int shift = 0; shift < 32; shift++) {
		print("clz", clz(1u << shift), 1u << shift);
		print("clz", clz((1u << shift) - 1), (1u << shift) - 1);
	}
	for (int i = 0; i < numRandom; i++) {
		int32_t val = randomValue();
		print("clz", clz(val), val);
	}

	for (int32_t val : edges) {
		print("rev", swapEndianness32(val), val);
		print("rev16", swapEndianness2x16(val), val);
	}
	for (int i = 0; i < 100; i++) {
		int32_t val = (int32_t)next();
		print("rev", swapEndianness32(val), val);
		print("rev16", swapEndianness2x16(val), val);
	}
	return 0;
}
