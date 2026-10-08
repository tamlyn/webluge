import { useRef, useState } from "react";
import type { Card } from "../card/card";
import { type Context, inverse, type Plan, remaining } from "../card/plan";
import { run, RunStopped } from "../card/run";
import type { UsageIndex } from "../card/usageIndex";
import { documentsSummary } from "./words";

// Each change to the card goes the same way (PLAN.md, Phase 8): the index catches up with the card, the change is
// planned from it, confirmed if need be, run, and the index catches up again. What it did is kept, newest last, so it
// can be undone.

// One that fades goes once it's been seen, as there's nothing left to do about it.
export type Status = { state: "planning" | "running" | "done" | "failed"; message: string; fades?: boolean };

type Done = { message: string; undo: Plan };

// Whether to go ahead with a plan, asking the user if it does more than they chose.
export type Confirm = (plan: Plan) => Promise<boolean>;

export type Operations = {
  status?: Status;
  // Planning or running: nothing else can start.
  busy: boolean;
  // Changing the card: nothing should read it.
  running: boolean;
  canUndo: boolean;
  // The plan, once it has run.
  perform: (message: string, makePlan: (context: Context) => Promise<Plan>, confirm?: Confirm) => Promise<Plan | undefined>;
  undo: () => Promise<void>;
};

// After each run, with what it did, so the app can follow what moved.
export function useOperations(
  card: Card,
  refresh: (rewritten?: string[]) => Promise<UsageIndex>,
  onRun: (done: Plan) => void,
): Operations {
  const [status, setStatus] = useState<Status>();
  const [history, setHistory] = useState<Done[]>([]);
  const busy = status?.state === "planning" || status?.state === "running";
  // Set at once, unlike the status, so a double click can't start two.
  const started = useRef(false);

  async function exclusively<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (started.current) return;
    started.current = true;
    try {
      return await action();
    } finally {
      started.current = false;
    }
  }

  // What it changed on the card, if anything, and whether it finished.
  async function go(
    message: string,
    makePlan: (context: Context) => Promise<Plan>,
    confirm?: Confirm,
  ): Promise<{ done: Plan; finished: boolean } | undefined> {
    // First, while the click that started it still lets the browser ask.
    if (!(await card.writable())) {
      setStatus({ state: "failed", message: "Webluge needs permission to change the card" });
      return;
    }
    setStatus({ state: "planning", message: `${message}…` });
    let plan: Plan;
    try {
      plan = await makePlan({ card, index: await refresh() });
    } catch (error) {
      setStatus({ state: "failed", message: errorMessage(error) });
      return;
    }
    if (isEmpty(plan)) {
      setStatus({ state: "done", message: "Nothing to change" });
      return;
    }
    if (confirm) {
      // Nothing's happening while the user decides.
      setStatus(undefined);
      if (!(await confirm(plan))) return;
    }
    setStatus({ state: "running", message: `${message}…` });
    try {
      await run(card, plan);
      const updated = documentsSummary(plan.rewrites.map((rewrite) => rewrite.path));
      setStatus({ state: "done", message: [message, updated && `updated ${updated}`].filter(Boolean).join(" · ") });
      onRun(plan);
      return { done: plan, finished: true };
    } catch (error) {
      setStatus({ state: "failed", message: `Stopped: ${errorMessage(error)}` });
      // Anything else comes from checking the card before the run, which changes nothing.
      if (!(error instanceof RunStopped) || isEmpty(error.done)) return;
      onRun(error.done);
      return { done: error.done, finished: false };
    } finally {
      // By their paths before the moves: a document that moved is new to the index anyway. If it fails, that shows,
      // and what ran still counts: the next change refreshes again before it plans.
      await refresh(plan.rewrites.map((rewrite) => rewrite.path)).catch(() => {});
    }
  }

  return {
    status,
    busy,
    running: status?.state === "running",
    canUndo: !busy && history.length > 0,
    perform: (message, makePlan, confirm) =>
      exclusively(async () => {
        const ran = await go(message, makePlan, confirm);
        if (!ran) return;
        const done = { message: ran.finished ? message : `${message} (stopped partway)`, undo: inverse(ran.done) };
        setHistory((history) => [...history, done]);
        return ran.finished ? ran.done : undefined;
      }),
    // Whatever it doesn't get to stays, to undo once whatever stopped it is sorted out.
    undo: async () => {
      await exclusively(async () => {
        const last = history.at(-1);
        if (!last) return;
        const ran = await go(`Undone: ${last.message}`, async () => last.undo);
        if (!ran) return;
        const rest = { message: partlyUndone(last.message), undo: remaining(last.undo, ran.done) };
        setHistory((history) => [...history.slice(0, -1), ...(ran.finished ? [] : [rest])]);
        if (ran.finished) setStatus((status) => status && { ...status, fades: true });
      });
    },
  };
}

function isEmpty(plan: Plan): boolean {
  return !plan.rewrites.length && !plan.newFolders.length && !plan.moves.length && !plan.oldFolders.length;
}

function partlyUndone(message: string): string {
  const suffix = " (partly undone)";
  return message.endsWith(suffix) ? message : `${message}${suffix}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
