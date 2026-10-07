#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define WEBLUGE_SECTOR_SIZE 512

// Inserts a card image as the SD card. The caller keeps ownership of the memory, which must outlive the card.
void webluge_disk_insert(uint8_t* image, uint32_t numSectors);
void webluge_disk_eject(void);

#ifdef __cplusplus
}
#endif
