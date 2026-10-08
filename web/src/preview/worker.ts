// Runs the firmware off the main thread. One worker per song: the firmware boots once per instance.

import { type CardFile, type ClipState, Firmware, type Rendered, type SongDescription } from "./firmware";

export type Request =
  | { type: "load"; files: CardFile[]; songPath: string }
  | { type: "render"; numFrames: number }
  // Applied before the next render, so not answered.
  | { type: "toggle"; index: number; instant: boolean }
  | { type: "solo"; index: number };

export type Response =
  | { type: "loaded"; numMissing: number; song: SongDescription; clips: ClipState[] }
  | ({ type: "rendered" } & Rendered)
  | { type: "error"; message: string };

let firmware: Firmware | undefined;

self.onmessage = async ({ data: request }: MessageEvent<Request>) => {
  try {
    if (request.type === "load") {
      firmware = await Firmware.loadSong(request.files, request.songPath, (text) => console.debug(text));
      reply({ type: "loaded", numMissing: firmware.numMissing, song: firmware.song, clips: firmware.clipStates() });
    } else if (request.type === "render") {
      const rendered = firmware!.render(request.numFrames);
      reply({ type: "rendered", ...rendered }, [rendered.left.buffer, rendered.right.buffer]);
    } else if (request.type === "toggle") {
      firmware!.toggleClip(request.index, request.instant);
    } else {
      firmware!.soloClip(request.index);
    }
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

function reply(response: Response, transfer: Transferable[] = []) {
  self.postMessage(response, { transfer });
}
