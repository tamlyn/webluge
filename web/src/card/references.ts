// Finds the audio files a song, kit or synth XML refers to. Older firmware writes them as elements and newer as
// attributes: <fileName>SAMPLES/…</fileName>, fileName="SAMPLES/…", and filePath="SAMPLES/…" for audio clips.

export type SampleReference = {
  path: string;
  // Where the path sits in the text, so it can be rewritten in place.
  start: number;
  end: number;
};

const pattern = /\b(fileName|filePath)(?:="([^"]*)"|>([^<]*)<\/\1>)/g;

export function findSampleReferences(xml: string): SampleReference[] {
  const references: SampleReference[] = [];
  for (const match of xml.matchAll(pattern)) {
    const path = match[2] ?? match[3];
    if (!path.trim()) continue;
    const start = match.index + match[1].length + (match[2] === undefined ? 1 : 2);
    references.push({ path, start, end: start + path.length });
  }
  return references;
}

// A text value and where it sits in the XML.
export type Span = { value: string; start: number; end: number };

// A song's link from an instrument, or one of its clips, to the kit or synth preset it came from: presetName and
// presetFolder on the instrument, instrumentPresetName and instrumentPresetFolder on each clip. The firmware matches
// clips to their instrument by these, ignoring case (Song::getInstrumentFromPresetSlot), so a song whose instrument
// and clips disagree won't load.
export type PresetLink = {
  name: Span;
  // Missing from songs saved before firmware 4.0.
  folder?: Span;
  // Where an instrument's preset is when it has no folder. A clip's depends on its instrument's kind, so it has none.
  defaultFolder?: "KITS" | "SYNTHS";
};

// An opening tag and its attributes. Attribute values never contain quotes: the firmware writes none, unescaped.
const tagPattern = /<([A-Za-z]\w*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*\/?>/g;
const attributePattern = /([\w:.-]+)(\s*=\s*")([^"]*)"/g;

export function findPresetLinks(xml: string): PresetLink[] {
  const links: PresetLink[] = [];
  for (const tag of xml.matchAll(tagPattern)) {
    const attributes = new Map<string, Span>();
    const offset = tag.index + 1 + tag[1].length;
    for (const attribute of tag[2].matchAll(attributePattern)) {
      const start = offset + attribute.index + attribute[1].length + attribute[2].length;
      attributes.set(attribute[1], { value: attribute[3], start, end: start + attribute[3].length });
    }
    const instrument = attributes.get("presetName");
    if (instrument && (tag[1] === "sound" || tag[1] === "kit")) {
      const defaultFolder = tag[1] === "kit" ? "KITS" : "SYNTHS";
      links.push({ name: instrument, folder: attributes.get("presetFolder"), defaultFolder });
    }
    const clip = attributes.get("instrumentPresetName");
    if (clip) links.push({ name: clip, folder: attributes.get("instrumentPresetFolder") });
  }
  return links;
}

// The preset file a link refers to, if it says.
export function presetPath(link: PresetLink): string | undefined {
  const folder = link.folder?.value ?? link.defaultFolder;
  return folder && `${folder}/${link.name.value}.XML`;
}

// FAT names are case-insensitive, and so are the firmware's lookups.
export function pathKey(path: string): string {
  return path.toLowerCase();
}

// Where the firmware looks for a sample it can't find at its path: a folder named after the song, beside it, holding
// samples with the folders after SAMPLES/ flattened into the name (AudioFileManager::setupAlternateAudioFilePath).
export function alternatePath(songPath: string, samplePath: string): string | undefined {
  if (!samplePath.toUpperCase().startsWith("SAMPLES/")) return undefined;
  const songFolder = songPath.replace(/\.xml$/i, "");
  return `${songFolder}/${samplePath.slice("SAMPLES/".length).replaceAll("/", "_")}`;
}
