# Webluge plan

Play a Deluge song (XML + samples) in the browser, sounding the same as the hardware.

This is a living document. When we learn something that changes the plan, add it to the **Discoveries** log, update the affected phases, and record any decision in **Decisions**. Tick a checkpoint only when its verification has actually passed.

## Approach

Compile the whole of `DelugeFirmware/src/deluge` to WebAssembly and replace only the hardware layer (`src/RZA1`, `src/deluge/drivers`, the task scheduler and timers). We don't extract the synth engines on their own, because the sequencer, automation, param smoothing and song model all shape the sound, and they're tightly coupled to the audio engine.

Keep our changes to the firmware small and replayable, so that a new upstream release (e.g. 1.3.0) means replaying a known list of changes rather than redoing the port. [UPSTREAM.md](UPSTREAM.md) has the rules, the upgrade runbook and a log of what each release needed.

## Non-goals (for now)

- Native Mac app. arm64 macOS has no 32-bit mode, and the firmware assumes 32-bit pointers. wasm32 matches.
- Editing songs, the pad/button UI, MIDI, recording, saving.
- Modelling the device's analogue output stage.

## Phases and checkpoints

Each checkpoint has a verification step that anyone can run. Tick a box only when its verification passes.

### Phase 0: Foundations

- [x] **0.1 Firmware as a pinned dependency.** `DelugeFirmware` is a git submodule pointing at our fork (`tamlyn/DelugeFirmware`), pinned to the `release_1_2_1` tag (`c23bc2fe`). The submodule's `upstream` remote points at `SynthstromAudible/DelugeFirmware`.
  *Verify:* `git submodule status` shows `c23bc2fe`; a fresh clone with `--recurse-submodules` gets the firmware.
- [x] **0.2 Toolchain.** Emscripten, Node, CMake and Ninja installed through mise, versions pinned in `mise.toml`.
  *Verify:* `mise install` then `mise exec -- emcc --version` and `mise exec -- node --version` match `mise.toml`.
- [ ] **0.3 Reference recordings.** At least three test songs, each with its own samples, recorded on a real Deluge running firmware 1.2.1. Use stem export, which writes WAVs to the SD card. Choose the songs to cover:
  - subtractive synth only (no reverb, no samples), as the integer-only case;
  - sample-based kit with timestretch;
  - FM (DX7), reverb, compressor and sidechain, as the float-heavy case.
  
  *Verify:* `reference/1.2.1/<song>/` contains the song XML, the samples and the device WAVs, and `reference/1.2.1/README.md` records the firmware version and export settings.

### Phase 1: Exact fixed-point maths

The host fallbacks in `src/deluge/util/fixedpoint.h` don't match the ARM instructions:

- `multiply_32x32_rshift32_rounded`, `multiply_accumulate_…_rounded` and `multiply_subtract_…_rounded` don't round;
- `signed_saturate` clamps only the upper bound, and to the wrong value;
- `add_saturation` doesn't saturate;
- `clz` is undefined for 0, where ARM returns 32.

Every checkpoint in this phase is verified by `tests/golden/check.sh`, which builds each harness natively and with Emscripten and compares its output with golden output from ARMv7. `tests/golden/generate.sh` makes the golden output by building the same harness against the ARM code and running it in a Docker `linux/arm/v7` container.

- [x] **1.1 Bit-exact host versions** of `smmul`, `smmulr`, `smmlar`, `smmlsr`, `ssat`, `qadd` and `clz`, following the ARM Architecture Reference Manual pseudocode.
  *Verify:* we run randomised and edge-case vectors (0, ±1, `INT32_MIN`, `INT32_MAX`, saturation boundaries). The host versions must match golden outputs from the real ARM instructions for every vector. Generate the golden outputs once by compiling the `__arm__` code paths for ARMv7 and running them in a Docker `linux/arm/v7` container.
- [x] **1.2 Upstream unit tests still pass** with the corrected fallbacks.
  *Verify:* the firmware's `tests/unit` suite passes.
