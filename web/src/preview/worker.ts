// Runs the firmware off the main thread. One worker per song, kit or synth: the firmware boots once per instance.

import { type CardFile, Firmware, type PlaybackState, type Rendered, type SongDescription } from "./firmware";

export type Request =
  | { type: "load"; files: CardFile[]; path: string; preset: boolean }
  | { type: "render"; numFrames: number }
  // Applied before the next render, so not answered.
  | { type: "toggle"; index: number; instant: boolean }
  | { type: "solo"; index: number }
  | { type: "switch"; to: "session" | "arrangement" }
  | { type: "audition"; y: number; on: boolean };

export type Response =
  | { type: "loaded"; numMissing: number; song: SongDescription; state: PlaybackState }
  | ({ type: "rendered" } & Rendered)
  | { type: "error"; message: string };

let firmware: Firmware | undefined;

self.onmessage = async ({ data: request }: MessageEvent<Request>) => {
  try {
    if (request.type === "load") {
      const load = request.preset ? Firmware.loadPreset : Firmware.loadSong;
      firmware = await load(request.files, request.path, (text) => console.debug(text));
      reply({ type: "loaded", numMissing: firmware.numMissing, song: firmware.song, state: firmware.state() });
    } else if (request.type === "render") {
      const rendered = firmware!.render(request.numFrames);
      reply({ type: "rendered", ...rendered }, [rendered.left.buffer, rendered.right.buffer]);
    } else if (request.type === "toggle") {
      firmware!.toggleClip(request.index, request.instant);
    } else if (request.type === "solo") {
      firmware!.soloClip(request.index);
    } else if (request.type === "switch") {
      if (request.to === "session") firmware!.switchToSession();
      else firmware!.switchToArrangement();
    } else {
      firmware!.audition(request.y, request.on);
    }
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

function reply(response: Response, transfer: Transferable[] = []) {
  self.postMessage(response, { transfer });
}
