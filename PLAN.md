# Webluge plan

Play a Deluge song (XML + samples) in the browser, sounding the same as the hardware.

This is a living document. When we learn something that changes the plan, add it to the **Discoveries** log, update the affected phases, and record any decision in **Decisions**. Tick a checkpoint only when its verification has actually passed.

## Approach

Compile the whole of `DelugeFirmware/src/deluge` to WebAssembly and replace only the hardware layer (`src/RZA1`, `src/deluge/drivers`, the task scheduler and timers). We don't extract the synth engines on their own, because the sequencer, automation, param smoothing and song model all shape the sound, and they're tightly coupled to the audio engine.

Keep our changes to the firmware small and replayable, so that a new upstream release (e.g. 1.3.0) means replaying a known list of changes rather than redoing the port. [UPSTREAM.md](UPSTREAM.md) has the rules, the upgrade runbook and a log of what each release needed.

## Non-goals (for now)

- Native Mac app. arm64 macOS has no 32-bit mode, and the firmware assumes 32-bit pointers. wasm32 matches.
- Editing songs, the pad/button UI, MIDI, recording, saving. The one exception is rewriting the paths and preset links in songs, kits and synths when files move (Phase 8).
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

### Phases 5 and 6: dropped

Real-time playback on an AudioWorklet (5) and loading your own songs (6) were overtaken by the card browser (Phase 7), which opens a card and plays its songs by rendering ahead in a worker. See Decisions.

### Phase 7: Card browser

A web app (`web/`) that opens an SD card, or a copy of one, through the File System Access API (Chrome and Edge only), to browse it and preview its songs and samples. It previews songs by rendering them in a worker as they play, not in real time on an AudioWorklet.

Build the firmware first (Phase 2), then `cd web && mise exec -- npm install && mise exec -- npm run dev`. Tests: `mise exec -- npm test`.

- [x] **7.1 Browse and audition.** Open a card, remember it across reloads, browse its folders, and play a sample when it's selected, stepping through a folder with the arrow keys. Each sample shows the songs, kits and synths that use it; each song, kit and synth lists its samples, marking any missing.
  *Verify:* with `Reference Kit 808`, `C.Blade Runner` and `Annoying Song` copied into one card folder, the songs list 4, 0 and 179 samples, none missing, matching the WAVs on the card; a sample shows the song that uses it; and deleting a sample marks it missing in its song.
- [x] **7.2 Song preview.** Play a song from the card. The page copies only the song, its samples and the settings files at the card's root into a new firmware instance (`webluge_web`, `src/web.cpp`), which builds a card image, loads the song and presses play. A worker renders a second at a time, keeping 3 seconds ahead of playback.
  *Verify:* `npm test` loads `Reference Kit 808` in the browser build under Node and renders a second that isn't silent. In Chrome, the reference songs and `Annoying Song` (294MB, 179 samples) play, and a song with a sample deleted plays without it and reports it missing.
