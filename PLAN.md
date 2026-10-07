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
  
  *Verify:* `reference/1.2.1/<song>/` contains the song XML, the samples and the device WAVs, and its README records the firmware version and export settings.

### Phase 1: Exact fixed-point maths

The host fallbacks in `src/deluge/util/fixedpoint.h` don't match the ARM instructions:

- `multiply_32x32_rshift32_rounded` doesn't round;
- `signed_saturate` clamps only the upper bound, and to the wrong value;
- `add_saturation` doesn't saturate.

- [ ] **1.1 Bit-exact host versions** of `smmul`, `smmulr`, `smmlar`, `smmlsr`, `ssat`, `qadd` and `clz`, following the ARM Architecture Reference Manual pseudocode.
  *Verify:* we run randomised and edge-case vectors (0, ±1, `INT32_MIN`, `INT32_MAX`, saturation boundaries). The host versions must match golden outputs from the real ARM instructions for every vector. Generate the golden outputs once by compiling the `__arm__` code paths for ARMv7 and running them in a Docker `linux/arm/v7` container.
- [ ] **1.2 Upstream unit tests still pass** with the corrected fallbacks.
  *Verify:* the firmware's `tests/unit` suite passes.
- [ ] **1.3 Audit other ARM-only code paths**: anything else guarded by `__arm__`, plus inline asm in `util/functions.h`.
  *Verify:* we have a list of every `__arm__`/`asm` site in `src/deluge`, each marked as having an exact host equivalent or being irrelevant to audio.

### Phase 2: Whole firmware compiles and boots under Emscripten

- [ ] **2.1 Build system.** A CMake project in this repo that compiles `src/deluge` and FatFs with Emscripten, excluding the hardware sources. Flags: `-msimd128`, NEON translation enabled, `-ffp-contract=off`, no fast-math.
  *Verify:* `cmake --build` produces a `.wasm` and JS loader with zero unresolved symbols (`-sERROR_ON_UNDEFINED_SYMBOLS=1`).
- [ ] **2.2 NEON code compiles to wasm SIMD**: the five files using NEON intrinsics (`render_wave.h`, `vector_rendering_function.h`, `wave_table.cpp`, `voice.cpp`, `interpolate.h`), plus the argon user `cosine_oscillator.hpp`.
  *Verify:* the 2.1 build succeeds with no scalar rewrites. Any intrinsic Emscripten can't translate gets a hand-written fallback, logged in Discoveries.
- [ ] **2.3 Stub hardware layer.** No-op or minimal implementations of the following, plus a large heap buffer standing in for the 64MB SDRAM:
  - the pad/button controller (PIC) over UART;
  - the OLED and 7-segment display;
  - USB, MIDI and CV;
  - the timers;
  - the SD card.
  
  *Verify:* `node build/webluge.js` runs firmware initialisation to the point of setting up a blank song (`setupBlankSong`) and exits cleanly, logging that it got there.
- [ ] **2.4 32-bit pointer assumptions.** Nothing to fix on wasm32, but note any casts that break the build.
  *Verify:* the build has no pointer-truncation warnings, or each remaining one is explained in Discoveries.

### Phase 3: Storage

Samples stream from the SD card by mapping FAT clusters straight to sector reads, so a real FAT filesystem is required.

- [ ] **3.1 In-memory block device.** FatFs's disk layer (`diskio.c`) backed by a byte array.
  *Verify:* a host test formats the array with `f_mkfs`, writes files, reads them back byte-identical, and reads the clusters through `clst2sect` + `disk_read`.
- [ ] **3.2 Image builder.** Build a FAT image from a directory tree laid out like the Deluge SD card (`SONGS/`, `SAMPLES/`, …), using FatFs itself.
  *Verify:* the CLI builds an image from `reference/<song>/`, and `mdir`/`hdiutil` on macOS lists the same files with matching sizes.
