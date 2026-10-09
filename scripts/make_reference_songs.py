# Writes the reference songs that cover synth engines, effects and sample playback (docs/PLAN.md 0.3), each clip testing
# one thing, so its stem nulls or fails on its own. Run it from the repo root:
#
#   python3 scripts/make_reference_songs.py
#
# Most clips avoid anything random or free-running, so they can null-test: oscillators retrigger at 0°, DX7 voices
# key-sync with no random detune, and filters stay off except in the clips testing them. A few clips test things that
# can't null, to be compared by ear: the transistor ladder filter adds noise to its cutoff, mod FX LFOs keep running in
# time while their sound is silent, and the timestretcher randomises its hops.
import math
import pathlib
import re
import shutil
import struct
import wave

REFERENCE = pathlib.Path("reference/1.2.1")
TEMPLATE = REFERENCE / "Reference Synth Sub/card"
DRUMS = REFERENCE / "Reference Kit 808/card/SAMPLES/DRUMS"

SAMPLE_RATE = 44100
FRAMES_PER_BEAT = SAMPLE_RATE // 2  # The template's 120 BPM
TICKS_PER_BEAT = 96
CLIP_TICKS = 4 * TICKS_PER_BEAT

KICK = ("SAMPLES/DRUMS/Kick/808 Kick.wav", 22051)
SNARE = ("SAMPLES/DRUMS/Snare/808 Snare.wav", 22051)
LOOP = ("SAMPLES/REFERENCE/Ref Loop 120.wav", 8 * FRAMES_PER_BEAT)
WAVETABLE = "SAMPLES/REFERENCE/Ref Morph.wav"
WAVETABLE_CYCLE = 2048

# Curved Air, from Dx Chord Swing, with its LFO's pitch depth at 0: the DX7 LFO runs freely, so vibrato would depend on
# when the export starts.
DX7_PATCH = bytearray.fromhex(
    "4E261A103A484800000000000000000342000C000E50191F124A4B4B00273F000100000003630000000E4F401E202C5860000000000000000003"
    "630001000E4E261A103A484800000000000000000342001000074E191F124A4B4B00273F000100000003630000000050401E202C5860000000"
    "0000000000036300010007636363633232323203070125000A0000000118437572766564204169723F"
)
DX7_PATCH[139] = 0
assert DX7_PATCH[136] == 1, "oscillator key sync must be on, or each note starts at a random phase"

MIN = -(1 << 31)
MAX = 0x7FFFFFFF


def render(element, depth=0):
    """(tag, attributes, children) as the device writes it: an attribute per line. A str child is text content."""
    tag, attributes, children = element
    indent = "\t" * depth
    out = f"{indent}<{tag}" + "".join(f'\n{indent}\t{name}="{value}"' for name, value in attributes.items())
    if isinstance(children, str):
        return f"{out}>{children}</{tag}>"
    if not children:
        return f"{out} />"
    inner = "\n".join(render(child, depth + 1) for child in children)
    return f"{out}>\n{inner}\n{indent}</{tag}>"


def hex32(value):
    return f"0x{value & 0xFFFFFFFF:08X}"


def params(values):
    return {name: hex32(value) for name, value in values.items()}


def notes(*events):
    """Note data for one row: (tick, length) pairs at velocity 64, full probability."""
    return "0x" + "".join(f"{tick:08X}{length:08X}404014" for tick, length in events)


# Every param a sound's clip holds, as the device saves them. Filters are wide open with nothing patched to them, so
# they don't run.
SOUND_PARAMS = {
    "arpeggiatorGate": 0,
    "portamento": MIN,
    "compressorShape": 0xDC28F5B2,
    "oscAVolume": MAX,
    "oscAPulseWidth": 0,
    "oscAWavetablePosition": 0,
    "oscBVolume": MIN,
    "oscBPulseWidth": 0,
    "oscBWavetablePosition": 0,
    "noiseVolume": MIN,
    "volume": 0x50000000,
    "pan": 0,
    "lpfFrequency": MAX,
    "lpfResonance": MIN,
    "hpfFrequency": MIN,
    "hpfResonance": MIN,
    "lfo1Rate": 0x1999997E,
    "lfo2Rate": 0,
    "modulator1Amount": MIN,
    "modulator1Feedback": MIN,
    "modulator2Amount": MIN,
    "modulator2Feedback": MIN,
    "carrier1Feedback": MIN,
    "carrier2Feedback": MIN,
    "modFXRate": 0,
    "modFXDepth": 0,
    "delayRate": 0,
    "delayFeedback": MIN,
    "reverbAmount": MIN,
    "arpeggiatorRate": 0,
    "stutterRate": 0,
    "sampleRateReduction": MIN,
    "bitCrush": MIN,
    "modFXOffset": 0,
    "modFXFeedback": 0,
    "compressorThreshold": 0,
    "lpfMorph": MIN,
    "hpfMorph": MIN,
    "waveFold": MIN,
    "ratchetProbability": MIN,
    "ratchetAmount": MIN,
    "sequenceLength": MIN,
    "rhythm": MIN,
}
ENVELOPE1 = {"attack": MIN, "decay": 0xE6666654, "sustain": MAX, "release": 0x851EB851}
ENVELOPE2 = {"attack": 0xA3D70A37, "decay": 0xC0000000, "sustain": MIN, "release": 0xE6666654}
EQUALIZER = ("equalizer", params({"bass": 0, "treble": 0, "bassFrequency": 0, "trebleFrequency": 0}), [])


