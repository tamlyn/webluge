#!/usr/bin/env bash
# Builds each harness against the host replacements, both natively and with Emscripten (compilers are free
# to treat undefined behaviour differently), and compares the output with the golden ARM output.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

flags=(-std=c++23 -O2 -w -ffp-contract=off -I"$repo/DelugeFirmware/src/deluge" -I"$repo/DelugeFirmware/src")
status=0

compare() {
	local name=$1 build=$2
	if cmp -s "$here/$name.txt" "$out/$name-$build.txt"; then
		echo "$name ($build): pass"
	else
		echo "$name ($build): FAIL, mismatched lines:"
		diff "$here/$name.txt" "$out/$name-$build.txt" | awk '/^>/ {print $2}' | sort | uniq -c | head -40 || true
		status=1
	fi
}

check() {
	local name=$1
	shift
	c++ "${flags[@]}" "$here/$name.cpp" "$@" -o "$out/$name"
	"$out/$name" >"$out/$name-native.txt"
	compare "$name" native

	(cd "$repo" && mise exec -- em++ "${flags[@]}" -msimd128 "$here/$name.cpp" "$@" -o "$out/$name.js")
	(cd "$repo" && mise exec -- node "$out/$name.js") >"$out/$name-wasm.txt"
	compare "$name" wasm
}

check fixedpoint
check dx7_kernel "$repo/src/dsp/neon_fm_kernel.cpp"
check neon

exit $status
