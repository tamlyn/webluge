cmake_minimum_required(VERSION 3.23)

set(FIRMWARE ${CMAKE_CURRENT_LIST_DIR}/DelugeFirmware)

# Take the version from the firmware's release tag so that saved songs and settings carry the same version as the
# device's. Its CMakeLists.txt can lag behind: 1.2.1's still says 1.2.0, but the release build reports 1.2.1.
execute_process(
	COMMAND git describe --tags --abbrev=0 --match release_*
	WORKING_DIRECTORY ${FIRMWARE}
	OUTPUT_VARIABLE firmware_tag
	OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REGEX REPLACE "^release_([0-9]+)_([0-9]+)_([0-9]+)$" "\\1.\\2.\\3" firmware_version "${firmware_tag}")
if(NOT firmware_version MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+$")
	message(FATAL_ERROR "No release tag in the firmware's history (found '${firmware_tag}')")
endif()

project(webluge VERSION ${firmware_version} LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
	message(FATAL_ERROR "Configure with emcmake, e.g. `mise exec -- emcmake cmake -B build -G Ninja`")
endif()

set(CMAKE_C_STANDARD 23)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS ON)

if(NOT CMAKE_BUILD_TYPE)
	set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

execute_process(
	COMMAND git rev-parse --short HEAD
	WORKING_DIRECTORY ${FIRMWARE}
	OUTPUT_VARIABLE GIT_COMMIT_SHORT
	OUTPUT_STRIP_TRAILING_WHITESPACE
)
set(PROJECT_VERSION_MAJOR ${webluge_VERSION_MAJOR})
set(PROJECT_VERSION_MINOR ${webluge_VERSION_MINOR})
set(PROJECT_VERSION_PATCH ${webluge_VERSION_PATCH})
set(BUILD_VERSION_STRING "c${firmware_version}")
set(BUILD_VERSION_STRING_SHORT "c${firmware_version}")
set(generated ${CMAKE_CURRENT_BINARY_DIR}/generated)
configure_file(${FIRMWARE}/src/deluge/util/firmware_version.h.in ${generated}/util/firmware_version.h @ONLY)
configure_file(${FIRMWARE}/src/deluge/version/version.h.in ${generated}/version.h @ONLY)
configure_file(${FIRMWARE}/src/deluge/version/version.cpp.in ${generated}/version.cpp.gen @ONLY)

# Everything in src/deluge except the hardware drivers and the ARM-only files listed in ARM_AUDIT.md.
file(GLOB_RECURSE firmware_sources CONFIGURE_DEPENDS
	${FIRMWARE}/src/deluge/*.c
	${FIRMWARE}/src/deluge/*.cpp
)
list(FILTER firmware_sources EXCLUDE REGEX "/src/deluge/drivers/")
list(FILTER firmware_sources EXCLUDE REGEX "/src/deluge/util/chainload\\.cpp$")

list(APPEND firmware_sources
	${FIRMWARE}/src/OSLikeStuff/task_scheduler.cpp
	${FIRMWARE}/src/fatfs/ff.c
	${FIRMWARE}/src/fatfs/ffsystem.c
	${FIRMWARE}/src/fatfs/ffunicode.c
	${FIRMWARE}/src/fatfs/fatfs.cpp
	${FIRMWARE}/src/NE10/common/NE10_mask_table.c
	${FIRMWARE}/src/NE10/modules/dsp/NE10_fft.c
	${FIRMWARE}/src/NE10/modules/dsp/NE10_fft_generic_int32.cpp
	${FIRMWARE}/src/NE10/modules/dsp/NE10_fft_generic_int32.neonintrinsic.cpp
	${FIRMWARE}/src/NE10/modules/dsp/NE10_fft_int32.c
	${FIRMWARE}/src/NE10/modules/dsp/NE10_fft_int32.neonintrinsic.c
	${FIRMWARE}/src/NE10/modules/dsp/NE10_fir_init.c
	${FIRMWARE}/src/lib/printf.c
)

file(GLOB_RECURSE host_sources CONFIGURE_DEPENDS
	${CMAKE_CURRENT_LIST_DIR}/src/*.c
	${CMAKE_CURRENT_LIST_DIR}/src/*.cpp
)
list(FILTER host_sources EXCLUDE REGEX "/src/(main|web)\\.cpp$")

# Everything but main, so that tests can link the firmware too.
add_library(firmware OBJECT ${firmware_sources} ${host_sources})

target_include_directories(firmware PUBLIC
	# First, so that our replacements shadow the firmware's headers of the same name.
	${CMAKE_CURRENT_LIST_DIR}/src/include
	${generated}
	${FIRMWARE}/src/deluge
	${FIRMWARE}/src
	${FIRMWARE}/src/OSLikeStuff
	${FIRMWARE}/src/NE10/inc
	${FIRMWARE}/src/NE10/common
	${FIRMWARE}/src/NE10/modules
	${FIRMWARE}/src/fatfs
	${FIRMWARE}/src/lib
	${CMAKE_CURRENT_LIST_DIR}/src
)

target_compile_definitions(firmware PUBLIC
	WEBLUGE=1
	USE_TASK_MANAGER
	_GNU_SOURCE
	FF_USE_MKFS=1
)

target_compile_options(firmware PUBLIC
	-fsigned-char
	-fno-exceptions
	-fno-rtti
	$<$<COMPILE_LANGUAGE:CXX>:-fno-threadsafe-statics>
	-msimd128
	# The device never fuses multiply-adds (VFPv3), and the DX7 kernel port depends on it. See ARM_AUDIT.md.
	-ffp-contract=off
	-Wno-everything
)

target_link_options(firmware PUBLIC
	-sERROR_ON_UNDEFINED_SYMBOLS=1
	# The firmware uses fixed addresses for SDRAM (0x0C000000-0x10000000) and on-chip RAM (0x20000000-0x20300000).
	# Starting Emscripten's own data, stack and heap above them leaves those ranges free for the firmware.
	# Memory that's never touched costs nothing, so the gap is cheap.
	-sGLOBAL_BASE=541065216 # 0x20400000
	-sINITIAL_MEMORY=640mb
	-sALLOW_MEMORY_GROWTH=1
	-sMAXIMUM_MEMORY=4gb
)

# For programs run under Node: the CLI and the tests.
set(node_program_options
	-sENVIRONMENT=node
	-sEXIT_RUNTIME=1
	# Gives the program the host's filesystem, for card folders and images.
	-sNODERAWFS=1
)

add_executable(webluge src/main.cpp)
target_link_libraries(webluge PRIVATE firmware)
target_link_options(webluge PRIVATE ${node_program_options})

# The browser's song preview (web/), an ES module. Node too, so that its tests can run it.
add_executable(webluge_web src/web.cpp)
target_link_libraries(webluge_web PRIVATE firmware)
set_target_properties(webluge_web PROPERTIES SUFFIX ".mjs")
target_link_options(webluge_web PRIVATE
	# Debug info makes the download twelve times bigger. This overrides the build type's -g for this target only.
	-g0
	--no-entry
	-sENVIRONMENT=web,worker,node
	-sMODULARIZE=1
	-sEXPORT_ES6=1
	-sEXPORT_NAME=createWebluge
	-sFORCE_FILESYSTEM=1
	-sEXPORTED_FUNCTIONS=_webluge_web_load,_webluge_web_load_preset,_webluge_web_audition,_webluge_web_play,_webluge_web_describe,_webluge_web_description_length,_webluge_web_render,_webluge_web_rendered_frames,_webluge_web_toggle_clip,_webluge_web_solo_clip,_webluge_web_clip_states,_webluge_web_frames_per_tick
	-sEXPORTED_RUNTIME_METHODS=FS,ccall,HEAPF32,HEAP32,HEAPU8
)

enable_testing()
add_executable(storage_test tests/storage/storage_test.cpp)
target_link_libraries(storage_test PRIVATE firmware)
target_link_options(storage_test PRIVATE ${node_program_options})
# emcmake runs tests under Node.
add_test(NAME storage COMMAND storage_test)
add_executable(render_test tests/render/render_test.cpp)
target_link_libraries(render_test PRIVATE firmware)
target_link_options(render_test PRIVATE ${node_program_options})
add_test(NAME metronome COMMAND render_test metronome)
add_test(NAME note COMMAND render_test note)
