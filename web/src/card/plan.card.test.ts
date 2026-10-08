// Reorganises a copy of a real card, given by WEBLUGE_CARD, and checks that every song, kit and synth still finds the
// same files. Samples are stood in for by empty files, so it reads only the XML.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { baseName, Card } from "./card";
import { fileAt, memoryFolder, type MemoryFiles, snapshot } from "./memoryFolder";
import { inverse, type Plan, planDelete, planMoves } from "./plan";
import { alternatePath, findPresetLinks, findSampleReferences } from "./references";
import { run } from "./run";
import { isDocument, readDocument, refreshIndex, type UsageIndex } from "./usageIndex";

const cardFolder = process.env.WEBLUGE_CARD;

describe.skipIf(!cardFolder)("Reorganising a real card", () => {
  it("keeps every reference finding the same file", async () => {
    const files: MemoryFiles = {};
    for (const entry of await readdir(cardFolder!, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = relative(cardFolder!, join(entry.parentPath, entry.name));
      files[path] = isDocument(path) ? new Uint8Array(await readFile(join(cardFolder!, path))) : new Uint8Array();
    }
    const root = memoryFolder(files);
    const card = new Card(root as unknown as FileSystemDirectoryHandle);
    const original = snapshot(root);
    // Each file by where it started, so that results read as paths.
    const startedAt = new Map(Object.keys(files).map((path) => [fileAt(root, path)!, path]));
    let index = await refreshIndex(card, undefined, () => {});

    // By document, the file each of its references finds.
    const resolveAll = async () => {
      const found = new Map<object, (string | undefined)[]>();
      for (const { path } of index.documents.values()) {
        const references = findSampleReferences((await readDocument(card, path))!);
        found.set(
          fileAt(root, path)!,
          references.map(({ path: sample }) => {
            const alternate = alternatePath(path, sample);
            const file = fileAt(root, sample) ?? (alternate ? fileAt(root, alternate) : undefined);
            return file && startedAt.get(file);
          }),
        );
      }
      return found;
    };
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
    for (const [document, found] of before) {
      const name = startedAt.get(document)!;
      const now = after.get(document);
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
}, 300_000);

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
