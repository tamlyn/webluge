// Plays a song as the firmware renders it. It renders only a little ahead of what's playing, so that toggling a
// clip is heard soon after.

import type { CardFile, ClipState, SongDescription } from "./firmware";
import { sampleRate } from "./firmware";
import type { Request, Response } from "./worker";

const chunkFrames = 2048;
const secondsAhead = 0.15;

type Timeline = { time: number; clips: ClipState[]; framesPerTick: number };

export class SongPlayer {
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private stopped = false;
  private pending?: (response: Response) => void;
  // Clip states as each scheduled chunk starts, oldest first.
  private timeline: Timeline[] = [];

  private constructor(
    private readonly context: AudioContext,
    private readonly worker: Worker,
    readonly numMissing: number,
    readonly song: SongDescription,
  ) {}

  static async play(
    context: AudioContext,
    files: CardFile[],
    songPath: string,
    onError: (message: string) => void,
  ): Promise<SongPlayer> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const loaded = await new Promise<Response>((resolve) => {
      worker.onmessage = ({ data }: MessageEvent<Response>) => resolve(data);
      post(worker, { type: "load", files, songPath }, files.map((f) => f.data.buffer as ArrayBuffer));
    });
    if (loaded.type !== "loaded") {
      worker.terminate();
      throw new Error(loaded.type === "error" ? loaded.message : "Unexpected reply");
    }
    const player = new SongPlayer(context, worker, loaded.numMissing, loaded.song);
    worker.onmessage = ({ data }: MessageEvent<Response>) => player.pending?.(data);
    player.nextTime = context.currentTime + 0.1;
    player.pump().catch((error: Error) => {
      player.stop();
      onError(error.message);
    });
    return player;
  }

  stop() {
    this.stopped = true;
    this.worker.terminate();
    for (const source of this.sources) source.stop();
  }

  toggleClip(index: number, instant: boolean) {
    post(this.worker, { type: "toggle", index, instant });
  }

  soloClip(index: number) {
    post(this.worker, { type: "solo", index });
  }

  // As heard now, with positions moved on from the latest chunk to start playing.
  clipStates(): ClipState[] | undefined {
    const now = this.context.currentTime;
    while (this.timeline.length > 1 && this.timeline[1].time <= now) this.timeline.shift();
    const latest = this.timeline[0];
    if (!latest || latest.time > now) return undefined;
    const ticks = ((now - latest.time) * sampleRate) / latest.framesPerTick;
    return latest.clips.map((clip, i) => ({
      ...clip,
      pos: clip.active ? (clip.pos + ticks) % this.song.clips[i].loopLength : clip.pos,
    }));
  }

  private async pump() {
    while (!this.stopped) {
      if (this.nextTime - this.context.currentTime > secondsAhead) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      const response = await this.request({ type: "render", numFrames: chunkFrames });
      if (this.stopped) return;
      if (response.type === "error") throw new Error(response.message);
      if (response.type === "rendered") {
        // If rendering fell behind, carry on from now rather than skip.
        this.nextTime = Math.max(this.nextTime, this.context.currentTime);
        this.timeline.push({ time: this.nextTime, clips: response.clips, framesPerTick: response.framesPerTick });
        this.schedule(response.left, response.right);
      }
    }
  }

  private schedule(left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>) {
    const buffer = this.context.createBuffer(2, left.length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  private request(request: Request): Promise<Response> {
    return new Promise((resolve) => {
      this.pending = resolve;
      post(this.worker, request);
    });
  }
}

function post(worker: Worker, request: Request, transfer: Transferable[] = []) {
  worker.postMessage(request, transfer);
}
