import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { baseName, type Card, type Entry, joinPath, parentPath } from "../card/card";
import { homeOf } from "../card/plan";
import { pathKey } from "../card/references";
import type { UsageIndex } from "../card/usageIndex";
import { ErrorBoundary } from "./ErrorBoundary";
import { type Drop, endDrag, startDrag, useDropTarget } from "./drag";
import { isAudio, samePath } from "./files";
import type { Navigate } from "./route";
import { useAsync } from "./useAsync";

// A file or folder on the card. The card's root is the folder "".
export type Selection = { path: string; folder: boolean };

export type Choose = (paths: string[], focus: Entry, options?: { replace?: boolean; anchor?: string }) => void;

// Each is undefined when it can't be used on what's chosen.
export type Tools = { onNewFolder?: () => void; onRename?: () => void; onMoveTo?: () => void; onDelete?: () => void };

type Props = {
  card: Card;
  selection: Selection;
  // The entries chosen in the selection's folder, the selection among them, and the one a Shift-click extends from.
  chosen: string[];
  anchor: string;
  index?: UsageIndex;
  // Changes when the card does, so folders are listed again.
  version: number;
  tools: Tools;
  onSelect: Navigate;
  onChoose: Choose;
  onDrop: Drop;
};

// Finder-style columns, one for each folder from the card's root down to the selection.
export function Browser({ card, selection, index, tools, onSelect, ...props }: Props) {
  const [unusedOnly, setUnusedOnly] = useState(false);
  const columns = useRef<HTMLDivElement>(null);
  const folders = foldersShowing(selection);

  useEffect(() => {
    columns.current?.scrollTo({ left: columns.current.scrollWidth });
  }, [folders.length]);

  return (
    <section className="browser" aria-label="Card">
      <div className="browser-tools">
        <label>
          <input
            type="checkbox"
            checked={unusedOnly}
            disabled={!index}
            onChange={(event) => setUnusedOnly(event.target.checked)}
          />
          Unused samples
        </label>
        <div className="tools">
          <button className="text-button" disabled={!tools.onNewFolder} onClick={tools.onNewFolder}>
            New folder
          </button>
          <button className="text-button" disabled={!tools.onRename} onClick={tools.onRename}>
            Rename
          </button>
          <button className="text-button" disabled={!tools.onMoveTo} onClick={tools.onMoveTo}>
            Move to…
          </button>
          <button className="text-button" disabled={!tools.onDelete} onClick={tools.onDelete} title="Cmd-Backspace">
            Delete
          </button>
          <button className="text-button" disabled={!index} onClick={() => onSelect({ view: "missing" })}>
            Missing samples
          </button>
        </div>
      </div>
      <div className="columns" ref={columns}>
        {folders.map((folder) => (
          <ErrorBoundary
            key={folder}
            fallback={(error) => (
              <div className="column">
                <h2 className="label">{folderName(card, folder)}</h2>
                <ul className="entries">
                  <li className="empty error">Couldn't list this folder: {String(error)}</li>
                </ul>
              </div>
            )}
          >
            <Column
              card={card}
              folder={folder}
              selection={selection}
              index={index}
              unusedOnly={unusedOnly}
              onSelect={onSelect}
              onDelete={tools.onDelete}
              {...props}
            />
          </ErrorBoundary>
        ))}
      </div>
    </section>
  );
}

function folderName(card: Card, folder: string): string {
  return folder ? baseName(folder) : card.name;
}

function foldersShowing({ path, folder }: Selection): string[] {
  const parts = path ? path.split("/") : [];
  const ancestors = parts.map((_, i) => parts.slice(0, i).join("/"));
  return folder && path ? [...ancestors, path] : ancestors.length ? ancestors : [""];
}

type ColumnProps = Omit<Props, "tools"> & {
  folder: string;
  unusedOnly: boolean;
  onDelete?: () => void;
};

