import { describe, expect, it } from "vitest";
import { Card } from "./card";
import { memoryFolder } from "./memoryFolder";
import { refreshIndex } from "./usageIndex";

describe("refreshIndex", () => {
  it("rereads a document it's told was rewritten, even if it looks unchanged", async () => {
    const root = memoryFolder({
      "SONGS/Song.XML": `<song><osc1 fileName="SAMPLES/Drums/Kick.wav" /></song>`,
      "SAMPLES/Drums/Kick.wav": "kick",
    });
    const card = new Card(root as unknown as FileSystemDirectoryHandle);
    const index = await refreshIndex(card, undefined, () => {});
    // As if rewritten within the 2 seconds FAT can tell apart, to the same size.
    const stale = {
      ...index,
      documents: new Map(
        [...index.documents].map(([key, document]) => [key, { ...document, samples: ["SAMPLES/Kicks/Kick.wav"] }]),
      ),
    };
    const samples = async (rewritten?: string[]) =>
      (await refreshIndex(card, stale, () => {}, rewritten)).documents.get("songs/song.xml")?.samples;
    expect(await samples()).toEqual(["SAMPLES/Kicks/Kick.wav"]);
    expect(await samples(["SONGS/Song.XML"])).toEqual(["SAMPLES/Drums/Kick.wav"]);
  });
});
