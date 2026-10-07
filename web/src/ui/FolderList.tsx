import { type KeyboardEvent, useEffect, useRef } from "react";
import { type Card, type Entry, parentPath } from "../card/card";
import { pathKey } from "../card/references";
import type { SampleIndex } from "../card/sampleIndex";
import { isAudio, samePath } from "./files";
import { useAsync } from "./useAsync";

type Props = {
  card: Card;
  folder: string;
  selected?: string;
  index?: SampleIndex;
  onOpenFolder: (path: string) => void;
  onSelect: (path: string) => void;
};

export function FolderList({ card, folder, selected, index, onOpenFolder, onSelect }: Props) {
  const entries = useAsync(() => card.list(folder), [card, folder]);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    list.current?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }, [selected, entries]);

  function open(entry: Entry) {
    if (entry.kind === "folder") onOpenFolder(entry.path);
    else onSelect(entry.path);
  }

  // Up and down to step through files, so samples can be auditioned one after another.
  function onKeyDown(event: KeyboardEvent) {
    if (!entries?.length) return;
    const i = entries.findIndex((e) => samePath(e.path, selected));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = entries[Math.min(Math.max(i + (event.key === "ArrowDown" ? 1 : -1), 0), entries.length - 1)];
      onSelect(next.path);
    } else if (event.key === "Enter" && i >= 0) {
      open(entries[i]);
    } else if (event.key === "Backspace" && folder) {
      onOpenFolder(parentPath(folder));
      onSelect(folder);
    }
  }

  const parts = folder ? folder.split("/") : [];
  return (
    <section className="folder">
      <nav className="breadcrumbs">
        <button onClick={() => onOpenFolder("")}>{card.name}</button>
        {parts.map((part, i) => (
          <span key={i}>
            {" / "}
            <button onClick={() => onOpenFolder(parts.slice(0, i + 1).join("/"))}>{part}</button>
          </span>
        ))}
      </nav>
      <ul className="entries" tabIndex={0} ref={list} onKeyDown={onKeyDown}>
        {entries?.map((entry) => {
          const users = index && isAudio(entry.path) ? (index.usersOf.get(pathKey(entry.path))?.length ?? 0) : undefined;
          return (
            <li
              key={entry.path}
              className={`${entry.kind} ${samePath(entry.path, selected) ? "selected" : ""}`}
              onClick={() => open(entry)}
            >
              <span className="name">{entry.name}</span>
              {users !== undefined && (
                <span className={`badge ${users ? "" : "unused"}`} title={`Used by ${users} songs, kits and synths`}>
                  {users}
                </span>
              )}
            </li>
          );
        })}
        {entries?.length === 0 && <li className="empty">Empty folder</li>}
      </ul>
    </section>
  );
}
