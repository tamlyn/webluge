import { useRef, useState } from "react";
import type { Card } from "../card/card";
import { type Context, inverse, type Plan } from "../card/plan";
import { run, RunStopped } from "../card/run";
import type { UsageIndex } from "../card/usageIndex";
import { documentsSummary } from "./words";

// Each change to the card goes the same way (PLAN.md, Phase 8): the index catches up with the card, the change is
// planned from it, run, and the index catches up again. What it did is kept, newest last, so it can be undone.

export type Status = { state: "running" | "done" | "failed"; message: string };

type Done = { message: string; undo: Plan };

export type Operations = {
  status?: Status;
  running: boolean;
  canUndo: boolean;
  perform: (message: string, makePlan: (context: Context) => Promise<Plan>) => Promise<void>;
  undo: () => Promise<void>;
};

export function useOperations(card: Card, refresh: () => Promise<UsageIndex>): Operations {
  const [status, setStatus] = useState<Status>();
  const [history, setHistory] = useState<Done[]>([]);
  const running = status?.state === "running";
  // Set at once, unlike the status, so a double click can't start two.
  const busy = useRef(false);

  async function exclusively(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
    } finally {
      busy.current = false;
    }
  }

  // Whether it changed the card, completely or partly. A run that stops partway is kept so it can be undone.
  async function go(message: string, makePlan: (context: Context) => Promise<Plan>): Promise<Plan | "partly" | undefined> {
    // First, while the click that started it still lets the browser ask.
    if (!(await card.writable())) {
      setStatus({ state: "failed", message: "Webluge needs permission to change the card" });
      return;
    }
    setStatus({ state: "running", message: `${message}…` });
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
    try {
      await run(card, plan);
      const updated = documentsSummary(plan.rewrites.map((rewrite) => rewrite.path));
      setStatus({ state: "done", message: [message, updated && `updated ${updated}`].filter(Boolean).join(" · ") });
      return plan;
    } catch (error) {
      setStatus({ state: "failed", message: `Stopped: ${errorMessage(error)}` });
      // Anything else comes from checking the card before the run, which changes nothing.
      if (!(error instanceof RunStopped) || isEmpty(error.done)) return;
      setHistory((history) => [...history, { message: `${message} (stopped partway)`, undo: inverse(error.done) }]);
      return "partly";
    } finally {
      await refresh();
    }
  }

  return {
    status,
    running,
    canUndo: !running && history.length > 0,
    perform: (message, makePlan) =>
      exclusively(async () => {
        const plan = await go(message, makePlan);
        if (plan && plan !== "partly") setHistory((history) => [...history, { message, undo: inverse(plan) }]);
      }),
    undo: () =>
      exclusively(async () => {
        const last = history.at(-1);
        if (!last) return;
        setHistory((history) => history.slice(0, -1));
        // Still there to undo if nothing changed.
        if (!(await go(`Undone: ${last.message}`, async () => last.undo))) {
          setHistory((history) => [...history, last]);
        }
      }),
  };
}

function isEmpty(plan: Plan): boolean {
  return !plan.rewrites.length && !plan.newFolders.length && !plan.moves.length && !plan.oldFolders.length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
