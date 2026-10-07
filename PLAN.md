# Webluge plan

Play a Deluge song (XML + samples) in the browser, sounding the same as the hardware.

This is a living document. When we learn something that changes the plan, add it to the **Discoveries** log, update the affected phases, and record any decision in **Decisions**. Tick a checkpoint only when its verification has actually passed.

## Approach

Compile the whole of `DelugeFirmware/src/deluge` to WebAssembly and replace only the hardware layer (`src/RZA1`, `src/deluge/drivers`, the task scheduler and timers). We don't extract the synth engines on their own, because the sequencer, automation, param smoothing and song model all shape the sound, and they're tightly coupled to the audio engine.

Keep our changes to the firmware small and replayable, so that a new upstream release (e.g. 1.3.0) means replaying a known list of changes rather than redoing the port. [UPSTREAM.md](UPSTREAM.md) has the rules, the upgrade runbook and a log of what each release needed.

## Non-goals (for now)

- Native Mac app. arm64 macOS has no 32-bit mode, and the firmware assumes 32-bit pointers. wasm32 matches.
- Editing songs, the pad/button UI, MIDI, recording, saving. The one exception is rewriting sample paths when samples move (7.3).
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

- [x] **4.1 Fake audio clock.** The host clock (`src/hal/clock.cpp`) is virtual: it moves on only when the firmware's own scheduler has nothing due, 16 frames at a time, and the codec (`src/hal/ssi.c`) plays each frame it passes from the DMA buffer. The scheduler runs the device's own tasks (`registerTasks`), audio routine included, and calls the host through a seam when it's idle.
  *Verify:* `ctest` (`tests/render`, `metronome`) renders the blank song with the metronome on: the clicks are one beat apart (22050 frames at 120 BPM), within ±1 frame.
- [x] **4.2 Single synth note.** Trigger one note on a default synth.
  *Verify:* `ctest` (`note`) renders a C4: it isn't silent, its strongest partial is the fundamental, and the spectral peak is within ±1 cent of 261.626 Hz.
- [x] **4.3 Full song render.** `webluge render <card> <song> out.wav <seconds>` presses play and records what the codec plays. `webluge export <card> <song> <folder>` runs the firmware's own stem export, a stem per clip, and copies the WAVs out of the card.
  *Verify:* each reference song exports without crashing, one stem per device stem, none silent. Lengths differ from the device's by up to 1500 frames, not "within one block": stem export renders offline for as long as the CPU takes, so its overshoot past the clip's end depends on CPU speed (see Discoveries). `test-songs/` render whole: `C.Blade Runner` and `Annoying Song` in arranger mode.
- [ ] **4.4 Match against the device.**
  *Verify:* `mise exec -- uv run --with numpy scripts/null_test.py reference/1.2.1/<song>/device <export folder>/<song>/CLIPS` aligns each render with its device stem export (cross-correlation), then null-tests:
  - integer-only song: residual RMS at least 60 dB below the signal (target: bit-identical apart from block-size effects);
  - float-heavy songs: residual at least 40 dB below, plus a blind A/B listening check by Tamlyn.
  
  Record the numbers in Discoveries. If a song falls short, add a checkpoint to find the cause before moving on.

  Short so far (see Discoveries), so 4.5–4.8 come first.
- [ ] **4.5 Null-testable references.** Re-record the references on 1.2.1 with nothing random: every oscillator's retrigger phase set (e.g. 0°), and no noise, random LFOs or unison spread. The synths are done; left: re-export `Reference Kit 808` on 1.2.1, and take the noise out of `Reference Synth Sub`'s clip 5.
  *Verify:* the README lists the songs' random sources as none, and every song as recorded on 1.2.1; 4.4 reruns on them.
- [ ] **4.6 Residual that depends on render timing.** Find why the synths' plain clips null to only −38 to −58 dB although 67–95% of their samples are bit-identical, and why `Reference Kit 808`'s clips with several drums reach only −38 dB when the kick alone reaches −75 dB. In both, the error comes in short runs (in the synths, the 30 samples after each edge of a square wave), and the nulls move when only the export's timing changes, so look for state that runs freely with time, such as LFOs or the kit's flanger.
  *Verify:* the cause is named in Discoveries, and either fixed or added to Known differences.
- [ ] **4.8 Filter automation.** Find why clips automating the low-pass filter diverge as they go on: −32 dB for `Reference Synth Sub`'s clip 6 (cutoff), −6 dB for `Rsb`'s clip 2 (cutoff and resonance).
  *Verify:* the cause is named in Discoveries, and either fixed or added to Known differences.
- [ ] **4.7 Annoying Song level.** Find why the host's render of `test-songs/Annoying Song` runs 0.6–2.1 dB quieter than the device's recording, section by section.
  *Verify:* the cause is named in Discoveries, and either fixed or added to Known differences.

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

### Phase 7: Card browser

A web app (`web/`) that opens an SD card, or a copy of one, through the File System Access API (Chrome and Edge only), to browse it and preview its songs and samples. Ahead of Phase 5: it previews songs by rendering them in a worker as they play, not in real time on an AudioWorklet.

