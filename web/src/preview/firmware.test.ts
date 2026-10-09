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

// The reference song as if saved in arranger view, which the firmware reads as playing its arrangement, with an
// arrangement of its first two clips one after the other. Each clip instance is its position, length and clip's
// index, in hex.
const loopLength = 384;
const clipInstances = [0, loopLength, 0, loopLength, loopLength, 1].map((n) => n.toString(16).padStart(8, "0")).join("");

async function loadInArrangerView() {
  const files = await readCard(card);
  const song = files.find((file) => file.path === songPath)!;
  const xml = song.data.toString().replace("<song", '<song inArrangementView="1"');
  song.data = Buffer.from(xml.replace(/<kit\s/, `<kit clipInstances="0x${clipInstances}" `));
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

  it("loads files whose folders are spelt in different cases", async () => {
    const files = (await readCard(card)).map((file) =>
      file.path.includes("Snare") ? { ...file, path: file.path.replace("SAMPLES/DRUMS", "samples/drums") } : file,
    );
    const kick = files.find((file) => file.path.includes("Kick"))!;
    files.push({ ...kick, path: kick.path.toUpperCase() });
    const firmware = await Firmware.loadSong(files, songPath, () => {});
    expect(firmware.numMissing).toBe(0);
  });

  it("describes the song's clips", async () => {
    const { song } = await load();
    expect(song.arrangement).toBe(false);
    expect(song.clips.length).toBeGreaterThan(1);
    for (const clip of song.clips) {
      expect(clip.type).toBe("kit");
      expect(clip.length).toBeGreaterThan(0);
      expect(clip.rows!.some((row) => row.notes.length)).toBe(true);
    }
    expect(song.clips[0].rows!.map((row) => row.name)).toEqual(["KICK", "SNARE", "HATC", "HATO"]);
  });

  it("describes a song saved in arranger view as playing its arrangement", async () => {
    const { song } = await loadInArrangerView();
    expect(song.arrangement).toBe(true);
    expect(song.tracks).toHaveLength(1);
    expect(song.tracks[0].type).toBe("kit");
    expect(song.tracks[0].instances.map(([pos, length]) => [pos, length])).toEqual([
      [0, loopLength],
      [loopLength, loopLength],
    ]);
  });

  it("describes a song without an arrangement as having no tracks", async () => {
    const { song } = await load();
    expect(song.tracks).toEqual([]);
  });

  it("plays the arrangement to its end, then stops", async () => {
    const firmware = await loadInArrangerView();
    const { state, framesPerTick } = firmware.render(1024);
    expect(state).toMatchObject({ playing: true, arrangement: true });
    firmware.render(loopLength * framesPerTick);
    const later = firmware.render(1024).state;
    expect(later.arrangementPos).toBeGreaterThanOrEqual(loopLength);
    expect(later.clips[1].active).toBe(true);
    firmware.render(loopLength * framesPerTick);
    expect(firmware.render(1024).state.playing).toBe(false);
  });

  it("switches from the arrangement to the session, where its clips play on", async () => {
    const firmware = await loadInArrangerView();
    const { framesPerTick } = firmware.render(1024);
    firmware.switchToSession();
    const left = firmware.render(1024).state;
    expect(left).toMatchObject({ playing: true, arrangement: false });
    expect(left.clips[0].active).toBe(true);
    // The session plays on past where the arrangement would have ended.
    firmware.render(2 * loopLength * framesPerTick);
    const { state } = firmware.render(1024);
    expect(state).toMatchObject({ playing: true, arrangement: false, arrangementPos: left.arrangementPos });
    expect(state.clips[0].active).toBe(true);
  });

  it("only switches to the session when a clip is toggled while the arrangement plays", async () => {
    const firmware = await loadInArrangerView();
    firmware.render(1024);
    firmware.toggleClip(2, false);
    const { state } = firmware.render(1024);
    expect(state.arrangement).toBe(false);
    expect(state.clips[2]).toMatchObject({ active: false, armed: false });
  });

  it("switches back to the arrangement from where it was left, at the end of the loop", async () => {
    const firmware = await loadInArrangerView();
    const { framesPerTick } = firmware.render(1024);
    firmware.switchToSession();
    const left = firmware.render(1024).state.arrangementPos;
    firmware.switchToArrangement();
    expect(firmware.render(1024).state).toMatchObject({ arrangement: false, switchingToArrangement: true });
    firmware.render(loopLength * framesPerTick);
    const { state } = firmware.render(1024);
    expect(state).toMatchObject({ playing: true, arrangement: true, switchingToArrangement: false });
    expect(state.arrangementPos).toBeGreaterThanOrEqual(left);
    expect(state.arrangementPos).toBeLessThan(loopLength);
  });

  it("plays at the song's tempo", async () => {
    const firmware = await load();
    const { framesPerTick } = firmware.render(1024);
    expect(bpm(framesPerTick, firmware.song.ticksPerQuarterNote)).toBeCloseTo(120, 0);
  });

  it("toggles a clip at the end of its loop", async () => {
    const firmware = await load();
    const index = firmware.render(1024).state.clips.findIndex((clip) => clip.active);
    expect(index).toBeGreaterThanOrEqual(0);
    firmware.toggleClip(index, false);
    const armed = firmware.render(1024);
    expect(armed.state.clips[index]).toMatchObject({ active: true, armed: true });
    const loopFrames = firmware.song.clips[index].length * armed.framesPerTick;
    firmware.render(loopFrames);
    expect(firmware.render(1024).state.clips[index]).toMatchObject({ active: false, armed: false });
  });

  it("toggles a clip straight away if instant", async () => {
    const firmware = await load();
    const index = firmware.render(1024).state.clips.findIndex((clip) => clip.active);
    firmware.toggleClip(index, true);
    firmware.render(1024);
    expect(firmware.render(1024).state.clips[index]).toMatchObject({ active: false, armed: false });
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
