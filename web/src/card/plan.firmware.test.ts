// The firmware itself loads songs after their samples and kits have moved.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Firmware } from "../preview/firmware";
import { collectDocumentFiles } from "../preview/documentFiles";
import { Card } from "./card";
import { encodeCp437 } from "./cp437";
import { memoryFolder, type MemoryFiles } from "./memoryFolder";
import { findMissing } from "./missing";
import { planMoves, planRelinks, type Move } from "./plan";
import { run } from "./run";
import { readDocument, refreshIndex } from "./usageIndex";

const folder = fileURLToPath(new URL("../../../reference/1.2.1/Reference Kit 808/card", import.meta.url));
const songPath = "SONGS/Reference Kit 808.XML";

// With each path as the rename given makes it, as if changed outside the app.
async function referenceCard(rename = (path: string) => path): Promise<Card> {
  const files: MemoryFiles = {
    // The kit the song's instrument came from, which the reference card doesn't have.
    "KITS/000 TR-808.XML": "<kit />",
  };
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[rename(relative(folder, path))] = new Uint8Array(await readFile(path));
    }
  }
  return new Card(memoryFolder(files) as unknown as FileSystemDirectoryHandle);
}

async function move(card: Card, moves: Move[]) {
  await run(card, await planMoves({ card, index: await refreshIndex(card, undefined, () => {}) }, moves));
}

async function load(card: Card) {
  return Firmware.loadSong(await collectDocumentFiles(card, songPath), songPath);
}

describe("Moving files a song uses", () => {
  it("leaves the song loading with all its samples and clips", async () => {
    const card = await referenceCard();
    const original = await load(card);
    await move(card, [{ from: "SAMPLES/DRUMS", to: "SAMPLES/808/DRUMS" }]);
    await move(card, [{ from: "KITS/000 TR-808.XML", to: "KITS/Drum machines/TR-808.XML" }]);
    expect(await readDocument(card, songPath)).not.toMatch(/000 TR-808|"SAMPLES\/DRUMS/);

    const moved = await load(card);
    expect(moved.numMissing).toBe(0);
    expect(moved.song.clips.map((clip) => clip.output)).toEqual(original.song.clips.map(() => "TR-808"));
    expect(moved.song.clips.map(({ output: _, ...clip }) => clip)).toEqual(
      original.song.clips.map(({ output: _, ...clip }) => clip),
    );
  });

  it("loads with all its samples once a folder renamed outside the app is relinked", async () => {
    const original = await load(await referenceCard());
    const card = await referenceCard((path) => path.replace("SAMPLES/DRUMS/", "SAMPLES/808/"));
    expect((await load(card)).numMissing).toBe(4);

    const index = await refreshIndex(card, undefined, () => {});
    const { samples, folders } = await findMissing(card, index);
    expect(samples.map((sample) => sample.users)).toEqual(samples.map(() => [songPath]));
    expect(folders.map(({ from, to }) => ({ from, to }))).toEqual([{ from: "SAMPLES/DRUMS", to: "SAMPLES/808" }]);
    await run(card, await planRelinks({ card, index }, folders[0].relinks));

    const relinked = await load(card);
    expect(relinked.numMissing).toBe(0);
    expect(relinked.song).toEqual(original.song);
  });

  // Why the planner changes an instrument's link and its clips' together, or not at all.
  it("is needed for the clips' links too, or the song doesn't load", async () => {
    const card = await referenceCard();
    const xml = (await readDocument(card, songPath))!;
    await card.writeFile(songPath, encodeCp437(xml.replace(`presetName="000 TR-808"`, `presetName="TR-808"`)));
    await expect(load(card)).rejects.toThrow("Couldn't load");
  });
}, 60_000);
