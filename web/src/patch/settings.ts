// A synth's settings as the patch editor shows them, with the values the device gives a new synth: Sound's
// constructor, Sound::initParams and Sound::setupAsBlankSynth in the firmware, as instrument_clip_minder.cpp does for
// a new synth. (Sound::setupAsDefaultSynth is only for a song with no synth 0 on its card.)

const min = -0x80000000;
const max = 0x7fffffff;

// How a stored 32-bit value shows as the device's own numbers, and back.
export type Scale = {
  min: number;
  max: number;
  toUser: (value: number) => number;
  fromUser: (user: number) => number;
  format: (user: number) => string;
};

const clamp = (value: number) => Math.max(min, Math.min(max, Math.round(value)));
const signed = (user: number) => (user > 0 ? `+${user}` : String(user));

// getParamFromUserValue in the firmware's util/functions.cpp, and its inverse.
export const scales = {
  unipolar: {
    min,
    max,
    toUser: (v) => Math.round((v - min) / 85899345),
    fromUser: (u) => clamp(u * 85899345 + min),
    format: String,
  },
  bipolar: {
    min,
    max,
    toUser: (v) => Math.round(v / 42949672),
    fromUser: (u) => clamp(u * 42949672),
    format: signed,
  },
  pan: {
    min,
    max,
    toUser: (v) => Math.round((v * 32) / 0x80000000),
    fromUser: (u) => clamp((u * 0x80000000) / 32),
    format: (u) => (u < 0 ? `L${-u}` : u > 0 ? `R${u}` : "Centre"),
  },
  pulseWidth: {
    min: 0,
    max,
    toUser: (v) => Math.round(v / 42949672),
    fromUser: (u) => clamp(u * 42949672),
    format: String,
  },
  cable: {
    min: -50 * 21474836,
    max: 50 * 21474836,
    toUser: (v) => Math.round(v / 21474836),
    fromUser: (u) => u * 21474836,
    format: signed,
  },
} satisfies Record<string, Scale>;

const user = (value: number) => scales.unipolar.fromUser(value);

export const sections = ["Oscillators", "Filters", "Envelopes", "LFOs", "Modulation", "Effects", "Voice"] as const;
export type Section = (typeof sections)[number];

// What the rest of the patch says about whether a setting can be heard.
export type Context = {
  value: (id: string) => number | string;
  // Whether a patch cable comes from this source, or goes to this destination.
  patchedFrom: (source: string) => boolean;
  patchedTo: (destination: string) => boolean;
};

type Base = {
  id: string;
  label: string;
  section: Section;
  // Under <sound>: each step a child element, the last one an element or an attribute.
  path: string[];
  // Why it can't be heard in this patch, if it can't.
  silentBecause?: (patch: Context) => string | undefined;
};

// A parameter, saved as a 32-bit hexadecimal value.
export type Knob = Base & {
  kind: "knob";
  init: number;
  scale: Scale;
  // Its name as a patch cable's destination.
  destination?: string;
};

// A whole number, saved as it shows unless it says otherwise.
export type Count = Base & {
  kind: "count";
  init: number;
  min: number;
  max: number;
  format: (value: number) => string;
  saved?: { read: (saved: number) => number; write: (value: number) => number };
};

export type Choice = Base & {
  kind: "choice";
  init: string;
  options: string[];
  // Older firmware saves some choices as numbers.
  aliases?: Record<string, string>;
  format: (value: string) => string;
};

export type Setting = Knob | Count | Choice;

const knob = (id: string, label: string, section: Section, init: number, rest: Partial<Knob> = {}): Knob => ({
  kind: "knob",
  id,
  label,
  section,
  init,
  scale: scales.unipolar,
  path: ["defaultParams", id],
  ...rest,
});

const count = (
  id: string,
  label: string,
  section: Section,
  init: number,
  [low, high]: [number, number],
  rest: Partial<Count> = {},
): Count => ({
  kind: "count",
  id,
  label,
  section,
  init,
  min: low,
  max: high,
  format: String,
  path: id.split("."),
  ...rest,
});

