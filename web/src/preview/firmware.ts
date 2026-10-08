// Runs the firmware on a song, kit or synth: loads it from the files given and renders what it plays.

import createWebluge, { type Webluge } from "@firmware/webluge_web.mjs";
import { decodeCp437 } from "../card/cp437";

export type CardFile = { path: string; data: Uint8Array };

// A song's session clips and arrangement, as the firmware loaded them. Positions and lengths are in ticks.
export type SongDescription = {
  // Songs saved in arranger view start by playing their arrangement.
  arrangement: boolean;
  ticksPerQuarterNote: number;
  clips: ClipDescription[];
  // Empty if the song has no arrangement.
  tracks: TrackDescription[];
};

export type ClipDescription = {
  name: string;
  output: string;
  type: "synth" | "kit" | "midi" | "cv" | "audio" | "none";
  section: number;
  loopLength: number;
  colour: string;
  // Instrument clips. A row's y is its note number, or for a kit, its drum's index.
  rows?: { y: number; name: string; muted: boolean; colour: string; notes: [pos: number, length: number, velocity: number][] }[];
  // Audio clips. Start and end are in frames of the sample.
  sample?: { path: string; start: number; end: number; rate: number };
};

// An output's clips in the arrangement, coloured as on the arranger view's pads.
export type TrackDescription = {
  name: string;
  type: ClipDescription["type"];
  instances: [pos: number, length: number, colour: string][];
};

export type ClipState = { pos: number; active: boolean; armed: boolean; soloing: boolean };

export type PlaybackState = {
  // Until the arrangement plays to its end, which stops the song.
  playing: boolean;
  arrangement: boolean;
  // Waiting for the longest clip playing to reach the end of its loop.
  switchingToArrangement: boolean;
  // Where the arrangement is, or was when the session took over.
  arrangementPos: number;
  clips: ClipState[];
};

export type Rendered = {
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  // As the first frame played.
  state: PlaybackState;
  framesPerTick: number;
};

export const sampleRate = 44100;

export function bpm(framesPerTick: number, ticksPerQuarterNote: number): number {
  return (60 * sampleRate) / (framesPerTick * ticksPerQuarterNote);
}

const cardFolder = "/card";

// Songs can spell a folder or file in different cases, which the card doesn't mind but MEMFS does: copied in as
// spelt, one would be two, and the card image can't hold both. Each is spelt as it was first.
function oneSpelling(): (path: string) => string {
  const spellings = new Map<string, string>();
  return function spell(path: string): string {
    const key = path.toLowerCase();
    let spelt = spellings.get(key);
    if (!spelt) {
      const slash = path.lastIndexOf("/");
      spelt = slash < 0 ? path : `${spell(path.slice(0, slash))}${path.slice(slash)}`;
      spellings.set(key, spelt);
    }
    return spelt;
  };
}

export class Firmware {
  readonly song: SongDescription;

  private constructor(
    private readonly module: Webluge,
    // Audio files the song uses that aren't on the card. The device plays on without them, silent.
    readonly numMissing: number,
  ) {
    const start = module._webluge_web_describe();
    const json = decodeCp437(module.HEAPU8.subarray(start, start + module._webluge_web_description_length()));
    this.song = JSON.parse(json);
  }

  // The firmware boots once per instance, so each song needs a new one.
  static async loadSong(files: CardFile[], songPath: string, log?: (text: string) => void): Promise<Firmware> {
    const { module, numMissing } = await Firmware.boot("webluge_web_load", files, songPath, log);
    // Before describing: pressing play is when the firmware chooses between the arrangement and the session.
    module._webluge_web_play();
    return new Firmware(module, numMissing);
  }

  // A kit or synth, in place of the blank song's synth, to audition. It's the song's only clip, and nothing plays
  // until it's auditioned.
  static async loadPreset(files: CardFile[], presetPath: string, log?: (text: string) => void): Promise<Firmware> {
    const { module, numMissing } = await Firmware.boot("webluge_web_load_preset", files, presetPath, log);
    return new Firmware(module, numMissing);
  }

  private static async boot(
    entry: "webluge_web_load" | "webluge_web_load_preset",
    files: CardFile[],
    path: string,
    log?: (text: string) => void,
  ): Promise<{ module: Webluge; numMissing: number }> {
    const module = await createWebluge(log && { print: log, printErr: log });
    const spell = oneSpelling();
    const written = new Set<string>();
    const folders = new Set<string>();
    for (const { path, data } of files) {
      const file = `${cardFolder}/${spell(path)}`;
      const folder = file.replace(/\/[^/]*$/, "");
      module.FS.mkdirTree(folder);
      module.FS.writeFile(file, data);
      written.add(file);
      for (let f = folder; f !== cardFolder; f = f.replace(/\/[^/]*$/, "")) folders.add(f);
    }
    const numMissing = module.ccall(entry, "number", ["string", "string"], [cardFolder, path]);
    if (numMissing < 0) throw new Error(`Couldn't load ${path}`);
    // The card image has its own copy now.
    for (const file of written) module.FS.unlink(file);
    for (const folder of [...folders].sort().reverse()) module.FS.rmdir(folder);
    return { module, numMissing };
  }

  // At least this many frames, as the codec plays in blocks.
  render(numFrames: number): Rendered {
    const state = this.state();
    const framesPerTick = this.module._webluge_web_frames_per_tick();
    const start = this.module._webluge_web_render(numFrames) / Float32Array.BYTES_PER_ELEMENT;
    const length = this.module._webluge_web_rendered_frames();
    const interleaved = this.module.HEAPF32.subarray(start, start + 2 * length);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      left[i] = interleaved[2 * i];
      right[i] = interleaved[2 * i + 1];
    }
    return { left, right, state, framesPerTick };
  }

  // Quantised to the clip's loop, as on the device, unless instant. While the arrangement plays, toggling or soloing
  // a clip only switches to the session, as on the device.
  toggleClip(index: number, instant: boolean) {
    this.module._webluge_web_toggle_clip(index, instant);
  }

  soloClip(index: number) {
    this.module._webluge_web_solo_clip(index);
  }

  // As on the device: the clips the arrangement was playing play on in the session.
  switchToSession() {
    this.module._webluge_web_switch_to_session();
  }

  // From where the session took over, once the longest clip playing reaches the end of its loop.
  switchToArrangement() {
    this.module._webluge_web_switch_to_arrangement();
  }

  // A preset's drum, by its row, or a synth's note, held until it's auditioned again with on false.
  audition(y: number, on: boolean) {
    this.module._webluge_web_audition(y, on);
  }

  state(): PlaybackState {
    const heap = this.module.HEAP32;
    const start = this.module._webluge_web_states() / Int32Array.BYTES_PER_ELEMENT;
    const flags = heap[start];
    return {
      playing: !!(flags & 1),
      arrangement: !!(flags & 2),
      switchingToArrangement: !!(flags & 4),
      arrangementPos: heap[start + 1],
      clips: this.song.clips.map((_, i) => {
        const clipFlags = heap[start + 2 * i + 3];
        return { pos: heap[start + 2 * i + 2], active: !!(clipFlags & 1), armed: !!(clipFlags & 2), soloing: !!(clipFlags & 4) };
      }),
    };
  }
}
