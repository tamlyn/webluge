import { describe, expect, it } from "vitest";
import { Card } from "./card";
import { memoryFolder, type MemoryFiles, snapshot } from "./memoryFolder";
import {
  canMoveInto,
  followMove,
  inverse,
  needsConfirmation,
  type Plan,
  planDelete,
  PlanError,
  planMoves,
  planNewFolder,
} from "./plan";
import { run, RunStopped } from "./run";
import { refreshIndex } from "./usageIndex";

const fixture: MemoryFiles = {
  "SONGS/Song A.XML": `<song>
  <instruments>
    <kit
      presetName="Drums"
      presetFolder="KITS/Old">
      <soundSources>
        <sound name="KICK"><osc1 fileName="SAMPLES/DRUMS/Kick.wav" /></sound>
        <sound name="SNARE"><osc1><fileName>SAMPLES/DRUMS/Snare.wav</fileName></osc1></sound>
      </soundSources>
    </kit>
  </instruments>
  <sessionClips>
    <instrumentClip instrumentPresetName="Drums" instrumentPresetFolder="KITS/Old" />
    <audioClip filePath="SAMPLES/Vox/Hey.wav" />
  </sessionClips>
</song>`,
  // Its samples collected beside it: the firmware finds SAMPLES/DRUMS/Gone.wav as Collected/DRUMS_Gone.wav.
  "SONGS/Collected.XML": `<song><sound><osc1 fileName="SAMPLES/DRUMS/Gone.wav" /><osc2 fileName="samples/drums/kick.wav" /></sound></song>`,
  "SONGS/Collected/DRUMS_Gone.wav": "gone",
  "KITS/Old/Drums.XML": `<kit><sound name="KICK"><osc1 fileName="SAMPLES/DRUMS/Kick.wav" /></sound></kit>`,
  "SYNTHS/Bass.XML": `<sound><osc1 fileName="SAMPLES/DRUMS/Kick.wav" /></sound>`,
  "SAMPLES/DRUMS/Kick.wav": "kick",
  "SAMPLES/DRUMS/Snare.wav": "snare",
  "SAMPLES/DRUMS/.DS_Store": "finder",
  "SAMPLES/Vox/Hey.wav": "hey",
  "SAMPLES/Unused.wav": "unused",
};

async function setup(files: MemoryFiles = fixture) {
  const root = memoryFolder(files);
  const card = new Card(root as unknown as FileSystemDirectoryHandle);
  const context = { card, index: await refreshIndex(card, undefined, () => {}) };
  return { root, card, context };
}

// The fixture with some files' text changed, some moved and some removed.
function changed(edits: Record<string, (text: string) => string>, moves: Record<string, string> = {}) {
  const files: Record<string, string> = { ...(fixture as Record<string, string>) };
  for (const [path, edit] of Object.entries(edits)) files[path] = edit(files[path]);
  for (const [from, to] of Object.entries(moves)) {
    files[to] = files[from];
    delete files[from];
  }
  return files;
}

