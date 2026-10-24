// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import richSawBass from "../preview/fixtures/SYNTHS/Rich Saw Bass.XML?raw";
import { applyEdits, cableEdit, newSynth, readPatch, same } from "./patch";
import { cableKey, settings } from "./settings";

const attributes = `<?xml version="1.0" encoding="UTF-8"?>
<sound firmwareVersion="4.1.4-alpha" polyphonic="mono" mode="subtractive" lpfMode="12dB">
  <osc1 type="square" transpose="0" cents="0" retrigPhase="-1" />
  <defaultParams lpfFrequency="0x04000000" volume="0x50000000">
    <envelope1 attack="0x7FFFFFFF" decay="0xE6666654" sustain="0x7FFFFFFF" release="0x851EB851" />
    <patchCables>
      <patchCable source="velocity" destination="volume" amount="0x3FFFFFE8" />
    </patchCables>
  </defaultParams>
  <compressor attack="327244" release="936" />
</sound>`;

function changes(xml: string) {
  const patch = readPatch(xml);
  return settings.filter((s) => !same(s, patch.settings[s.id], newSynth.settings[s.id])).map((s) => s.id);
}

describe("readPatch", () => {
  it("compares Rich Saw Bass, the synth a song gets without a card, with a new synth", () => {
    // Sound::setupAsDefaultSynth against Sound::setupAsBlankSynth, and the older firmware Rich Saw Bass was saved with,
    // which started LFOs on a sine and the delay analog.
    expect(changes(richSawBass)).toEqual([
      "osc1.type",
      "osc2.transpose",
      "oscBVolume",
      "unison.num",
      "unison.detune",
      "lpfFrequency",
      "lpfResonance",
      "env1.release",
      "env2.attack",
      "env2.decay",
      "lfo1.type",
      "lfo2.type",
      "delay.analog",
      "volume",
      "transpose",
    ]);
    // It was saved before the firmware added expression cables, so they're added as it loads.
    expect(readPatch(richSawBass).cables).toEqual({
      ...newSynth.cables,
      [cableKey("note", "lpfFrequency")]: 0x08f5c28c,
      [cableKey("envelope2", "lpfFrequency")]: 0x1c28f5b8,
      [cableKey("velocity", "lpfFrequency")]: 0x0f5c28f0,
    });
  });

  it("reads settings saved as attributes, by their place in the document", () => {
    const patch = readPatch(attributes);
    expect(changes(attributes)).toEqual([
      "lpfMode",
      "lpfFrequency",
      "env1.attack",
      "env1.release",
      "volume",
      "polyphonic",
    ]);
    expect(patch.settings["env1.attack"]).toBe(0x7fffffff);
    // Saved by firmware 4, which no longer adds expression cables to patches without them.
    expect(patch.cables).toEqual({ [cableKey("velocity", "volume")]: 0x3fffffe8 });
  });

  it("reads patches saved by older firmware, with more than one root element", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<firmwareVersion>2.0.0-beta</firmwareVersion>
<earliestCompatibleFirmware>2.0.0-beta</earliestCompatibleFirmware>
<sound><osc1><type>sine</type></osc1></sound>`;
    expect(readPatch(xml).settings["osc1.type"]).toBe("sine");
    // Saved before firmware 4, so it gets the expression cables.
    expect(Object.keys(readPatch(xml).cables)).toEqual([
      cableKey("aftertouch", "volume"),
      cableKey("y", "lpfFrequency"),
    ]);
    const edited = applyEdits(xml, { "osc1.type": "saw" });
    expect(edited).toMatch(/^<\?xml[^>]*\?>\n<firmwareVersion>2\.0\.0-beta<\/firmwareVersion>\n<earliest/);
    expect(readPatch(edited).settings["osc1.type"]).toBe("saw");
  });
});

describe("applyEdits", () => {
  it("writes settings and cables in either form", () => {
    for (const xml of [richSawBass, attributes]) {
      const edited = readPatch(
        applyEdits(xml, {
          lpfResonance: 0x7fffffff,
          "osc2.type": "sine",
          [cableEdit(cableKey("velocity", "volume"))]: null,
          [cableEdit(cableKey("lfo1", "pitch"))]: 0x10000000,
        }),
      );
      expect(edited.settings.lpfResonance).toBe(0x7fffffff);
      expect(edited.settings["osc2.type"]).toBe("sine");
      expect(edited.cables[cableKey("velocity", "volume")]).toBeUndefined();
      expect(edited.cables[cableKey("lfo1", "pitch")]).toBe(0x10000000);
    }
  });

  it("saves a retrigger phase in the firmware's steps of a degree", () => {
    const xml = applyEdits(attributes, { "osc1.retrigPhase": 90 });
    expect(xml).toContain('retrigPhase="1073741760"');
    expect(readPatch(xml).settings["osc1.retrigPhase"]).toBe(90);
    expect(readPatch(applyEdits(attributes, { "osc1.retrigPhase": 270 })).settings["osc1.retrigPhase"]).toBe(270);
    expect(applyEdits(xml, { "osc1.retrigPhase": -1 })).toContain('retrigPhase="-1"');
  });

  it("leaves a compressor's attack alone when editing an envelope's", () => {
    const edited = applyEdits(attributes, { "env1.attack": 0 });
    expect(edited).toContain('<compressor attack="327244"');
    expect(readPatch(edited).settings["env1.attack"]).toBe(0);
  });
});
