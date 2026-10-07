#pragma once

#include "hid/display/seven_segment.h"

// The 7-segment display, plus reporting on stderr. On the device a freeze waits for a button press, which would
// hang the host, so here it aborts instead.
class HostDisplay final : public deluge::hid::display::SevenSegment {
public:
	void freezeWithError(char const* text) override;
	void displayPopup(char const* newText, int8_t numFlashes = 3, bool alignRight = false, uint8_t drawDot = 255,
	                  int32_t blinkSpeed = 1, PopupType type = PopupType::GENERAL) override;
	void displayError(Error error) override;
};