describe("planMoves", () => {
  it("rewrites exactly the references to a moved folder of samples", async () => {
    const { root, card, context } = await setup();
    const plan = await planMoves(context, [{ from: "SAMPLES/DRUMS", to: "SAMPLES/Old/DRUMS" }]);
    expect(plan.rewrites.map((r) => r.path).sort()).toEqual([
      "KITS/Old/Drums.XML",
      "SONGS/Collected.XML",
      "SONGS/Song A.XML",
      "SYNTHS/Bass.XML",
    ]);
    expect(plan.newFolders).toEqual(["SAMPLES/Old", "SAMPLES/Old/DRUMS"]);
    expect(needsConfirmation(plan)).toBe(true);
    await run(card, plan);

    const moved = (text: string) => text.replaceAll("SAMPLES/DRUMS/", "SAMPLES/Old/DRUMS/");
    expect(snapshot(root)).toEqual(
      changed(
        {
          "SONGS/Song A.XML": moved,
          // The reference to its collected sample still finds it; the other is written as the file's path now is.
          "SONGS/Collected.XML": (text) => text.replace("samples/drums/kick.wav", "SAMPLES/Old/DRUMS/Kick.wav"),
          "KITS/Old/Drums.XML": moved,
          "SYNTHS/Bass.XML": moved,
        },
        {
          "SAMPLES/DRUMS/Kick.wav": "SAMPLES/Old/DRUMS/Kick.wav",
          "SAMPLES/DRUMS/Snare.wav": "SAMPLES/Old/DRUMS/Snare.wav",
          "SAMPLES/DRUMS/.DS_Store": "SAMPLES/Old/DRUMS/.DS_Store",
        },
      ),
    );
  });

  it("moves an unused sample without needing confirmation", async () => {
    const { context } = await setup();
    const plan = await planMoves(context, [{ from: "SAMPLES/Unused.wav", to: "SAMPLES/Vox/Unused.wav" }]);
    expect(plan.moves).toEqual([{ from: "SAMPLES/Unused.wav", to: "SAMPLES/Vox/Unused.wav" }]);
    expect(needsConfirmation(plan)).toBe(false);
  });

  it("takes a song's collected samples with it", async () => {
    const { root, card, context } = await setup();
    const plan = await planMoves(context, [{ from: "SONGS/Collected.XML", to: "SONGS/Archive/Kept.XML" }]);
    expect(plan.companions).toEqual([{ from: "SONGS/Collected", to: "SONGS/Archive/Kept" }]);
    expect(plan.rewrites).toEqual([]);
    expect(needsConfirmation(plan)).toBe(true);
    await run(card, plan);
    expect(snapshot(root)).toEqual(
      changed(
        {},
        {
          "SONGS/Collected.XML": "SONGS/Archive/Kept.XML",
          "SONGS/Collected/DRUMS_Gone.wav": "SONGS/Archive/Kept/DRUMS_Gone.wav",
        },
      ),
    );
  });

  it("gives a collected sample its path when it leaves its song's folder", async () => {
    const { context } = await setup();
    const plan = await planMoves(context, [{ from: "SONGS/Collected/DRUMS_Gone.wav", to: "SONGS/Gone.wav" }]);
    expect(plan.rewrites).toHaveLength(1);
    expect(plan.rewrites[0].after).toContain(`fileName="SONGS/Gone.wav"`);
  });

  it("relinks the songs made from a renamed kit, instrument and clips together", async () => {
    const { root, card, context } = await setup();
    const plan = await planMoves(context, [{ from: "KITS/Old/Drums.XML", to: "KITS/808.XML" }]);
    await run(card, plan);
    const song = snapshot(root)["SONGS/Song A.XML"];
    expect(song).toContain(`presetName="808"\n      presetFolder="KITS"`);
    expect(song).toContain(`instrumentPresetName="808" instrumentPresetFolder="KITS"`);
    expect(song).not.toContain("Old");
  });

  it("leaves a song's preset links alone if it can't change all of them", async () => {
    const withoutFolder = (await setup(
      changed({ "SONGS/Song A.XML": (text) => text.replace(` instrumentPresetFolder="KITS/Old"`, "") }),
    )).context;
    const plan = await planMoves(withoutFolder, [{ from: "KITS/Old/Drums.XML", to: "KITS/808.XML" }]);
    expect(plan.rewrites).toEqual([]);

    // The clips would match this instrument instead.
    const taken = (await setup(
      changed({
        "SONGS/Song A.XML": (text) => text.replace("<instruments>", `<instruments><sound presetName="808" presetFolder="KITS" />`),
      }),
    )).context;
    expect((await planMoves(taken, [{ from: "KITS/Old/Drums.XML", to: "KITS/808.XML" }])).rewrites).toEqual([]);
  });

  it("refuses moves that would break the card", async () => {
    const { context } = await setup();
    const refuses = (from: string, to: string) => expect(planMoves(context, [{ from, to }])).rejects.toThrow(PlanError);
    await refuses("SAMPLES/Unused.wav", "SONGS/Unused.wav");
    await refuses("SAMPLES/Unused.wav", "SAMPLES/Un:used.wav");
    await refuses("SAMPLES/Unused.wav", "SAMPLES/Unused ✓.wav");
    await refuses("SAMPLES/Unused.wav", "SAMPLES/vox");
    await refuses("SAMPLES/DRUMS", "SAMPLES/DRUMS/Inside");
    await refuses("SAMPLES", "SONGS/SAMPLES");
    await refuses("SAMPLES/Missing.wav", "SAMPLES/Found.wav");
  });
});

