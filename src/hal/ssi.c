// Audio codec (SSI) DMA buffers. On the device, DMA cycles through these continuously and the audio engine
// renders up to the DMA position. Here the clock moves the DMA position on, and each frame it passes is played.

#include "audio.h"
#include "definitions.h"
#include "drivers/ssi/ssi.h"

static int32_t txBuffer[SSI_TX_BUFFER_NUM_SAMPLES * NUM_MONO_OUTPUT_CHANNELS];
static int32_t rxBuffer[SSI_RX_BUFFER_NUM_SAMPLES * NUM_MONO_INPUT_CHANNELS];

static uint64_t framesPlayed;
static WeblugeAudioSink sink;
static void* sinkContext;

void webluge_audio_set_sink(WeblugeAudioSink newSink, void* context) {
	sink = newSink;
	sinkContext = context;
}

uint64_t webluge_audio_frames_played(void) {
	return framesPlayed;
}

void webluge_audio_play_until(uint64_t frames) {
	for (; framesPlayed < frames; framesPlayed++) {
		if (sink) {
			int32_t* frame = txBuffer + (framesPlayed % SSI_TX_BUFFER_NUM_SAMPLES) * NUM_MONO_OUTPUT_CHANNELS;
			sink(frame[0], frame[1], sinkContext);
		}
	}
}

int32_t* getTxBufferStart() {
	return txBuffer;
}

int32_t* getTxBufferEnd() {
	return txBuffer + SSI_TX_BUFFER_NUM_SAMPLES * NUM_MONO_OUTPUT_CHANNELS;
}

void* getTxBufferCurrentPlace() {
	return txBuffer + (framesPlayed % SSI_TX_BUFFER_NUM_SAMPLES) * NUM_MONO_OUTPUT_CHANNELS;
}

int32_t* getRxBufferStart() {
	return rxBuffer;
}

int32_t* getRxBufferEnd() {
	return rxBuffer + SSI_RX_BUFFER_NUM_SAMPLES * NUM_MONO_INPUT_CHANNELS;
}

// The input is silent, but its DMA keeps pace with the output's, as the engine expects.
void* getRxBufferCurrentPlace() {
	return rxBuffer + (framesPlayed % SSI_RX_BUFFER_NUM_SAMPLES) * NUM_MONO_INPUT_CHANNELS;
}

void ssiInit(uint8_t ssiChannel, uint8_t dmaChannel) {
}
