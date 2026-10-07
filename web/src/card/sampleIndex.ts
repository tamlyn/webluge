import { Card } from "./card";
import { decodeCp437 } from "./cp437";
import { findSampleReferences, pathKey } from "./references";

// Which songs, kits and synths use which samples.
export type SampleIndex = {
  // By XML file, the sample paths it refers to, as written.
  samplesOf: Map<string, string[]>;
  // By sample path key, the XML files that refer to it.
  usersOf: Map<string, string[]>;
};

// The folders whose XML files refer to samples. Songs carry copies of their kits and synths, so each refers to its
// samples directly.
const documentFolders = ["SONGS", "KITS", "SYNTHS"];

export function isDocument(path: string): boolean {
  return /\.xml$/i.test(path) && documentFolders.some((folder) => path.toUpperCase().startsWith(`${folder}/`));
}

export async function readDocument(card: Card, path: string): Promise<string | undefined> {
  const file = await card.file(path);
  return file && decodeCp437(new Uint8Array(await file.arrayBuffer()));
}

export async function buildSampleIndex(
  card: Card,
  onProgress: (done: number, total: number) => void,
): Promise<SampleIndex> {
  const documents: string[] = [];
  for (const folder of documentFolders) {
    for await (const path of card.walk(folder)) {
      if (isDocument(path)) documents.push(path);
    }
  }
  const index: SampleIndex = { samplesOf: new Map(), usersOf: new Map() };
  for (const [i, path] of documents.entries()) {
    onProgress(i, documents.length);
    const xml = await readDocument(card, path);
    const samples = [...new Set(findSampleReferences(xml ?? "").map((r) => r.path))];
    index.samplesOf.set(path, samples);
    for (const sample of samples) {
      const key = pathKey(sample);
      index.usersOf.set(key, [...(index.usersOf.get(key) ?? []), path]);
    }
  }
  onProgress(documents.length, documents.length);
  return index;
}