describe("canMoveInto", () => {
  it("allows moves elsewhere within an entry's own top folder", () => {
    expect(canMoveInto(["SAMPLES/DRUMS/Kick.wav", "SAMPLES/Unused.wav"], "SAMPLES/Vox")).toBe(true);
    expect(canMoveInto(["SAMPLES/DRUMS/Kick.wav"], "SAMPLES")).toBe(true);
    expect(canMoveInto(["SAMPLES/DRUMS/Kick.wav"], "samples/drums")).toBe(false);
    expect(canMoveInto(["SAMPLES/DRUMS"], "SAMPLES/DRUMS/Old")).toBe(false);
    expect(canMoveInto(["SAMPLES/DRUMS"], "SAMPLES/DRUMS")).toBe(false);
    expect(canMoveInto(["SAMPLES/Unused.wav"], "SONGS")).toBe(false);
    expect(canMoveInto(["SAMPLES"], "SONGS")).toBe(false);
    expect(canMoveInto(["SAMPLES/Unused.wav"], "TRASH/SAMPLES")).toBe(false);
    // Restoring from the trash, but not moving around inside it.
    expect(canMoveInto(["TRASH/SAMPLES/Old.wav"], "SAMPLES/Vox")).toBe(true);
    expect(canMoveInto(["TRASH/SAMPLES/Old.wav"], "SONGS")).toBe(false);
    expect(canMoveInto(["TRASH/SAMPLES/Old.wav"], "TRASH/SAMPLES/Vox")).toBe(false);
    expect(canMoveInto([], "SAMPLES")).toBe(false);
    expect(canMoveInto(["TRASH"], "SAMPLES")).toBe(false);
    expect(canMoveInto(["TRASH/SAMPLES"], "SAMPLES")).toBe(false);
  });
});

describe("followMove", () => {
  it("follows entries and what's in them, there and back", async () => {
    const { context } = await setup();
    const plan = await planMoves(context, [{ from: "SONGS/Collected.XML", to: "SONGS/Archive/Kept.XML" }]);
    expect(followMove(plan, "SONGS/Collected.XML")).toBe("SONGS/Archive/Kept.XML");
    expect(followMove(plan, "SONGS/Collected/DRUMS_Gone.wav")).toBe("SONGS/Archive/Kept/DRUMS_Gone.wav");
    expect(followMove(plan, "SONGS/Song A.XML")).toBe("SONGS/Song A.XML");
    expect(followMove(inverse(plan), "SONGS/Archive/Kept/DRUMS_Gone.wav")).toBe("SONGS/Collected/DRUMS_Gone.wav");
  });
});

describe("planNewFolder", () => {
  it("makes a folder inside a top folder", async () => {
    const { root, card, context } = await setup();
    await run(card, await planNewFolder(context, "SAMPLES/Vox/Takes"));
    expect(snapshot(root)["SAMPLES/Vox/Takes/"]).toBe("");
    await expect(planNewFolder(context, "Elsewhere")).rejects.toThrow(PlanError);
    await expect(planNewFolder(context, "SAMPLES/vox")).rejects.toThrow(PlanError);
  });
});

describe("planDelete", () => {
  it("moves a sample to the trash, keeping its path, and lists the documents that lose it", async () => {
    const { root, card, context } = await setup();
    const plan = await planDelete(context, ["SAMPLES/Vox/Hey.wav"]);
    expect(plan.moves).toEqual([{ from: "SAMPLES/Vox/Hey.wav", to: "TRASH/SAMPLES/Vox/Hey.wav" }]);
    expect(plan.rewrites).toEqual([]);
    expect(plan.broken).toEqual(["SONGS/Song A.XML"]);
    await run(card, plan);
    expect(snapshot(root)).toEqual({
      ...changed({}, { "SAMPLES/Vox/Hey.wav": "TRASH/SAMPLES/Vox/Hey.wav" }),
      "SAMPLES/Vox/": "",
    });
  });

  it("takes a song's collected samples, numbering both if the trash has them already", async () => {
    const { root, card, context } = await setup({ ...fixture, "TRASH/SONGS/Collected/DRUMS_Old.wav": "old" });
    await run(card, await planDelete(context, ["SONGS/Collected.XML"]));
    expect(Object.keys(snapshot(root)).filter((path) => path.startsWith("TRASH/")).sort()).toEqual([
      "TRASH/SONGS/Collected 2.XML",
      "TRASH/SONGS/Collected 2/DRUMS_Gone.wav",
      "TRASH/SONGS/Collected/DRUMS_Old.wav",
    ]);
  });

  it("restores by moving back, which the songs find again", async () => {
    const { root, card, context } = await setup();
    await run(card, await planDelete(context, ["SAMPLES/Vox/Hey.wav"]));
    context.index = await refreshIndex(card, context.index, () => {});
    const restore = await planMoves(context, [{ from: "TRASH/SAMPLES/Vox/Hey.wav", to: "SAMPLES/Vox/Hey.wav" }]);
    expect(restore.rewrites).toEqual([]);
    await run(card, restore);
    expect(snapshot(root)).toEqual({ ...fixture, "TRASH/SAMPLES/Vox/": "" });
  });

  it("never deletes from the trash", async () => {
    const { context } = await setup({ ...fixture, "TRASH/SAMPLES/Old.wav": "old" });
    await expect(planDelete(context, ["TRASH/SAMPLES/Old.wav"])).rejects.toThrow(PlanError);
  });
});

