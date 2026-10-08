import { Card } from "./card";
import { decodeCp437 } from "./cp437";
import { findPresetLinks, findSampleReferences, pathKey, presetPath } from "./references";

// Which songs, kits and synths use which samples, and which kits and synths songs' instruments came from. It's a guide
// to where to look: the card can change behind it, so anything that changes the card checks the card itself.
export type UsageIndex = {
  // By path key.
  documents: Map<string, IndexedDocument>;
  // By path key of a sample or preset, the documents that refer to it.
  usersOf: Map<string, string[]>;
};

export type IndexedDocument = {
  path: string;
  // Size and modification time, to tell when it has changed.
  stamp: string;
  // As written in the document.
  samples: string[];
  presets: string[];
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

// Rereads only the documents that are new or changed since the previous index.
export async function refreshIndex(
  card: Card,
  previous: UsageIndex | undefined,
  onProgress: (done: number, total: number) => void,
): Promise<UsageIndex> {
  const files: File[] = [];
  const paths: string[] = [];
  for (const folder of documentFolders) {
    for await (const path of card.walk(folder)) {
      const file = isDocument(path) && (await card.file(path));
      if (file) {
        files.push(file);
        paths.push(path);
      }
    }
  }
  const documents = new Map<string, IndexedDocument>();
  const changed: number[] = [];
  for (const [i, path] of paths.entries()) {
    const known = previous?.documents.get(pathKey(path));
    if (known?.stamp === stampOf(files[i])) documents.set(pathKey(path), { ...known, path });
    else changed.push(i);
  }
  for (const [done, i] of changed.entries()) {
    onProgress(done, changed.length);
    const xml = decodeCp437(new Uint8Array(await files[i].arrayBuffer()));
    documents.set(pathKey(paths[i]), {
      path: paths[i],
      stamp: stampOf(files[i]),
      samples: [...new Set(findSampleReferences(xml).map((r) => r.path))],
      presets: [...new Set(findPresetLinks(xml).map(presetPath).filter((path) => path !== undefined))],
    });
  }
  onProgress(changed.length, changed.length);

  const usersOf = new Map<string, string[]>();
  for (const document of documents.values()) {
    for (const used of new Set([...document.samples, ...document.presets].map(pathKey))) {
      const users = usersOf.get(used);
      if (users) users.push(document.path);
      else usersOf.set(used, [document.path]);
    }
  }
  return { documents, usersOf };
}

function stampOf(file: File): string {
  return `${file.size}:${file.lastModified}`;
}
