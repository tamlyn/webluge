// OLED display, and the SPI bus it shares with the CV outputs. Nothing is drawn or sent.

#include "RZA1/oled/oled_low_level.h"
#include "drivers/oled/oled.h"
#include "drivers/rspi/rspi.h"
#include "RZA1/rspi/rspi.h"

// 256 means not waiting for a message from the PIC.
int oledWaitingForMessage = 256;
volatile bool spiTransferQueueCurrentlySending = false;

void oledRoutine() {
}

void oledSelectingComplete() {
}

void oledDeselectionComplete() {
}

void oledLowLevelTimerCallback() {
}

void enqueueSPITransfer(int32_t whichOled, uint8_t const* image) {
}

void enqueueCVMessage(int channel, uint32_t message) {
}

void R_RSPI_SendBasic32(uint8_t channel, uint32_t data) {
}

void oledMainInit() {
}

void oledDMAInit() {
}

void setupSPIInterrupts() {
}

void R_RSPI_Create(uint8_t channel, uint32_t bitRate, uint8_t phase, uint8_t dataSize) {
}

void R_RSPI_Start(uint8_t channel) {
}