Build the firmware first (Phase 2), then `cd web && mise exec -- npm install && mise exec -- npm run dev`. Tests: `mise exec -- npm test`.

- [x] **7.1 Browse and audition.** Open a card, remember it across reloads, browse its folders, and play a sample when it's selected, stepping through a folder with the arrow keys. Each sample shows the songs, kits and synths that use it; each song, kit and synth lists its samples, marking any missing.
  *Verify:* with `Reference Kit 808`, `C.Blade Runner` and `Annoying Song` copied into one card folder, the songs list 4, 0 and 179 samples, none missing, matching the WAVs on the card; a sample shows the song that uses it; and deleting a sample marks it missing in its song.
- [x] **7.2 Song preview.** Play a song from the card. The page copies only the song, its samples and the settings files at the card's root into a new firmware instance (`webluge_web`, `src/web.cpp`), which builds a card image, loads the song and presses play. A worker renders a second at a time, keeping 3 seconds ahead of playback.
  *Verify:* `npm test` loads `Reference Kit 808` in the browser build under Node and renders a second that isn't silent. In Chrome, the reference songs and `Annoying Song` (294MB, 179 samples) play, and a song with a sample deleted plays without it and reports it missing.
- [ ] **7.3 Move samples.** Move or rename samples and folders of samples, rewriting the paths in every song, kit and synth that refers to them. Needs the card opened read-write.
  *Verify:* after moving samples used by several songs, each song loads in the CLI (`webluge load`) with no missing audio files, and each rewritten XML differs from its original only in the moved paths.

## Known differences from the device

These are expected, and we accept them unless a listening test says otherwise.

- **Render block size.** On the device it varies with CPU load, and modulation updates once per block. The host's comes from the scheduler on the virtual clock (windows of 12 and 20 frames during playback). Stem export's offline rendering uses fixed 32-frame windows on both. Expected effect: tiny, inaudible.
- **Randomness.** The device seeds its random numbers from a timer at boot, so oscillators without a retrigger phase, random LFOs and noise start differently on every boot, on the device as on the host.
- **Stem export length.** Stem export stops a stem after a render burst, so how far it runs past its end depends on CPU speed: up to about 800 frames different from the device with export to silence on, 1500 with it off.
- **Voice culling.** An overloaded Deluge drops voices; the host won't, so heavy songs may sound cleaner than on the device. If this matters, we could model the device's CPU cost.
- **Float maths** (reverbs, compressor, parts of DX7). The device firmware is built with `-funsafe-math-optimizations`, so GCC runs float maths on NEON (flushing denormals to zero) and may reassociate it. That can't be reproduced, and maths library functions differ too, so the last few bits may differ. The DX7 NEON kernel is the exception: it's hand-written assembly, so its float maths is exact (1.4).

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-07 | Preview songs with a fresh firmware instance per song, rendering in a worker ahead of playback, rather than waiting for Phase 5's real-time AudioWorklet | The firmware boots once per instance (as the tests do), and rendering runs 40 to 100 times faster than real time (4.3), so a worker that keeps a few seconds ahead plays smoothly without SharedArrayBuffer or COOP/COEP headers |
| 2026-10-07 | Copy only a song's own files into its preview's card image | A whole card can be tens of gigabytes; wasm32 tops out at 4GB, and the image builder at 2GB (3.2) |
| 2026-10-07 | Find sample references in XML with a pattern, not an XML parser, and keep their positions in the text | Moving samples (7.3) has to rewrite only the paths, leaving the rest of each file byte for byte as the firmware wrote it |
| 2026-10-07 | The web app is React, Vite and TypeScript, in `web/` with its own `package.json` | Tamlyn's usual stack. The firmware's browser build comes in from `build/` through a Vite alias, so CMake stays the only build for C++ |
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
| 2026-10-07 | Drive the audio engine from the firmware's scheduler on a virtual clock, rather than calling it directly with a fixed block size (4.1) | Stem export, which made the reference recordings, waits on the scheduler with `yield`, so it can only run on the host this way. The engine then also picks its render windows as on the device |
| 2026-10-07 | Compare against the device's stem exports by running the firmware's own stem export on the host (4.3) | It reproduces the device's procedure (solo, offline render, mono conversion, file naming) rather than imitating it. A plain `render` would have to reimplement all that |
| 2026-10-07 | Rendering costs 14 P0 cycles a frame on the virtual clock | Stem export renders offline for a fixed time per call, so without a cost the host renders 17.5 seconds per call and overshoots each clip by that much. 14 cycles puts its overshoot near the device's for the reference songs (host 2100–3600 frames, device 2100–3000) |
| 2026-10-07 | The virtual clock moves on 16 frames per idle step | Moving one frame at a time gives one-frame render windows, which the device, taking time to render, never does. 16 frames is the audio routine's target interval in `deluge_main`, and gives windows of 12 and 20 frames |

## Discoveries

Newest first. Note anything that contradicts or changes the plan, and link to the checkpoint it affects.

