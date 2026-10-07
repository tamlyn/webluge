// Shadows DelugeFirmware/src/arm_neon_shim.h, which under clang declares only the NEON types. Emscripten's
// arm_neon.h (SIMDe) implements the intrinsics too, exactly for the ones the firmware uses (tests/golden/neon).
#pragma once
#include <arm_neon.h>
