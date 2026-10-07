// Plays a song as the firmware renders it, keeping a few seconds rendered ahead of what's playing.

import type { CardFile } from "./firmware";
import { sampleRate } from "./firmware";
import type { Request, Response } from "./worker";

const chunkFrames = sampleRate;
const secondsAhead = 3;

export class SongPlayer {
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private stopped = false;
  private pending?: (response: Response) => void;

  private constructor(
    private readonly context: AudioContext,
    private readonly worker: Worker,
    readonly numMissing: number,
  ) {}

  static async play(
    context: AudioContext,
    files: CardFile[],
    songPath: string,
    onError: (message: string) => void,
  ): Promise<SongPlayer> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const pending: { resolve?: (response: Response) => void } = {};
    worker.onmessage = ({ data }: MessageEvent<Response>) => pending.resolve?.(data);
    const loaded = await new Promise<Response>((resolve) => {
      pending.resolve = resolve;
      post(worker, { type: "load", files, songPath }, files.map((f) => f.data.buffer as ArrayBuffer));
    });
    if (loaded.type === "error") {
      worker.terminate();
      throw new Error(loaded.message);
    }
    const player = new SongPlayer(context, worker, loaded.type === "loaded" ? loaded.numMissing : 0);
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

  private async pump() {
    while (!this.stopped) {
      if (this.nextTime - this.context.currentTime > secondsAhead) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const response = await this.request({ type: "render", numFrames: chunkFrames });
      if (this.stopped) return;
      if (response.type === "error") throw new Error(response.message);
      if (response.type === "rendered") this.schedule(response.left, response.right);
    }
  }

  private schedule(left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>) {
    const buffer = this.context.createBuffer(2, left.length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    // If rendering fell behind, carry on from now rather than skip.
    this.nextTime = Math.max(this.nextTime, this.context.currentTime);
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
