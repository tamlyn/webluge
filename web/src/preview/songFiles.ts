// Gathers what the firmware needs from the card to play a song: the song, its samples, and the settings files at the
// card's root. Copying only these keeps the card image small; a whole card can be many gigabytes.

import { Card } from "../card/card";
import { readDocument } from "../card/sampleIndex";
import { alternatePath, findSampleReferences } from "../card/references";
import type { CardFile } from "./firmware";

// Where the firmware will find a song's sample, if it's on the card.
export async function findSample(card: Card, songPath: string, samplePath: string): Promise<string | undefined> {
  if (await card.exists(samplePath)) return samplePath;
  const alternate = alternatePath(songPath, samplePath);
  return alternate && (await card.exists(alternate)) ? alternate : undefined;
}

export async function collectSongFiles(card: Card, songPath: string): Promise<CardFile[]> {
  const xml = (await readDocument(card, songPath)) ?? "";
  const samples = new Set(findSampleReferences(xml).map((r) => r.path));
  const found = await Promise.all([...samples].map((sample) => findSample(card, songPath, sample)));
  const settings = (await card.list("")).filter((e) => e.kind === "file" && /\.xml$/i.test(e.name)).map((e) => e.path);
  const paths = new Set([songPath, ...settings, ...found.filter((path) => path !== undefined)]);
  return Promise.all(
    [...paths].map(async (path) => ({ path, data: new Uint8Array(await (await card.file(path))!.arrayBuffer()) })),
  );
}
