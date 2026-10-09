// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Card } from "../card/card";
import { memoryFolder } from "../card/memoryFolder";
import { Browser, type Selection, type Tools } from "./Browser";
import { samePath } from "./files";

beforeAll(() => {
  // jsdom lays nothing out, so has nothing to scroll.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
});

// Testing Library only cleans up after itself when Vitest's globals are on.
afterEach(cleanup);

const files = {
  "SAMPLES/Drums/Toms/Low.wav": "",
  "SAMPLES/Drums/Clap.wav": "",
  "SAMPLES/Drums/Hat.wav": "",
  "SAMPLES/Drums/Kick.wav": "",
  "SAMPLES/Drums/Snare.wav": "",
  "SONGS/Song.XML": "<song/>",
  "SONGS/song/Bass.wav": "",
  "SONGS/Unsung/Lead.wav": "",
};

// Holds the selection and what's chosen with it as the app does.
function Harness({ card, tools, start }: { card: Card; tools: Tools; start: Selection }) {
  const [selection, setSelection] = useState<Selection>(start);
  const [choice, setChoice] = useState<{ paths: string[]; anchor: string }>();
  const chosen =
    choice && choice.paths.some((path) => samePath(path, selection.path))
      ? choice.paths
      : selection.path
        ? [selection.path]
        : [];
  const anchor = chosen === choice?.paths ? choice.anchor : selection.path;
  return (
    <Browser
      card={card}
      selection={selection}
      chosen={chosen}
      anchor={anchor}
      version={0}
      tools={tools}
      onSelect={(route) => "path" in route && setSelection(route)}
      onChoose={(paths, focus, { anchor } = {}) => {
        setChoice({ paths, anchor: anchor ?? focus.path });
        setSelection({ path: focus.path, folder: focus.kind === "folder" });
      }}
      onDrop={() => {}}
    />
  );
}

// Waits for an entry in the last column to be listed.
async function setup(
  tools: Tools = {},
  start: Selection = { path: "SAMPLES/Drums", folder: true },
  ready = "Kick.wav",
) {
  const card = new Card(memoryFolder(files) as unknown as FileSystemDirectoryHandle);
  render(<Harness card={card} tools={tools} start={start} />);
  await screen.findByText(ready);
}

const row = (name: string) => screen.getByText(name, { selector: ".name" }).closest("li")!;
const column = (name: string) => screen.getByRole("heading", { name }).parentElement!.querySelector("ul")!;
const click = (name: string, keys: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) =>
  fireEvent.click(row(name), keys);
const press = (folder: string, key: string, keys: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) =>
  fireEvent.keyDown(column(folder), { key, ...keys });

function selected(): string | undefined {
  return document.querySelector("li.selected .name")?.textContent ?? undefined;
}

// The selection and everything chosen with it, in the order shown.
function picked(): string[] {
  return [...document.querySelectorAll("li.selected .name, li.chosen .name")].map((name) => name.textContent!);
}

