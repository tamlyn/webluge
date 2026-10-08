// Gathers what the firmware needs from the card to play a song, kit or synth: the file itself, its samples, and the
// settings files at the card's root. Copying only these keeps the card image small; a whole card can be many gigabytes.

import { Card } from "../card/card";
import { findSampleReferences } from "../card/references";
import { findSample, readDocument } from "../card/usageIndex";
import type { CardFile } from "./firmware";

export async function collectDocumentFiles(card: Card, path: string): Promise<CardFile[]> {
  const xml = (await readDocument(card, path)) ?? "";
  const samples = new Set(findSampleReferences(xml).map((r) => r.path));
  const found = await Promise.all([...samples].map((sample) => findSample(card, path, sample)));
  const settings = (await card.list("")).filter((e) => e.kind === "file" && /\.xml$/i.test(e.name)).map((e) => e.path);
  const paths = new Set([path, ...settings, ...found.filter((sample) => sample !== undefined)]);
  return Promise.all(
    [...paths].map(async (file) => ({ path: file, data: new Uint8Array(await (await card.file(file))!.arrayBuffer()) })),
  );
}
