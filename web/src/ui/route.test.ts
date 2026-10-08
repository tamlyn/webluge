import { describe, expect, it } from "vitest";
import { hashOf, routeOf } from "./route";

describe("route", () => {
  const cases = [
    { hash: "#/", selection: { path: "", folder: true } },
    { hash: "#/SAMPLES/DRUMS/", selection: { path: "SAMPLES/DRUMS", folder: true } },
    { hash: "#/SONGS/Song%20001.XML", selection: { path: "SONGS/Song 001.XML", folder: false } },
    { hash: "#/SAMPLES/50%25%20%23%3F.wav", selection: { path: "SAMPLES/50% #?.wav", folder: false } },
  ];

  it.each(cases)("round-trips $hash", ({ hash, selection }) => {
    expect(hashOf(selection)).toBe(hash);
    expect(routeOf(hash)).toEqual(selection);
  });

  it("round-trips the list of missing samples", () => {
    expect(routeOf(hashOf({ view: "missing" }))).toEqual({ view: "missing" });
    expect(routeOf("#/missing")).toEqual({ path: "missing", folder: false });
  });

  it("treats no hash as the card's root", () => {
    expect(routeOf("")).toEqual({ path: "", folder: true });
  });

  it("reads paths typed with unencoded characters", () => {
    expect(routeOf("#/SONGS/Song 001.XML")).toEqual({ path: "SONGS/Song 001.XML", folder: false });
  });

  it("falls back to the root for malformed escapes", () => {
    expect(routeOf("#/SONGS/100%.XML")).toEqual({ path: "", folder: true });
  });
});
