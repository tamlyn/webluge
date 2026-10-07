#pragma once

#include <cstdint>

namespace webluge {

// Presses play.
void startPlayback();

// Runs the firmware until the codec has played this many more frames. Set an audio sink to hear them.
void run(uint64_t numFrames);

// Exports a stem per clip, as the device's stem export does, into the card's SAMPLES/EXPORTS/<song name>/.
void exportClipStems();

} // namespace webluge