- [ ] **3.3 Song load.** Load a song XML through the firmware's own storage manager, samples included.
  *Verify:* for each reference song, the CLI logs the song name, the number of clips/instruments and the number of samples loaded; no loading errors.

### Phase 4: Offline render (Node CLI)

- [ ] **4.1 Fake audio clock.** Replace the audio driver's output buffer (`getTxBufferStart`/`getTxBufferCurrentPlace`) with a ring buffer whose read position advances by a fixed block size per tick. Run the audio engine without the hardware scheduler.
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
- **Float maths** (reverbs, compressor, parts of DX7). Maths library functions and denormal handling differ from ARMv7, so the last few bits may differ.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-07 | Pin the firmware to 1.2.1 and update the hardware to match (was 1.2.0) | No references recorded yet, so switching is free. 1.2.1 fixes clicks during sample loading; the host loads instantly and wouldn't reproduce them, so they'd pollute the comparisons |
| 2026-10-07 | Firmware changes go in a per-release patch series on the fork; everything else stays in this repo (see UPSTREAM.md) | So 1.3.0 and later releases are a rebase, not a restart |
| 2026-10-07 | Manage project tools with mise (`mise.toml`) | Tamlyn's preference for project dependencies |
| 2026-10-07 | Target WebAssembly, not a native Mac app | wasm32 matches the firmware's 32-bit pointer assumptions; native arm64 doesn't |
| 2026-10-07 | Port the whole firmware with a replacement hardware layer, rather than extracting the DSP | The sound depends on the sequencer, params and song model, not just the voice engines |
| 2026-10-07 | Keep FatFs and back it with an in-memory disk image | Sample streaming reads raw sectors by FAT cluster, bypassing the file API |
| 2026-10-07 | Offline Node renderer before real-time browser playback | Deterministic output we can null-test against device recordings |

## Discoveries

Newest first. Note anything that contradicts or changes the plan, and link to the checkpoint it affects.

- **2026-10-07** Docker on this Mac runs `linux/arm/v7` containers (`uname -m` prints `armv7l`), so we can generate the ARM golden vectors for 1.1 there.
- **2026-10-07** `~/music/Deluge` is a synced copy of the SD card: about 250 songs, kits, synths and samples, and a good source of test songs for 0.3. It has no usable reference recordings: `SAMPLES/RECORD` and `RESAMPLE` are empty, and the only matching audio elsewhere (`Ableton/Projects/Loops/Acid Project/Acid.mp3`) is an Ableton render in a lossy format. Most songs were last saved by official firmware 4.0–4.1, so 3.3 also exercises the community firmware's loading of older song files. `SONGS/SONG060` is self-contained: its samples are collected next to the XML.
- **2026-10-07** 1.2.1 differs from 1.2.0 in only three source commits: #3266 moves the record point before volume, #3680 fixes clicks during sample cluster loading, and a CMake build fix. The findings below were checked at both versions and hold for both.
- **2026-10-07** Initial survey of firmware commit `c23bc2fe`:
  - The DX7 NEON assembly (`neon_fm_kernel.s`) is unused on the device because `HAVE_NEON` is never defined, so the C++ path is the reference.
  - The firmware already has `IN_UNIT_TESTS` hooks in the memory allocator, which we can reuse for 2.3.
  - The audio engine works out its render window from the position of the audio hardware's output buffer (`getTxBufferCurrentPlace`), and its voice culling depends on that window size.
  - Hardware drivers live in `src/deluge/drivers` as well as `src/RZA1`.

## Open questions

- **Stem export as reference.** Is stem export bit-identical to normal playback, or does it change the engine's behaviour (e.g. block size, culling)? Check `processing/stem_export` before relying on it for 4.4.
- **Block size.** Which fixed block size best approximates typical device behaviour? Look at the `numSamples` distribution on the device, using the existing debug logging.
- **Upstream.** Would they accept the corrected host fixed-point maths, and perhaps a hardware-replacement layer that could make a host build an official target?
