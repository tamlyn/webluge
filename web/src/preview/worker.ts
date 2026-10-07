// Runs the firmware off the main thread. One worker per song: the firmware boots once per instance.

import { type CardFile, Firmware, type Rendered } from "./firmware";

export type Request = { type: "load"; files: CardFile[]; songPath: string } | { type: "render"; numFrames: number };

export type Response =
  | { type: "loaded"; numMissing: number }
  | ({ type: "rendered" } & Rendered)
  | { type: "error"; message: string };

let firmware: Firmware | undefined;

self.onmessage = async ({ data: request }: MessageEvent<Request>) => {
  try {
    if (request.type === "load") {
      firmware = await Firmware.loadSong(request.files, request.songPath, (text) => console.debug(text));
      reply({ type: "loaded", numMissing: firmware.numMissing });
    } else {
      const { left, right } = firmware!.render(request.numFrames);
      reply({ type: "rendered", left, right }, [left.buffer, right.buffer]);
    }
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

function reply(response: Response, transfer: Transferable[] = []) {
  self.postMessage(response, { transfer });
}
