# Reference recordings: firmware 1.2.1

Each song has two folders:

- `card/` holds only what the song reads from the SD card: the song, the samples it references and the card's settings (`CommunityFeatures.XML`, `MIDIFollow.XML`). Build an image from it with `webluge image`, or pass it to `webluge load`.
- `device/` holds the Deluge's stem export, kept out of `card/` so it doesn't end up in images.

## Songs made on the device

These were copied from the SD card used for the recordings and checked byte-identical with it.

| Song | Covers | Tempo | Clip length | Recorded on |
|---|---|---|---|---|
| Reference Synth Sub | Subtractive synth, no samples, no reverb. Clip 5 automates noise volume, clip 6 the filter cutoff | 120 BPM | 4 beats (88200 frames) | 1.2.1 |
| Reference Synth Rsb | Subtractive synth (Rich Saw Bass), no samples, no reverb. Clip 2 automates filter cutoff and resonance | 100 BPM | 8 beats (211680 frames) | 1.2.1 |
| Reference Kit 808 | Sample kit (808), no timestretch | 120 BPM | 4 beats (88200 frames) | 1.2.1 |

The synths were re-recorded on 1.2.1 with every oscillator's retrigger phase at 0°, and their songs say `firmwareVersion="c1.2.1"`. The kit was first recorded on 1.2.0 and re-exported on 1.2.1 without being re-saved, so its song still says `c1.2.0`. The two exports null the same against the host.

Random sources left:

- Synth Sub's noise (clip 5), so that clip is left out of comparisons.
- Every synth's and drum's low-pass filter, the 24 dB transistor ladder, which adds noise to its cutoff whenever it runs (`LpLadderFilter::do24dBLPFOnSample`). It runs even fully open, because the default `y` cable is patched to the cutoff. So none of these songs can null: two host exports at different render timings null against each other as well as against the device (PLAN.md 4.6).

## Generated songs

`scripts/make_reference_songs.py` writes these, each clip testing one thing. Clips marked "by ear" can't null, even against another export on the same device. All were exported on 1.2.1 without being re-saved, so the songs on the card stayed byte-identical with these.

| Song | Clips | Export with |
|---|---|---|
| Reference Synth Engines | DX7 on its modern (NEON) and MkI engines, FM, wavetable, ring mod | Defaults |
| Reference FX | Digital and analog delay, chorus (by ear), stereo chorus (by ear), phaser (by ear), compressor, bitcrush, decimation, wavefold, 24 dB ladder low-pass (by ear), SVF band-pass, high-pass, and the same saw dry | Defaults |
| Reference Reverb Mutable | A saw into the Mutable reverb | "Include song FX" on |
| Reference Reverb Freeverb | A saw into Freeverb | "Include song FX" on |
| Reference Samples | Kit: a snare transposed up a fifth; a loop slowed by timestretch (by ear); the loop pitched up with its speed kept (by ear); a kick sidechaining a pad. An audio clip timestretching the loop from 120 to 96 BPM (by ear) | Defaults |

All are 120 BPM with 4-beat clips. The loop and wavetable are generated too, from the 808 samples and from sines, so the repo holds no third-party audio beyond the 808 samples.

Each reverb has a song of its own because "include song FX" also runs the master compressor, whose state carries from one stem to the next. On the host only the first stem exported is reproducible with it on. For the same reason, stem export goes from the last clip to the first, so the delays come first in Reference FX: their tails can run on below the silence threshold into the next stem.

To record again: copy each song's `card/SONGS` and `card/SAMPLES` onto the card, load the song and run stem export of clips with the settings above. On the host: `webluge export [--song-fx] <card> <song> <folder>`.

## Stem exports

The Deluge writes these to `SAMPLES/EXPORTS/<song>/CLIPS/`, or `CLIPS-00/` and so on if that exists. Each is one clip, mono, 44.1kHz, 24-bit PCM, with a `smpl` chunk holding the loop end.

- Normalisation was off.
- The device-made songs were exported with the defaults: export to silence on, so each stem runs on 12 seconds after the sound stops, and "include song FX" off, so the stems are the mix before song FX, made mono afterwards. `webluge export` uses the same defaults, and its stems match these lengths to within 800 frames.
