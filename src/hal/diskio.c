// FatFs disk layer for the SD card, backed by a card image in memory. Follows the device's (RZA1/diskio.c),
// including its status flags, so the firmware sees the same card states.

#include "diskio.h"
#include "disk.h"
#include "ff.h"
#include <string.h>

void loadAnyEnqueuedClustersRoutine(void);

uint8_t currentlyAccessingCard = 0;

static uint8_t* image;
static uint32_t imageSectors;
static DSTATUS status = STA_NOINIT | STA_NODISK;

void webluge_disk_insert(uint8_t* newImage, uint32_t numSectors) {
	image = newImage;
	imageSectors = numSectors;
	status = STA_NOINIT;
}

void webluge_disk_eject(void) {
	image = NULL;
	imageSectors = 0;
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
	return !(status & STA_NOINIT) && sector < imageSectors && count <= imageSectors - sector;
}

DRESULT disk_read_without_streaming_first(BYTE pdrv, BYTE* buff, DWORD sector, UINT count) {
	if (!inRange(sector, count)) {
		return RES_ERROR;
	}
	memcpy(buff, image + (size_t)sector * WEBLUGE_SECTOR_SIZE, (size_t)count * WEBLUGE_SECTOR_SIZE);
	return RES_OK;
}

DRESULT disk_read(BYTE pdrv, BYTE* buff, LBA_t sector, UINT count) {
	// As on the device, sample streaming comes before any other card access.
	loadAnyEnqueuedClustersRoutine();
	return disk_read_without_streaming_first(pdrv, buff, sector, count);
}

DRESULT disk_write(BYTE pdrv, const BYTE* buff, LBA_t sector, UINT count) {
	loadAnyEnqueuedClustersRoutine();
	if (!inRange(sector, count)) {
		return RES_ERROR;
	}
	memcpy(image + (size_t)sector * WEBLUGE_SECTOR_SIZE, buff, (size_t)count * WEBLUGE_SECTOR_SIZE);
	return RES_OK;
}

DRESULT disk_ioctl(BYTE pdrv, BYTE cmd, void* buff) {
	if (status & STA_NOINIT) {
		return RES_NOTRDY;
	}
	switch (cmd) {
	case CTRL_SYNC:
		return RES_OK;
	case GET_SECTOR_COUNT:
		*(LBA_t*)buff = imageSectors;
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
