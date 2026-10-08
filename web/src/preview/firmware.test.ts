import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bpm, type CardFile, Firmware, sampleRate } from "./firmware";

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

function load() {
  return readCard(card).then((files) => Firmware.loadSong(files, "SONGS/Reference Kit 808.XML", () => {}));
}

describe("Firmware", () => {
  it("plays a song", async () => {
    const firmware = await load();
    expect(firmware.numMissing).toBe(0);
    const { left, right } = firmware.render(sampleRate);
    expect(left.length).toBeGreaterThanOrEqual(sampleRate);
    expect(right.length).toBe(left.length);
    const peak = left.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("describes the song's clips", async () => {
    const { song } = await load();
    expect(song.arrangement).toBe(false);
    expect(song.clips.length).toBeGreaterThan(1);
    for (const clip of song.clips) {
      expect(clip.type).toBe("kit");
      expect(clip.loopLength).toBeGreaterThan(0);
      expect(clip.rows!.some((row) => row.notes.length)).toBe(true);
    }
    expect(song.clips[0].rows!.map((row) => row.name)).toEqual(["KICK", "SNARE", "HATC", "HATO"]);
  });

  it("plays at the song's tempo", async () => {
    const firmware = await load();
    const { framesPerTick } = firmware.render(1024);
    expect(bpm(framesPerTick, firmware.song.ticksPerQuarterNote)).toBeCloseTo(120, 0);
  });

  it("toggles a clip at the end of its loop", async () => {
    const firmware = await load();
    const index = firmware.render(1024).clips.findIndex((clip) => clip.active);
    expect(index).toBeGreaterThanOrEqual(0);
    firmware.toggleClip(index, false);
    const armed = firmware.render(1024);
    expect(armed.clips[index]).toMatchObject({ active: true, armed: true });
    const loopFrames = firmware.song.clips[index].loopLength * armed.framesPerTick;
    firmware.render(loopFrames);
    expect(firmware.render(1024).clips[index]).toMatchObject({ active: false, armed: false });
  });

  it("toggles a clip straight away if instant", async () => {
    const firmware = await load();
    const index = firmware.render(1024).clips.findIndex((clip) => clip.active);
    firmware.toggleClip(index, true);
    firmware.render(1024);
    expect(firmware.render(1024).clips[index]).toMatchObject({ active: false, armed: false });
  });
}, 60_000);