def sound_params(values, cables):
    cables = [("velocity", "volume", 0x3FFFFFE8), *cables]
    return (
        "soundParams",
        params({**SOUND_PARAMS, **values}),
        [
            ("envelope1", params(ENVELOPE1), []),
            ("envelope2", params(ENVELOPE2), []),
            (
                "patchCables",
                {},
                [("patchCable", {"source": s, "destination": d, "amount": hex32(a)}, []) for s, d, a in cables],
            ),
            EQUALIZER,
        ],
    )


def global_params(tag, volume):
    """A kit's or audio clip's own params, with everything off."""
    values = {
        "reverbAmount": MIN,
        "volume": volume,
        "pan": 0,
        "sidechainCompressorShape": 0xDC28F5B2,
        "modFXDepth": 0,
        "modFXRate": 0xE0000000,
        "stutterRate": 0,
        "sampleRateReduction": MIN,
        "bitCrush": MIN,
        "modFXOffset": 0,
        "modFXFeedback": MIN,
        "compressorThreshold": 0,
        "lpfMorph": MIN,
        "hpfMorph": MIN,
        "tempo": 0,
    }
    return (
        tag,
        params(values),
        [
            ("delay", params({"rate": 0, "feedback": MIN}), []),
            ("lpf", params({"frequency": MAX, "resonance": MIN}), []),
            ("hpf", params({"frequency": MIN, "resonance": MIN}), []),
            EQUALIZER,
        ],
    )


FILTERS = {"modFXType": "none", "lpfMode": "24dB", "hpfMode": "HPLadder", "filterRoute": "H2L"}


def delay(analog=0):
    return ("delay", {"pingPong": 0, "analog": analog, "syncLevel": 7, "syncType": 0}, [])


def wave_osc(kind, transpose=0):
    return {"type": kind, "transpose": transpose, "cents": 0, "retrigPhase": 0}


def sample_osc(sample, transpose=0, stretch=0, independent=0):
    """A sample oscillator's attributes and its zone."""
    path, frames = sample
    attributes = {
        "type": "sample",
        "transpose": transpose,
        "cents": 0,
        "loopMode": 1,
        "reversed": 0,
        "timeStretchEnable": independent,
        "timeStretchAmount": stretch,
        "fileName": path,
    }
    return attributes, [("zone", {"startSamplePos": 0, "endSamplePos": frames}, [])]


NO_SAMPLE = sample_osc(("", 0))


def sound(
    opening,
    osc1,
    osc2=wave_osc("square"),
    mode="subtractive",
    mod_fx="none",
    lpf="24dB",
    modulators=None,
    analog_delay=0,
    compressor=0,
):
    """A synth, or a kit's drum: everything but its params, which its clip holds."""
    settings = {
        "polyphonic": "poly",
        "voicePriority": 1,
        "mode": mode,
        "modFXType": mod_fx,
        "lpfMode": lpf,
        "hpfMode": "HPLadder",
        "filterRoute": "H2L",
        "maxVoices": 8,
    }
    oscillators = []
    for tag, osc in (("osc1", osc1), ("osc2", osc2)):
        attributes, zone = osc if isinstance(osc, tuple) else (osc, [])
        oscillators.append((tag, attributes, zone))
    oscillators += [(tag, values, []) for tag, values in (modulators or {}).items()]
    compressor = {
        "attack": 83886080,
        "release": 83886080,
        "thresh": compressor,
        "ratio": 1073741824,
        "compHPF": 0,
        "compBlend": MAX,
    }
    return (
        "sound",
        {**opening, **settings},
        [
            *oscillators,
            ("lfo1", {"type": "sine", "syncLevel": 0, "syncType": 0}, []),
            ("lfo2", {"type": "sine", "syncLevel": 0, "syncType": 0}, []),
            ("unison", {"num": 1, "detune": 8, "spread": 0}, []),
            delay(analog_delay),
            ("sidechain", {"attack": 327244, "release": 936, "syncLevel": 6, "syncType": 0}, []),
            ("audioCompressor", compressor, []),
        ],
    )


