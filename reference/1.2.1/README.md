# Reference recordings: firmware 1.2.1

Each song has two folders:

- `card/` holds only what the song reads from the SD card: the song, the samples it references and the card's settings (`CommunityFeatures.XML`, `MIDIFollow.XML`). Build an image from it with `webluge image`, or pass it to `webluge load`.
- `device/` holds the Deluge's stem export, kept out of `card/` so it doesn't end up in images.

Everything was copied from the SD card used for the recordings and checked byte-identical with it.

Songs saved by 1.2.1 say `firmwareVersion="c1.2.0"`: the release didn't bump the version in CMake.

**TODO (Tamlyn):** confirm the Deluge was running 1.2.1.

| Song | Covers | Tempo | Clip length |
|---|---|---|---|
| Reference Synth Sub | Subtractive synth, no samples, no reverb | 120 BPM | 4 beats (88200 frames) |
| Reference Synth Rsb | Subtractive synth (Rich Saw Bass), no samples, no reverb | 100 BPM | 8 beats (211680 frames) |
| Reference Kit 808 | Sample kit (808), no timestretch | 120 BPM | 4 beats (88200 frames) |

## Stem exports

The Deluge wrote these to `SAMPLES/EXPORTS/<song>/CLIPS/`. Each is one clip, mono, 44.1kHz, 24-bit PCM, with a `smpl` chunk holding the loop end.

- Normalisation was off: peaks range from −22 to −3 dBFS.
- Export to silence appears to have been on: every stem runs 1–3% past its clip length, and most end in a run of zeros.
- **TODO (Tamlyn):** record the "include song FX" and "offline rendering" settings.
