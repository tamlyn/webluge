// Plays a song, kit or synth as the firmware renders it. It renders only a little ahead of what's playing, so that
// toggling a clip or auditioning a drum is heard soon after.

import type { CardFile, ClipState, SongDescription } from "./firmware";
import { bpm, sampleRate } from "./firmware";
import type { Request, Response } from "./worker";

// An audition should sound as a pad is pressed. A kit or synth alone renders cheaply enough to stay this close.
const pacing = {
  song: { chunkFrames: 2048, secondsAhead: 0.15 },
  preset: { chunkFrames: 512, secondsAhead: 0.05 },
};

type Timeline = { time: number; clips: ClipState[]; framesPerTick: number };

export class Player {
  private context?: AudioContext;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private stopped = false;
  private pending?: (response: Response) => void;
  // Clip states as each scheduled chunk starts, oldest first.
  private timeline: Timeline[] = [];

  private constructor(
    private readonly worker: Worker,
    private readonly pacing: { chunkFrames: number; secondsAhead: number },
    readonly numMissing: number,
    readonly song: SongDescription,
    // As the song was saved, before it plays.
    readonly initialStates: ClipState[],
  ) {}

  // A kit or synth is a preset: the song is then the blank one, with the preset its only clip.
  static async load(files: CardFile[], path: string, preset: boolean): Promise<Player> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const loaded = await new Promise<Response>((resolve) => {
      worker.onmessage = ({ data }: MessageEvent<Response>) => resolve(data);
      post(worker, { type: "load", files, path, preset }, files.map((f) => f.data.buffer as ArrayBuffer));
    });
    if (loaded.type !== "loaded") {
      worker.terminate();
      throw new Error(loaded.type === "error" ? loaded.message : "Unexpected reply");
    }
    const player = new Player(worker, pacing[preset ? "preset" : "song"], loaded.numMissing, loaded.song, loaded.clips);
    worker.onmessage = ({ data }: MessageEvent<Response>) => player.pending?.(data);
    return player;
  }

  // Plays from the start. Once stopped, it must be loaded again to play it again.
  start(context: AudioContext, onError: (message: string) => void) {
    if (this.context || this.stopped) return;
    this.context = context;
    this.nextTime = context.currentTime + this.pacing.secondsAhead;
    this.pump().catch((error: Error) => {
      this.stop();
      onError(error.message);
    });
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

  // A preset's drum, by its row, or a synth's note.
  audition(y: number, on: boolean) {
    post(this.worker, { type: "audition", y, on });
  }

  // As heard now, with positions moved on from the latest chunk to start playing.
  clipStates(): ClipState[] | undefined {
    if (!this.context || this.stopped) return undefined;
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

  // As the latest chunk to start playing was rendered.
  bpm(): number | undefined {
    const latest = this.timeline[0];
    return latest && bpm(latest.framesPerTick, this.song.ticksPerQuarterNote);
  }

  private async pump() {
    const context = this.context!;
    while (!this.stopped) {
      if (this.nextTime - context.currentTime > this.pacing.secondsAhead) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      const response = await this.request({ type: "render", numFrames: this.pacing.chunkFrames });
      if (this.stopped) return;
      if (response.type === "error") throw new Error(response.message);
      if (response.type === "rendered") {
        // If rendering fell behind, carry on from now rather than skip.
        this.nextTime = Math.max(this.nextTime, context.currentTime);
        this.timeline.push({ time: this.nextTime, clips: response.clips, framesPerTick: response.framesPerTick });
        this.schedule(context, response.left, response.right);
      }
    }
  }

  private schedule(context: AudioContext, left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>) {
    const buffer = context.createBuffer(2, left.length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
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
