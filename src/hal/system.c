// Interrupt controller, cache and SPI flash. The flash holds the device's settings; erased flash reads as
// 0xFF, so the firmware falls back to its defaults.

#include "RZA1/intc/devdrv_intc.h"
#include "RZA1/spibsc/r_spibsc_flash_api.h"
#include "RZA1/spibsc/spibsc_Deluge_setup.h"
#include "definitions.h"
#include <stdint.h>
#include <string.h>

volatile uint32_t intc_func_active = 0;

// Rising edges on the analog clock input, which the device records from an interrupt. None ever arrive.
uint32_t triggerClockRisingEdgeTimes[TRIGGER_CLOCK_INPUT_NUM_TIMES_STORED];
uint32_t triggerClockRisingEdgesReceived = 0;
uint32_t triggerClockRisingEdgesProcessed = 0;

int32_t R_INTC_Enable(uint16_t int_id) {
	return 0;
}

void initSPIBSC() {
}

void v7_dma_flush_range(uintptr_t start, uintptr_t end) {
}

int32_t R_SFLASH_EraseSector(uint32_t addr, uint32_t ch_no, uint32_t dual, uint8_t data_width, uint8_t addr_mode) {
	return 0;
}

int32_t R_SFLASH_ByteRead(uint32_t addr, uint8_t* buf, int32_t size, uint32_t ch_no, uint32_t dual, uint8_t data_width,
                          uint8_t addr_mode) {
	memset(buf, 0xFF, size);
	return 0;
}

int32_t R_SFLASH_ByteProgram(uint32_t addr, uint8_t* buf, int32_t size, uint32_t ch_no, uint32_t dual,
                             uint8_t data_width, uint8_t addr_mode) {
	return 0;
}
