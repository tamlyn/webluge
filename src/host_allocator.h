#pragma once

#include <cstdio>
#include <cstdlib>
#include <vector>

namespace webluge {

// Allocates from Emscripten's heap. The firmware routes operator new to its own allocator (memory/operators.cpp),
// which manages only the device's RAM, so anything that isn't the Deluge's own memory, such as the card, uses this.
template <typename T>
struct HostAllocator {
	using value_type = T;

	HostAllocator() = default;
	template <typename U>
	HostAllocator(const HostAllocator<U>&) {}

	T* allocate(size_t n) {
		// wasm doesn't trap on null pointers, so a failed allocation must stop here.
		T* p = static_cast<T*>(std::malloc(n * sizeof(T)));
		if (!p) {
			std::fprintf(stderr, "Out of host memory allocating %zu bytes\n", n * sizeof(T));
			std::abort();
		}
		return p;
	}
	void deallocate(T* p, size_t) { std::free(p); }

	template <typename U>
	bool operator==(const HostAllocator<U>&) const {
		return true;
	}
};

template <typename T>
using HostVector = std::vector<T, HostAllocator<T>>;

} // namespace webluge
