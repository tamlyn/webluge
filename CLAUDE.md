# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Webluge plays Synthstrom Deluge songs in the browser by compiling the Deluge firmware itself (the `DelugeFirmware`
submodule, a fork pinned to release 1.2.1) to WebAssembly and replacing only the hardware layer. The goal is output that
matches the device, ideally bit for bit.

## Commands

Tools (Emscripten, CMake, Ninja, Node, uv) are pinned in `mise.toml`, not asdf. Run them through mise: either a task, or
`mise exec -- <command>`.

```sh
mise run dev            # build the firmware, then the web app's dev server
mise run test           # ctest (firmware) and vitest (web)
mise run build          # firmware into build/, web app into web/dist
mise run build:firmware # just `ninja -C build`

mise exec -- ctest --test-dir build -R note          # one firmware test: storage, metronome, note, sample
mise exec -- npm --prefix web test -- src/card/plan.test.ts   # one web test file (add -t "<name>" for one test)
mise exec -- npm --prefix web run typecheck
```

- The web tests load the firmware's browser build (`build/webluge_web.mjs`, through Vite's `@firmware` alias), so build
  the firmware first.
- `web/src/card/plan.card.test.ts` runs only with `WEBLUGE_CARD` set to a copy of a real SD card.
- `tests/golden/check.sh` compares the fixed-point, NEON and DX7 kernel harnesses against golden ARMv7 output;
  `tests/golden/generate.sh` regenerates that output in a Docker `linux/arm/v7` container.
- The Node CLI: `mise exec -- node build/webluge.js image|load|render|export …` builds card images, loads songs, renders
  to WAV and runs the firmware's own stem export. `export` output is compared with device recordings by
  `mise exec -- uv run --with numpy scripts/null_test.py reference/1.2.1/<song>/device <folder>/<song>/CLIPS`.

There's no formatter or linter. Don't run Prettier; wrap code and comments by hand at about 120 columns.

## Architecture

### Firmware on the host (C++, `src/`)

- `CMakeLists.txt` globs all of `DelugeFirmware/src/deluge` minus the drivers, plus FatFs, NE10 and this repo's `src/`,
  into one `firmware` object library. Three kinds of executable link it: the Node CLI (`src/main.cpp`), the browser
  build (`src/web.cpp`, an ES module whose `webluge_web_*` exports are listed in `EXPORTED_FUNCTIONS`) and the tests.
- `src/include` comes first on the include path, so its headers replace the firmware's of the same name. Prefer
  wrapping the original with `#include_next` over copying it.
- `src/hal` stubs the hardware: pads, displays, USB/MIDI, timers, the codec (`ssi.c`) and the SD card (`diskio.c`,
  backed by an in-memory FAT image built with FatFs itself, as sample streaming reads raw clusters).
- `src/boot.cpp` follows `deluge_main` without its hardware setup. Compare it with `deluge_main` on each firmware upgrade.
- Time is virtual (`src/hal/clock.cpp`): it moves on only when the firmware's own task scheduler is idle, 16 frames at a
  time, and the codec plays the frames it passes. Audio is driven by the device's own scheduler, not by calling the
  engine with a fixed block size, so stem export and render windows behave as on the device.
- wasm memory keeps the device's memory map: SDRAM at `0x0C000000`, on-chip RAM at `0x20000000`, and Emscripten's own
  memory above them (`-sGLOBAL_BASE`). The firmware's `operator new` serves only that SDRAM, so large host buffers such
  as card images use `HostAllocator`.
- Builds use `-ffp-contract=off` (never fast-math): the device never fuses multiply-adds and the DX7 kernel port depends
  on it.

### Changing firmware source

Read `docs/UPSTREAM.md` first. Prefer a seam in this repo over a change in the fork. Fork changes go on the
`webluge/<version>` branch, one concern per commit, with messages starting `upstreamable:`, `seam:` or `workaround:`.
Guard host-only code with the `WEBLUGE` macro. `docs/ARM_AUDIT.md` lists every ARM-specific site and how the host
handles it.

### Web app (`web/`, React + Vite + TypeScript)

A card browser that opens an SD card (or a copy) through the File System Access API, so Chrome and Edge only. The
selection lives in the URL hash (`ui/route.ts`), for GitHub Pages.

- `preview/`: each song, kit or synth gets a fresh firmware instance in its own worker (`worker.ts`), since the firmware
  boots once per instance. Only the song's own files go into its card image. `player.ts` renders a small chunk at a time
  just ahead of playback rather than on an AudioWorklet, so clip toggles and auditions are heard promptly. Clip views
  read the song's structure from the firmware (`webluge_web_describe`), not from the XML.
- `card/`: every change to the card (move, rename, new folder, delete, relink) is one plan (`plan.ts`, a pure function)
  run by `run.ts`: XML rewrites first, then new folders, file moves, then removing emptied folders. Each step rechecks
  the disk and refuses to overwrite or delete, so a stopped run reports what it did as an undoable plan. The card on
  disk is the only truth; `usageIndex.ts` is a hint that refreshes from disk after every run.
- XML is never parsed for rewriting: `references.ts` finds sample paths and preset links by pattern, keeping positions,
  so everything else stays byte for byte. Card text is code page 437 (`cp437.ts`), as the firmware writes it.
- Delete moves entries into `TRASH/` at the card's root; the app never deletes for good. Entries move only within their
  own top folder (`SONGS`, `KITS`, `SYNTHS`, `SAMPLES`) or into and out of `TRASH`.
- Tests run `Card` on an in-memory stand-in for the File System Access API (`card/memoryFolder.ts`).

## Docs

- `docs/PLAN.md` is a living plan: phases with verifiable checkpoints, Known differences from the device, Decisions and
  Discoveries. Record findings that change the plan in Discoveries and decisions in Decisions, and tick a checkpoint
  only when its verification has passed. Code comments cite its checkpoints (e.g. "docs/PLAN.md 4.4").
- `reference/<firmware version>/` holds reference songs with device stem exports; its README records how they were made.
  `test-songs/` (gitignored) holds larger songs for manual testing.