ARPEGGIATOR = (
    "arpeggiator",
    {
        "mode": "off",
        "syncLevel": 6,
        "numOctaves": 2,
        "syncType": 0,
        "arpMode": "off",
        "noteMode": "up",
        "octaveMode": "up",
        "mpeVelocity": "off",
    },
    [],
)
COLUMNS = ("columnControls", {}, [("leftCol", {"type": "velocity"}, []), ("rightCol", {"type": "mod"}, [])])

# A C major arpeggio, a beat per note, leaving a quarter of each beat for the release.
PHRASE = [(48, 0), (52, 96), (55, 192), (60, 288)]


class Song:
    def __init__(self, name):
        self.name = name
        self.instruments = []
        self.clips = []
        self.files = {}

    def clip_opening(self):
        index = len(self.clips)
        return {
            "isPlaying": 0,
            "isSoloing": 0,
            "isArmedForRecording": 0,
            "length": CLIP_TICKS,
            "colourOffset": index * 12 % 192 - 96,
            "section": index % 12,
        }

    def instrument_clip(self, name, folder, children):
        opening = {"inKeyMode": 0, "instrumentPresetName": name, "instrumentPresetFolder": folder}
        self.clips.append(("instrumentClip", {**opening, **self.clip_opening()}, children))

    def synth(self, name, params=None, cables=(), **settings):
        opening = {"presetName": name, "presetFolder": "SYNTHS", "defaultVelocity": 64, "isArmedForRecording": 0}
        self.instruments.append(sound(opening, **settings))
        rows = [("noteRow", {"y": y, "noteDataWithLift": notes((tick, 72))}, []) for y, tick in PHRASE]
        clip = [ARPEGGIATOR, sound_params(params or {}, cables), COLUMNS, ("noteRows", {}, rows)]
        self.instrument_clip(name, "SYNTHS", clip)

    def kit(self, name, drums, clips):
        """drums: (name, sound settings, params, cables, extra attributes). clips: {drum index: notes} each."""
        opening = {"presetName": name, "presetFolder": "KITS", "defaultVelocity": 64, "isArmedForRecording": 0}
        sounds = [sound({"name": drum, **extra, "path": ""}, **kwargs) for drum, kwargs, _, _, extra in drums]
        children = [delay(), ("soundSources", {}, sounds), ("selectedDrumIndex", {}, "0")]
        self.instruments.append(("kit", {**opening, **FILTERS}, children))
        for played in clips:
            rows = []
            for d, (_, _, params, cables, _) in enumerate(drums):
                attributes = {"noteDataWithLift": notes(*played[d])} if d in played else {}
                rows.append(("noteRow", {**attributes, "drumIndex": d}, [sound_params(params, cables)]))
            clip = [global_params("kitParams", 0x50000000), COLUMNS, ("noteRows", {}, rows)]
            self.instrument_clip(name, "KITS", clip)

    def audio_clip(self, name, sample, beats):
        path, frames = sample
        opening = {"name": name, "inputChannel": "left", "isArmedForRecording": 0}
        self.instruments.append(("audioTrack", {**opening, **FILTERS}, [delay()]))
        opening = {
            "trackName": name,
            "filePath": path,
            "startSamplePos": 0,
            "endSamplePos": frames,
            "pitchSpeedIndependent": 1,
            "attack": MIN,
            "priority": 1,
            **self.clip_opening(),
            "length": beats * TICKS_PER_BEAT,
        }
        # An audio clip plays far louder than a sound at the same volume.
        self.clips.append(("audioClip", opening, [global_params("params", 0xE0000000)]))

    def write(self, reverb_model=1):
        folder = REFERENCE / self.name / "card"
        if folder.exists():
            shutil.rmtree(folder)
        (folder / "SONGS").mkdir(parents=True)
        for settings in ("CommunityFeatures.XML", "MIDIFollow.XML"):
            shutil.copy(TEMPLATE / settings, folder / settings)
        for path, write in self.files.items():
            (folder / path).parent.mkdir(parents=True, exist_ok=True)
            write(folder / path)
        # The song's settings, song params and sections come from the template.
        template = (TEMPLATE / "SONGS/Reference Synth Sub.XML").read_text()
        header = template[: template.index("\t<instruments>")]
        header = re.sub(r'\n\tpreview(NumPads)?="[^"]*"', "", header)
        header = re.sub(r'model="\d"', f'model="{reverb_model}"', header)
        sections = template[template.index("\t<sections>") : template.index("\t<sessionClips>")]
        scales = ("scales", {}, [("userScale", {}, "0"), ("disabledPresetScales", {}, "0")])
        song = (
            header
            + render(("instruments", {}, self.instruments), 1)
            + f"\n{sections}"
            + render(("sessionClips", {}, self.clips), 1)
            + f"\n{render(scales, 1)}\n</song>\n"
        )
        (folder / "SONGS" / f"{self.name}.XML").write_text(song)


