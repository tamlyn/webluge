// Every change to the card is planned first, from the card as it is, so that the same plan can be confirmed, checked
// before it runs, run (run.ts) and undone.

import { type Card, baseName, joinPath, parentPath } from "./card";
import { isCp437 } from "./cp437";
import { alternatePath, findPresetLinks, findSampleReferences, pathKey, type PresetLink, type Span } from "./references";
import { isDocument, readDocument, type UsageIndex } from "./usageIndex";

export type Move = { from: string; to: string };

// A document's whole text before and after, at its path before the moves.
export type Rewrite = { path: string; before: string; after: string };

// Runs in the order of its fields: rewrites, new folders (parents first), file moves, then old folders (children
// first), each removed once the moves have emptied it.
export type Plan = {
  rewrites: Rewrite[];
  newFolders: string[];
  moves: Move[];
  oldFolders: string[];
  // What it does beyond what was chosen, for the user to confirm: the collected-samples folders going with their
  // songs, kits and synths, and the documents that will lose samples going to the trash.
  companions: Move[];
  broken: string[];
};

export class PlanError extends Error {}

export function emptyPlan(): Plan {
  return { rewrites: [], newFolders: [], moves: [], oldFolders: [], companions: [], broken: [] };
}

export function needsConfirmation(plan: Plan): boolean {
  return plan.rewrites.length > 0 || plan.companions.length > 0 || plan.broken.length > 0;
}

export type Context = { card: Card; index: UsageIndex };

export const trash = "TRASH";

// Where the device's browsers look. Anything else on the card stays where it is.
const homes = ["SONGS", "KITS", "SYNTHS", "SAMPLES"];

// The top folder an entry belongs in, whether it's in the trash or not. Undefined for the top folders themselves.
function homeOf(path: string): string | undefined {
  const parts = path.split("/");
  if (parts[0].toUpperCase() === trash) parts.shift();
  const home = parts[0].toUpperCase();
  return parts.length > 1 && homes.includes(home) ? home : undefined;
}

export function inTrash(path: string): boolean {
  return path.toUpperCase().startsWith(`${trash}/`);
}

