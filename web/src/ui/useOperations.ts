import { useRef, useState } from "react";
import type { Card } from "../card/card";
import { type Context, inverse, type Plan } from "../card/plan";
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
export function useOperations(card: Card, refresh: () => Promise<UsageIndex>, onRun: (done: Plan) => void): Operations {
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

  // Whether it changed the card, completely or partly. A run that stops partway is kept so it can be undone.
  async function go(
    message: string,
    makePlan: (context: Context) => Promise<Plan>,
    confirm?: Confirm,
  ): Promise<Plan | "partly" | undefined> {
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
      return plan;
    } catch (error) {
      setStatus({ state: "failed", message: `Stopped: ${errorMessage(error)}` });
      // Anything else comes from checking the card before the run, which changes nothing.
      if (!(error instanceof RunStopped) || isEmpty(error.done)) return;
      onRun(error.done);
      setHistory((history) => [...history, { message: `${message} (stopped partway)`, undo: inverse(error.done) }]);
      return "partly";
    } finally {
      await refresh();
    }
  }

  return {
    status,
    busy,
    running: status?.state === "running",
    canUndo: !busy && history.length > 0,
    perform: (message, makePlan, confirm) =>
      exclusively(async () => {
        const plan = await go(message, makePlan, confirm);
        if (!plan || plan === "partly") return;
        setHistory((history) => [...history, { message, undo: inverse(plan) }]);
        return plan;
      }),
    undo: async () => {
      await exclusively(async () => {
        const last = history.at(-1);
        if (!last) return;
        setHistory((history) => history.slice(0, -1));
        const undone = await go(`Undone: ${last.message}`, async () => last.undo);
        // Still there to undo if nothing changed.
        if (!undone) setHistory((history) => [...history, last]);
        else if (undone !== "partly") setStatus((status) => status && { ...status, fades: true });
      });
    },
  };
}

function isEmpty(plan: Plan): boolean {
  return !plan.rewrites.length && !plan.newFolders.length && !plan.moves.length && !plan.oldFolders.length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
