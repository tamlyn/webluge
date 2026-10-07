#include "host_display.h"
#include <cstdio>
#include <cstdlib>

void HostDisplay::freezeWithError(char const* text) {
	std::fprintf(stderr, "Froze with error %s\n", text);
	std::abort();
}

void HostDisplay::displayPopup(char const* newText, int8_t numFlashes, bool alignRight, uint8_t drawDot,
                               int32_t blinkSpeed, PopupType type) {
	std::fprintf(stderr, "Popup: %s\n", newText);
	SevenSegment::displayPopup(newText, numFlashes, alignRight, drawDot, blinkSpeed, type);
}

void HostDisplay::displayError(Error error) {
	if (error != Error::NONE) {
		std::fprintf(stderr, "Error %d\n", (int)error);
	}
	SevenSegment::displayError(error);
}
