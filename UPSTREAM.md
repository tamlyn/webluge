# Tracking upstream firmware

How we keep webluge's changes to the Deluge firmware small and replayable, so that moving to a new release (e.g. 1.3.0) means replaying a known list of changes rather than redoing the port.

## Where code lives

| What | Where | Why |
|---|---|---|
| Hardware replacement layer (audio clock, disk, stubs for pads, display, USB, timers) | This repo | Upstream never touches it, so it survives upgrades unchanged unless a driver interface changes |
| Build (CMake, Emscripten flags, source list) | This repo | Includes `src/deluge` by glob with a short exclusion list, so new upstream files are picked up without edits |
| Replacement headers (`src/include`) | This repo | First on the include path, so they replace firmware headers of the same name without touching the fork. Prefer wrapping the original with `#include_next` over copying it |
| Boot sequence (`src/boot.cpp`) | This repo | Follows `deluge_main` without its hardware setup, and registers the device's scheduler tasks |
| Changes to firmware source | Our fork, as a patch series on a per-release branch | Small, reviewable and replayable with `git rebase`/`cherry-pick` |

## Rules for changing firmware source

- Prefer a change in this repo over a change in the fork. Change the firmware only when there's no seam to hook into from outside.
- One concern per commit. Never mix an upstreamable fix with a webluge-only hack.
- Commit messages start with a category, and explain why the change is needed and how we verified it:
  - `upstreamable:` correct for every build, worth sending upstream (e.g. exact host fixed-point maths);
  - `seam:` adds a hook or `#ifdef` so the host build can replace hardware behaviour;
  - `workaround:` a host-only fix we'd rather not need.
- Guard host-only code with a single macro, `WEBLUGE`, so `grep -rn WEBLUGE` finds every touchpoint.
- Send `upstreamable:` commits upstream as PRs. Each one merged is one fewer commit to replay.

## Branches

- The fork has a branch per firmware release, named `webluge/<version>` (e.g. `webluge/1.2.1`) and based on that release's tag. It holds our patch series.
- The submodule in this repo points at the tip of the current branch.
- Old branches are kept, so we can always rebuild against an older release.

## Reference recordings are per release

Reference recordings live in `reference/<firmware version>/<song>/`. The test songs stay the same across releases, but the recordings are made again on the hardware for each release, because upstream DSP changes legitimately change the output.

## Upgrade runbook

To move to a new release:

1. Copy the old branch and replay its patches onto the new tag, dropping any commits upstream has merged:
   ```sh
   git checkout -b webluge/<new> webluge/<old>
   git rebase --onto <new tag> <old tag>
   ```
2. Run `git range-diff` between the old and new series, and record anything that needed rework in the release log below.
3. Point the submodule at the new branch.
4. Build. Undefined symbols (`-sERROR_ON_UNDEFINED_SYMBOLS=1`) show where upstream changed an interface our hardware layer implements. They only cover code the link keeps, so also link once with `-DCMAKE_EXE_LINKER_FLAGS=-Wl,--no-gc-sections`: the only undefined symbol should be NE10's `ne10_fft_alloc_c2c_float32_c`.
5. Check what our replacements depend on:
   - `git diff <old tag> <new tag> -- src/arm_neon_shim.h src/RZA1/mtu/mtu.h src/RZA1/system/iodefines/mtu2_iodefine.h lib/CMakeLists.txt`, for the headers in `src/include` (argon's version is pinned in `lib/CMakeLists.txt`);
   - `git diff <old tag> <new tag> -- src/deluge/deluge.cpp src/deluge/gui/ui/load/load_song_ui.cpp`, for new steps in `deluge_main` that `src/boot.cpp` should copy, and changes to the song loading it reuses;
   - `mise exec -- ctest --test-dir build` passes, and `node build/webluge.js load <card> <song>` loads each test song with no missing audio files.
6. Rerun the searches in [ARM_AUDIT.md](ARM_AUDIT.md) and `scripts/find_register_access.sh`, and update it. If a harness in `tests/golden` changed, or a new ARM-only site needs one, regenerate with `tests/golden/generate.sh`. Then run `tests/golden/check.sh` and the firmware's unit tests.
7. Update the Deluge to the new release, record the test songs into `reference/<new>/`, then run the render comparisons (PLAN.md 4.4).
8. Re-check every item in PLAN.md's Discoveries that names a file or function, and update this log.

## Release log

Record what each upgrade needed, newest first: conflicts, interface changes, new hardware dependencies, comparison results.

### 1.2.1 (`release_1_2_1`, `c23bc2fe`)

Starting point. Patches on `webluge/1.2.1`:

- `upstreamable:` Host fixed-point fallbacks in `util/fixedpoint.h` match the ARM instructions.
- `upstreamable:` `swapEndianness32`/`2x16` in `util/functions.h` get a portable fallback.
- `upstreamable:` `gui/l10n/language.h` includes `<algorithm>` for `std::copy`.
- `upstreamable:` Include the headers that libstdc++ or the DSP unity build supplied implicitly.
- `upstreamable:` Build with clang and libc++: `int32_t` is not `long`, `std::array` iterators are not pointers, `strrchr` on a `const char*` returns `const char*`, `__restrict__` placement, and `Language`'s name no longer needs the heap in a `consteval` constructor.
- `upstreamable:` Guard the PMU and interrupt-control asm (`io/debug/print.{h,cpp}`, `timers_interrupts.h`) with `__arm__`.
- `seam:` `general_memory_allocator.cpp` takes its memory region bounds from `webluge/memory_map.h` instead of linker symbols.
- `seam:` `UNCACHED_MIRROR_OFFSET` is 0 on the host.
- `seam:` `ffconf.h` lets the host build enable `f_mkfs`, to format card images.
- `seam:` The task scheduler calls `webluge_scheduler_idle` when nothing is due, so the host's virtual clock can move on.