describe("Browser", () => {
  it("selects what's clicked", async () => {
    await setup();
    click("Kick.wav");
    expect(selected()).toBe("Kick.wav");
    expect(picked()).toEqual(["Kick.wav"]);
    click("Hat.wav");
    expect(picked()).toEqual(["Hat.wav"]);
  });

  it("extends from the anchor on Shift-click", async () => {
    await setup();
    click("Clap.wav");
    click("Kick.wav", { shiftKey: true });
    expect(selected()).toBe("Kick.wav");
    expect(picked()).toEqual(["Clap.wav", "Hat.wav", "Kick.wav"]);

    // The anchor stays put, so the range can shrink.
    click("Hat.wav", { shiftKey: true });
    expect(picked()).toEqual(["Clap.wav", "Hat.wav"]);
  });

  it("adds and takes away on Cmd- or Ctrl-click", async () => {
    await setup();
    click("Clap.wav");
    click("Kick.wav", { metaKey: true });
    expect(selected()).toBe("Kick.wav");
    expect(picked()).toEqual(["Clap.wav", "Kick.wav"]);
    click("Snare.wav", { ctrlKey: true });
    expect(picked()).toEqual(["Clap.wav", "Kick.wav", "Snare.wav"]);

    click("Kick.wav", { metaKey: true });
    expect(picked()).toEqual(["Clap.wav", "Snare.wav"]);
    // Taking away the selection moves it to the last one chosen.
    click("Snare.wav", { metaKey: true });
    expect(selected()).toBe("Clap.wav");
    expect(picked()).toEqual(["Clap.wav"]);
  });

  it("selects only what's Cmd-clicked in another folder", async () => {
    await setup();
    click("Clap.wav");
    click("Kick.wav", { metaKey: true });
    click("SONGS", { metaKey: true });
    expect(picked()).toEqual(["SONGS"]);
  });

  it("moves up and down with the arrow keys, and extends with Shift", async () => {
    await setup();
    // From the folder itself, down starts at the top.
    press("Drums", "ArrowDown");
    expect(selected()).toBe("Toms");

    click("Hat.wav");
    press("Drums", "ArrowDown");
    expect(selected()).toBe("Kick.wav");
    press("Drums", "ArrowUp");
    press("Drums", "ArrowUp");
    expect(selected()).toBe("Clap.wav");

    press("Drums", "ArrowDown", { shiftKey: true });
    press("Drums", "ArrowDown", { shiftKey: true });
    expect(picked()).toEqual(["Clap.wav", "Hat.wav", "Kick.wav"]);
    press("Drums", "ArrowDown");
    expect(picked()).toEqual(["Snare.wav"]);
    // It stops at the end.
    press("Drums", "ArrowDown");
    expect(selected()).toBe("Snare.wav");
  });

  it("goes into a folder with ArrowRight or Enter", async () => {
    await setup();
    click("Toms");
    press("Drums", "ArrowRight");
    await waitFor(() => expect(selected()).toBe("Low.wav"));

    click("Toms");
    press("Drums", "Enter");
    await waitFor(() => expect(selected()).toBe("Low.wav"));

    // A file has nothing to go into.
    click("Kick.wav");
    press("Drums", "ArrowRight");
    expect(selected()).toBe("Kick.wav");
  });

  it("goes back out with ArrowLeft or Backspace", async () => {
    await setup();
    click("Kick.wav");
    press("Drums", "ArrowLeft");
    expect(selected()).toBe("Drums");

    click("Kick.wav");
    press("Drums", "Backspace");
    expect(selected()).toBe("Drums");
  });

  it("deletes on Cmd- or Ctrl-Backspace, when it can", async () => {
    const onDelete = vi.fn();
    await setup({ onDelete });
    click("Kick.wav");
    press("Drums", "Backspace", { metaKey: true });
    press("Drums", "Backspace", { ctrlKey: true });
    expect(onDelete).toHaveBeenCalledTimes(2);
    // Rather than going back out.
    expect(selected()).toBe("Kick.wav");

    // Only from the folder holding the selection.
    press("SAMPLES", "Backspace", { metaKey: true });
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it("does nothing on Cmd-Backspace when it can't delete", async () => {
    await setup();
    click("Kick.wav");
    press("Drums", "Backspace", { metaKey: true });
    expect(selected()).toBe("Kick.wav");
  });

  it("lists a song's collected samples just after it", async () => {
    await setup({}, { path: "SONGS", folder: true }, "Song.XML");
    const names = [...column("SONGS").querySelectorAll(".name")].map((name) => name.textContent);
    // Without a song of the same name, a folder is just a folder.
    expect(names).toEqual(["Unsung", "Song.XML", "song"]);
    expect(row("song").className).toContain("companion");
    expect(row("Unsung").className).not.toContain("companion");
  });
});
