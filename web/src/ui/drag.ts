import { type DragEvent, useState } from "react";
import { baseName } from "../card/card";
import { canMoveInto } from "../card/plan";

// The entries being dragged, if a drag started in the browser. Pages can't read a drag's data until the drop, but
// targets need to know while it's over them whether they'd take it.
let dragged: string[] | undefined;

// Only one target lights up at a time. A folder's row sits inside its column, and the row stops the drop reaching the
// column, so the column has to be put out when the row lights up rather than when the drop happens.
let lit: ((over: boolean) => void) | undefined;

function light(setOver: (over: boolean) => void) {
  if (lit === setOver) return;
  lit?.(false);
  lit = setOver;
  setOver(true);
}

function putOut(setOver?: (over: boolean) => void) {
  if (setOver && lit !== setOver) return;
  lit?.(false);
  lit = undefined;
}

export function startDrag(event: DragEvent, paths: string[]) {
  dragged = paths;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", paths.join("\n"));
  if (paths.length > 1) showStack(event, paths);
}

// Ends a drag however it ends, including when it's cancelled, which doesn't always tell the target it's been left.
export function endDrag() {
  dragged = undefined;
  putOut();
}

// Several entries drag as a stack, with how many there are, rather than as whichever row the drag started from.
function showStack(event: DragEvent, paths: string[]) {
  const stack = document.createElement("div");
  stack.className = "drag-stack";
  const top = document.createElement("div");
  const name = document.createElement("span");
  name.textContent = baseName(paths[0]);
  const count = document.createElement("output");
  count.textContent = String(paths.length);
  top.append(name, count);
  stack.append(top);
  // The browser takes a picture of it as it is now, so it only has to be on the page for this moment.
  document.body.append(stack);
  event.dataTransfer.setDragImage(stack, 16, 16);
  setTimeout(() => stack.remove());
}

export type Drop = (paths: string[], folder: string) => void;

// Makes an element take entries dragged onto it into a folder, lighting up while it would. Undefined for none.
export function useDropTarget(folder: string | undefined, onDrop: Drop) {
  const [over, setOver] = useState(false);
  const takes = () => dragged !== undefined && folder !== undefined && canMoveInto(dragged, folder);
  return {
    over,
    handlers: {
      onDragOver(event: DragEvent) {
        if (!takes()) return;
        // Only the innermost target takes it: an entry's folder, not the column around it.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        light(setOver);
      },
      onDragLeave(event: DragEvent) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) putOut(setOver);
      },
      onDrop(event: DragEvent) {
        if (!takes()) return;
        event.preventDefault();
        event.stopPropagation();
        const paths = dragged!;
        endDrag();
        onDrop(paths, folder!);
      },
    },
  };
}
