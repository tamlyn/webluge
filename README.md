# Webluge

Play [Synthstrom Deluge](https://synthstrom.com/product/deluge/) songs in the browser, sounding the same as the hardware.

Rather than reimplementing the synth engines, Webluge compiles the [Deluge firmware](https://github.com/SynthstromAudible/DelugeFirmware) itself to WebAssembly and swaps out only the hardware layer. The sequencer, automation and audio engine are the device's own code.

**Try it:** [tamlyn.github.io/webluge](https://tamlyn.github.io/webluge/). Open a copy of your SD card to browse it, audition samples and play songs, starting and stopping clips as you would in session view. It needs the File System Access API, so Chrome or Edge only.

It's a work in progress. Most sounds match the device closely but not yet exactly, and there's no editing, MIDI or recording. [PLAN.md](PLAN.md) has the details.

## Building

The toolchain (Emscripten, CMake, Ninja, Node) is pinned in `mise.toml`.

```sh
git clone --recurse-submodules git@github.com:tamlyn/webluge.git
cd webluge
mise install
mise exec -- emcmake cmake -B build -G Ninja
mise exec -- ninja -C build
mise exec -- ctest --test-dir build
```

That also builds a Node CLI for loading and rendering songs offline. Run `mise exec -- node build/webluge.js` for usage.

Then the web app:

```sh
cd web
mise exec -- npm install
mise exec -- npm run dev
mise exec -- npm test
```

## Firmware

`DelugeFirmware` is a submodule pointing at [a fork](https://github.com/tamlyn/DelugeFirmware), pinned to release 1.2.1 plus a few small changes. [UPSTREAM.md](UPSTREAM.md) explains how those are kept and how to move to a new release. [ARM_AUDIT.md](ARM_AUDIT.md) lists the ARM-specific code and how each piece runs on the host.

## Licence

[GPL-3.0](LICENSE), the same as the Deluge firmware.