- [x] **1.3 Audit other ARM-only code paths**: anything else guarded by `__arm__`, plus inline asm in `util/functions.h`.
  *Verify:* we have a list of every `__arm__`/`asm` site in `src/deluge`, each marked as having an exact host equivalent or being irrelevant to audio. See [ARM_AUDIT.md](ARM_AUDIT.md).
- [x] **1.4 DX7 NEON kernel.** The device runs the DX7 "modern" engine through `dsp/dx/neon_fm_kernel.s`, which computes sine with a float polynomial, not the lookup table in the C++ fallback. Port it to C++ in this repo.
  *Verify:* the `dx7_kernel` golden test matches for every block size `FmCore::render` can request, with and without modulation and accumulation, and at extreme gains.
- [x] **1.5 NEON intrinsics are exact under Emscripten.** Emscripten's `arm_neon.h` is SIMDe; check it against ARMv7 for every integer intrinsic the firmware and NE10 use.
  *Verify:* the `neon` golden test matches, covering edge-value pairs for the saturating, rounding and halving operations and every valid shift immediate.

### Phase 2: Whole firmware compiles and boots under Emscripten

Build with `mise exec -- emcmake cmake -B build -G Ninja` then `mise exec -- ninja -C build`. Run the host tests with `mise exec -- ctest --test-dir build`.

- [x] **2.1 Build system.** A CMake project in this repo that compiles `src/deluge` and FatFs with Emscripten, excluding the hardware sources and the ARM-only files in [ARM_AUDIT.md](ARM_AUDIT.md), and adding `src/dsp/neon_fm_kernel.cpp`. Flags: `-msimd128`, NEON translation enabled, `-ffp-contract=off` (never `fast`, see 1.4), no fast-math.
  *Verify:* `cmake --build` produces a `.wasm` and JS loader with zero unresolved symbols (`-sERROR_ON_UNDEFINED_SYMBOLS=1`).
