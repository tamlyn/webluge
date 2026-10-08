import { describe, expect, it } from "vitest";
import { Card } from "./card";
import { memoryFolder, type MemoryFiles, snapshot } from "./memoryFolder";
import { findMissing } from "./missing";
import { inverse, planRelinks } from "./plan";
import { run } from "./run";
import { refreshIndex } from "./usageIndex";

// SAMPLES/DRUMS has been renamed SAMPLES/808 outside the app.
const fixture: MemoryFiles = {
  "SONGS/Song.XML": `<song>
  <sound><osc1 fileName="samples/drums/kick.wav" /><osc2 fileName="SAMPLES/DRUMS/Snare/Snare.wav" /></sound>
  <sound><osc1 fileName="SAMPLES/DRUMS/Clap.wav" /></sound>
  <audioClip filePath="SAMPLES/Vox/Hey.wav" />
  <audioClip filePath="SAMPLES/Gone.wav" />
</song>`,
  "SONGS/Song/DRUMS_Clap.wav": "clap",
  "KITS/Kit.XML": `<kit><sound><osc1 fileName="SAMPLES/DRUMS/Kick.wav" /></sound></kit>`,
  "SAMPLES/808/Kick.wav": "kick",
  "SAMPLES/808/Snare/Snare.wav": "snare",
  "SAMPLES/Other/Hey.wav": "hey",
  "SAMPLES/More/HEY.WAV": "hey too",
  "TRASH/SAMPLES/Gone.wav": "gone",
};

async function setup() {
  const root = memoryFolder(fixture);
  const card = new Card(root as unknown as FileSystemDirectoryHandle);
  const context = { card, index: await refreshIndex(card, undefined, () => {}) };
  return { root, card, context };
}

describe("findMissing", () => {
  it("lists each missing sample once, with its users and the files with its name", async () => {
    const { card, context } = await setup();
    const missing = await findMissing(card, context.index);
    expect(missing.samples).toEqual([
      { path: "SAMPLES/DRUMS/Kick.wav", users: ["KITS/Kit.XML", "SONGS/Song.XML"], candidates: ["SAMPLES/808/Kick.wav"] },
      { path: "SAMPLES/DRUMS/Snare/Snare.wav", users: ["SONGS/Song.XML"], candidates: ["SAMPLES/808/Snare/Snare.wav"] },
      // Not the one in the trash: it's deleted until it's put back.
      { path: "SAMPLES/Gone.wav", users: ["SONGS/Song.XML"], candidates: [] },
      {
        path: "SAMPLES/Vox/Hey.wav",
        users: ["SONGS/Song.XML"],
        candidates: ["SAMPLES/More/HEY.WAV", "SAMPLES/Other/Hey.wav"],
      },
    ]);
    expect(missing.folders).toEqual([
      {
        from: "SAMPLES/DRUMS",
        to: "SAMPLES/808",
        relinks: [
          { from: "SAMPLES/DRUMS/Kick.wav", to: "SAMPLES/808/Kick.wav" },
          { from: "SAMPLES/DRUMS/Snare/Snare.wav", to: "SAMPLES/808/Snare/Snare.wav" },
        ],
      },
    ]);
  });
});

describe("planRelinks", () => {
  it("points every reference to a missing sample at the file chosen, and undoes", async () => {
    const { root, card, context } = await setup();
    const { folders } = await findMissing(card, context.index);
    const hey = { from: "SAMPLES/Vox/Hey.wav", to: "SAMPLES/Other/Hey.wav" };
    const plan = await planRelinks(context, [...folders[0].relinks, hey]);
    expect(plan.rewrites.map((rewrite) => rewrite.path).sort()).toEqual(["KITS/Kit.XML", "SONGS/Song.XML"]);
    await run(card, plan);

    const files = snapshot(root);
    expect(files["KITS/Kit.XML"]).toBe(`<kit><sound><osc1 fileName="SAMPLES/808/Kick.wav" /></sound></kit>`);
    expect(files["SONGS/Song.XML"]).toBe(
      (fixture["SONGS/Song.XML"] as string)
        .replace("samples/drums/kick.wav", "SAMPLES/808/Kick.wav")
        .replace("SAMPLES/DRUMS/Snare/", "SAMPLES/808/Snare/")
        .replace("SAMPLES/Vox/Hey.wav", "SAMPLES/Other/Hey.wav"),
    );
    const index = await refreshIndex(card, context.index, () => {});
    expect((await findMissing(card, index)).samples.map((sample) => sample.path)).toEqual(["SAMPLES/Gone.wav"]);

    await run(card, inverse(plan));
    expect(snapshot(root)).toEqual(fixture);
  });

  it("leaves references alone that find a file", async () => {
    const { context } = await setup();
    const plan = await planRelinks(context, [{ from: "SAMPLES/DRUMS/Clap.wav", to: "SAMPLES/808/Kick.wav" }]);
    expect(plan.rewrites).toEqual([]);
  });
});
