// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Card } from "../card/card";
import { type MemoryFiles, memoryFolder, snapshot } from "../card/memoryFolder";
import { refreshIndex, type UsageIndex } from "../card/usageIndex";
import type { Selection } from "./Browser";
import { useOperations } from "./useOperations";
import { useOrganize } from "./useOrganize";

// jsdom doesn't draw modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
// Testing Library only cleans up by itself where Vitest's globals are on.
afterEach(cleanup);

const song = (sample: string) => `<song><sound><osc1 fileName="${sample}" /></sound></song>`;

// The browser's organising on a card in memory, with its latest tools to hand and its dialog drawn.
function setup(files: MemoryFiles, options: { chosen?: string[]; selection?: Selection; rescan?: Promise<void> } = {}) {
  const root = memoryFolder(files);
  const card = new Card(root as unknown as FileSystemDirectoryHandle);
  let index: UsageIndex | undefined;
  const refresh = async (rewritten?: string[]) => {
    if (rewritten) await options.rescan;
    return (index = await refreshIndex(card, index, () => {}, rewritten));
  };
  const chosen = options.chosen ?? [];
  const selection = "selection" in options ? options.selection : { path: chosen[0] ?? "", folder: false };
  const latest = {} as { organize: ReturnType<typeof useOrganize>; busy: boolean };
  function Harness() {
    const operations = useOperations(card, refresh, () => {});
    latest.organize = useOrganize({ card, operations, selection, chosen, navigate: () => {} });
    latest.busy = operations.busy;
    return <>{latest.organize.dialog}</>;
  }
  render(<Harness />);
  return {
    root,
    card,
    tools: () => latest.organize.tools,
    drop: (paths: string[], folder: string) => act(() => latest.organize.onDrop(paths, folder)),
    settled: () => waitFor(() => expect(latest.busy).toBe(false)),
  };
}

async function confirmation() {
  const dialog = await screen.findByRole("dialog");
  return {
    title: within(dialog).getByRole("heading").textContent,
    lines: within(dialog)
      .queryAllByRole("listitem")
      .map((item) => item.textContent),
    answer: (action: string) => fireEvent.click(within(dialog).getByRole("button", { name: action })),
  };
}

