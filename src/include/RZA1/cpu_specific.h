// The device's memory map, moved to the bottom of wasm memory. At the device's own addresses, wasm memory has to start
// at over 512MB, and a phone may refuse to make one that big (docs/CLOUD.md 0.1). The firmware finds its memory only
// through these macros, and its checks rely only on their order: SDRAM, then on-chip RAM, then everything else.
#pragma once

#include_next "RZA1/cpu_specific.h"

#undef EXTERNAL_MEMORY_BEGIN
#undef EXTERNAL_MEMORY_END
#undef UNUSED_MEMORY_SPACE_ADDRESS
#undef INTERNAL_MEMORY_BEGIN

// Where a voice writes the rest of a cache it has stopped using. On the device, it's an address nothing is mapped to.
#define UNUSED_MEMORY_SPACE_ADDRESS 0x00100000
#define EXTERNAL_MEMORY_BEGIN 0x00400000
#define EXTERNAL_MEMORY_END 0x04400000
#define INTERNAL_MEMORY_BEGIN 0x04400000uL
