import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { type Card, baseName, parentPath } from "../card/card";
import { canMoveInto, homeOf, inTrash, nameProblem } from "../card/plan";
import { useAsync } from "./useAsync";

// A modal dialog, as the browser draws one: focus stays inside it, and Escape cancels.
function Dialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

function Buttons({ action, disabled, onCancel }: { action: string; disabled?: boolean; onCancel: () => void }) {
  return (
    <div className="dialog-buttons">
      <button type="button" className="key" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="key primary" disabled={disabled}>
        {action}
      </button>
    </div>
  );
}

function submitted(event: FormEvent, action: () => void) {
  event.preventDefault();
  action();
}

// Asks for a name, for a rename or a new folder. A file's name is selected up to its extension, as in the Finder.
export function NameDialog({
  title,
  action,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  action: string;
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const extension = /\.[^.]+$/.exec(initial);
    input.current?.setSelectionRange(0, extension ? extension.index : initial.length);
  }, [initial]);
  const problem = nameProblem(name);
  return (
    <Dialog title={title} onCancel={onCancel}>
      <form onSubmit={(event) => submitted(event, () => !problem && onSubmit(name))}>
        <input
          ref={input}
          className="name-input"
          value={name}
          autoFocus
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="dialog-note error">{name && problem}</p>
        <Buttons action={action} disabled={!!problem || name === initial} onCancel={onCancel} />
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  lines,
  action,
  onAnswer,
}: {
  title: string;
  lines: string[];
  action: string;
  onAnswer: (yes: boolean) => void;
}) {
  return (
    <Dialog title={title} onCancel={() => onAnswer(false)}>
      <form onSubmit={(event) => submitted(event, () => onAnswer(true))}>
        <ul className="dialog-lines">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Buttons action={action} onCancel={() => onAnswer(false)} />
      </form>
    </Dialog>
  );
}

// Picks a folder to move entries into, within their own top folder, starting from where they are, or for entries in the
// trash, from the top folder they'd go back to.
export function MoveToDialog({
  card,
  paths,
  onMove,
  onCancel,
}: {
  card: Card;
  paths: string[];
  onMove: (folder: string) => void;
  onCancel: () => void;
}) {
  const home = homeOf(paths[0])!;
  const [folder, setFolder] = useState(inTrash(paths[0]) ? home : parentPath(paths[0]));
  const folders = useAsync(
    async () => (await card.list(folder)).filter((entry) => entry.kind === "folder"),
    [card, folder],
  );
  const title = paths.length === 1 ? `Move ${baseName(paths[0])}` : `Move ${paths.length} items`;
  return (
    <Dialog title={title} onCancel={onCancel}>
      <form onSubmit={(event) => submitted(event, () => onMove(folder))}>
        <div className="picker-head">
          <button
            type="button"
            className="text-button"
            disabled={folder.toUpperCase() === home}
            onClick={() => setFolder(parentPath(folder))}
          >
            Up
          </button>
          <span className="picker-path" title={folder}>
            {folder}
          </span>
        </div>
        <ul className="picker">
          {folders?.map((entry) => (
            <li key={entry.path}>
              <button type="button" onClick={() => setFolder(entry.path)}>
                {entry.name}
              </button>
            </li>
          ))}
          {folders?.length === 0 && <li className="empty">No folders</li>}
        </ul>
        <Buttons action="Move here" disabled={!canMoveInto(paths, folder)} onCancel={onCancel} />
      </form>
    </Dialog>
  );
}
