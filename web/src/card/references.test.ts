import { describe, expect, it } from "vitest";
import { alternatePath, findSampleReferences } from "./references";

describe("findSampleReferences", () => {
  it("finds attributes and elements, with their positions", () => {
    const xml = `<sound>
  <osc1 type="sample" fileName="SAMPLES/DRUMS/Kick/808 Kick.wav" />
  <fileName>SAMPLES/DRUMS/Snare/909 Snare.wav</fileName>
  <audioClip filePath="SAMPLES/Vocals/afraid.wav" />
</sound>`;
    const references = findSampleReferences(xml);
    expect(references.map((r) => r.path)).toEqual([
      "SAMPLES/DRUMS/Kick/808 Kick.wav",
      "SAMPLES/DRUMS/Snare/909 Snare.wav",
      "SAMPLES/Vocals/afraid.wav",
    ]);
    for (const r of references) {
      expect(xml.slice(r.start, r.end)).toBe(r.path);
    }
  });

  it("skips empty references", () => {
    expect(findSampleReferences(`<osc1 fileName="" /><fileName>\r\n</fileName>`)).toEqual([]);
  });
});

describe("alternatePath", () => {
  it("flattens the sample's folders into a folder named after the song", () => {
    expect(alternatePath("SONGS/SONG060.XML", "SAMPLES/DRUMS/Kick/808.wav")).toBe("SONGS/SONG060/DRUMS_Kick_808.wav");
  });
});
