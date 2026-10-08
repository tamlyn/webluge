import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type Card, type Entry, joinPath, parentPath } from "../card/card";
import { pathKey } from "../card/references";
import type { SampleIndex } from "../card/sampleIndex";
import { isAudio, samePath } from "./files";
import type { Navigate } from "./route";
import { useAsync } from "./useAsync";

// A file or folder on the card. The card's root is the folder "".
export type Selection = { path: string; folder: boolean };

type Props = {
  card: Card;
  selection: Selection;
  index?: SampleIndex;
  onSelect: Navigate;
};

// Finder-style columns, one for each folder from the card's root down to the selection.
export function Browser({ card, selection, index, onSelect }: Props) {
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
          Unused samples only
        </label>
      </div>
      <div className="columns" ref={columns}>
        {folders.map((folder) => (
          <Column
            key={folder}
            card={card}
            folder={folder}
            selection={selection}
            index={index}
            unusedOnly={unusedOnly}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function foldersShowing({ path, folder }: Selection): string[] {
  const parts = path ? path.split("/") : [];
  const ancestors = parts.map((_, i) => parts.slice(0, i).join("/"));
  return folder && path ? [...ancestors, path] : ancestors.length ? ancestors : [""];
}

type ColumnProps = Props & {
  folder: string;
  unusedOnly: boolean;
};

function Column({ card, folder, selection, index, unusedOnly, onSelect }: ColumnProps) {
  const listed = useAsync(() => card.list(folder), [card, folder]);
  const list = useRef<HTMLUListElement>(null);
  const usersOf = (entry: Entry) =>
    index && isAudio(entry.path) ? (index.usersOf.get(pathKey(entry.path))?.length ?? 0) : undefined;
  const entries = listed?.filter((entry) => !unusedOnly || !usersOf(entry));
  const onPath = childOnPath(folder, selection.path);
  const current = entries?.find((entry) => samePath(entry.path, onPath));
  const holdsSelection = samePath(parentPath(selection.path), folder) && selection.path !== "";

  useEffect(() => {
    list.current?.querySelector(".selected, .on-path")?.scrollIntoView({ block: "nearest" });
  }, [onPath, entries]);

  // Keys move through the columns, so focus follows the selection once the columns have it.
  useEffect(() => {
    const element = list.current;
    if (holdsSelection && element?.closest(".browser")?.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }
  }, [holdsSelection, selection.path]);

  const select = (entry: Entry, replace = false) =>
    onSelect({ path: entry.path, folder: entry.kind === "folder" }, { replace });

  async function onKeyDown(event: KeyboardEvent) {
    if (!entries?.length) return;
    const i = current ? entries.indexOf(current) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Stepping through a folder would otherwise leave an entry in the history for every file passed.
      select(entries[i < 0 ? 0 : Math.min(Math.max(i + step, 0), entries.length - 1)], true);
    } else if ((event.key === "ArrowRight" || event.key === "Enter") && current?.kind === "folder") {
      event.preventDefault();
      const first = (await card.list(current.path))[0];
      if (first) select(first);
    } else if ((event.key === "ArrowLeft" || event.key === "Backspace") && folder) {
      event.preventDefault();
      onSelect({ path: folder, folder: true });
    }
  }

  const hasAudio = entries?.some((entry) => isAudio(entry.path));
  return (
    <div className={`column ${hasAudio ? "has-audio" : ""}`}>
      <h2 className="label">{folder ? folder.slice(folder.lastIndexOf("/") + 1) : card.name}</h2>
      <ul className="entries" tabIndex={0} ref={list} onKeyDown={onKeyDown}>
        {entries?.map((entry) => {
          const users = usersOf(entry);
          const state = entry !== current ? "" : samePath(entry.path, selection.path) ? "selected" : "on-path";
          return (
            <li key={entry.path} className={`${entry.kind} ${state}`} onClick={() => select(entry)}>
              {!folder && entry.kind === "folder" && <span className="led" />}
              <span className="name">{entry.name}</span>
              {users !== undefined && <UsageMeter users={users} />}
              {entry.kind === "folder" && (
                <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              )}
            </li>
          );
        })}
        {entries?.length === 0 && <li className="empty">{unusedOnly ? "No unused samples" : "Empty folder"}</li>}
      </ul>
    </div>
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