def write_wav(path, samples, chunks=b""):
    """16-bit mono. Extra chunks go between fmt and data, where a wavetable's clm chunk goes."""
    data = b"".join(struct.pack("<h", max(-32768, min(32767, round(s)))) for s in samples)
    fmt = struct.pack("<HHIIHH", 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + chunks
    body += b"data" + struct.pack("<I", len(data)) + data
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)


def read_wav(path):
    with wave.open(str(path)) as w:
        assert (w.getnchannels(), w.getsampwidth()) == (1, 2)
        frames = w.readframes(w.getnframes())
    return struct.unpack(f"<{len(frames) // 2}h", frames)


def write_loop(path):
    """Two bars of the 808 drums with a sine bass line, so a stretch is heard in both transients and pitch."""
    drums = {
        hit: read_wav(next((DRUMS / folder).glob("*.wav")))
        for hit, folder in (("k", "Kick"), ("s", "Snare"), ("h", "HatC"), ("o", "HatO"))
    }
    pattern = ["kh", "h", "sh", "h", "kh", "kh", "sh", "o"] * 2
    frames = LOOP[1]
    out = [0.0] * frames
    eighth = FRAMES_PER_BEAT // 2
    for step, hits in enumerate(pattern):
        start = step * eighth
        for hit in hits:
            for n, value in enumerate(drums[hit][: frames - start]):
                out[start + n] += value * 0.25
    for beat, note in enumerate([45, 45, 48, 52, 50, 50, 48, 43]):
        frequency = 440 * 2 ** ((note - 69) / 12)
        start = beat * FRAMES_PER_BEAT
        for n in range(FRAMES_PER_BEAT):
            decay = math.exp(-3 * n / FRAMES_PER_BEAT)
            out[start + n] += 3000 * math.sin(2 * math.pi * frequency * n / SAMPLE_RATE) * decay
    write_wav(path, out)


def write_wavetable(path):
    """32 cycles morphing from a sine to a band-limited saw."""
    cycles = 32
    out = []
    for c in range(cycles):
        mix = c / (cycles - 1)
        amplitudes = {h: (1 - mix) * (h == 1) + mix / h for h in range(1, 41)}
        cycle = [
            sum(a * math.sin(2 * math.pi * h * n / WAVETABLE_CYCLE) for h, a in amplitudes.items())
            for n in range(WAVETABLE_CYCLE)
        ]
        peak = max(abs(v) for v in cycle)
        out += [v / peak * 26000 for v in cycle]
    clm = b"<!>2048 00000000 wavetable"
    write_wav(path, out, b"clm " + struct.pack("<I", len(clm)) + clm)


def copy_drum(sample):
    return lambda target: shutil.copy(DRUMS.parent.parent / sample[0], target)


def engines():
    song = Song("Reference Synth Engines")
    dx7 = {"type": "dx7", "transpose": 0, "cents": 0, "retrigPhase": 0, "dx7patch": DX7_PATCH.hex().upper()}
    song.synth("Engine DX7 Modern", osc1={**dx7, "dx7enginemode": 1})
    song.synth("Engine DX7 MkI", osc1={**dx7, "dx7enginemode": 2})
    song.synth(
        "Engine FM",
        mode="fm",
        osc1=wave_osc("sine"),
        osc2=wave_osc("sine", 12),
        modulators={
            "modulator1": {"transpose": 0, "cents": 0, "retrigPhase": 0},
            "modulator2": {"transpose": 7, "cents": 0, "retrigPhase": 0, "toModulator1": 0},
        },
        params={
            "oscBVolume": 0xC0000000,
            "modulator1Amount": 0xE0000000,
            "modulator1Feedback": 0xC0000000,
            "modulator2Amount": 0xC0000000,
            "carrier1Feedback": 0xA0000000,
        },
        cables=[("envelope2", "modulator1Volume", 0x30000000)],
    )
    song.synth(
        "Engine Wavetable",
        osc1={**wave_osc("wavetable"), "fileName": WAVETABLE},
        cables=[("envelope2", "oscAWavetablePosition", 0x60000000)],
    )
    song.synth(
        "Engine Ringmod",
        mode="ringmod",
        osc1=wave_osc("saw"),
        osc2=wave_osc("square", 7),
        params={"oscBVolume": MAX},
    )
    song.files[WAVETABLE] = write_wavetable
    song.write()