- [x] **2.2 NEON code compiles to wasm SIMD**: the files using NEON intrinsics (`render_wave.h`, `vector_rendering_function.h`, `wave_table.cpp`, `voice.cpp`, `interpolate.h`, `sample_low_level_reader`, `live_pitch_shifter_play_head`, NE10's int32 FFT), plus the argon user `cosine_oscillator.hpp`. Under clang, `src/arm_neon_shim.h` defines only the NEON types, not the intrinsics, so put a replacement that includes `<arm_neon.h>` earlier on the include path.
  *Verify:* the 2.1 build succeeds with no scalar rewrites. Any intrinsic Emscripten can't translate gets a hand-written fallback, logged in Discoveries.
- [x] **2.3 Stub hardware layer** (`src/hal`). No-op or minimal implementations of the following, with the device's SDRAM and on-chip RAM kept at their own addresses in wasm memory:
  - the pad/button controller (PIC) over UART;
  - the OLED and 7-segment display;
  - USB, MIDI and CV;
  - the timers;
  - the SD card.
  
  *Verify:* `node build/webluge.js` runs firmware initialisation to the point of setting up a blank song (`setupBlankSong`) and exits cleanly, logging that it got there. Since Phase 3 the CLI boots only to load a song, so 3.3's check covers this.
- [x] **2.4 32-bit pointer assumptions.** Nothing to fix on wasm32, but note any casts that break the build.
  *Verify:* the build has no pointer-truncation warnings, or each remaining one is explained in Discoveries.

### Phase 3: Storage

Samples stream from the SD card by mapping FAT clusters straight to sector reads, so a real FAT filesystem is required.

- [x] **3.1 In-memory block device.** FatFs's disk layer (`src/hal/diskio.c`) backed by a byte array.
  *Verify:* `ctest` (`tests/storage`) formats the array with `f_mkfs`, writes files, reads them back byte-identical, and reads the clusters through `clst2sect` + `disk_read`.
- [x] **3.2 Image builder.** Build a FAT image from a directory tree laid out like the Deluge SD card (`SONGS/`, `SAMPLES/`, …), using FatFs itself: `node build/webluge.js image <folder> <image>`.
  *Verify:* the CLI builds an image from `reference/1.2.1/<song>/card/`, `hdiutil attach` on macOS mounts it with the same files and contents (`diff -r`), and `fsck_msdos -n` finds no errors. (`mdir` would need mtools from Homebrew.)
- [x] **3.3 Song load.** Load a song XML through the firmware's own storage manager, samples included: `node build/webluge.js load <folder or image> SONGS/<song>.XML`.
  *Verify:* for each reference song, the CLI logs the song name, the number of clips/instruments and the number of audio files loaded; no loading errors and no missing audio files.

  3.2 and 3.3 were first verified with six songs from `~/music/Deluge` (see Discoveries), then rerun on the reference songs in `reference/1.2.1` and the songs in `test-songs/`.

### Phase 4: Offline render (Node CLI)

- [ ] **4.1 Fake audio clock.** Replace the audio driver's output buffer (`getTxBufferStart`/`getTxBufferCurrentPlace`, `src/hal/ssi.c`) with a ring buffer whose read position advances by a fixed block size per tick, and drive the host clock (`src/hal/clock.c`), which feeds the timers, from the same ticks. Run the audio engine without the hardware scheduler.
  *Verify:* rendering the blank song with the metronome on produces a WAV with clicks at the expected tempo, within ±1 sample per beat.
- [ ] **4.2 Single synth note.** Trigger one note on a default synth.
  *Verify:* the output WAV is non-silent, and an FFT confirms the fundamental at the expected frequency within ±1 cent.
- [ ] **4.3 Full song render.** `webluge render <image> <song> out.wav` plays the song from the start for its full length.
  *Verify:* each reference song renders without crashing, its output length matches the device recording within one block, and it isn't silent.
- [ ] **4.4 Match against the device.**
  *Verify:* align each render with its device stem export (cross-correlation), then null-test:
  - integer-only song: residual RMS at least 60 dB below the signal (target: bit-identical apart from block-size effects);
  - float-heavy songs: residual at least 40 dB below, plus a blind A/B listening check by Tamlyn.
  
  Record the numbers in Discoveries. If a song falls short, add a checkpoint to find the cause before moving on.

### Phase 5: Real-time playback in the browser

- [ ] **5.1 Threading.** The firmware runs in a Web Worker; an AudioWorklet pulls audio from it through a lock-free ring buffer in a SharedArrayBuffer. The dev server sends the COOP/COEP headers that SharedArrayBuffer requires.
  *Verify:* `crossOriginIsolated === true` in the page, and the metronome plays in real time.
- [ ] **5.2 Song playback.** Play the reference songs in real time, with the song loaded from a bundled image.
  *Verify:* each reference song plays through in current Chrome and Safari with no underruns, counted by the worklet, and the worker uses less than 50% of one core (measured).
- [ ] **5.3 Real-time matches offline.** Real-time and offline renders of the same song produce the same output.
  *Verify:* capture the worklet's output and null-test it against the Phase 4 WAV; the residual must be identical, given the same block size.

### Phase 6: Load your own songs

- [ ] **6.1 Drop a folder.** Drag in a Deluge SD card folder (or pick it), build the FAT image in the browser, list the songs and play one.
  *Verify:* dropping a copy of a real SD card folder lists every song in `SONGS/`, and a chosen song plays with its samples.
- [ ] **6.2 Transport.** Play, stop and restart from the beginning.
  *Verify:* stopping and replaying gives the same output as the first play (null test on the captured output).

## Known differences from the device

These are expected, and we accept them unless a listening test says otherwise.

- **Render block size.** On the device it varies with CPU load, and modulation updates once per block. We use a fixed block size. Expected effect: tiny, inaudible.
- **Voice culling.** An overloaded Deluge drops voices; the host won't, so heavy songs may sound cleaner than on the device. If this matters, we could model the device's CPU cost.
- **Float maths** (reverbs, compressor, parts of DX7). The device firmware is built with `-funsafe-math-optimizations`, so GCC runs float maths on NEON (flushing denormals to zero) and may reassociate it. That can't be reproduced, and maths library functions differ too, so the last few bits may differ. The DX7 NEON kernel is the exception: it's hand-written assembly, so its float maths is exact (1.4).

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-07 | Card images use 32KB clusters and are sized to their contents, so the FAT type follows from the size (FAT12 below 128MB, FAT16 below 2GB). Real cards are FAT32 | The firmware's streaming works in clusters, so the cluster size matches a real card. FAT32 needs at least 65,525 clusters, a 2GB image held in memory. The FAT type is invisible to the firmware: FatFs reads all three, and sample streaming only uses `clst2sect` and `get_fat` |
| 2026-10-07 | Load songs the way `setupStartupSong` does: set the song path, open `loadSongUI` and call `performLoad`, with only the scheduler's cluster-loading task registered | The same code as picking a song on the device, including the fallback to samples collected in the song's own folder. `performLoad` waits on the scheduler to fetch sample clusters; the rest of `deluge_main`'s tasks are for Phase 4 to settle |
| 2026-10-07 | Card images live in Emscripten's heap (`HostAllocator`), not the firmware's allocator | The firmware's `operator new` serves only the device's 64MB of SDRAM, which a card image would exhaust and which the firmware needs for samples |
| 2026-10-07 | Convert host file names to code page 437 when building an image, skip names that can't be converted, and skip hidden files | The firmware sees names in code page 437 (`ffconf.h`), as it would read a real card's long names. Hidden files are host metadata (`.DS_Store`, sync state) |
| 2026-10-07 | `load` accepts a card folder as well as an image | Building the image in memory is the path the browser will take (6.1), so the CLI exercises it too |
| 2026-10-07 | Keep the device's memory map in wasm memory: SDRAM at `0x0C000000` and on-chip RAM at `0x20000000`, with Emscripten's own memory starting above them (`-sGLOBAL_BASE`) | The firmware hard-codes these addresses in several places (allocator, `d_string`, `resizeable_array`). Keeping them means one small seam for the linker symbols instead of patching each site. Untouched wasm memory costs nothing, so the gap is free |
| 2026-10-07 | Boot from our own `src/main.cpp`, following `deluge_main` without its hardware setup | `deluge_main` reads DMA registers in its first lines, and making it runnable would need seams throughout. The boot sequence is short; the runbook compares it with `deluge_main` on each upgrade |
| 2026-10-07 | Replace hardware headers from `src/include`, which comes first on the include path: wrap with `#include_next` where possible (MTU2), shadow outright only when the original can't compile (argon, `arm_neon_shim.h`) | No fork changes, and a wrapper keeps the original's definitions, so upstream edits still reach us |
| 2026-10-07 | The host clock is virtual and moves on each time it's read | Deterministic runs (the firmware seeds its random numbers from a timer), and busy-waits on a timer still finish |
| 2026-10-07 | Exit with `_Exit`, skipping global destructors | The device never tears down its globals, and they can't be: the memory allocator is destroyed before objects that free memory through it (E339) |
| 2026-10-07 | Replace the DX7 NEON kernel by providing `neon_fm_kernel` from this repo, rather than patching the firmware | The symbol is a clean seam, so the fork needs no change |
| 2026-10-07 | Accept QEMU's ARMv7 emulation as the source of golden outputs | Apple silicon has no AArch32, so real ARMv7 silicon would mean extra hardware. QEMU's integer and NEON emulation is well tested, and 4.4's null tests against the device would catch any discrepancy |
| 2026-10-07 | Pin the firmware to 1.2.1 and update the hardware to match (was 1.2.0) | No references recorded yet, so switching is free. 1.2.1 fixes clicks during sample loading; the host loads instantly and wouldn't reproduce them, so they'd pollute the comparisons |
| 2026-10-07 | Firmware changes go in a per-release patch series on the fork; everything else stays in this repo (see UPSTREAM.md) | So 1.3.0 and later releases are a rebase, not a restart |
| 2026-10-07 | Manage project tools with mise (`mise.toml`) | Tamlyn's preference for project dependencies |
| 2026-10-07 | Target WebAssembly, not a native Mac app | wasm32 matches the firmware's 32-bit pointer assumptions; native arm64 doesn't |
| 2026-10-07 | Port the whole firmware with a replacement hardware layer, rather than extracting the DSP | The sound depends on the sequencer, params and song model, not just the voice engines |
| 2026-10-07 | Keep FatFs and back it with an in-memory disk image | Sample streaming reads raw sectors by FAT cluster, bypassing the file API |
| 2026-10-07 | Offline Node renderer before real-time browser playback | Deterministic output we can null-test against device recordings |

## Discoveries

Newest first. Note anything that contradicts or changes the plan, and link to the checkpoint it affects.

- **2026-10-07** Reference songs (0.3):
  - `reference/1.2.1` has three purpose-made songs with stem exports: two subtractive synths and an 808 kit. Neither 0.3's timestretch case nor its FM/reverb case is covered yet: no song has timestretch, FM, the DX7 engine or reverb.
  - Stem exports are one mono WAV per clip, so 4.4 must render clips one at a time, soloed, to compare against them.
  - Four bigger songs from the same card are kept out of the repo, in `test-songs/` (gitignored), for manual testing. Two are in arranger mode, and one has FM sounds, audio clips and a 293MB Steinway multisample. Some have device recordings, but these are resample or whole-song recordings, not stem exports.
  - All seven load with nothing missing (3.3), and their images pass 3.2's checks. Each opens in the view it was saved in: arranger for the two arranger songs.
  - Leak check:
    - Loading all seven in one boot, four times over, leaves nothing behind in any of the firmware allocator's regions.
    - The one exception is `Song::setSongFullPath`, which leaks its `new[]` buffer (about 85 bytes). On the device only `setupStartupSong` calls it, once, but `webluge::loadSong` calls it for every song. Upstream has since fixed it with a stack array, so it'll go when we upgrade.
    - The check hooked `MemoryRegion::alloc`/`dealloc` temporarily. Linking without wasm-opt (`-O0`) and with `--profiling-funcs` gives usable stacks; otherwise binaryen inlines across files and the stacks stop at `main`.
  - Memory safety:
    - ASan isn't available: Emscripten's ASan doesn't support a custom `GLOBAL_BASE`.
    - `-sSAFE_HEAP=2 -sASSERTIONS=1` runs the storage test and all seven loads clean. `SAFE_HEAP=1` flags the firmware's deliberate unaligned accesses. `SAFE_HEAP` only traps address 0 itself, not null plus an offset.
  - Arranger playback has to wait for phase 4; render the arranger songs then too.

- **2026-10-07** Phase 3 findings:
  - Verified with `SONG060` (samples collected into `SONGS/SONG060/`, so loading uses the firmware's fallback to the song's own folder), `Acid`, `Amapiano Fm`, `Bells` (212 samples), `Chops` and `Car Jam`, each with only the files it references. All load with every audio file found, every sample's first cluster in memory and the loading queue empty. Images of 5MB (FAT12) and 518MB (FAT16) mount in macOS identical to their folders.
  - The firmware's `operator new` (`memory/operators.cpp`) is its own allocator, so host code's standard library allocations (strings, paths, streams) come out of the device's SDRAM too. That's harmless for small, short-lived ones, but a card image doesn't fit (3.1).
  - wasm doesn't trap on null pointers. When the firmware's allocator fails, `new` returns null, and writes through it land silently in low memory. The first storage test did exactly that with a 64MB `std::vector` and crashed only later, in an unrelated `delete`.
  - On the device, a missing sample doesn't fail a song load: `Source::loadAllSamples` discards `loadFile`'s error and the sound goes quiet. The CLI finds missing files itself, walking the song as `Song::loadAllSamples` does, and fails if any are missing, because a render without them wouldn't match the device (4.3).
  - Given a song that isn't on the card, the song browser opens the nearest file instead, so the CLI checks that the song exists first.
  - Song loading runs the audio engine: `Source::loadAllSamples` and `Song::loadAllSamples` call `AudioEngine::routineWithClusterLoading` every few sounds, as the device does to keep playing while it loads. Phase 4's audio clock must decide what those calls render (4.1).
  - `ffconf.h` disables `f_mkfs`, so a fork seam lets the host build enable it. The firmware's FatFs is modified to export `clst2sect` and `get_fat_from_fs` for sample streaming.
  - `deluge.h` declares `int main(void)`, so the CLI's `main` lives in a file that includes no firmware headers.
  - Nine sample names in `~/music/Deluge` contain characters outside code page 437 (they look like names already mangled by an earlier copy), so images built from it skip them.

- **2026-10-07** Phase 2 findings:
  - The firmware only builds with GCC and newlib. clang and libc++ needed fixes in the fork (2.1):
    - missing includes, which libstdc++ supplied transitively or the DSP library's unity build hid (`filter.cpp` gets `definitions.h` from a neighbouring file);
    - `int32_t` is `long` on arm-none-eabi but `int` on wasm, which breaks `std::max(u, 0L)`;
    - `std::array` iterators used as pointers, `strrchr` returning `char*` for a `const char*`, and a misplaced `__restrict__`;
    - `Language`'s name is a `std::string` built in a `consteval` constructor. "Seven Segment" fits libstdc++'s 15-character small-string buffer but not libc++'s 10.
  - argon, the NEON wrapper used for the Mutable reverb's LFO, doesn't compile with clang: it binds references to vector lanes. It's only used for a two-lane float vector, so `src/include/argon.hpp` replaces it with a scalar one doing the same operations in the same order (2.2). Nothing else needed a fallback.
  - The 1.3 audit missed inline asm in `OSLikeStuff/timers_interrupts.h`, because its searches only covered `src/deluge`. The searches now include `OSLikeStuff`.
  - Firmware code outside the drivers reads hardware registers directly (`scripts/find_register_access.sh` lists them):
    - the MTU2 timers: `delayMS`/`delayUS` busy-wait on them, `seedRandom` seeds the noise generator from one, and the audio and MIDI-gate code read them for timing;
    - the ADC in `inputRoutine` (battery voltage);
    - DMA registers in `deluge_main`, and the OLED's error screen;
    - the PIC and MIDI UART buffers, written through the uncached memory mirror at `+0x40000000`.
    
    The MTU2 registers now live in host memory (2.3). The others don't run yet; `inputRoutine` will matter in Phase 4 if we call it.
  - Because the device seeds its random numbers from a timer, anything using noise or randomness differs on every boot. Songs that use it can't null-test against a device recording (4.4).
  - Whether the engine renders in stereo depends on the jack-detect pins (`inputRoutine`): headphones or the right line out. The host reports headphones plugged in.
  - Settings live in SPI flash, which the host reports as erased, so the firmware uses its defaults. The device's own settings may differ; see Open questions.
  - The 1.2.1 release still says `VERSION 1.2.0` in its CMakeLists.txt, so the device reports itself as c1.2.0. The host build takes the version from there, so it matches.
  - wasm-ld only reports undefined symbols in code it keeps, so dead code hides missing hardware functions. Linked with `--no-gc-sections`, the only undefined symbol is NE10's float FFT allocator, which the device's link drops too.
  - No pointer-truncation warnings (2.4): pointers are 32 bits on both. `-Wshorten-64-to-32` reports 334 sites, but they're deliberate 64-to-32-bit arithmetic, identical on ARM.

- **2026-10-07** Phase 1 findings ([ARM_AUDIT.md](ARM_AUDIT.md) has the full list):
  - The DX7 NEON assembly *is* used on the device, contradicting the survey below: `fm_op_kernel.cpp` defines `HAVE_NEON`, `setEngineMode` defaults to `neon = true`, and `dsp/CMakeLists.txt` globs `*.s`. It computes sine with a float polynomial, so the C++ fallback sounds different. Added 1.4 and ported it; the port matches bit for bit.
  - The device build uses `-funsafe-math-optimizations` (`scripts/cmake/CMakeToolchainDeluge.cmake`), which confirms that float paths can't be bit-exact. Updated **Known differences**.
  - `smmlar`/`smmlsr` round the 64-bit sum rather than the product, so `smmlsr` is not `sum - smmulr(a, b)`: they differ when the product's low word is exactly `0x80000000`.
  - `swapEndianness32`/`2x16` in `util/functions.h` were unguarded inline asm, so the host build would fail; fixed in the fork.
  - `gui/l10n/language.h` uses `std::copy` without including `<algorithm>`. Current libc++ (Apple clang, and so Emscripten) doesn't include it transitively, so the unit tests didn't build on macOS. Fixed in the fork.
  - Under clang, `src/arm_neon_shim.h` defines only the NEON types, not the intrinsics (2.2). Emscripten's `arm_neon.h` is SIMDe, and is exact for every integer intrinsic the firmware uses (1.5).
  - The golden outputs come from QEMU, not silicon: the container reports a Cortex-A57 on an Apple M4, which has no AArch32.
  - The 32-bit memory manager tests (`tests/32bit_unit_tests`) only build on Linux with `-m32`, so 1.2 ran `tests/unit` and `tests/spec` only.
  - Golden tests compile with `-ffp-contract=off`. `-ffp-contract=fast` breaks the DX7 kernel even with `#pragma STDC FP_CONTRACT OFF` or `#pragma clang fp contract(off)`, because the backend fuses regardless.

- **2026-10-07** Docker on this Mac runs `linux/arm/v7` containers (`uname -m` prints `armv7l`), so we can generate the ARM golden vectors for 1.1 there.
- **2026-10-07** `~/music/Deluge` is a synced copy of the SD card: about 250 songs, kits, synths and samples, and a good source of test songs for 0.3. It has no usable reference recordings: `SAMPLES/RECORD` and `RESAMPLE` are empty, and the only matching audio elsewhere (`Ableton/Projects/Loops/Acid Project/Acid.mp3`) is an Ableton render in a lossy format. Most songs were last saved by official firmware 4.0–4.1, so 3.3 also exercises the community firmware's loading of older song files. `SONGS/SONG060` is self-contained: its samples are collected next to the XML.
- **2026-10-07** 1.2.1 differs from 1.2.0 in only three source commits: #3266 moves the record point before volume, #3680 fixes clicks during sample cluster loading, and a CMake build fix. The findings below were checked at both versions and hold for both.
- **2026-10-07** Initial survey of firmware commit `c23bc2fe`:
  - ~~The DX7 NEON assembly (`neon_fm_kernel.s`) is unused on the device because `HAVE_NEON` is never defined, so the C++ path is the reference.~~ Wrong; see the Phase 1 findings above.
  - The firmware already has `IN_UNIT_TESTS` hooks in the memory allocator, which we can reuse for 2.3.
  - The audio engine works out its render window from the position of the audio hardware's output buffer (`getTxBufferCurrentPlace`), and its voice culling depends on that window size.
  - Hardware drivers live in `src/deluge/drivers` as well as `src/RZA1`.

## Open questions

- **Stem export as reference.** Is stem export bit-identical to normal playback, or does it change the engine's behaviour (e.g. block size, culling)? Check `processing/stem_export` before relying on it for 4.4.
- **Block size.** Which fixed block size best approximates typical device behaviour? Look at the `numSamples` distribution on the device, using the existing debug logging.
- **Device settings.** Do any of the settings in the device's SPI flash change playback? If so, record them with the reference songs and feed them to the host, which currently uses the defaults. Settings on the card (`CommunityFeatures.XML`, MIDI devices, MIDI follow) already come from the image, so reference songs should include them.
- **Upstream.** Would they accept the corrected host fixed-point maths, and perhaps a hardware-replacement layer that could make a host build an official target?
