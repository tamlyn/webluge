// Audio codec (SSI) DMA buffers. On the device, DMA cycles through these continuously and the audio engine
// renders up to the DMA position. The position never moves yet; Phase 4.1 turns it into the render clock.

#include "definitions.h"
#include "drivers/ssi/ssi.h"

static int32_t txBuffer[SSI_TX_BUFFER_NUM_SAMPLES * NUM_MONO_OUTPUT_CHANNELS];
static int32_t rxBuffer[SSI_RX_BUFFER_NUM_SAMPLES * NUM_MONO_INPUT_CHANNELS];

int32_t* getTxBufferStart() {
	return txBuffer;
}

int32_t* getTxBufferEnd() {
	return txBuffer + SSI_TX_BUFFER_NUM_SAMPLES * NUM_MONO_OUTPUT_CHANNELS;
}

void* getTxBufferCurrentPlace() {
	return txBuffer;
}

int32_t* getRxBufferStart() {
	return rxBuffer;
}

int32_t* getRxBufferEnd() {
	return rxBuffer + SSI_RX_BUFFER_NUM_SAMPLES * NUM_MONO_INPUT_CHANNELS;
}

void* getRxBufferCurrentPlace() {
	return rxBuffer;
}

void ssiInit(uint8_t ssiChannel, uint8_t dmaChannel) {
}
