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
