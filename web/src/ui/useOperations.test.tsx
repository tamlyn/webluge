// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Card } from "../card/card";
import { memoryFolder } from "../card/memoryFolder";
import { planNewFolder } from "../card/plan";
import { refreshIndex } from "../card/usageIndex";
import { useOperations } from "./useOperations";

// A card whose index catches up after a run only when the test lets it, as a slow rescan would.
function setup() {
  const card = new Card(memoryFolder({ "SONGS/Song.XML": "<song/>" }) as unknown as FileSystemDirectoryHandle);
  let finishRescan = () => {};
  const rescanned = new Promise<void>((resolve) => (finishRescan = resolve));
  // Only the refresh after a run is told what was rewritten.
  const refresh = async (rewritten?: string[]) => {
    if (rewritten) await rescanned;
    return refreshIndex(card, undefined, () => {});
  };
  const { result } = renderHook(() => useOperations(card, refresh, () => {}));
  return { card, result, finishRescan };
}

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
});
