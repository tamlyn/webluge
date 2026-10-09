// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CardView } from "./App";
import { Card } from "./card/card";
import { type MemoryFiles, memoryFolder } from "./card/memoryFolder";

// Songs and samples load in the firmware's worker, which jsdom can't run, and these tests are about the browser.
vi.mock("./ui/Details", () => ({ Details: () => null }));

beforeAll(() => {
  // jsdom lays nothing out, so it can't scroll, nor open dialogs modally.
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
});

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "#");
});

function show(files: MemoryFiles, hash: string) {
  history.replaceState(null, "", hash);
  render(<CardView card={new Card(memoryFolder(files) as unknown as FileSystemDirectoryHandle)} onClose={() => {}} />);
  return within(screen.getByRole("region", { name: "Card" }));
}

// The change is over once Undo offers to undo it.
const finished = () => screen.findByRole("button", { name: "Undo" });

function rename(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: name } });
  fireEvent.click(dialog.getByRole("button", { name: "Rename" }));
}

async function moveTo(folder: string) {
  fireEvent.click(screen.getByRole("button", { name: "Move to…" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.click(await dialog.findByRole("button", { name: folder }));
  fireEvent.click(dialog.getByRole("button", { name: "Move here" }));
}

const row = async (browser: ReturnType<typeof show>, name: string) => (await browser.findByText(name)).closest("li")!;

describe("the selection following what moved", () => {
  it("follows a renamed song", async () => {
    show({ "SONGS/A.XML": "<song/>" }, "#/SONGS/A.XML");
    rename("B.XML");
    await finished();
    expect(location.hash).toBe("#/SONGS/B.XML");
  });

  it("follows a moved folder", async () => {
    show({ "SAMPLES/Kit/Kick.wav": "", "SAMPLES/Drums/Snare.wav": "" }, "#/SAMPLES/Kit/");
    await moveTo("Drums");
    await finished();
    expect(location.hash).toBe("#/SAMPLES/Drums/Kit/");
  });

  it("keeps everything chosen chosen where it went", async () => {
    const browser = show(
      { "SONGS/A.XML": "<song/>", "SONGS/B.XML": "<song/>", "SONGS/Old/C.XML": "<song/>" },
      "#/SONGS/A.XML",
    );
    fireEvent.click(await row(browser, "B.XML"), { metaKey: true });
    await moveTo("Old");
    await finished();

    expect(location.hash).toBe("#/SONGS/Old/B.XML");
    expect(await row(browser, "A.XML")).toHaveProperty("className", expect.stringContaining("chosen"));
    expect(await row(browser, "B.XML")).toHaveProperty("className", expect.stringContaining("selected"));
    expect(await row(browser, "C.XML")).toHaveProperty("className", expect.not.stringMatching(/chosen|selected/));
  });

  it("stays in the folder of what was deleted", async () => {
    show({ "SONGS/Sub/A.XML": "<song/>" }, "#/SONGS/Sub/A.XML");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await finished();
    expect(location.hash).toBe("#/SONGS/Sub/");
  });

  it("goes back with an undo", async () => {
    show({ "SONGS/A.XML": "<song/>" }, "#/SONGS/A.XML");
    rename("B.XML");
    const undo = await finished();
    expect(location.hash).toBe("#/SONGS/B.XML");
    fireEvent.click(undo);
    await waitFor(() => expect(location.hash).toBe("#/SONGS/A.XML"));
  });
});
