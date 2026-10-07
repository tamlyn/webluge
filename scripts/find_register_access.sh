#!/usr/bin/env bash
# Lists the functions in the built wasm that use a constant in the RZ/A1's peripheral address range
# (0xE0000000-0xFEFFFFFF), grouped by the top 16 bits of the address. On the host those addresses are out of
# bounds, so any of these that runs traps unless its peripheral is replaced (see ARM_AUDIT.md). DSP code uses
# constants in this range too, so expect false positives in the 0xE000, 0xF000 and 0xF800-0xFF00 groups.
# Register pointers held in tables rather than inlined don't show up.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
bin=$(dirname "$(cd "$repo" && mise which emcc)")/../bin

"$bin/wasm-dis" "$repo/build/webluge.wasm" | awk '
/^ \(func \$/ { fn = $2 }
/i32.const -[0-9]+/ {
	match($0, /i32.const -[0-9]+/)
	v = substr($0, RSTART + 11, RLENGTH - 11) + 0
	if (v >= 16777216 && v <= 536870912) printf "%04X %s\n", int((4294967296 - v) / 65536), fn
}' | sort -u | awk '{ fns[$1] = fns[$1] " " $2 } END { for (k in fns) print k ":" fns[k] }' | sort