// Options as saved, each with how it shows.
const choice = (
  id: string,
  label: string,
  section: Section,
  init: string,
  options: Record<string, string>,
  rest: Partial<Choice> = {},
): Choice => ({
  kind: "choice",
  id,
  label,
  section,
  init,
  options: Object.keys(options),
  format: (value) => options[value] ?? value,
  path: id.split("."),
  ...rest,
});

const onOff = { "0": "Off", "1": "On" };
const semitones = (value: number) => `${signed(value)} st`;
const cents = (value: number) => `${signed(value)} ¢`;
const syncLevel = (value: number) => (value === 0 ? "Off" : `Level ${value}`);
const oscTypes = {
  sine: "Sine",
  triangle: "Triangle",
  square: "Square",
  analogSquare: "Analog square",
  saw: "Saw",
  analogSaw: "Analog saw",
};
// The phase an oscillator restarts at with each note, in degrees, or -1 for free-running. Saved as a 32-bit phase in
// the firmware's steps of a degree (menu_item/osc/retrigger_phase.h), written as a signed number.
const degree = 11930464;
const retriggerPhase = {
  read: (saved: number) => ((saved >>> 0) === 0xffffffff ? -1 : Math.floor((saved >>> 0) / degree)),
  write: (degrees: number) => (degrees < 0 ? -1 : (degrees * degree) | 0),
};
const lfoTypes = { sine: "Sine", triangle: "Triangle", square: "Square", saw: "Saw", sah: "S&H", rwalk: "Random walk" };

const isOff = (patch: Context, id: string) => patch.value(id) === min;

const fmOnly = (patch: Context) => (patch.value("mode") === "fm" ? undefined : "Only in FM mode");
const notFm = (patch: Context) => (patch.value("mode") === "fm" ? "Not in FM mode" : undefined);
const filters = (patch: Context) => (patch.value("mode") === "fm" ? "No filters in FM mode" : undefined);
const osc2 = (patch: Context) =>
  patch.value("mode") !== "ringmod" && isOff(patch, "oscBVolume") && !patch.patchedTo("oscBVolume")
    ? "Osc 2 is silent"
    : undefined;
const hpf = (patch: Context) =>
  filters(patch) ?? (isOff(patch, "hpfFrequency") && !patch.patchedTo("hpfFrequency") ? "HPF is open" : undefined);
const unison = (patch: Context) => ((patch.value("unison.num") as number) > 1 ? undefined : "Only one unison voice");
const patchedFrom = (source: string, name: string) => (patch: Context) =>
  patch.patchedFrom(source) ? undefined : `${name} isn't patched to anything`;
const modFx = (patch: Context) => (patch.value("modFXType") === "none" ? "Mod FX is off" : undefined);
const delay = (patch: Context) =>
  isOff(patch, "delayFeedback") && !patch.patchedTo("delayFeedback") ? "Delay amount is 0" : undefined;
const arp = (patch: Context) => (patch.value("arpeggiator.mode") === "off" ? "Arpeggiator is off" : undefined);
const eq = (band: string, name: string) => (patch: Context) =>
  patch.value(band) === 0 ? `${name} is flat` : undefined;

const envelope = (n: 1 | 2, init: [number, number, number, number]): Knob[] =>
  (["attack", "decay", "sustain", "release"] as const).map((stage, i) =>
    knob(`env${n}.${stage}`, `Env ${n} ${stage}`, "Envelopes", init[i], {
      path: ["defaultParams", `envelope${n}`, stage],
      destination: `env${n}${stage[0].toUpperCase()}${stage.slice(1)}`,
      silentBecause: n === 2 ? patchedFrom("envelope2", "Env 2") : undefined,
    }),
  );

