// FatFs disk layer for the SD card, backed by a card image (src/card/image.h). Follows the device's (RZA1/diskio.c),
// including its status flags, so the firmware sees the same card states.

#include "diskio.h"
#include "disk.h"
#include "ff.h"

void loadAnyEnqueuedClustersRoutine(void);

uint8_t currentlyAccessingCard = 0;

static WeblugeDisk disk;
static DSTATUS status = STA_NOINIT | STA_NODISK;

void webluge_disk_insert(WeblugeDisk newDisk) {
	disk = newDisk;
	status = STA_NOINIT;
}

void webluge_disk_eject(void) {
	disk = (WeblugeDisk){0};
	status = STA_NOINIT | STA_NODISK;
}

DSTATUS disk_status(BYTE pdrv) {
	return status;
}

DSTATUS disk_initialize(BYTE pdrv) {
	if (!(status & STA_NODISK)) {
		status = 0;
	}
	return status;
}

static int inRange(LBA_t sector, UINT count) {
	return !(status & STA_NOINIT) && sector < disk.numSectors && count <= disk.numSectors - sector;
}

DRESULT disk_read_without_streaming_first(BYTE pdrv, BYTE* buff, DWORD sector, UINT count) {
	return inRange(sector, count) && disk.read(disk.card, buff, sector, count) ? RES_OK : RES_ERROR;
}

DRESULT disk_read(BYTE pdrv, BYTE* buff, LBA_t sector, UINT count) {
	// As on the device, sample streaming comes before any other card access.
	loadAnyEnqueuedClustersRoutine();
	return disk_read_without_streaming_first(pdrv, buff, sector, count);
}

DRESULT disk_write(BYTE pdrv, const BYTE* buff, LBA_t sector, UINT count) {
	loadAnyEnqueuedClustersRoutine();
	return inRange(sector, count) && disk.write(disk.card, buff, sector, count) ? RES_OK : RES_ERROR;
}

DRESULT disk_ioctl(BYTE pdrv, BYTE cmd, void* buff) {
	if (status & STA_NOINIT) {
		return RES_NOTRDY;
	}
	switch (cmd) {
	case CTRL_SYNC:
		return RES_OK;
	case GET_SECTOR_COUNT:
		*(LBA_t*)buff = disk.numSectors;
		return RES_OK;
	default:
		return RES_PARERR;
	}
}

void disk_timerproc(UINT msPassed) {
}

DWORD get_fattime(void) {
	return 0;
}
