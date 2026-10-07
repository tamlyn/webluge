// UARTs to the PIC (pads, buttons, LEDs, 7-segment display) and MIDI DIN. Output is dropped as soon as it's
// flushed, and nothing is ever received. The firmware writes into the transmit buffers directly
// (bufferPICUart), so they must be real.

#include "RZA1/cpu_specific.h"
#include "RZA1/uart/sio_char.h"
#include "definitions.h"
#include "lib/printf.h"
#include <stdio.h>

struct UartItem uartItems[NUM_UART_ITEMS];
uint8_t picTxBuffer[PIC_TX_BUFFER_SIZE];
char midiTxBuffer[MIDI_TX_BUFFER_SIZE];

static int32_t bufferSize(int32_t item) {
	return item == UART_ITEM_PIC ? PIC_TX_BUFFER_SIZE : MIDI_TX_BUFFER_SIZE;
}

void uartFlushIfNotSending(int32_t item) {
	uartItems[item].txBufferReadPos = uartItems[item].txBufferWritePos;
}

int32_t uartGetTxBufferFullnessByItem(int32_t item) {
	return (uartItems[item].txBufferWritePos - uartItems[item].txBufferReadPos) & (bufferSize(item) - 1);
}

int32_t uartGetTxBufferSpace(int32_t item) {
	return bufferSize(item) - 1 - uartGetTxBufferFullnessByItem(item);
}

uint8_t uartGetChar(int32_t item, char* readData) {
	return 0;
}

uint32_t* uartGetCharWithTiming(int32_t timingCaptureItem, char* readData) {
	return NULL;
}

void uartPutCharBack(int32_t item) {
}

void uartSetBaudRate(uint8_t scifID, uint32_t baudRate) {
}

// Debug text, which the device sends over RTT or MIDI.
void uartPrint(char const* output) {
	fputs(output, stderr);
}

void uartPrintln(char const* output) {
	fprintf(stderr, "%s\n", output);
}

void uartPrintNumber(int32_t number) {
	fprintf(stderr, "%d\n", (int)number);
}

void uartPrintlnFloat(float number) {
	fprintf(stderr, "%f\n", number);
}

// Output for lib/printf, which the firmware uses in place of the C library's printf.
void putchar_(char c) {
	fputc(c, stderr);
}
