# Reference recordings: firmware 1.2.1

Each song has two folders:

- `card/` holds only what the song reads from the SD card: the song, the samples it references and the card's settings (`CommunityFeatures.XML`, `MIDIFollow.XML`). Build an image from it with `webluge image`, or pass it to `webluge load`.
- `device/` holds the Deluge's stem export, kept out of `card/` so it doesn't end up in images.

Everything was copied from the SD card used for the recordings and checked byte-identical with it.

| Song | Covers | Tempo | Clip length | Recorded on |
|---|---|---|---|---|
| Reference Synth Sub | Subtractive synth, no samples, no reverb. Clip 5 automates noise volume, clip 6 the filter cutoff | 120 BPM | 4 beats (88200 frames) | 1.2.1 |
| Reference Synth Rsb | Subtractive synth (Rich Saw Bass), no samples, no reverb. Clip 2 automates filter cutoff and resonance | 100 BPM | 8 beats (211680 frames) | 1.2.1 |
| Reference Kit 808 | Sample kit (808), no timestretch | 120 BPM | 4 beats (88200 frames) | 1.2.0 |

The synths were re-recorded on 1.2.1 with every oscillator's retrigger phase at 0°, and their songs say `firmwareVersion="c1.2.1"`. The kit's stems are from the first session, on 1.2.0, and its song still says `c1.2.0`.

**TODO (Tamlyn):** re-export the kit on 1.2.1.

Random sources left: Synth Sub's noise (clip 5), so that clip can't null-test. Unpatched LFOs don't count.

## Stem exports

The Deluge wrote these to `SAMPLES/EXPORTS/<song>/CLIPS-00/` (the synths) and `CLIPS/` (the kit). Each is one clip, mono, 44.1kHz, 24-bit PCM, with a `smpl` chunk holding the loop end.

- Normalisation was off: peaks range from −22 to −3 dBFS.
- The synths were exported with the defaults: export to silence on, so each stem runs on 12 seconds after the sound stops, and "include song FX" off, so the stems are the mix before song FX, made mono afterwards. `webluge export` uses the same defaults, and its stems match these lengths to within 800 frames.
- The kit was exported with export to silence off: its stems end 2000–3000 frames after the clip, where the offline render's burst stops.