function Column({ card, folder, selection, chosen, anchor, index, version, unusedOnly, onDelete, ...props }: ColumnProps) {
  const { onSelect, onChoose, onDrop } = props;
  const listed = useAsync(() => card.list(folder), [card, folder, version]);
  const list = useRef<HTMLUListElement>(null);
  const usersOf = (entry: Entry) =>
    index && isAudio(entry.path) ? (index.usersOf.get(pathKey(entry.path))?.length ?? 0) : undefined;
  const entries = listed?.filter((entry) => !unusedOnly || !usersOf(entry));
  const onPath = childOnPath(folder, selection.path);
  const current = entries?.find((entry) => samePath(entry.path, onPath));
  const holdsSelection = samePath(parentPath(selection.path), folder) && selection.path !== "";
  const chosenHere = new Set(holdsSelection ? chosen.map(pathKey) : []);
  const drop = useDropTarget(folder || undefined, onDrop);

  // Only when what's shown changes, not on every render, which would fight the user's scrolling.
  useEffect(() => {
    list.current?.querySelector(".selected, .on-path")?.scrollIntoView({ block: "nearest" });
  }, [onPath, listed, unusedOnly]);

  // Keys move through the columns, so focus follows the selection once the columns have it.
  useEffect(() => {
    const element = list.current;
    if (holdsSelection && element?.closest(".browser")?.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
  }, [holdsSelection, selection.path]);

  const choose = (entry: Entry, replace = false) => onChoose([entry.path], entry, { replace });

  // From the anchor to the entry, if both are in this column.
  function extendTo(entry: Entry, replace = false) {
    const from = entries!.findIndex((e) => samePath(e.path, anchor));
    if (!holdsSelection || from < 0) return choose(entry, replace);
    const to = entries!.indexOf(entry);
    const range = entries!.slice(Math.min(from, to), Math.max(from, to) + 1);
    onChoose(
      range.map((e) => e.path),
      entry,
      { replace, anchor },
    );
  }

  function onClick(event: MouseEvent, entry: Entry) {
    if (event.shiftKey) return extendTo(entry);
    if (!(event.metaKey || event.ctrlKey) || !holdsSelection) return choose(entry);
    if (!chosenHere.has(pathKey(entry.path))) {
      return onChoose([...chosen, entry.path], entry, { anchor: entry.path });
    }
    const rest = chosen.filter((path) => !samePath(path, entry.path));
    const focus = entries!.find((e) => samePath(e.path, rest.at(-1)));
    if (focus) onChoose(rest, focus, { anchor: focus.path });
  }

  async function onKeyDown(event: KeyboardEvent) {
    if (!entries?.length) return;
    if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (holdsSelection) onDelete?.();
      return;
    }
    const i = current ? entries.indexOf(current) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = entries[i < 0 ? 0 : Math.min(Math.max(i + step, 0), entries.length - 1)];
      // Stepping through a folder would otherwise leave an entry in the history for every file passed.
      if (event.shiftKey) extendTo(next, true);
      else choose(next, true);
    } else if ((event.key === "ArrowRight" || event.key === "Enter") && current?.kind === "folder") {
      event.preventDefault();
      const first = (await card.list(current.path))[0];
      if (first) choose(first);
    } else if ((event.key === "ArrowLeft" || event.key === "Backspace") && folder) {
      event.preventDefault();
      onSelect({ path: folder, folder: true });
    }
  }

  const hasAudio = entries?.some((entry) => isAudio(entry.path));
  return (
    <div className={`column ${hasAudio ? "has-audio" : ""} ${drop.over ? "drop-target" : ""}`} {...drop.handlers}>
      <h2 className="label">{folderName(card, folder)}</h2>
      <ul className="entries" tabIndex={0} ref={list} onKeyDown={onKeyDown}>
        {entries?.map((entry) => (
          <EntryRow
            key={entry.path}
            entry={entry}
            atRoot={!folder}
            state={
              entry === current
                ? samePath(entry.path, selection.path)
                  ? "selected"
                  : "on-path"
                : chosenHere.has(pathKey(entry.path))
                  ? "chosen"
                  : ""
            }
            users={usersOf(entry)}
            dragging={chosenHere.has(pathKey(entry.path)) ? chosen : [entry.path]}
            onClick={(event) => onClick(event, entry)}
            onDrop={onDrop}
          />
        ))}
        {entries?.length === 0 && <li className="empty">{unusedOnly ? "No unused samples" : "Empty folder"}</li>}
      </ul>
    </div>
  );
}

function EntryRow({
  entry,
  atRoot,
  state,
  users,
  dragging,
  onClick,
  onDrop,
}: {
  entry: Entry;
  atRoot: boolean;
  state: string;
  users?: number;
  // What dragging it drags: everything chosen, if it's among them.
  dragging: string[];
  onClick: (event: MouseEvent) => void;
  onDrop: Drop;
}) {
  const drop = useDropTarget(entry.kind === "folder" ? entry.path : undefined, onDrop);
  const movable = homeOf(entry.path) !== undefined;
  return (
    <li
      className={`${entry.kind} ${state} ${drop.over ? "drop-target" : ""}`}
      draggable={movable}
      onDragStart={(event) => startDrag(event, dragging)}
      onDragEnd={endDrag}
      onClick={onClick}
      {...drop.handlers}
    >
      {atRoot && entry.kind === "folder" && <span className="led" />}
      <span className="name">{entry.name}</span>
      {users !== undefined && <UsageMeter users={users} />}
      {entry.kind === "folder" && (
        <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </li>
  );
}

// The folder or file inside this folder that leads to the selection.
function childOnPath(folder: string, path: string): string | undefined {
  const rest = folder ? path.slice(folder.length + 1) : path;
  return rest ? joinPath(folder, rest.split("/")[0]) : undefined;
}

// How many songs, kits and synths use a sample, on a log scale like a level meter.
function UsageMeter({ users }: { users: number }) {
  const lit = users ? Math.min(8, Math.ceil(Math.log2(users + 1) * 1.6)) : 0;
  return (
    <span className="meter" title={`Used by ${users} songs, kits and synths`}>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={i < lit ? "on" : ""} />
      ))}
      <output>{users || "—"}</output>
    </span>
  );
}