const oscillator = (n: 1 | 2): Setting[] => {
  const silent = n === 2 ? osc2 : undefined;
  return [
    choice(`osc${n}.type`, `Osc ${n} type`, "Oscillators", "square", oscTypes, {
      silentBecause: (patch) => silent?.(patch) ?? notFm(patch),
    }),
    count(`osc${n}.transpose`, `Osc ${n} transpose`, "Oscillators", 0, [-96, 96], {
      format: semitones,
      silentBecause: silent,
    }),
    count(`osc${n}.cents`, `Osc ${n} fine tune`, "Oscillators", 0, [-50, 50], { format: cents, silentBecause: silent }),
    count(`osc${n}.retrigPhase`, `Osc ${n} retrigger`, "Oscillators", -1, [-1, 360], {
      format: (degrees) => (degrees < 0 ? "Off" : `${degrees}°`),
      saved: retriggerPhase,
      silentBecause: silent,
    }),
  ];
};

export const settings: Setting[] = [
  choice("mode", "Synth mode", "Oscillators", "subtractive", {
    subtractive: "Subtractive",
    fm: "FM",
    ringmod: "Ring mod",
  }),
  ...oscillator(1),
  knob("oscAVolume", "Osc 1 level", "Oscillators", max, { destination: "oscAVolume" }),
  knob("oscAPulseWidth", "Osc 1 pulse width", "Oscillators", 0, {
    scale: scales.pulseWidth,
    destination: "oscAPhaseWidth",
    silentBecause: notFm,
  }),
  ...oscillator(2),
  knob("oscBVolume", "Osc 2 level", "Oscillators", min, { destination: "oscBVolume" }),
  knob("oscBPulseWidth", "Osc 2 pulse width", "Oscillators", 0, {
    scale: scales.pulseWidth,
    destination: "oscBPhaseWidth",
    silentBecause: (patch) => osc2(patch) ?? notFm(patch),
  }),
  choice("oscillatorSync", "Osc sync", "Oscillators", "0", onOff, { silentBecause: osc2 }),
  knob("noiseVolume", "Noise level", "Oscillators", min, { destination: "noiseVolume" }),
  knob("waveFold", "Wavefold", "Oscillators", min, { destination: "waveFold" }),
  knob("modulator1Amount", "Mod 1 amount", "Oscillators", min, {
    destination: "modulator1Volume",
    silentBecause: fmOnly,
  }),
  count("modulator1.transpose", "Mod 1 transpose", "Oscillators", 0, [-96, 96], {
    format: semitones,
    silentBecause: fmOnly,
  }),
  count("modulator1.cents", "Mod 1 fine tune", "Oscillators", 0, [-50, 50], { format: cents, silentBecause: fmOnly }),
  knob("modulator1Feedback", "Mod 1 feedback", "Oscillators", min, {
    destination: "modulator1Feedback",
    silentBecause: fmOnly,
  }),
  knob("modulator2Amount", "Mod 2 amount", "Oscillators", min, {
    destination: "modulator2Volume",
    silentBecause: fmOnly,
  }),
  count("modulator2.transpose", "Mod 2 transpose", "Oscillators", -12, [-96, 96], {
    format: semitones,
    silentBecause: fmOnly,
  }),
  count("modulator2.cents", "Mod 2 fine tune", "Oscillators", 0, [-50, 50], { format: cents, silentBecause: fmOnly }),
  knob("modulator2Feedback", "Mod 2 feedback", "Oscillators", min, {
    destination: "modulator2Feedback",
    silentBecause: fmOnly,
  }),
  choice("modulator2.toModulator1", "Mod 2 into mod 1", "Oscillators", "0", onOff, { silentBecause: fmOnly }),
  knob("carrier1Feedback", "Carrier 1 feedback", "Oscillators", min, {
    destination: "carrier1Feedback",
    silentBecause: fmOnly,
  }),
  knob("carrier2Feedback", "Carrier 2 feedback", "Oscillators", min, {
    destination: "carrier2Feedback",
    silentBecause: fmOnly,
  }),
  count("unison.num", "Unison voices", "Oscillators", 1, [1, 8]),
  count("unison.detune", "Unison detune", "Oscillators", 8, [0, 50], { silentBecause: unison }),
  count("unison.spread", "Unison spread", "Oscillators", 0, [0, 50], { silentBecause: unison }),

  choice(
    "lpfMode",
    "LPF type",
    "Filters",
    "24dB",
    { "12dB": "12 dB", "24dB": "24 dB", "24dBDrive": "Drive", SVF_Band: "SVF band", SVF_Notch: "SVF notch" },
    { silentBecause: filters },
  ),
  knob("lpfFrequency", "LPF frequency", "Filters", max, { destination: "lpfFrequency", silentBecause: filters }),
  knob("lpfResonance", "LPF resonance", "Filters", min, { destination: "lpfResonance", silentBecause: filters }),
  knob("lpfMorph", "LPF morph", "Filters", min, { destination: "lpfMorph", silentBecause: filters }),
  choice(
    "hpfMode",
    "HPF type",
    "Filters",
    "HPLadder",
    { HPLadder: "Ladder", SVF_Band: "SVF band", SVF_Notch: "SVF notch" },
    { silentBecause: hpf },
  ),
  knob("hpfFrequency", "HPF frequency", "Filters", min, { destination: "hpfFrequency", silentBecause: filters }),
  knob("hpfResonance", "HPF resonance", "Filters", min, { destination: "hpfResonance", silentBecause: hpf }),
  knob("hpfMorph", "HPF morph", "Filters", min, { destination: "hpfMorph", silentBecause: hpf }),
  choice(
    "filterRoute",
    "Filter route",
    "Filters",
    "H2L",
    { H2L: "HPF → LPF", L2H: "LPF → HPF", PARA: "Parallel" },
    { silentBecause: hpf },
  ),

  ...envelope(1, [min, user(20), max, min]),
  ...envelope(2, [user(20), user(20), user(25), user(20)]),

  choice("lfo1.type", "LFO 1 shape", "LFOs", "triangle", lfoTypes, { silentBecause: patchedFrom("lfo1", "LFO 1") }),
  knob("lfo1Rate", "LFO 1 rate", "LFOs", user(30), {
    destination: "lfo1Rate",
    silentBecause: patchedFrom("lfo1", "LFO 1"),
  }),
  count("lfo1.syncLevel", "LFO 1 sync", "LFOs", 0, [0, 9], {
    format: syncLevel,
    silentBecause: patchedFrom("lfo1", "LFO 1"),
  }),
  choice("lfo2.type", "LFO 2 shape", "LFOs", "triangle", lfoTypes, { silentBecause: patchedFrom("lfo2", "LFO 2") }),
  knob("lfo2Rate", "LFO 2 rate", "LFOs", 0, { destination: "lfo2Rate", silentBecause: patchedFrom("lfo2", "LFO 2") }),

  choice("modFXType", "Mod FX", "Effects", "none", {
    none: "Off",
    flanger: "Flanger",
    chorus: "Chorus",
    StereoChorus: "Stereo chorus",
    phaser: "Phaser",
    grainFX: "Grain",
  }),
  knob("modFXRate", "Mod FX rate", "Effects", 0, { destination: "modFXRate", silentBecause: modFx }),
  knob("modFXDepth", "Mod FX depth", "Effects", 0, { destination: "modFXDepth", silentBecause: modFx }),
  knob("modFXOffset", "Mod FX offset", "Effects", 0, { silentBecause: modFx }),
  knob("modFXFeedback", "Mod FX feedback", "Effects", 0, { silentBecause: modFx }),
  knob("delayFeedback", "Delay amount", "Effects", min, { destination: "delayFeedback" }),
  knob("delayRate", "Delay rate", "Effects", 0, { destination: "delayRate", silentBecause: delay }),
  // Set from the song's tempo resolution; 7 with the device's default.
  count("delay.syncLevel", "Delay sync", "Effects", 7, [0, 9], { format: syncLevel, silentBecause: delay }),
  choice("delay.pingPong", "Delay ping-pong", "Effects", "1", onOff, { silentBecause: delay }),
  choice("delay.analog", "Delay analog", "Effects", "0", onOff, { silentBecause: delay }),
  knob("reverbAmount", "Reverb", "Effects", min, { destination: "reverbAmount" }),
  count("clippingAmount", "Saturation", "Effects", 0, [0, 15]),
  knob("bitCrush", "Bitcrush", "Effects", min),
  knob("sampleRateReduction", "Decimation", "Effects", min),
  knob("eq.bass", "EQ bass", "Effects", 0, { scale: scales.bipolar, path: ["defaultParams", "equalizer", "bass"] }),
  knob("eq.bassFrequency", "EQ bass frequency", "Effects", 0, {
    path: ["defaultParams", "equalizer", "bassFrequency"],
    silentBecause: eq("eq.bass", "EQ bass"),
  }),
  knob("eq.treble", "EQ treble", "Effects", 0, {
    scale: scales.bipolar,
    path: ["defaultParams", "equalizer", "treble"],
  }),
  knob("eq.trebleFrequency", "EQ treble frequency", "Effects", 0, {
    path: ["defaultParams", "equalizer", "trebleFrequency"],
    silentBecause: eq("eq.treble", "EQ treble"),
  }),

  knob("volume", "Volume", "Voice", user(40), { destination: "volumePostFX" }),
  knob("pan", "Pan", "Voice", 0, { scale: scales.pan, destination: "pan" }),
  count("transpose", "Transpose", "Voice", 0, [-96, 96], { format: semitones }),
  choice(
    "polyphonic",
    "Polyphony",
    "Voice",
    "poly",
    { auto: "Auto", poly: "Poly", mono: "Mono", legato: "Legato", choke: "Choke" },
    { aliases: { "0": "auto", "1": "poly", "2": "mono", "3": "legato", "4": "choke" } },
  ),
  choice("voicePriority", "Voice priority", "Voice", "1", { "0": "Low", "1": "Medium", "2": "High" }),
  knob("portamento", "Portamento", "Voice", min),
  // Older firmware saved the note order here too, which now has a setting of its own.
  choice("arpeggiator.mode", "Arpeggiator", "Voice", "off", { off: "Off", arp: "On" }),
  knob("arpeggiatorRate", "Arp rate", "Voice", 0, { destination: "arpRate", silentBecause: arp }),
  knob("arpeggiatorGate", "Arp gate", "Voice", 0, { silentBecause: arp }),
  count("arpeggiator.numOctaves", "Arp octaves", "Voice", 2, [1, 8], { silentBecause: arp }),
];

