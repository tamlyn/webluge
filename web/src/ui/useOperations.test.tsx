// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Card } from "../card/card";
import { type MemoryFiles, memoryFolder, snapshot } from "../card/memoryFolder";
import { planMoves, planNewFolder } from "../card/plan";
import { refreshIndex } from "../card/usageIndex";
import { useOperations } from "./useOperations";

// A card whose index catches up after a run only when the test lets it, as a slow rescan would.
function setup(files: MemoryFiles = { "SONGS/Song.XML": "<song/>" }) {
  const root = memoryFolder(files);
  const card = new Card(root as unknown as FileSystemDirectoryHandle);
  let finishRescan = () => {};
  const rescanned = new Promise<void>((resolve) => (finishRescan = resolve));
  // Only the refresh after a run is told what was rewritten.
  const refresh = async (rewritten?: string[]) => {
    if (rewritten) await rescanned;
    return refreshIndex(card, undefined, () => {});
  };
  const { result } = renderHook(() => useOperations(card, refresh, () => {}));
  return { root, card, result, finishRescan };
}

// The card goes away on the nth file moved from now on.
function failMove(card: Card, n: number) {
  const moveFile = card.moveFile.bind(card);
  let moved = 0;
  return vi.spyOn(card, "moveFile").mockImplementation(async (from, to) => {
    if (++moved === n) throw new Error("The card went away");
    return moveFile(from, to);
  });
}

const kit = { "SAMPLES/Kit/Kick.wav": "", "SAMPLES/Kit/Snare.wav": "", "SAMPLES/Kit/Hat.wav": "" };

afterEach(cleanup);

describe("useOperations", () => {
  it("stays busy until the index has caught up after a run", async () => {
    const { card, result, finishRescan } = setup();

    let performed!: Promise<unknown>;
    act(() => {
      performed = result.current.perform("Made One", (context) => planNewFolder(context, "SONGS/One"));
    });
    await waitFor(() => expect(result.current.status?.state).toBe("done"));
    expect(await card.kind("SONGS/One")).toBe("folder");
    expect(result.current.busy).toBe(true);
    expect(result.current.undoable).toBeUndefined();

    await act(async () => {
      finishRescan();
      await performed;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.undoable).toBe("Made One");
  });

  it("starts nothing else while the index catches up", async () => {
    const { card, result, finishRescan } = setup();

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.perform("Made One", (context) => planNewFolder(context, "SONGS/One"));
    });
    await waitFor(() => expect(result.current.status?.state).toBe("done"));

    const makePlan = vi.fn((context) => planNewFolder(context, "SONGS/Two"));
    await act(async () => {
      expect(await result.current.perform("Made Two", makePlan)).toBeUndefined();
    });
    expect(makePlan).not.toHaveBeenCalled();
    expect(await card.kind("SONGS/Two")).toBeUndefined();

    await act(async () => {
      finishRescan();
      await first;
    });
    expect(result.current.undoable).toBe("Made One");
  });

  it("asks before the page unloads while busy", async () => {
    const { result, finishRescan } = setup();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);

    let performed!: Promise<unknown>;
    act(() => {
      performed = result.current.perform("Made One", (context) => planNewFolder(context, "SONGS/One"));
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(unload()).toBe(true);

    await act(async () => {
      finishRescan();
      await performed;
    });
    expect(unload()).toBe(false);
  });

  it("undoes what a run did before it stopped", async () => {
    const { root, card, result, finishRescan } = setup(kit);
    finishRescan();
    const before = snapshot(root);

    failMove(card, 2);
    await act(async () => {
      const done = await result.current.perform("Renamed Kit to Drums", (context) =>
        planMoves(context, [{ from: "SAMPLES/Kit", to: "SAMPLES/Drums" }]),
      );
      expect(done).toBeUndefined();
    });
    expect(result.current.status).toEqual({ state: "failed", message: "Stopped: The card went away" });
    expect(result.current.undoable).toBe("Renamed Kit to Drums (stopped partway)");
    expect(snapshot(root)).not.toEqual(before);

    vi.restoreAllMocks();
    await act(() => result.current.undo());
    expect(snapshot(root)).toEqual(before);
    expect(result.current.undoable).toBeUndefined();
  });

  it("keeps what an undo didn't get to, to undo again", async () => {
    const { root, card, result, finishRescan } = setup(kit);
    finishRescan();
    const before = snapshot(root);
    await act(() =>
      result.current.perform("Renamed Kit to Drums", (context) =>
        planMoves(context, [{ from: "SAMPLES/Kit", to: "SAMPLES/Drums" }]),
      ),
    );

    failMove(card, 2);
    await act(() => result.current.undo());
    expect(result.current.status?.state).toBe("failed");
    expect(result.current.undoable).toBe("Renamed Kit to Drums (partly undone)");

    // Stopping again doesn't say so twice.
    vi.restoreAllMocks();
    failMove(card, 2);
    await act(() => result.current.undo());
    expect(result.current.undoable).toBe("Renamed Kit to Drums (partly undone)");

    vi.restoreAllMocks();
    await act(() => result.current.undo());
    expect(snapshot(root)).toEqual(before);
    expect(result.current.undoable).toBeUndefined();
  });

  it("undoes only the latest change each time", async () => {
    const { root, result, finishRescan } = setup(kit);
    finishRescan();
    const before = snapshot(root);
    await act(() => result.current.perform("Made One", (context) => planNewFolder(context, "SAMPLES/One")));
    const made = snapshot(root);
    await act(() =>
      result.current.perform("Renamed Kit to Drums", (context) =>
        planMoves(context, [{ from: "SAMPLES/Kit", to: "SAMPLES/Drums" }]),
      ),
    );

    await act(() => result.current.undo());
    expect(snapshot(root)).toEqual(made);
    expect(result.current.undoable).toBe("Made One");
    await act(() => result.current.undo());
    expect(snapshot(root)).toEqual(before);
  });
});
