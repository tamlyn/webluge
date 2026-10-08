import { type DragEvent, useState } from "react";
import { canMoveInto } from "../card/plan";

// The entries being dragged, if a drag started in the browser. Pages can't read a drag's data until the drop, but
// targets need to know while it's over them whether they'd take it.
let dragged: string[] | undefined;

export function startDrag(event: DragEvent, paths: string[]) {
  dragged = paths;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", paths.join("\n"));
}

export function endDrag() {
  dragged = undefined;
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
        setOver(true);
      },
      onDragLeave(event: DragEvent) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop(event: DragEvent) {
        setOver(false);
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
