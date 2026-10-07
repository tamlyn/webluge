# ARM-only code in the firmware

Every place where the firmware's behaviour depends on the ARM CPU or the ARM compiler, and what the host build does about it. Checked at firmware 1.2.1 (`c23bc2fe`). Re-check on every upstream upgrade (see [UPSTREAM.md](UPSTREAM.md)) by rerunning these searches from `DelugeFirmware/src` and comparing with the table:

```sh
grep -rnE '__arm__|__ARM_|__aarch64__|HAVE_NEON' deluge OSLikeStuff
grep -rnE '\basm\b|__asm' deluge OSLikeStuff
find deluge OSLikeStuff -iname '*.s'
grep -rln 'arm_neon' deluge NE10
grep -rhoE '\bv[a-z0-9]+(_lane|_n|_high|_low)?_[su](8|16|32|64)\b' deluge NE10/modules/dsp | sort -u
```

"Exact" means a golden test in `tests/golden` shows the host output matches the ARM output bit for bit. `tests/golden/check.sh` runs them all.

| Site | What it is | Affects audio? | Host |
|---|---|---|---|
| `util/fixedpoint.h` | `smmul`, `smmulr`, `smmlar`, `smmlsr`, `ssat`, `qadd`, `clz` as inline asm | Yes, throughout the DSP | Exact. The host fallbacks were wrong; fixed in the fork. Test: `fixedpoint` |
| `util/functions.h`, `swapEndianness32`/`2x16` | `rev`, `rev16` as inline asm, with no `__arm__` guard | Only via AIFF header parsing | Exact. Guarded, with a portable fallback, in the fork. Test: `fixedpoint` |
| `dsp/dx/neon_fm_kernel.s` | DX7 "modern" engine operator kernel. Used on the device: `HAVE_NEON` is defined in `fm_op_kernel.cpp`, and `setEngineMode` defaults to `neon = true` | Yes, every DX7 voice not on the MkI engine | Exact. Ported to `src/dsp/neon_fm_kernel.cpp`. Test: `dx7_kernel` |
| NEON intrinsics in `model/voice/voice.cpp`, `storage/wave_table/wave_table.cpp`, `processing/render_wave.h`, `processing/vector_rendering_function.h`, `dsp/interpolation/interpolate.h`, `model/sample/sample_low_level_reader.{h,cpp}`, `processing/live/live_pitch_shifter_play_head.{h,cpp}`, and NE10's int32 FFT (`NE10/modules/dsp/*.neonintrinsic.*`) | Oscillators, sample interpolation, wavetables, FFT | Yes | Exact. Emscripten's `arm_neon.h` (SIMDe) matches ARMv7 for every integer intrinsic used, and every valid shift immediate. Test: `neon`. The build must supply it in place of `src/arm_neon_shim.h`, which only defines the types under clang (2.2) |
| argon `Neon64<float>` in `dsp/reverb/mutable/cosine_oscillator.hpp` | Float NEON wrapper for the Mutable reverb's LFO | Yes | argon doesn't compile with clang, so `src/include/argon.hpp` replaces it with scalar code doing the same operations in the same order. Should match, as the values stay clear of denormals (where NEON flushes to zero), but GCC may reorder float maths on the device (see compiler flags). No golden test |
| `io/debug/print.{h,cpp}` | PMU cycle counter via `MRC`/`MCR p15` | No, debug timing only | Guarded with `__arm__` in the fork; the counter reads 0 |
| `OSLikeStuff/timers_interrupts/timers_interrupts.h` | `CPSID`/`CPSIE` with barriers, to disable and enable interrupts | No | Guarded with `__arm__` in the fork. No-ops: the host has no interrupts |
| `deluge.cpp:981` | `asm volatile("nop")` in a busy-wait | No | `nop` is also a wasm instruction, so it compiles as is |
| `util/chainload.{cpp,S}` | Boots another firmware image | No | Leave out of the build |
| `drivers/cache/invalidate.S` | Cache maintenance | No | Leave out of the build (driver) |
| `src/c_lib_alternatives.S` (outside `src/deluge`) | Assembly `memset`, `memmove` | No | Leave out of the build; use libc |

## Compiler flags

| Flag | Where | Effect | Host |
|---|---|---|---|
| `-funsafe-math-optimizations` | `scripts/cmake/CMakeToolchainDeluge.cmake` | Lets GCC run scalar float maths on NEON (which flushes denormals to zero), reassociate, and use reciprocal approximations | Can't be reproduced: the result depends on GCC's choices at each site. The host uses strict IEEE maths, so float code (reverbs, compressor, parts of DX7) will differ in the last bits |
| `-fsigned-char` | `CMakeLists.txt` | `char` is signed, unlike the ARM default | wasm `char` is signed too. Matches |
| (none; newlib) | arm-none-eabi toolchain | `int32_t` is `long`, not `int` | On wasm it's `int`. Same size and range, so arithmetic matches; only overload and template deduction differ, which shows up as compile errors |
| `-mcpu=cortex-a9 -mfpu=neon` | toolchain file | VFPv3 has no fused multiply-add, so the device never fuses | Host must build with `-ffp-contract=off`; `-ffp-contract=fast` fuses even where a pragma forbids it |

## Runtime behaviour

Behaviour of the device's CPU and runtime libraries that no search finds, because it's in ordinary C++.

| Behaviour | Device | Host |
|---|---|---|
| Integer division by zero | The Cortex-A9 has no divide instruction, so GCC calls libgcc's division routines. Dividing by zero returns a value instead of trapping: 0 for 0/0, otherwise all ones for unsigned 64-bit division (`__aeabi_uldivmod`) and the saturated value for signed | wasm's `div` traps. Each site that can divide by zero is fixed in the fork to give the device's result as it turns up: so far `Sample::fillPercCache` (4.3) |

## Hardware registers outside the drivers

Not ARM-specific, but the same problem: firmware code outside `src/deluge/drivers` that reads or writes the RZ/A1's peripheral registers directly. On the host those addresses are outside wasm memory, so the access traps. `scripts/find_register_access.sh` lists the functions in the built wasm that do this; rerun it after each upgrade.

| Registers | Used by | Host |
|---|---|---|
| MTU2 timers (`0xFCFF0000`) | `delayMS`/`delayUS`, `seedRandom`, audio and MIDI-gate timing | `src/include/RZA1/mtu/mtu.h` moves them into host memory, and counters follow the host clock (`src/hal/mtu.c`) |
| ADC (`0xE8005800`) | `inputRoutine`, battery voltage | Not yet: `inputRoutine` isn't called |
| DMAC (`0xE8200000`) | `deluge_main`, `OLED::freezeWithError` | Not called on the host |
| Uncached mirror (`+0x40000000`) | `bufferPICUart`, `bufferMIDIUart` | `seam:` in the fork sets the offset to 0 on the host |
