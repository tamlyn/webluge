#pragma once

#include <cstdint>

namespace webluge {

// Boots the firmware, with whatever card is inserted, as far as the blank song.
void boot();

// Loads a song from the card, as if picked in the song browser. Returns false if the firmware reported an error.
bool loadSong(const char* path);

// Loads a kit or synth from the card in place of the blank song's synth, as if picked in the preset browser. Returns
// false if the firmware reported an error.
bool loadPreset(const char* path);

// Prints a summary of the loaded song, and each audio file it uses that isn't on the card. Returns the number
// missing.
int32_t reportSong();

} // namespace webluge
