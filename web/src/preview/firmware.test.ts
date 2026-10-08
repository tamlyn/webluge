import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bpm, type CardFile, Firmware, sampleRate } from "./firmware";

const card = fileURLToPath(new URL("../../../reference/1.2.1/Reference Kit 808/card", import.meta.url));
// Factory presets: the TR-808 kit, cut down to the four drums the reference card has samples for, and a synth.
const presets = fileURLToPath(new URL("./fixtures", import.meta.url));

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

function peak(samples: Float32Array): number {
  return samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
}

const songPath = "SONGS/Reference Kit 808.XML";

function load() {
  return readCard(card).then((files) => Firmware.loadSong(files, songPath, () => {}));
}

// The reference song as if saved in arranger view, which the firmware reads as playing its arrangement.
async function loadInArrangerView() {
  const files = await readCard(card);
  const song = files.find((file) => file.path === songPath)!;
  song.data = Buffer.from(song.data.toString().replace("<song", '<song inArrangementView="1"'));
  return Firmware.loadSong(files, songPath, () => {});
}

describe("Firmware", () => {
  it("plays a song", async () => {
    const firmware = await load();
    expect(firmware.numMissing).toBe(0);
    const { left, right } = firmware.render(sampleRate);
    expect(left.length).toBeGreaterThanOrEqual(sampleRate);
    expect(right.length).toBe(left.length);
    expect(peak(left)).toBeGreaterThan(0.01);
    expect(peak(left)).toBeLessThanOrEqual(1);
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

  it("describes a song saved in arranger view as playing its arrangement", async () => {
    const { song } = await loadInArrangerView();
    expect(song.arrangement).toBe(true);
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

describe("Firmware with a kit or synth", () => {
  async function loadPreset(path: string) {
    return Firmware.loadPreset([...(await readCard(card)), ...(await readCard(presets))], path, () => {});
  }

  it("auditions each of a kit's drums", async () => {
    const firmware = await loadPreset("KITS/TR-808.XML");
    expect(firmware.numMissing).toBe(0);
    expect(firmware.song.clips).toHaveLength(1);
    const [kit] = firmware.song.clips;
    expect(kit).toMatchObject({ type: "kit", output: "TR-808" });
    expect(kit.rows!.map((row) => row.name)).toEqual(["KICK", "SNARE", "HATC", "HATO"]);
    for (let y = 0; y < kit.rows!.length; y++) {
      firmware.render(sampleRate);
      expect(peak(firmware.render(4096).left)).toBeLessThan(0.0001);
      firmware.audition(y, true);
      expect(peak(firmware.render(4096).left)).toBeGreaterThan(0.01);
      firmware.audition(y, false);
    }
  });

  it("holds a synth's note until it's released", async () => {
    const firmware = await loadPreset("SYNTHS/Rich Saw Bass.XML");
    expect(firmware.song.clips[0]).toMatchObject({ type: "synth", output: "Rich Saw Bass" });
    expect(peak(firmware.render(4096).left)).toBeLessThan(0.0001);
    firmware.audition(48, true);
    firmware.render(sampleRate);
    expect(peak(firmware.render(4096).left)).toBeGreaterThan(0.01);
    firmware.audition(48, false);
    firmware.render(sampleRate);
    expect(peak(firmware.render(4096).left)).toBeLessThan(0.0001);
  });
}, 60_000);
