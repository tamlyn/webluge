#!/usr/bin/env bash
# Builds each harness against the firmware's ARM code (inline asm, assembly, NEON) and runs it in an ARMv7
# container to record the device's output. Only needs rerunning when a harness changes.
#
# Docker on Apple silicon runs ARMv7 under QEMU, so these come from QEMU's model of the instructions rather
# than real hardware.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

docker run --rm --platform linux/arm/v7 -v "$repo:/src:ro" -v "$here:/out" -w /tmp gcc:14 sh -ec '
	flags="-std=c++23 -O2 -w -mcpu=cortex-a9 -mfpu=neon -mfloat-abi=hard -marm"
	flags="$flags -I/src/DelugeFirmware/src/deluge -I/src/DelugeFirmware/src"

	g++ $flags /src/tests/golden/fixedpoint.cpp -o fixedpoint
	./fixedpoint >/out/fixedpoint.txt

	g++ $flags /src/tests/golden/dx7_kernel.cpp /src/DelugeFirmware/src/deluge/dsp/dx/neon_fm_kernel.s -o dx7_kernel
	./dx7_kernel >/out/dx7_kernel.txt

	g++ $flags /src/tests/golden/neon.cpp -o neon
	./neon >/out/neon.txt
'
