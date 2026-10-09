import { type ReactNode, useState } from "react";
import { type Card, baseName, joinPath, parentPath } from "../card/card";
import {
  canMoveInto,
  homeOf,
  inTrash,
  needsConfirmation,
  type Plan,
  planDelete,
  planMoves,
  planNewFolder,
} from "../card/plan";
import type { Selection, Tools } from "./Browser";
import { ConfirmDialog, MoveToDialog, NameDialog } from "./Dialogs";
import type { Drop } from "./drag";
import type { Navigate } from "./route";
import type { Operations } from "./useOperations";
import { documentsSummary, plural } from "./words";

// Moving, renaming, deleting and making folders, from the browser's toolbar, keys and dragging, each one plan through
// the operations.
export function useOrganize({
  card,
  operations,
  selection,
  chosen,
  navigate,
}: {
  card: Card;
  operations: Operations;
  selection?: Selection;
  chosen: string[];
  navigate: Navigate;
}): { tools: Tools; onDrop: Drop; dialog: ReactNode } {
  const [dialog, setDialog] = useState<ReactNode>();
  const close = () => setDialog(undefined);

  // Asks first only if the plan does more than move what was chosen.
  const confirm = (verb: string) => (plan: Plan) =>
    !needsConfirmation(plan)
      ? Promise.resolve(true)
      : new Promise<boolean>((resolve) =>
          setDialog(
            <ConfirmDialog
              title={`${verb} ${describe(plan.entries.map((entry) => entry.from))}?`}
              lines={sideEffects(plan, verb)}
              action={verb}
              onAnswer={(yes) => {
                close();
                resolve(yes);
              }}
            />,
          ),
        );

  const move = (paths: string[], folder: string) =>
    operations.perform(
      `Moved ${describe(paths)} to ${baseName(folder)}`,
      (context) => planMoves(context, paths.map((path) => ({ from: path, to: joinPath(folder, baseName(path)) }))),
      confirm("Move"),
    );

  // Entries in the trash can move too, to put them back.
  const movable = (path: string) => homeOf(path) !== undefined;
  const idle = !operations.busy && selection !== undefined;
  // New folders go in the folder showing the selection's contents, or the one holding it.
  const folder = selection && (selection.folder ? selection.path : parentPath(selection.path));
  const tools: Tools = {
    onNewFolder:
      idle && folder !== undefined && homeOf(joinPath(folder, "_")) && !inTrash(folder)
        ? () =>
            setDialog(
              <NameDialog
                title={`New folder in ${baseName(folder)}`}
                action="Make"
                initial="New folder"
                onCancel={close}
                onSubmit={async (name) => {
                  close();
                  const path = joinPath(folder, name);
                  if (await operations.perform(`Made ${name}`, (context) => planNewFolder(context, path))) {
                    navigate({ path, folder: true });
                  }
                }}
              />,
            )
        : undefined,
    onRename:
      idle && chosen.length === 1 && movable(chosen[0])
        ? () => {
            const path = chosen[0];
            setDialog(
              <NameDialog
                title={`Rename ${baseName(path)}`}
                action="Rename"
                initial={baseName(path)}
                onCancel={close}
                onSubmit={(name) => {
                  close();
                  void operations.perform(
                    `Renamed ${baseName(path)} to ${name}`,
                    (context) => planMoves(context, [{ from: path, to: joinPath(parentPath(path), name) }]),
                    confirm("Rename"),
                  );
                }}
              />,
            );
          }
        : undefined,
    onMoveTo:
      idle && chosen.length > 0 && chosen.every(movable)
        ? () =>
            setDialog(
              <MoveToDialog
                card={card}
                paths={chosen}
                onCancel={close}
                onMove={(target) => {
                  close();
                  void move(chosen, target);
                }}
              />,
            )
        : undefined,
    onDelete:
      idle && chosen.length > 0 && chosen.every((path) => movable(path) && !inTrash(path))
        ? () =>
            void operations.perform(
              `Deleted ${describe(chosen)}`,
              (context) => planDelete(context, chosen),
              confirm("Delete"),
            )
        : undefined,
  };

  return {
    tools,
    onDrop: (paths, folder) => {
      if (!operations.busy && canMoveInto(paths, folder)) void move(paths, folder);
    },
    dialog,
  };
}

function describe(paths: string[]): string {
  return paths.length === 1 ? baseName(paths[0]) : plural(paths.length, "item");
}

// How many names to list before summing up the rest.
const namesShown = 8;

// What a plan does beyond moving what was chosen.
function sideEffects(plan: Plan, verb: string): string[] {
  const lines = plan.companions.map(({ from, to }) =>
    verb === "Rename"
      ? `Also renames its folder of collected samples, ${baseName(from)}, to ${baseName(to)}`
      : `Also ${verb === "Delete" ? "deletes" : "moves"} the folder of samples collected for ${baseName(from)}`,
  );
  if (plan.rewrites.length) {
    const verb = plan.rewrites.length === 1 ? "uses" : "use";
    lines.push(`Also updates ${documentsSummary(plan.rewrites.map((rewrite) => rewrite.path))} that ${verb} what moves`);
  }
  if (plan.broken.length) {
    const names = plan.broken.map((path) => baseName(path).replace(/\.xml$/i, "")).sort();
    const more = names.length - namesShown;
    lines.push(
      `Leaves ${documentsSummary(plan.broken)} missing samples: ${names.slice(0, namesShown).join(", ")}` +
        (more > 0 ? ` and ${more} more` : ""),
    );
  }
  return lines;
}