- [x] **7.4 Toggle clips.** While a session-mode song plays, show its clips as the session view does: one row each, with its notes (or its sample's waveform, for an audio clip) across one loop and a play head. Each clip can be started, stopped or soloed through the firmware's own session code (`Session::toggleClipStatus`, `soloClipAction`), so a toggle waits for the end of the clip's loop as on the device, or happens at once with shift. The worker renders 2048 frames at a time, 150ms ahead, so toggles are heard promptly. Arranger songs aren't covered: they show a note instead. Toggles are never saved.
  *Verify:* `npm test` starts and stops a clip of `Reference Kit 808` in the browser build under Node, quantised and instant. In Chrome, on `Reference Kit 808` and `Swinging In The Rain` (from `~/music/Deluge`, with an audio clip): an armed clip blinks until its loop ends, then starts, stopping the clip on the same instrument; play heads follow each clip's own loop; the audio clip shows its waveform; and 8 seconds of `Annoying Song` play with no chunk scheduled late (at least 135ms ahead).
- [x] **7.5 Audition kits and synths.** Selecting a kit or synth loads it into a new firmware instance in place of the blank song's synth, as the preset browser does (`loadInstrumentFromFile`, then `Song::replaceInstrument`), and keeps rendering, silent until auditioned. A kit shows a pad per drum, the first at the bottom left as in the Deluge's keyboard view, coloured as its rows; a synth shows two octaves of keys that move up and down. Holding a pad or key auditions it through the firmware's own audition code (`Kit::beginAuditioningforDrum`, `MelodicInstrument::beginAuditioningForNote`). Presets render 512 frames at a time, 50ms ahead, so a press is heard about as soon as the browser schedules it.
  *Verify:* `npm test` loads a TR-808 kit (trimmed to the reference card's four drums) and auditions each drum, silent before and sounding after, and holds a note of Rich Saw Bass until it's released, then fades to silence. In Chrome, on an OPFS card with both, the kit's pads and the synth's keys light while held and sound, the first audible chunk rendered 15ms after the press, and the render keeps pace (60 chunks in 700ms).
- 7.3 Move samples: now Phase 8.

### Phase 8: Organise the card

Reorganise songs, kits, synths and samples, delete what's no longer wanted, make folders, and find missing samples, all without breaking the songs, kits and synths that refer to them.

The card on disk is the only source of truth. The sample index (7.1) is a hint about where to look, and nothing is trusted from it when changing files. Each gesture (a drag, a rename, a new folder, a delete) is one plan, which goes through one pipeline, from choosing it to it finishing, in a few seconds; nothing is ever pending, so browsing and playing carry on between them as usual.

- **Refresh.** Before planning, the index catches up with the card: it checks every song, kit and synth's size and modification time, and rereads the ones that are new or changed. The card holds about 1,200 of them, 44MB of XML, so rereading everything each time would be slow.
- **Plan.** A pure function turns an operation (move, rename, delete, new folder) and the documents just read into a plan: file moves, folders to make and remove, and XML rewrites. Rewrites change only the paths and preset attributes, found by pattern with their positions (as in `references.ts`), and are encoded back to code page 437, so everything else stays byte for byte. Whether a reference resolves is checked on disk, for the references the operation affects.
- **Confirm.** A plan that does more than move, rename or make what the user chose asks first, saying what else it will do: "Also updates 14 songs and 2 kits", "Also moves the song's samples folder", or for a delete, which songs will lose the sample. Otherwise it runs at once.
- **Run.** XML rewrites go first, then new folders, file moves, and last the removal of the folders the moves emptied, so the whole plan can be checked against the card before it changes anything. Then each step checks, on disk and just before it acts, the state the plan expects, and stops the run if it differs. No step can destroy anything: a move refuses an existing destination, a rewrite goes ahead only if the file still holds the text the plan read, and a folder is removed only if it's empty (`removeEntry` without `recursive`). Each XML file is written through `createWritable`, which swaps the file in on commit. A run that stops reports exactly what it did. Songs can't be loaded while a run is going, so playback only ever sees a settled card.
- **Afterwards.** The index refreshes from the card, as before planning, rather than being patched from the plan, so there's only one way it gets updated.
- **Undo.** Each plan that runs keeps its inverse (moves reversed, the original XML text), so the last few operations can be undone within the session, newest first. An undo is a plan like any other, with the same checks. After each run, a line says what it did, with an Undo button: "Moved Kick.wav · updated 14 songs · Undo".

If a run stops partway (an error, a closed tab), some documents have new paths whose samples haven't moved yet. The runner reports what it did as a plan, which undoes like any other; failing that, the references show up as missing, and 8.2 relinks them by name.

Rules every plan follows:

- A song, kit or synth moves with its collected-samples folder beside it (`SONGS/Foo.XML` with `SONGS/Foo/`), and a reference that resolves there before the move still does after it.
- A reference whose file moves is rewritten to the file's new path. References that already don't resolve are left alone.
- When a kit or synth moves, songs whose instrument links to it (`presetFolder` and `presetName`) get the new folder; when it's renamed, the new name too. Each of the instrument's clips links to it the same way (`instrumentPresetFolder`, `instrumentPresetName`), and the firmware won't load a song whose clips don't match an instrument, so a song's links all change together or not at all. They don't change if any link with that name has no folder (songs saved before firmware 4.0), if the song already has an instrument with the new name, or if the song names presets by number (`presetSlot`). Out-of-date links still load.
- Things move only within their own top folder (`SONGS`, `KITS`, `SYNTHS`, `SAMPLES`), where the device's browsers can see them, or into and out of `TRASH`.
- New names are legal FAT names, encodable in code page 437, and don't clash, ignoring case, with a name already in the folder.

Write access is asked for the first time an operation runs, so browsing stays read-only.

- [x] **8.1 Planner and runner.** The refresh, planner, runner and undo, with no UI beyond what tests need. Tests run `Card` itself on an in-memory stand-in for the File System Access API (`memoryFolder.ts`).
  *Verify:* `npm test` checks plans against fixtures: moving a sample folder rewrites exactly the references to it in songs, kits and synths; moving a song takes its collected folder and its samples still resolve; renaming a kit updates the songs linked to it; and an undo restores every file byte for byte. It also changes the in-memory card between planning and running (a document edited, a destination taken, a source gone, a file appearing), and each run stops having changed nothing; a run that fails partway undoes. The firmware loads `Reference Kit 808` after its samples move and its kit is renamed, with no missing samples and the same clips, and refuses it if only the instrument's link changes. With `WEBLUGE_CARD` set to a copy of a card, a test moves its most used sample folder, renames its most used preset, moves a song with collected samples and deletes its most used sample, then checks that every reference still finds the same file (or, for the deleted sample, a collected copy or nothing, as the plan warned), that rewrites change nothing but paths and links, and that undoing all four restores the card byte for byte.
- [x] **8.2 Missing samples.** A card-wide list of missing samples ("Missing samples" in the browser's toolbar, `#missing`): each missing path once, by folder, with the songs, kits and synths that use it and the files on the card with the same name, outside `TRASH`. Relink one sample, or a whole folder at once when its samples turn up below another folder by the same paths. A relink is a plan of rewrites only, and runs through the same pipeline as everything else, with its Undo line in the header.
  *Verify:* `npm test` renames `SAMPLES/DRUMS` in the reference card outside the app; the list shows its 4 samples once each, offers `SAMPLES/808`, and after relinking the firmware loads `Reference Kit 808` with none missing and the same song. With `WEBLUGE_CARD`, the card copy's most used sample folder is renamed: each of its samples is listed once with every user (but those finding a collected copy), the renamed folder is offered, relinking leaves every reference finding the same file as before the rename and the same samples missing, and undo restores the card byte for byte. In Chrome, on an OPFS copy of the reference card with `SAMPLES/DRUMS` renamed, relinking one sample then the folder leaves the song playing with all 4 samples, and two undos restore it byte for byte. On an OPFS copy of the whole card copy (18,490 files, samples empty), the list takes 2.5s to appear, offers the 5,631 samples of `TAL Multisamples`, and relinks them (99 synths) in 1.9s; undo restores all 1,197 documents byte for byte.
- [x] **8.3 Move, rename and new folder.** Select several entries in a column (Cmd- and Shift-click, Shift with the arrow keys), then drag them onto a folder in any column or the path bar, or use "Move to…", which picks a folder within the entries' top folder. Rename and New folder sit in the browser's toolbar. A plan that does more than move what was chosen asks first, in a dialog listing what else it does. After a run, the selection and what's chosen follow what moved, undo included.
  *Verify:* `npm test` checks which folders a drag may drop into, and that the selection follows a song and its collected folder there and back. In Chrome, on an OPFS card holding `Reference Kit 808`, its kit, an unused sample and a copy of the song with a collected folder: making a folder and dragging the unused sample into it run without asking; moving `SAMPLES/DRUMS` with Move to… asks ("Also updates 2 songs"), and both songs then load with all 4 samples; renaming the song with a collected folder asks and takes the folder; renaming the kit asks ("Also updates 2 songs") and the song loads with its clips on `TR-808`; Shift-clicking both songs and dragging them onto a new folder asks, and both follow. Undoing all seven, newest first, leaves the card's files exactly as they were, the songs byte for byte. Still to check on a real SD card: OPFS is case-sensitive, unlike FAT.
- [x] **8.4 Delete.** Delete (Cmd-Backspace, or Delete in the toolbar) moves entries into `TRASH/` at the card's root, keeping their paths, so it can be undone, and restoring is a move back: entries in the trash can be dragged or moved (Move to… starts at their top folder) back into it. Deleting something in use lists its users first. After a delete, the folder it was in stays showing. The app never deletes for good: emptying `TRASH` is left to the user, outside the app.
  *Verify:* `npm test` restores a deleted sample by moving it back, with nothing rewritten, and refuses to move `TRASH` or its top folders. In Chrome, on an OPFS card: deleting `808 Snare.wav` with Cmd-Backspace asks first ("Leaves 2 songs missing samples: Collected, Reference Kit 808", as the copy's collected folder holds only the kick), the song then shows it missing, and Move to… from the trash puts it back, the song finding it again; deleting the song with a collected folder asks ("Also deletes the folder of samples collected for Collected") and moves both into `TRASH/SONGS/`; undoing both leaves the card's files exactly as before.

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
| 2026-10-08 | Drop Phases 5 (real-time playback on an AudioWorklet) and 6 (load your own songs) | Phase 7 does both jobs: rendering ahead plays smoothly without SharedArrayBuffer or COOP/COEP headers, and the card browser opens a card and plays any song on it. That gives up drag-and-drop and browsers without the File System Access API. Revisit real-time playback if previews underrun |
| 2026-10-08 | Each gesture is one plan that runs at once. It asks first only if it does more than move, rename or make what the user chose (rewriting documents, moving a collected folder, leaving references missing) | With undo, a confirmation on every drag would only slow things down. Side effects are what the user can't see from the gesture itself |
| 2026-10-08 | Deleting moves to `TRASH/` on the card, and operations can be undone within the session. The app has no way to empty the trash | The File System Access API deletes for good, with no system trash. As a move, a delete is undone like any other operation, and the app can't lose anything for good |
| 2026-10-08 | Moving or renaming a kit or synth updates the preset links (`presetFolder`, `presetName`) of songs using it | Songs still load without it, but the device's preset browser and saving would use the old folder. Renaming changes the instrument's name in those songs, which is the point of keeping the link |
| 2026-10-08 | Entries move only within their own top folder, or into and out of `TRASH` | A song outside `SONGS` (and the same for kits, synths and samples) is invisible to the device's browsers |
| 2026-10-08 | All card changes go through a planner, then a runner that rewrites XML first, then makes folders, moves files and removes emptied folders | Tests run the planner and runner on an in-memory card, the same plan feeds the confirmation and undo, and with rewrites first every check can be made against the card before anything changes |
| 2026-10-08 | The card on disk is the only truth: plans are made from freshly read documents and run at once, each step checks the disk before acting and none can overwrite or delete, and the index refreshes from disk afterwards | The index can be out of date (the card can change outside the app), and there's no pending state to drift from the disk. Changes made while the app is open stop a run instead of being clobbered |
| 2026-10-07 | The web app looks like the Deluge (black panel, OLED-style readouts, lit pads, JetBrains Mono), browses the card in Finder-style columns, and puts each preview's play controls beside it rather than in a global transport | Picked from four directions on a design canvas. A preview plays only the song or sample selected, so there's nothing for a global transport to control |
| 2026-10-07 | Clip views read the song from the firmware (`webluge_web_describe`), not from the XML | The firmware has already parsed every song format, kits' drum names and the clips' colours. The JSON goes out in code page 437, like the names, and the page decodes it as that |
| 2026-10-07 | Render 2048 frames at a time, 150ms ahead of playback, from the main thread's timer, rather than through an AudioWorklet and ring buffer (5.1) | Short enough that a toggle is heard almost at once, and cheap: 2048 frames of even `Annoying Song` render in about a millisecond. Chrome doesn't throttle timers in tabs playing audio. Revisit with 5.1 if it underruns |
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

- **2026-10-08** Delete (8.4):
  - The first delete put `TRASH` in the root column, and `homeOf("TRASH")` crashed the app (nothing left after taking off the trash). Fixed, with a test, but a render error still blanks the whole app: worth an error boundary.
  - Putting something back by a move leaves the empty folders it came from in `TRASH`. Undo removes them; otherwise they go when the trash is emptied.

- **2026-10-08** Move, rename and new folder (8.3):
  - Chrome's real `move()`, `createWritable`, `getDirectoryHandle({ create })` and `removeEntry` behave in OPFS as the in-memory stand-in assumes: whole folder moves, renames with collected folders and undos all left the card exactly as planned.
  - Plans now record the entries chosen (`entries`), whole, so the app can follow a moved folder's contents; the file moves alone can't say where an empty folder went.

- **2026-10-08** Missing samples (8.2):
  - The card copy already had 5,878 missing samples, used by 152 songs, kits and synths: 5,631 of them in `SAMPLES/Multisamples/TAL Multisamples/…`, which had moved up a level. Matching paths below a folder finds that and three smaller renames, with no false suggestions.
  - Chrome's `FileSystemFileHandle.move()` replaces a file already at the destination without complaint (checked in OPFS), as the in-memory stand-in assumed. The runner's own check is what keeps a move from overwriting.
  - `Card`'s lookups ignore case by listing the folder when a name isn't found, so looking up a missing path lists its nearest existing folder. Planning the TAL relink did that about 12,000 times and took 14s; remembering which folders exist while planning one change brings it to 1.2s.

- **2026-10-08** Planner and runner (8.1):
  - Clips link to their instrument by `instrumentPresetName` and `instrumentPresetFolder`, and `InstrumentClip::claimOutput` fails the load (`FILE_CORRUPTED`) when no instrument matches. So renaming a preset in a song means changing the instrument and every clip together; the firmware test checks the failure.
  - On the copy of Tamlyn's card (358 songs), 44 instruments in older songs have no `presetFolder`, and clips name presets by number 731 times. The planner leaves those links alone.
  - A deleted sample isn't always lost: the firmware falls back to a copy among the song's collected samples, as `SONG060` has for the 808 hi-hat. The delete's warning counts only songs left without one.
  - Moving the card copy's biggest sample folder moves 9,795 files and rewrites 181 songs, kits and synths.

- **2026-10-08** Planning Phase 8:
  - Kits and synths have collected-samples folders too, like songs: `Instrument::setupDefaultAudioFileDir` looks in `<presetFolder>/<name>/`. `alternatePath` already works for them, despite its parameter's name.
  - Songs link each kit and synth to its preset with `presetName` and `presetFolder` (`Instrument::writeDataToFile`). Loading doesn't check that the preset exists; the link only steers the preset browser and saving.
  - Chrome moves and renames files in place with `FileSystemFileHandle.move()` (Chrome 111), but not folders, so moving a folder means making the new one, moving its files and removing the old one.

- **2026-10-07** Clip toggling (7.4):
  - As on the device, only one clip per instrument plays at a time, so starting a clip stops the other clips on its instrument. `Reference Kit 808`'s five clips share one kit, so only one plays at once.
  - An audio clip's name, and its output's, can be its sample's path, as in `Swinging In The Rain` (saved by firmware 4.x), so the view shows only the file name.
  - Clip state comes with each rendered chunk, as it stands at the chunk's first frame; the view moves play heads on from there at the song's tempo.

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
