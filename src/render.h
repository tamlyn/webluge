#pragma once

#include <cstdint>

namespace webluge {

// Presses play.
void startPlayback();

// Runs the firmware until the codec has played this many more frames. Set an audio sink to hear them.
void run(uint64_t numFrames);

} // namespace webluge
