// Runs a plan (plan.ts) on the card. It checks the whole plan against the card before changing anything, then checks
// each step again just before taking it, and stops at the first that doesn't hold, so it never overwrites or deletes
// anything: a rewrite needs the text the plan read, a move needs its destination free, and a folder is only removed
// once empty.

import { type Card, parentPath } from "./card";
import { encodeCp437 } from "./cp437";
import { emptyPlan, type Plan } from "./plan";
import { pathKey } from "./references";
import { readDocument } from "./usageIndex";

// What the run did before it stopped, which can be undone like any plan.
export class RunStopped extends Error {
  constructor(
    message: string,
    readonly done: Plan,
  ) {
    super(message);
  }
}

export async function run(card: Card, plan: Plan): Promise<void> {
  const done = emptyPlan();
  const step = async (action: () => Promise<void>, check?: () => Promise<string | undefined>) => {
    const problem = await check?.();
    if (problem) throw new RunStopped(problem, done);
    try {
      await action();
    } catch (error) {
      throw new RunStopped(error instanceof Error ? error.message : String(error), done);
    }
  };

  // Asked for here, as close as possible to the click that started the run, which the browser needs to ask.
  if (!(await card.writable())) throw new RunStopped("Webluge needs permission to change the card", done);
  const problem = await check(card, plan);
  if (problem) throw new RunStopped(problem, done);

  for (const rewrite of plan.rewrites) {
    await step(
      () => card.writeFile(rewrite.path, encodeCp437(rewrite.after)),
      () => unchanged(card, rewrite.path, rewrite.before),
    );
    done.rewrites.push(rewrite);
  }
  for (const folder of plan.newFolders) {
    await step(
      () => card.makeFolder(folder),
      () => absent(card, folder),
    );
    done.newFolders.push(folder);
  }
  for (const move of plan.moves) {
    await step(
      () => card.moveFile(move.from, move.to),
      async () => ((await card.kind(move.from)) !== "file" ? `${move.from} isn't on the card` : absent(card, move.to)),
    );
    done.moves.push(move);
  }
  for (const folder of plan.oldFolders) {
    // The card refuses to remove a folder that isn't empty, so it needs no check of its own.
    await step(() => card.removeFolder(folder));
    done.oldFolders.push(folder);
  }
}

// Everything that has to hold before the run starts, so that a card changed since planning stops it before it does
// anything. Steps that depend on earlier ones are checked against what those will have done.
async function check(card: Card, plan: Plan): Promise<string | undefined> {
  for (const { path, before } of plan.rewrites) {
    const problem = await unchanged(card, path, before);
    if (problem) return problem;
  }
  const making = new Set(plan.newFolders.map(pathKey));
  const folderReady = async (path: string) => making.has(pathKey(path)) || (await card.kind(path)) === "folder";
  for (const folder of plan.newFolders) {
    const problem = (await absent(card, folder)) ?? (await parentReady(folder));
    if (problem) return problem;
  }
  for (const { from, to } of plan.moves) {
    if ((await card.kind(from)) !== "file") return `${from} isn't on the card`;
    const problem = (await absent(card, to)) ?? (await parentReady(to));
    if (problem) return problem;
  }
  const leaving = new Set([...plan.moves.map((move) => move.from), ...plan.oldFolders].map(pathKey));
  for (const folder of plan.oldFolders) {
    if ((await card.kind(folder)) !== "folder") return `${folder} isn't on the card`;
    for (const entry of await card.list(folder, { hidden: true })) {
      if (!leaving.has(pathKey(entry.path))) return `${entry.path} has appeared since`;
    }
  }

  async function parentReady(path: string) {
    return (await folderReady(parentPath(path))) ? undefined : `${parentPath(path)} isn't on the card`;
  }
}

async function unchanged(card: Card, path: string, text: string): Promise<string | undefined> {
  const current = await readDocument(card, path);
  if (current === undefined) return `${path} isn't on the card`;
  return current === text ? undefined : `${path} has changed since`;
}

async function absent(card: Card, path: string): Promise<string | undefined> {
  return (await card.kind(path)) ? `${path} is already on the card` : undefined;
}