export type CableKey = `${string}>${string}`;

export const cableKey = (source: string, destination: string): CableKey => `${source}>${destination}`;

// Sound::setupAsBlankSynth, then Sound::setupDefaultExpressionPatching.
export const initCables: Record<CableKey, number> = {
  [cableKey("velocity", "volume")]: 50 * 21474836,
  [cableKey("aftertouch", "volume")]: 33 * 21474836,
  [cableKey("y", "lpfFrequency")]: 20 * 21474836,
};

export const sourceNames: Record<string, string> = {
  velocity: "Velocity",
  note: "Note",
  envelope1: "Env 1",
  envelope2: "Env 2",
  lfo1: "LFO 1",
  lfo2: "LFO 2",
  random: "Random",
  aftertouch: "Aftertouch",
  x: "MPE X",
  y: "MPE Y",
  compressor: "Sidechain",
};

// Destinations with no setting of their own here; the rest take their setting's label.
const destinationNames: Record<string, string> = {
  volume: "Level",
  pitch: "Pitch",
  oscAPitch: "Osc 1 pitch",
  oscBPitch: "Osc 2 pitch",
  modulator1Pitch: "Mod 1 pitch",
  modulator2Pitch: "Mod 2 pitch",
  volumePostReverbSend: "Sidechain duck",
  oscAWavetablePosition: "Osc 1 wavetable",
  oscBWavetablePosition: "Osc 2 wavetable",
};

export function destinationName(destination: string): string {
  return (
    destinationNames[destination] ??
    settings.find((s) => s.kind === "knob" && s.destination === destination)?.label ??
    destination
  );
}
