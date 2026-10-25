#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define WEBLUGE_SECTOR_SIZE 512

// A card in the SD card slot, read and written whole sectors at a time. Each returns false if it can't.
typedef struct {
	void* card;
	uint32_t numSectors;
	bool (*read)(void* card, uint8_t* buffer, uint32_t sector, uint32_t count);
	bool (*write)(void* card, const uint8_t* buffer, uint32_t sector, uint32_t count);
} WeblugeDisk;

// The card must outlive its insertion.
void webluge_disk_insert(WeblugeDisk disk);
void webluge_disk_eject(void);

#ifdef __cplusplus
}
#endif