function same(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

function within(path: string, folder: string): boolean {
  return pathKey(path).startsWith(`${pathKey(folder)}/`);
}

// Names the card and the firmware can both hold.
export function nameProblem(name: string): string | undefined {
  if (!name.trim()) return "Names can't be empty";
  if (/[\x00-\x1f"*/:<>?\\|]/.test(name)) return `Names can't contain any of " * / : < > ? \\ |`;
  if (/[. ]$/.test(name)) return "Names can't end with a dot or a space";
  if (name.length > 255) return "Names can't be longer than 255 characters";
  if (!isCp437(name)) return "The Deluge can't show some of the characters in that name";
}

// A song, kit or synth's collected samples, in a folder named after it beside it.
function companionOf(path: string): string | undefined {
  const home = homeOf(path);
  return /\.xml$/i.test(path) && home && home !== "SAMPLES" ? path.replace(/\.xml$/i, "") : undefined;
}

export async function planNewFolder({ card }: Context, path: string): Promise<Plan> {
  if (!homeOf(path) || inTrash(path)) throw new PlanError("New folders go inside SONGS, KITS, SYNTHS or SAMPLES");
  const problem = nameProblem(baseName(path));
  if (problem) throw new PlanError(problem);
  if ((await card.kind(parentPath(path))) !== "folder") throw new PlanError(`${parentPath(path)} isn't on the card`);
  if (await card.kind(path)) throw new PlanError(`${baseName(path)} is already there`);
  return { ...emptyPlan(), newFolders: [path] };
}

// Moves each to the trash, keeping its path there, numbered if the trash already has one.
export async function planDelete(context: Context, paths: string[]): Promise<Plan> {
  const taken = new Set<string>();
  const free = async (path: string) => !taken.has(pathKey(path)) && !(await context.card.kind(path));
  const chosen: Move[] = [];
  for (const path of paths) {
    if (inTrash(path)) throw new PlanError(`${baseName(path)} is already in the trash`);
    const kind = await context.card.kind(path);
    if (!kind) throw new PlanError(`${baseName(path)} isn't on the card`);
    let to = joinPath(trash, path);
    for (let n = 2; !(await free(to)) || (companionOf(to) && !(await free(companionOf(to)!))); n++) {
      to = joinPath(trash, numbered(path, n, kind === "file"));
    }
    taken.add(pathKey(to));
    if (companionOf(to)) taken.add(pathKey(companionOf(to)!));
    chosen.push({ from: path, to });
  }
  return planMoves(context, chosen);
}

function numbered(path: string, n: number, file: boolean): string {
  const extension = file ? (/\.[^./]*$/.exec(path)?.[0] ?? "") : "";
  return `${path.slice(0, path.length - extension.length)} ${n}${extension}`;
}

// Moves or renames files and folders, each to a new path, and rewrites every song, kit and synth that refers to them.
export async function planMoves({ card, index }: Context, chosen: Move[]): Promise<Plan> {
  const plan = emptyPlan();
  // Anything inside another chosen folder goes with it.
  const entries = chosen.filter(
    (move) => !same(move.from, move.to) && !chosen.some((other) => within(move.from, other.from)),
  );

  for (const { from, to } of entries) {
    const home = homeOf(from);
    if (!home || homeOf(to) !== home) {
      throw new PlanError(home ? `${baseName(from)} can only move within ${home}` : `${from} can't be moved`);
    }
    const problem = nameProblem(baseName(to));
    if (problem) throw new PlanError(problem);
    if (within(to, from)) throw new PlanError(`${baseName(from)} can't go inside itself`);
    if (!(await card.kind(from))) throw new PlanError(`${baseName(from)} isn't on the card`);
  }

  for (const { from, to } of entries) {
    const companion = companionOf(from);
    if (
      companion &&
      (await card.kind(companion)) === "folder" &&
      !entries.some((other) => same(companion, other.from) || within(companion, other.from))
    ) {
      plan.companions.push({ from: companion, to: companionOf(to)! });
    }
  }

  const targets = new Set<string>();
  for (const { to } of [...entries, ...plan.companions]) {
    if (targets.has(pathKey(to))) throw new PlanError(`Two of them would be called ${baseName(to)}`);
    targets.add(pathKey(to));
    if (await card.kind(to)) throw new PlanError(`${baseName(to)} is already in ${parentPath(to)}`);
  }

  const making = new Set<string>();
  const makeFolder = (path: string) => {
    plan.newFolders.push(path);
    making.add(pathKey(path));
  };
  const ensureFolder = async (path: string): Promise<void> => {
    if (making.has(pathKey(path))) return;
    const kind = await card.kind(path);
    if (kind === "file") throw new PlanError(`${path} is a file`);
    if (kind) return;
    await ensureFolder(parentPath(path));
    makeFolder(path);
  };
  const expand = async (from: string, to: string): Promise<void> => {
    makeFolder(to);
    for (const entry of await card.list(from, { hidden: true })) {
      if (entry.kind === "folder") await expand(entry.path, joinPath(to, entry.name));
      else plan.moves.push({ from: entry.path, to: joinPath(to, entry.name) });
    }
    plan.oldFolders.push(from);
  };
  for (const { from, to } of [...entries, ...plan.companions]) {
    await ensureFolder(parentPath(to));
    if ((await card.kind(from)) === "file") plan.moves.push({ from, to });
    else await expand(from, to);
  }

  await planRewrites(card, index, plan);
  return plan;
}

// Rewrites each reference to a file that moves, unless it will still find the file where it is, as a reference to a
// song's collected samples does when the folder goes with it. References that don't find a file already are left
// alone. Nothing is rewritten for moves to and from the trash: a deleted sample goes missing.
async function planRewrites(card: Card, index: UsageIndex, plan: Plan): Promise<void> {
  const movesFrom = new Map(plan.moves.map((move) => [pathKey(move.from), move]));
  const arriving = new Set(plan.moves.map((move) => pathKey(move.to)));
  const known = new Map<string, Promise<boolean>>();
  const existsBefore = (path: string) => {
    if (!known.has(pathKey(path))) known.set(pathKey(path), card.exists(path));
    return known.get(pathKey(path))!;
  };
  const existsAfter = async (path: string) =>
    arriving.has(pathKey(path)) || (!movesFrom.has(pathKey(path)) && (await existsBefore(path)));
  const resolve = async (document: string, sample: string, exists: (path: string) => Promise<boolean>) => {
    if (await exists(sample)) return sample;
    const alternate = alternatePath(document, sample);
    return alternate && (await exists(alternate)) ? alternate : undefined;
  };

  // The documents that might refer to what moves: by its path before or after, as its collected samples, or itself.
  const affected = new Map<string, string>();
  for (const { from, to } of plan.moves) {
    for (const user of [...(index.usersOf.get(pathKey(from)) ?? []), ...(index.usersOf.get(pathKey(to)) ?? [])]) {
      affected.set(pathKey(user), user);
    }
    const owner = index.documents.get(pathKey(`${parentPath(from)}.XML`));
    if (owner) affected.set(pathKey(owner.path), owner.path);
    if (isDocument(from)) affected.set(pathKey(from), from);
  }

  const presetMoves = plan.moves.filter(
    ({ from, to }) => isDocument(from) && !inTrash(to) && /^(KITS|SYNTHS)\//i.test(from),
  );
  const broken = new Set<string>();
  for (const path of affected.values()) {
    const movedTo = movesFrom.get(pathKey(path))?.to ?? path;
    if (inTrash(movedTo)) continue;
    const text = await readDocument(card, path);
    if (text === undefined) continue;

    const edits: Edit[] = [];
    for (const reference of findSampleReferences(text)) {
      const before = await resolve(path, reference.path, existsBefore);
      if (!before) continue;
      const move = movesFrom.get(pathKey(before));
      const after = await resolve(movedTo, reference.path, existsAfter);
      if (move && inTrash(move.to)) {
        // Unless it finds a copy in the document's collected samples instead.
        if (!after) broken.add(path);
        continue;
      }
      const target = move?.to ?? before;
      if (!after || !same(after, target)) edits.push({ ...reference, value: target });
    }
    for (const move of presetMoves) edits.push(...relinkPresets(text, move));
    if (edits.length) plan.rewrites.push({ path, before: text, after: applyEdits(text, edits) });
  }
  plan.broken = [...broken];
}

type Edit = { start: number; end: number; value: string };

function applyEdits(text: string, edits: Edit[]): string {
  let result = text;
  for (const { start, end, value } of [...edits].sort((a, b) => b.start - a.start)) {
    if (!isCp437(value)) throw new PlanError(`The Deluge can't read the path ${value}`);
    result = result.slice(0, start) + value + result.slice(end);
  }
  return result;
}

type Preset = { folder: string; name: string };

function presetOf(path: string): Preset {
  return { folder: parentPath(path), name: baseName(path).replace(/\.xml$/i, "") };
}

// Points a song's instruments that came from a moved kit or synth, and their clips, at its new folder and name. If it
// can't be sure of changing every link that the firmware will match, it changes none: a song still loads with links
// to where a preset used to be, but not with clips parted from their instrument.
function relinkPresets(text: string, move: Move): Edit[] {
  const from = presetOf(move.from);
  const to = presetOf(move.to);
  const links = findPresetLinks(text);
  const named = (link: PresetLink, preset: Preset) => same(link.name.value, preset.name);
  const matching = links.filter((link) => named(link, from) && link.folder && same(link.folder.value, from.folder));
  // Without a folder, a clip could belong to an instrument of either kind.
  if (!matching.length || links.some((link) => named(link, from) && !link.folder)) return [];
  // Clips would match an instrument already called the new name.
  if (links.some((link) => named(link, to) && (!link.folder || same(link.folder.value, to.folder)))) return [];
  const edits: Edit[] = [];
  const edit = (span: Span, value: string) => span.value !== value && edits.push({ ...span, value });
  for (const link of matching) {
    edit(link.name, to.name);
    edit(link.folder!, to.folder);
  }
  return edits;
}

// Puts back what a plan did, including only part of one if its run stopped.
export function inverse(plan: Plan): Plan {
  const movedTo = new Map(plan.moves.map((move) => [pathKey(move.from), move.to]));
  return {
    rewrites: plan.rewrites.map(({ path, before, after }) => ({
      path: movedTo.get(pathKey(path)) ?? path,
      before: after,
      after: before,
    })),
    newFolders: [...plan.oldFolders].reverse(),
    moves: plan.moves.map(({ from, to }) => ({ from: to, to: from })).reverse(),
    oldFolders: [...plan.newFolders].reverse(),
    companions: [],
    broken: [],
  };
}
