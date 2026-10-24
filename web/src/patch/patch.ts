// A synth patch's settings and patch cables, read from its XML, and edits written back into it. Unlike the card's own
// rewrites (card/references.ts), this parses and reserializes the whole document, so it's only ever handed to the
// firmware, never saved.

import { type CableKey, cableKey, type Context, initCables, type Setting, settings } from "./settings";

export type Values = {
  settings: Record<string, number | string>;
  // The amount of each patch cable, by source and destination.
  cables: Record<CableKey, number>;
  // The cable whose amount a "range" cable scales.
  adjustable?: CableKey;
};

// A setting's value, or a cable's amount, by its key; null removes a cable.
export type Edits = Record<string, number | string | null>;

export const cableEdit = (key: CableKey) => `cable:${key}`;

// A new synth, as the device makes one.
export const newSynth: Values = {
  settings: Object.fromEntries(settings.map((s) => [s.id, s.init])),
  cables: initCables,
};

export function readPatch(xml: string): Values {
  const { file, sound } = parse(xml);
  const values = Object.fromEntries(
    settings.map((s) => {
      const saved = read(sound, s.path);
      if (saved === undefined) return [s.id, s.init];
      if (s.kind === "choice") return [s.id, s.aliases?.[saved] ?? saved];
      if (s.kind === "knob") return [s.id, Number(saved) | 0];
      return [s.id, s.saved ? s.saved.read(Number(saved)) : Number(saved)];
    }),
  );
  const cables: Record<CableKey, number> = {};
  let adjustable: CableKey | undefined;
  for (const cable of patchCables(sound)) {
    const key = cableKey(read(cable, ["source"])!, read(cable, ["destination"])!);
    cables[key] = Number(read(cable, ["amount"])) | 0;
    if (read(cable, ["rangeAdjustable"]) === "1") adjustable = key;
  }
  // As Sound::possiblySetupDefaultExpressionPatching does for patches saved before firmware 4.
  const version = read(sound, ["firmwareVersion"]) ?? read(file, ["firmwareVersion"]);
  if (!isFirmware4(version) && !Object.keys(cables).some(isExpressionCable)) {
    for (const key of Object.keys(initCables) as CableKey[]) if (isExpressionCable(key)) cables[key] = initCables[key];
  }
  return { settings: values, cables, adjustable };
}

export function withEdits(values: Values, edits: Edits): Values {
  const result: Values = { ...values, settings: { ...values.settings }, cables: { ...values.cables } };
  for (const [key, value] of Object.entries(edits)) {
    if (key.startsWith("cable:")) {
      const cable = key.slice("cable:".length) as CableKey;
      if (value === null) delete result.cables[cable];
      else result.cables[cable] = value as number;
    } else {
      result.settings[key] = value!;
    }
  }
  return result;
}

export function context(values: Values): Context {
  const cables = Object.keys(values.cables);
  return {
    value: (id) => values.settings[id],
    patchedFrom: (source) => cables.some((key) => key.startsWith(`${source}>`)),
    patchedTo: (destination) => cables.some((key) => key.endsWith(`>${destination}`)),
  };
}

// Whether two values of a setting or cable look the same in the device's own numbers.
export function same(setting: Setting | "cable", a: number | string | undefined, b: number | string | undefined) {
  if (a === undefined || b === undefined) return a === b;
  if (setting === "cable") return Math.round((a as number) / 21474836) === Math.round((b as number) / 21474836);
  if (setting.kind !== "knob") return a === b;
  return setting.scale.toUser(a as number) === setting.scale.toUser(b as number);
}

export function applyEdits(xml: string, edits: Edits): string {
  const { file, sound, declaration } = parse(xml);
  for (const [key, value] of Object.entries(edits)) {
    if (key.startsWith("cable:")) {
      const [source, destination] = key.slice("cable:".length).split(">");
      writeCable(sound, source, destination, value as number | null);
    } else {
      const setting = settings.find((s) => s.id === key)!;
      write(sound, setting.path, savedText(setting, value!));
    }
  }
  const serializer = new XMLSerializer();
  return declaration + [...file.childNodes].map((node) => serializer.serializeToString(node)).join("");
}

// Firmware before 3 saved its version as elements beside <sound>, so a patch can have more than one root element.
// It's parsed inside one of its own, which is left out when it's written again.
function parse(xml: string) {
  const declaration = /^\s*<\?xml[^>]*\?>/.exec(xml)?.[0] ?? "";
  const doc = new DOMParser().parseFromString(`<file>${xml.slice(declaration.length)}</file>`, "text/xml");
  const file = doc.documentElement;
  const sound = file.tagName === "file" && child(file, "sound");
  if (!sound) throw new Error("Not a readable patch");
  return { file, sound, declaration };
}

function child(element: Element, name: string): Element | undefined {
  return [...element.children].find((c) => c.tagName === name);
}

// The firmware reads each value from an attribute or a child element, whichever the patch was saved with.
function read(element: Element, path: string[]): string | undefined {
  const [name, ...rest] = path;
  if (rest.length) {
    const next = child(element, name);
    return next && read(next, rest);
  }
  return element.getAttribute(name) ?? child(element, name)?.textContent?.trim();
}

function write(element: Element, path: string[], value: string) {
  const [name, ...rest] = path;
  const doc = element.ownerDocument;
  if (rest.length) {
    let next = child(element, name);
    if (!next) next = element.appendChild(doc.createElement(name));
    return write(next, rest, value);
  }
  const existing = child(element, name);
  if (existing) existing.textContent = value;
  else if (element.hasAttribute(name) || element.attributes.length) element.setAttribute(name, value);
  else element.appendChild(doc.createElement(name)).textContent = value;
}

function patchCables(sound: Element): Element[] {
  const list = child(child(sound, "defaultParams") ?? sound, "patchCables");
  return list ? [...list.children].filter((c) => c.tagName === "patchCable") : [];
}

function writeCable(sound: Element, source: string, destination: string, amount: number | null) {
  const existing = patchCables(sound).find(
    (c) => read(c, ["source"]) === source && read(c, ["destination"]) === destination,
  );
  if (amount === null) return existing?.remove();
  if (existing) return write(existing, ["amount"], hex(amount));
  const doc = sound.ownerDocument;
  const params = child(sound, "defaultParams") ?? sound.appendChild(doc.createElement("defaultParams"));
  const list = child(params, "patchCables") ?? params.appendChild(doc.createElement("patchCables"));
  const cable = list.appendChild(doc.createElement("patchCable"));
  cable.setAttribute("source", source);
  cable.setAttribute("destination", destination);
  cable.setAttribute("amount", hex(amount));
}

function savedText(setting: Setting, value: number | string): string {
  if (setting.kind === "knob") return hex(value as number);
  if (setting.kind === "count" && setting.saved) return String(setting.saved.write(value as number));
  return String(value);
}

function hex(value: number): string {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function isExpressionCable(key: string): boolean {
  return /^(aftertouch|x|y)>/.test(key);
}

// Community firmware's versions start with "c", and all count as later than 4.
function isFirmware4(version: string | undefined): boolean {
  return !!version && (version.startsWith("c") || Number(version.split(".")[0]) >= 4);
}