- **2026-10-07** Phase 7 findings:
  - Songs refer to samples as `fileName="…"` attributes (newer firmware), `<fileName>…</fileName>` elements (older) and `filePath="…"` on audio clips. On the copy of Tamlyn's card, every non-empty one starts with `SAMPLES/`, and none has characters outside ASCII. The firmware writes paths in code page 437, so the app decodes XML as that.
  - When a sample isn't at its path, the firmware looks in a folder named after the song, beside it, for the path after `SAMPLES/` with its slashes turned into underscores (`AudioFileManager::setupAlternateAudioFilePath`). It's how songs with collected samples, like `SONG060`, load. The app follows the same rule when it marks samples missing and gathers a song's files. Moving samples (7.3) must handle songs that rely on it.
  - The browser build boots, loads and starts `Annoying Song` 0.56 seconds after Play, including copying 294MB into the worker and building the image.

- **2026-10-07** Phase 4 findings:
  - Stem export (`processing/stem_export`), with its defaults, renders offline while it runs, in fixed 32-frame windows rather than at the codec's pace. It records the mix before song FX, and converts the file to mono afterwards (`SampleRecorder::alterFile`). Fixed windows make it a better reference than resampling, which renders whatever the scheduler asks for.
  - The first stems ended 2000–3000 frames after the clip, not 12 seconds after it went quiet, so "export to silence" was off for them. The re-recorded synths used the defaults, export to silence on, and so does `webluge export`.
  - Null tests against the reference stems (4.4):
    - `Reference Kit 808`: −75 dB for the kick-only clip, −47 dB with two drums, −38 to −44 dB with three or four. The error repeats exactly every beat, so it's systematic, not random. It also moves when the render's timing does (−41.7 to −44.0 dB for one clip when the cost per frame went from 10 to 14 cycles), which suggests something free-running, such as the kit's flanger LFO (4.6).
    - `Reference Synth Sub` and `Rsb`, first recording: about 0 dB, no null at all. Every oscillator had `retrigPhase="-1"`, so each note starts at a random phase (`Voice::randomizeOscPhases`, from `getNoise()`), and the device's random state is unknowable. The envelopes and peaks matched (peaks within 0.3 dB), but the waveforms couldn't cancel (4.5).
    - The same synths re-recorded on 1.2.1 with retrigger phase 0°: plain clips −38 to −58 dB, with 67–95% of samples bit-identical and no gain difference (best-fit gain within 0.001 dB) (4.6). Clips automating the filter: −32 dB (Sub clip 6) and −6 dB (Rsb clip 2), with the error growing through the clip (4.8). Sub clip 5 automates noise volume, so it can't null: −5 dB.
  - The first references were recorded on 1.2.0, not 1.2.1: the device was updated before the re-recordings, whose songs say `firmwareVersion="c1.2.1"`. So release builds report 1.2.1 even though the tag's CMakeLists.txt says 1.2.0.
  - Whole songs against the device's recordings, by loudness envelope in 10 ms steps:
    - `C.Blade Runner` (arranger, 230 seconds): correlation 0.999, median level difference 0.0 dB.
    - `Annoying Song` (arranger, 151 seconds): the timing lines up throughout, but the host is 0.6–2.1 dB quieter depending on the section (4.7).
  - On the device, integer division by zero returns a value: the Cortex-A9 has no divide instruction, and libgcc's division routines don't trap. On wasm it traps. `Sample::fillPercCache` divides by zero in digital silence, which crashed `Annoying Song`'s timestretched audio clips. Fixed in the fork, keeping the device's result; see ARM_AUDIT.md.
  - Stem export loops forever if the card has no `SAMPLES` folder: it makes only the folders inside it, and its search for an unused folder name never gives up. The host makes `SAMPLES` first.
  - Some firmware loops keep audio running without yielding to the scheduler, e.g. `alterFile` calling `routineWithClusterLoading`. On the virtual clock only clock reads move time on there, so a long one passes thousands of virtual seconds and wraps `audioSampleTimer`. That's harmless, but times printed around them look odd.
  - Rendering is fast: 30 seconds of `C.Blade Runner` in 0.3 seconds, and of `Annoying Song` in 0.8.

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
  - ~~The 1.2.1 release still says `VERSION 1.2.0` in its CMakeLists.txt, so the device reports itself as c1.2.0. The host build takes the version from there, so it matches.~~ Wrong for the release build: the device on 1.2.1 writes `c1.2.1` (Phase 4 findings). The host now takes its version from the release tag.
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

- **Block size.** The host renders in windows of 12 and 20 frames (4.1). What does the device use? Look at the `numSamples` distribution on the device, using the existing debug logging, and if it differs, model the time the device takes to render.
- **Device settings.** Do any of the settings in the device's SPI flash change playback? If so, record them with the reference songs and feed them to the host, which currently uses the defaults. Settings on the card (`CommunityFeatures.XML`, MIDI devices, MIDI follow) already come from the image, so reference songs should include them.
- **Upstream.** Would they accept the corrected host fixed-point maths, and perhaps a hardware-replacement layer that could make a host build an official target?
