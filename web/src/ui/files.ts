import { isDocument } from "../card/usageIndex";

export function isAudio(path: string): boolean {
  return /\.(wav|aiff?)$/i.test(path);
}

export function isSong(path: string): boolean {
  return isDocument(path) && path.toUpperCase().startsWith("SONGS/");
}

export function samePath(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}
