import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { type CardFile, Firmware, sampleRate } from "./firmware";

const card = fileURLToPath(new URL("../../../reference/1.2.1/Reference Kit 808/card", import.meta.url));

async function readCard(folder: string): Promise<CardFile[]> {
  const files: CardFile[] = [];
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith(".")) {
      const path = join(entry.parentPath, entry.name);
      files.push({ path: relative(folder, path), data: await readFile(path) });
    }
  }
  return files;
}

it("plays a song", async () => {
  const firmware = await Firmware.loadSong(await readCard(card), "SONGS/Reference Kit 808.XML", () => {});
  expect(firmware.numMissing).toBe(0);
  const { left, right } = firmware.render(sampleRate);
  expect(left.length).toBeGreaterThanOrEqual(sampleRate);
  expect(right.length).toBe(left.length);
  const peak = left.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
  expect(peak).toBeGreaterThan(0.01);
  expect(peak).toBeLessThanOrEqual(1);
  console.log("peak", peak, "frames", left.length);
}, 60_000);
