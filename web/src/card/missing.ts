// The samples that songs, kits and synths refer to but the firmware won't find, and the files elsewhere on the card
// that are probably them: those with the same name, and for a whole folder, those with the same path below it.

import { type Card, baseName } from "./card";
import { type Move, trash } from "./plan";
import { alternatePath, pathKey } from "./references";
import type { UsageIndex } from "./usageIndex";

export type MissingSample = {
  // As the first document to refer to it writes it.
  path: string;
  users: string[];
  // Files with the same name.
  candidates: string[];
};

// A folder whose missing samples are all, or mostly, below another folder by the same paths, as when it's been renamed
// or moved outside the app.
export type FolderRelink = { from: string; to: string; relinks: Move[] };

export type Missing = { samples: MissingSample[]; folders: FolderRelink[] };

export async function findMissing(card: Card, index: UsageIndex): Promise<Missing> {
  // Paths on the card by path key, and by name.
  const files = new Map<string, string>();
  const named = new Map<string, string[]>();
  for (const entry of await card.list("")) {
    if (entry.name.toUpperCase() === trash) continue;
    for await (const path of entry.kind === "folder" ? card.walk(entry.path) : [entry.path]) {
      files.set(pathKey(path), path);
      const name = pathKey(baseName(path));
      const same = named.get(name);
      if (same) same.push(path);
      else named.set(name, [path]);
    }
  }

  const missing = new Map<string, MissingSample>();
  const documents = [...index.documents.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const { path: document, samples } of documents) {
    for (const sample of samples) {
      const alternate = alternatePath(document, sample);
      if (files.has(pathKey(sample)) || (alternate && files.has(pathKey(alternate)))) continue;
      let entry = missing.get(pathKey(sample));
      if (!entry) {
        entry = { path: sample, users: [], candidates: named.get(pathKey(baseName(sample))) ?? [] };
        missing.set(pathKey(sample), entry);
      }
      if (!entry.users.includes(document)) entry.users.push(document);
    }
  }
  const samples = [...missing.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return { samples, folders: folderRelinks(samples, files) };
}

// Each pairing of a missing sample with a candidate suggests a folder relink: the folders above the longest stretch of
// path they share. A suggestion is kept if it would relink more than one sample.
function folderRelinks(samples: MissingSample[], files: Map<string, string>): FolderRelink[] {
  const suggested = new Map<string, { from: string; to: string }>();
  for (const { path, candidates } of samples) {
    const parts = path.split("/");
    for (const candidate of candidates) {
      const candidateParts = candidate.split("/");
      let shared = 1;
      while (
        shared < parts.length &&
        shared < candidateParts.length &&
        pathKey(parts.at(-1 - shared)!) === pathKey(candidateParts.at(-1 - shared)!)
      ) {
        shared++;
      }
      if (shared === parts.length || shared === candidateParts.length) continue;
      const from = parts.slice(0, -shared).join("/");
      const to = candidateParts.slice(0, -shared).join("/");
      suggested.set(`${pathKey(from)}\n${pathKey(to)}`, { from, to });
    }
  }

  const folders: FolderRelink[] = [];
  for (const { from, to } of suggested.values()) {
    const relinks: Move[] = [];
    for (const { path } of samples) {
      if (!pathKey(path).startsWith(`${pathKey(from)}/`)) continue;
      const found = files.get(pathKey(`${to}${path.slice(from.length)}`));
      if (found) relinks.push({ from: path, to: found });
    }
    if (relinks.length > 1) folders.push({ from, to, relinks });
  }
  return folders.sort((a, b) => b.relinks.length - a.relinks.length);
}