describe("useOrganize", () => {
  describe("confirming", () => {
    it("doesn't ask when only what was chosen moves", async () => {
      const { card, drop, settled } = setup({ "SONGS/Song.XML": "<song/>", "SONGS/Album/Other.XML": "<song/>" });

      await drop(["SONGS/Song.XML"], "SONGS/Album");
      await settled();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(await card.kind("SONGS/Album/Song.XML")).toBe("file");
    });

    it("asks before updating the songs that use what moves, and changes nothing if cancelled", async () => {
      const { root, drop, settled } = setup({
        "SONGS/Song.XML": song("SAMPLES/Kick.wav"),
        "SAMPLES/Kick.wav": "",
        "SAMPLES/Drums/Snare.wav": "",
      });
      const before = snapshot(root);

      await drop(["SAMPLES/Kick.wav"], "SAMPLES/Drums");
      const asked = await confirmation();
      expect(asked.title).toBe("Move Kick.wav?");
      expect(asked.lines).toEqual(["Also updates 1 song that uses what moves"]);

      asked.answer("Cancel");
      await settled();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(snapshot(root)).toEqual(before);
    });

    it("runs the plan once confirmed", async () => {
      const { root, drop, settled } = setup({
        "SONGS/Song.XML": song("SAMPLES/Kick.wav"),
        "SAMPLES/Kick.wav": "",
        "SAMPLES/Drums/Snare.wav": "",
      });

      await drop(["SAMPLES/Kick.wav"], "SAMPLES/Drums");
      (await confirmation()).answer("Move");
      await settled();
      const files = snapshot(root);
      expect(files).toHaveProperty(["SAMPLES/Drums/Kick.wav"]);
      expect(files).not.toHaveProperty(["SAMPLES/Kick.wav"]);
      expect(files["SONGS/Song.XML"]).toBe(song("SAMPLES/Drums/Kick.wav"));
    });

    it("says a renamed song's collected samples go with it", async () => {
      const { card, tools, settled } = setup(
        { "SONGS/Song.XML": "<song/>", "SONGS/Song/Loop.wav": "" },
        { chosen: ["SONGS/Song.XML"] },
      );

      act(() => tools().onRename!());
      const name = await screen.findByRole("textbox");
      fireEvent.change(name, { target: { value: "Tune.XML" } });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
      const asked = await confirmation();
      expect(asked.title).toBe("Rename Song.XML?");
      expect(asked.lines).toEqual(["Also renames its folder of collected samples, Song, to Tune"]);

      asked.answer("Rename");
      await settled();
      expect(await card.kind("SONGS/Tune.XML")).toBe("file");
      expect(await card.kind("SONGS/Tune/Loop.wav")).toBe("file");
    });

    it("says a deleted song's collected samples go with it", async () => {
      const { tools } = setup(
        { "SONGS/Song.XML": "<song/>", "SONGS/Song/Loop.wav": "" },
        { chosen: ["SONGS/Song.XML"] },
      );

      act(() => tools().onDelete!());
      const asked = await confirmation();
      expect(asked.title).toBe("Delete Song.XML?");
      expect(asked.lines).toEqual(["Also deletes the folder of samples collected for Song"]);
    });

    it("names the songs a deleted sample leaves missing samples", async () => {
      const { card, tools, settled } = setup(
        { "SONGS/Song.XML": song("SAMPLES/Kick.wav"), "SAMPLES/Kick.wav": "" },
        { chosen: ["SAMPLES/Kick.wav"] },
      );

      act(() => tools().onDelete!());
      const asked = await confirmation();
      expect(asked.title).toBe("Delete Kick.wav?");
      expect(asked.lines).toEqual(["Leaves 1 song missing samples: Song"]);

      asked.answer("Delete");
      await settled();
      expect(await card.kind("TRASH/SAMPLES/Kick.wav")).toBe("file");
    });
  });

  describe("tools", () => {
    const files = { "SONGS/Song.XML": "<song/>", "SONGS/Other.XML": "<song/>", "TRASH/SONGS/Old.XML": "<song/>" };
    const offered = (tools: object) =>
      Object.entries(tools)
        .filter(([, tool]) => tool)
        .map(([name]) => name)
        .sort();

    it("offers everything for one entry in a top folder", () => {
      const { tools } = setup(files, { chosen: ["SONGS/Song.XML"] });
      expect(offered(tools())).toEqual(["onDelete", "onMoveTo", "onNewFolder", "onRename"]);
    });

    it("doesn't rename several at once", () => {
      const { tools } = setup(files, { chosen: ["SONGS/Song.XML", "SONGS/Other.XML"] });
      expect(offered(tools())).toEqual(["onDelete", "onMoveTo", "onNewFolder"]);
    });

    it("only makes new folders in a top folder itself", () => {
      const { tools } = setup(files, { chosen: ["SONGS"], selection: { path: "SONGS", folder: true } });
      expect(offered(tools())).toEqual(["onNewFolder"]);
    });

    it("moves and renames what's in the trash, to put it back, but doesn't delete it or make folders there", () => {
      const { tools } = setup(files, { chosen: ["TRASH/SONGS/Old.XML"] });
      expect(offered(tools())).toEqual(["onMoveTo", "onRename"]);
    });

    it("offers nothing without a selection in the browser", () => {
      const { tools } = setup(files, { chosen: ["SONGS/Song.XML"], selection: undefined });
      expect(offered(tools())).toEqual([]);
    });

    it("offers nothing, and takes no drops, until a change has finished", async () => {
      let finishRescan = () => {};
      const rescan = new Promise<void>((resolve) => (finishRescan = resolve));
      const { card, tools, drop, settled } = setup(
        { ...files, "SONGS/Album/Third.XML": "<song/>" },
        { chosen: ["SONGS/Song.XML"], rescan },
      );

      await drop(["SONGS/Song.XML"], "SONGS/Album");
      await waitFor(async () => expect(await card.kind("SONGS/Album/Song.XML")).toBe("file"));
      expect(offered(tools())).toEqual([]);
      await drop(["SONGS/Other.XML"], "SONGS/Album");

      finishRescan();
      await settled();
      expect(offered(tools())).not.toEqual([]);
      expect(await card.kind("SONGS/Other.XML")).toBe("file");
    });
  });
});
