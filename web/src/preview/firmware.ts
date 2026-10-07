// Runs the firmware on a song: loads it from the files given, presses play and renders what it plays.

import createWebluge, { type Webluge } from "@firmware/webluge_web.mjs";

export type CardFile = { path: string; data: Uint8Array };

export type Rendered = { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> };

export const sampleRate = 44100;

const cardFolder = "/card";

export class Firmware {
  private constructor(
    private readonly module: Webluge,
    // Audio files the song uses that aren't on the card. The device plays on without them, silent.
    readonly numMissing: number,
  ) {}

  // The firmware boots once per instance, so each song needs a new one.
  static async loadSong(files: CardFile[], songPath: string, log?: (text: string) => void): Promise<Firmware> {
    const module = await createWebluge(log && { print: log, printErr: log });
    const folders = new Set<string>();
    for (const { path, data } of files) {
      const folder = `${cardFolder}/${path}`.replace(/\/[^/]*$/, "");
      module.FS.mkdirTree(folder);
      module.FS.writeFile(`${cardFolder}/${path}`, data);
      for (let f = folder; f !== cardFolder; f = f.replace(/\/[^/]*$/, "")) folders.add(f);
    }
    const numMissing = module.ccall("webluge_web_load", "number", ["string", "string"], [cardFolder, songPath]);
    if (numMissing < 0) throw new Error(`Couldn't load ${songPath}`);
    // The card image has its own copy now.
    for (const { path } of files) module.FS.unlink(`${cardFolder}/${path}`);
    for (const folder of [...folders].sort().reverse()) module.FS.rmdir(folder);
    module._webluge_web_play();
    return new Firmware(module, numMissing);
  }

  // At least this many frames, as the codec plays in blocks.
  render(numFrames: number): Rendered {
    const start = this.module._webluge_web_render(numFrames) / Float32Array.BYTES_PER_ELEMENT;
    const length = this.module._webluge_web_rendered_frames();
    const interleaved = this.module.HEAPF32.subarray(start, start + 2 * length);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      left[i] = interleaved[2 * i];
      right[i] = interleaved[2 * i + 1];
    }
    return { left, right };
  }
}
