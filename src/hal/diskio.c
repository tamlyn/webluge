// FatFs disk layer for the SD card. No card is inserted yet; Phase 3 backs this with an in-memory image.

#include "diskio.h"
#include "ff.h"

uint8_t currentlyAccessingCard = 0;

DSTATUS disk_status(BYTE pdrv) {
	return STA_NOINIT | STA_NODISK;
}

DSTATUS disk_initialize(BYTE pdrv) {
	return STA_NOINIT | STA_NODISK;
}

DRESULT disk_read(BYTE pdrv, BYTE* buff, LBA_t sector, UINT count) {
	return RES_NOTRDY;
}

DRESULT disk_read_without_streaming_first(BYTE pdrv, BYTE* buff, DWORD sector, UINT count) {
	return RES_NOTRDY;
}

DRESULT disk_write(BYTE pdrv, const BYTE* buff, LBA_t sector, UINT count) {
	return RES_NOTRDY;
}

DRESULT disk_ioctl(BYTE pdrv, BYTE cmd, void* buff) {
	return RES_NOTRDY;
}

void disk_timerproc(UINT msPassed) {
}

DWORD get_fattime(void) {
	return 0;
}
