#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define WEBLUGE_SAMPLE_RATE 44100

// Receives each frame the codec plays, as the 32-bit samples the firmware wrote to the DMA buffer.
typedef void (*WeblugeAudioSink)(int32_t left, int32_t right, void* context);

// Pass null to discard what's played.
void webluge_audio_set_sink(WeblugeAudioSink sink, void* context);

uint64_t webluge_audio_frames_played(void);

// Called by the clock: the codec plays frames until it has played this many in all.
void webluge_audio_play_until(uint64_t frames);

#ifdef __cplusplus
}
#endif
