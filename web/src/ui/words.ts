export function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-GB")} ${noun}${count === 1 ? "" : "s"}`;
}

// "song", "kit" or "synth".
export function documentKind(path: string): string {
  return path.split("/")[0].toLowerCase().replace(/s$/, "");
}

// How many of each kind there are: "3 songs, 1 kit".
export function documentsSummary(paths: string[]): string {
  const kinds = ["song", "kit", "synth"];
  return kinds
    .map((kind) => [kind, paths.filter((path) => documentKind(path) === kind).length] as const)
    .filter(([, count]) => count)
    .map(([kind, count]) => plural(count, kind))
    .join(", ");
}
