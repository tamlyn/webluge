// Stands in for the linker script's memory symbols in general_memory_allocator.cpp. The host build keeps the
// device's memory map: the link puts Emscripten's own memory above it (see CMakeLists.txt), so the firmware's
// fixed SDRAM and on-chip RAM addresses are ordinary wasm memory. Macros rather than variables, so the bounds
// are constant before any static initialiser runs.
#pragma once

#include "RZA1/cpu_specific.h"
#include <cstdint>

#define WEBLUGE_INTERNAL_MEMORY_SIZE 0x00300000u
#define WEBLUGE_PROGRAM_STACK_SIZE 0x8000u

// Nothing is placed in SDRAM at link time on the host, so all of it is free.
#define __sdram_bss_start (*reinterpret_cast<uint32_t*>(EXTERNAL_MEMORY_BEGIN))
#define __sdram_bss_end (*reinterpret_cast<uint32_t*>(EXTERNAL_MEMORY_BEGIN))

// The program's code and data don't live in on-chip RAM on the host, so the heap gets all of it apart from the
// stack. The stack itself is unused, as the real stack is Emscripten's.
#define program_stack_end (*reinterpret_cast<uint32_t*>(INTERNAL_MEMORY_BEGIN + WEBLUGE_INTERNAL_MEMORY_SIZE))
#define program_stack_start                                                                                        \
	(*reinterpret_cast<uint32_t*>(INTERNAL_MEMORY_BEGIN + WEBLUGE_INTERNAL_MEMORY_SIZE - WEBLUGE_PROGRAM_STACK_SIZE))
#define __heap_start (*reinterpret_cast<uint32_t*>(INTERNAL_MEMORY_BEGIN))
#define __heap_end program_stack_start
