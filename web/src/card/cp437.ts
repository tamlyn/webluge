// The firmware handles file names in code page 437 (ffconf.h), so the paths it writes into song files are in it too.

const upperHalf =
  "\xc7\xfc\xe9\xe2\xe4\xe0\xe5\xe7\xea\xeb\xe8\xef\xee\xec\xc4\xc5\xc9\xe6\xc6\xf4\xf6\xf2\xfb\xf9\xff\xd6\xdc\xa2\xa3\xa5₧ƒ" +
  "\xe1\xed\xf3\xfa\xf1\xd1\xaa\xba\xbf⌐\xac\xbd\xbc\xa1\xab\xbb░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "α\xdfΓπΣσ\xb5τΦΘΩδ∞φε∩≡\xb1≥≤⌠⌡\xf7≈\xb0∙\xb7√ⁿ\xb2■\xa0";

const upperCodes = new Map(Array.from(upperHalf, (c, i) => [c.charCodeAt(0), 0x80 + i]));

function codeOf(c: number): number | undefined {
  return c < 0x80 ? c : upperCodes.get(c);
}

export function isCp437(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (codeOf(text.charCodeAt(i)) === undefined) return false;
  }
  return true;
}

export function encodeCp437(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = codeOf(text.charCodeAt(i));
    if (code === undefined) throw new Error(`${JSON.stringify(text[i])} isn't in code page 437`);
    bytes[i] = code;
  }
  return bytes;
}

export function decodeCp437(bytes: Uint8Array): string {
  let text = "";
  // Chunked, because String.fromCharCode takes its codes as arguments.
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const codes = Array.from(bytes.subarray(i, i + chunk), (b) => (b < 0x80 ? b : upperHalf.charCodeAt(b - 0x80)));
    text += String.fromCharCode(...codes);
  }
  return text;
}