describe("inverse", () => {
  it("puts back every file byte for byte", async () => {
    const { root, card, context } = await setup();
    const plans: Plan[] = [];
    const apply = async (plan: Plan) => {
      await run(card, plan);
      plans.push(plan);
      context.index = await refreshIndex(card, context.index, () => {});
    };
    await apply(await planMoves(context, [{ from: "SAMPLES/DRUMS", to: "SAMPLES/Old/DRUMS" }]));
    await apply(await planMoves(context, [{ from: "KITS/Old/Drums.XML", to: "KITS/808.XML" }]));
    await apply(await planMoves(context, [{ from: "SONGS/Collected.XML", to: "SONGS/Archive/Kept.XML" }]));
    await apply(await planDelete(context, ["SAMPLES/Old/DRUMS/Kick.wav", "SONGS/Song A.XML"]));
    for (const plan of plans.reverse()) await run(card, inverse(plan));
    expect(snapshot(root)).toEqual(fixture);
  });
});

describe("run", () => {
  const drums = { from: "SAMPLES/DRUMS", to: "SAMPLES/Old/DRUMS" };

  async function expectStopsUntouched(change: (card: Card) => Promise<void>) {
    const { root, card, context } = await setup();
    const plan = await planMoves(context, [drums]);
    await change(card);
    const before = snapshot(root);
    const stopped = await run(card, plan).catch((error) => error);
    expect(stopped).toBeInstanceOf(RunStopped);
    expect((stopped as RunStopped).done).toMatchObject({ rewrites: [], newFolders: [], moves: [], oldFolders: [] });
    expect(snapshot(root)).toEqual(before);
  }

  it("stops before changing anything if a document has changed since planning", () =>
    expectStopsUntouched((card) => card.writeFile("SYNTHS/Bass.XML", new TextEncoder().encode("<sound />"))));

  it("stops before changing anything if a destination has been taken", () =>
    expectStopsUntouched((card) => card.makeFolder("SAMPLES/Old")));

  it("stops before changing anything if a file has gone", () =>
    expectStopsUntouched((card) => card.moveFile("SAMPLES/DRUMS/Snare.wav", "SAMPLES/Snare.wav")));

  it("stops before changing anything if a file has appeared in a folder it would remove", () =>
    expectStopsUntouched(async (card) => {
      await card.makeFolder("SAMPLES/DRUMS/New");
    }));

  it("reports what it did when it stops partway, which can be undone", async () => {
    const { root, card, context } = await setup();
    const plan = await planMoves(context, [drums]);
    const moveFile = card.moveFile.bind(card);
    let moves = 0;
    card.moveFile = async (from, to) => {
      if (++moves === 2) throw new Error("Card removed");
      await moveFile(from, to);
    };
    const stopped: RunStopped = await run(card, plan).catch((error) => error);
    expect(stopped.message).toBe("Card removed");
    expect(stopped.done.rewrites).toHaveLength(4);
    expect(stopped.done.moves).toHaveLength(1);
    card.moveFile = moveFile;
    await run(card, inverse(stopped.done));
    expect(snapshot(root)).toEqual(fixture);
  });
});
