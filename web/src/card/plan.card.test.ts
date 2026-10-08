// Reorganises a copy of a real card, given by WEBLUGE_CARD, and checks that every song, kit and synth still finds the
// same files. Samples are stood in for by empty files, so it reads only the XML.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { baseName, Card } from "./card";
import { fileAt, memoryFolder, type MemoryFiles, type MemoryFolderHandle, snapshot } from "./memoryFolder";
import { findMissing, type Missing } from "./missing";
import { inverse, type Plan, planDelete, planMoves, planRelinks } from "./plan";
import { alternatePath, findPresetLinks, findSampleReferences, pathKey } from "./references";
import { run } from "./run";
import { isDocument, readDocument, refreshIndex, type UsageIndex } from "./usageIndex";

const cardFolder = process.env.WEBLUGE_CARD;

describe.skipIf(!cardFolder)("Reorganising a real card", () => {
  it("keeps every reference finding the same file", async () => {
    const { files, root, card, startedAt } = await readCard();
    const original = snapshot(root);
    let index = await refreshIndex(card, undefined, () => {});
    const resolveAll = () => resolveReferences(card, root, index, startedAt);
    const before = await resolveAll();

    const plans: Plan[] = [];
    const apply = async (plan: Plan) => {
      for (const rewrite of plan.rewrites) expect(withoutLinks(rewrite.after)).toBe(withoutLinks(rewrite.before));
      await run(card, plan);
      plans.push(plan);
      index = await refreshIndex(card, index, () => {});
    };
    const context = () => ({ card, index });

    const folder = await mostUsed(card, index, (key) => key.match(/^(samples\/[^/]+)\//)?.[1]);
    const preset = await mostUsed(card, index, (key) => (/^(kits|synths)\//.test(key) ? key : undefined));
    const collected = [...index.documents.values()].find(
      ({ path }) => /^SONGS\//i.test(path) && Object.keys(files).some((file) => file.startsWith(`${path.slice(0, -4)}/`)),
    )!.path;

    await apply(await planMoves(context(), [{ from: folder, to: `SAMPLES/Moved/${baseName(folder)}` }]));
    await apply(
      await planMoves(context(), [
        { from: preset, to: `${preset.split("/")[0]}/Renamed/${baseName(preset).slice(0, -4)} 2.XML` },
      ]),
    );
    await apply(await planMoves(context(), [{ from: collected, to: `SONGS/Moved/${baseName(collected)}` }]));
    const deleted = await mostUsed(card, index, (key) => (/^samples\/.*\.wav$/.test(key) ? key : undefined));
    await apply(await planDelete(context(), [deleted]));
    const deletedFile = startedAt.get(fileAt(root, `TRASH/${deleted}`)!);

    const after = await resolveAll();
    let numReferences = 0;
    const lost = new Set<string>();
    for (const [name, found] of before) {
      const now = after.get(name);
      if (!now) continue;
      // A reference to the deleted sample finds nothing now, or the copy among the document's collected samples.
      const expected = found.map((file, i) => {
        if (file !== deletedFile) return file;
        if (!now[i]) lost.add(name);
        return now[i]?.startsWith(name.replace(/\.xml$/i, "/")) ? now[i] : undefined;
      });
      expect([name, now]).toEqual([name, expected]);
      numReferences += found.filter(Boolean).length;
    }
    expect([...lost].sort()).toEqual([...plans.at(-1)!.broken].sort());
    expect(lost.size).toBeGreaterThan(0);
    expect(numReferences).toBeGreaterThan(1000);
    expect(plans.reduce((sum, plan) => sum + plan.rewrites.length, 0)).toBeGreaterThan(10);
    for (const { path } of index.documents.values()) expect(clipsMatched((await readDocument(card, path))!)).toBe(true);

    for (const plan of plans.reverse()) await run(card, inverse(plan));
    expect(snapshot(root)).toEqual(original);
  });

  it("relinks a sample folder renamed outside the app, so every reference finds the same file", async () => {
    const real = await readCard();
    const index = await refreshIndex(real.card, undefined, () => {});
    const folder = await mostUsed(real.card, index, (key) => key.match(/^(samples\/[^/]+)\//)?.[1]);
    const renamed = `${folder} renamed`;
    const rename = (path: string) => (path.startsWith(`${folder}/`) ? renamed + path.slice(folder.length) : path);
    const before = await resolveReferences(real.card, real.root, index, real.startedAt);
    const missingBefore = await findMissing(real.card, index);

    const { root, card, startedAt } = await readCard(rename);
    const original = snapshot(root);
    let renamedIndex = await refreshIndex(card, undefined, () => {});
    const missing = await findMissing(card, renamedIndex);
    // Each sample once, with every user but those that find a copy among their collected samples.
    const inFolder = missing.samples.filter(({ path }) => pathKey(path).startsWith(`${pathKey(folder)}/`));
    expect(new Set(inFolder.map(({ path }) => pathKey(path))).size).toBe(inFolder.length);
    for (const { path, users } of inFolder) {
      const expected = index.usersOf.get(pathKey(path))!.filter((user) => !fileAt(root, alternatePath(user, path)!));
      expect(users.sort()).toEqual(expected.sort());
    }

    const suggestion = missing.folders.find((relink) => same(relink.from, folder) && same(relink.to, renamed))!;
    expect(suggestion.relinks.length).toBeGreaterThan(100);
    const plan = await planRelinks({ card, index: renamedIndex }, suggestion.relinks);
    for (const rewrite of plan.rewrites) expect(withoutLinks(rewrite.after)).toBe(withoutLinks(rewrite.before));
    await run(card, plan);
    renamedIndex = await refreshIndex(card, renamedIndex, () => {});

    const after = await resolveReferences(card, root, renamedIndex, startedAt);
    const expected = [...before].map(([path, found]) => [path, found.map((file) => file && rename(file))]);
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(expected));
    const paths = (missing: Missing) => missing.samples.map(({ path }) => path);
    expect(paths(await findMissing(card, renamedIndex))).toEqual(paths(missingBefore));

    await run(card, inverse(plan));
    expect(snapshot(root)).toEqual(original);
  });
}, 300_000);

// A copy of the card in memory, with each path as the rename given makes it.
async function readCard(rename = (path: string) => path) {
  const files: MemoryFiles = {};
  for (const entry of await readdir(cardFolder!, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(cardFolder!, join(entry.parentPath, entry.name));
    files[rename(path)] = isDocument(path) ? new Uint8Array(await readFile(join(cardFolder!, path))) : new Uint8Array();
  }
  const root = memoryFolder(files);
  const card = new Card(root as unknown as FileSystemDirectoryHandle);
  // Each file by where it started, so that results read as paths.
  const startedAt = new Map(Object.keys(files).map((path) => [fileAt(root, path)!, path]));
  return { files, root, card, startedAt };
}

// By document, where it started, the file each of its references finds, by where that started.
async function resolveReferences(card: Card, root: MemoryFolderHandle, index: UsageIndex, startedAt: Map<object, string>) {
  const found = new Map<string, (string | undefined)[]>();
  for (const { path } of index.documents.values()) {
    const references = findSampleReferences((await readDocument(card, path))!);
    found.set(
      startedAt.get(fileAt(root, path)!)!,
      references.map(({ path: sample }) => {
        const alternate = alternatePath(path, sample);
        const file = fileAt(root, sample) ?? (alternate ? fileAt(root, alternate) : undefined);
        return file && startedAt.get(file);
      }),
    );
  }
  return found;
}

function same(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

// The path, as named on the card, of the samples or presets most used, grouped by the key given.
async function mostUsed(card: Card, index: UsageIndex, group: (key: string) => string | undefined): Promise<string> {
  const counts = new Map<string, number>();
  for (const [key, users] of index.usersOf) {
    const chosen = group(key);
    if (chosen) counts.set(chosen, (counts.get(chosen) ?? 0) + users.length);
  }
  for (const [key] of [...counts].sort((a, b) => b[1] - a[1])) {
    const path = await namedPath(card, key);
    if (path) return path;
  }
  throw new Error("None on the card");
}

async function namedPath(card: Card, key: string): Promise<string | undefined> {
  let path = "";
  for (const part of key.split("/")) {
    const entry = (await card.list(path, { hidden: true })).find((e) => e.name.toLowerCase() === part);
    if (!entry) return undefined;
    path = entry.path;
  }
  return path;
}

// The text with every sample path and preset link blanked, which a rewrite must leave as it was.
function withoutLinks(xml: string): string {
  const spans = [
    ...findSampleReferences(xml),
    ...findPresetLinks(xml).flatMap((link) => [link.name, ...(link.folder ? [link.folder] : [])]),
  ].sort((a, b) => b.start - a.start);
  let text = xml;
  for (const { start, end } of spans) text = text.slice(0, start) + text.slice(end);
  return text;
}

// Every clip's link matches an instrument's, as the firmware needs to load the song.
function clipsMatched(xml: string): boolean {
  const links = findPresetLinks(xml);
  const key = (link: (typeof links)[number]) => `${link.folder?.value ?? link.defaultFolder}/${link.name.value}`.toLowerCase();
  const instruments = new Set(links.filter((link) => link.defaultFolder).map(key));
  return links.filter((link) => !link.defaultFolder && link.folder).every((link) => instruments.has(key(link)));
}