def effects():
    song = Song("Reference FX")
    saw = {"osc1": wave_osc("saw")}
    # Stem export goes from the last clip to the first, and a delay's tail can run on, below the silence threshold,
    # into the next stem. So the delays come first, exported last.
    song.synth("FX Delay Digital", **saw, params={"delayFeedback": 0xC0000000})
    song.synth("FX Delay Analog", **saw, analog_delay=1, params={"delayFeedback": 0xC0000000})
    song.synth("FX Chorus", **saw, mod_fx="chorus", params={"modFXDepth": 0x40000000})
    song.synth("FX Stereo Chorus", **saw, mod_fx="StereoChorus", params={"modFXDepth": 0x40000000})
    song.synth("FX Phaser", **saw, mod_fx="phaser", params={"modFXDepth": 0x40000000, "modFXFeedback": 0x40000000})
    song.synth("FX Compressor", **saw, compressor=0x40000000, params={"compressorThreshold": 0x40000000})
    song.synth("FX Bitcrush", **saw, params={"bitCrush": 0})
    song.synth("FX Decimation", **saw, params={"sampleRateReduction": 0})
    song.synth("FX Wavefold", **saw, params={"waveFold": 0})
    sweep = {
        "params": {"lpfFrequency": 0xC0000000, "lpfResonance": 0x20000000},
        "cables": [("envelope2", "lpfFrequency", 0x40000000)],
    }
    song.synth("FX Ladder 24dB", **saw, **sweep)
    song.synth("FX SVF Band", **saw, lpf="SVF_Band", **sweep)
    song.synth("FX HPF", **saw, params={"hpfFrequency": 0x20000000, "hpfResonance": 0x20000000})
    # What each effect is heard against.
    song.synth("FX Dry", **saw)
    song.write()


def reverbs():
    # Stem export only includes the reverb with "include song FX" on, which also runs the song's master compressor.
    # Its state carries from one stem to the next, so each reverb gets a song of its own.
    for model, name in ((1, "Mutable"), (0, "Freeverb")):
        song = Song(f"Reference Reverb {name}")
        song.synth(f"Reverb {name}", osc1=wave_osc("saw"), params={"reverbAmount": 0})
        song.write(reverb_model=model)


def samples():
    song = Song("Reference Samples")
    ducked = [("compressor", "volumePostReverbSend", 0x10000000)]
    drums = [
        ("KICK", {"osc1": sample_osc(KICK), "osc2": NO_SAMPLE}, {}, [], {"sideChainSend": MAX}),
        ("PAD", {"osc1": wave_osc("saw")}, {"volume": 0x30000000}, ducked, {}),
        ("SNARE UP", {"osc1": sample_osc(SNARE, transpose=7), "osc2": NO_SAMPLE}, {}, [], {}),
        ("LOOP SLOW", {"osc1": sample_osc(LOOP, stretch=-5), "osc2": NO_SAMPLE}, {}, [], {}),
        ("LOOP UP", {"osc1": sample_osc(LOOP, transpose=5, independent=1), "osc2": NO_SAMPLE}, {}, [], {}),
    ]
    beats = [(b * TICKS_PER_BEAT, TICKS_PER_BEAT // 4) for b in range(4)]
    song.kit(
        "Reference Kit",
        drums,
        [
            {2: [(b * TICKS_PER_BEAT, TICKS_PER_BEAT // 2) for b in range(4)]},
            {3: [(0, CLIP_TICKS)]},
            {4: [(0, CLIP_TICKS)]},
            {0: beats, 1: [(0, CLIP_TICKS)]},
        ],
    )
    # The loop is 8 beats at 120 BPM, so 10 beats of clip stretch it to 96 BPM.
    song.audio_clip("LOOP", LOOP, 10)
    song.files[LOOP[0]] = write_loop
    song.files[KICK[0]] = copy_drum(KICK)
    song.files[SNARE[0]] = copy_drum(SNARE)
    song.write()


engines()
effects()
reverbs()
samples()
