// Shadows argon (github.com/stellar-aria/argon), whose clang path takes references to vector lanes, which clang
// doesn't allow. The firmware only uses Neon64<float>, in the Mutable reverb's LFO (cosine_oscillator.hpp), so
// this provides just that, lane by lane. The values stay far from the denormal range, where NEON's
// flush-to-zero would differ, so the results match the device.
#pragma once

#include <array>
#include <cstddef>
#include <initializer_list>

namespace argon {

template <typename T>
class Neon64;

template <>
class Neon64<float> {
public:
	static constexpr int lanes = 2;

	constexpr Neon64() = default;
	constexpr Neon64(float value) : lanes_{value, value} {}
	constexpr Neon64(std::initializer_list<float> values) {
		int i = 0;
		for (float value : values) {
			lanes_[i++] = value;
		}
	}

	constexpr float& operator[](size_t i) { return lanes_[i]; }
	constexpr float operator[](size_t i) const { return lanes_[i]; }
	constexpr size_t size() const { return lanes; }

	template <typename Body>
	constexpr void each_lane(Body body) {
		for (int i = 0; i < lanes; ++i) {
			body(lanes_[i], i);
		}
	}

	friend constexpr Neon64 operator+(Neon64 a, Neon64 b) { return {a[0] + b[0], a[1] + b[1]}; }
	friend constexpr Neon64 operator-(Neon64 a, Neon64 b) { return {a[0] - b[0], a[1] - b[1]}; }
	friend constexpr Neon64 operator*(Neon64 a, Neon64 b) { return {a[0] * b[0], a[1] * b[1]}; }

private:
	std::array<float, lanes> lanes_{};
};

} // namespace argon
