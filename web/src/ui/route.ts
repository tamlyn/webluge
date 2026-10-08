import { useEffect, useState } from "react";
import { baseName } from "../card/card";
import type { Selection } from "./Browser";

// The selection lives in the URL's hash, as GitHub Pages can't route other paths to the app. Folders end in "/".

export function hashOf({ path, folder }: Selection): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `#/${encoded}${folder && path ? "/" : ""}`;
}

export function selectionOf(hash: string): Selection {
  const rest = hash.replace(/^#\/?/, "");
  const folder = rest === "" || rest.endsWith("/");
  try {
    return { path: rest.replace(/\/$/, "").split("/").map(decodeURIComponent).join("/"), folder };
  } catch {
    return { path: "", folder: true };
  }
}

export type Navigate = (selection: Selection, options?: { replace?: boolean }) => void;

export function useSelection(): [Selection, Navigate] {
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const update = () => setHash(location.hash);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const selection = selectionOf(hash);

  useEffect(() => {
    document.title = selection.path ? `${baseName(selection.path)} · Webluge` : "Webluge";
  }, [selection.path]);

  const navigate: Navigate = (next, { replace = false } = {}) => {
    const nextHash = hashOf(next);
    if (nextHash === location.hash) return;
    if (replace) history.replaceState(null, "", nextHash);
    else history.pushState(null, "", nextHash);
    setHash(location.hash);
  };

  return [selection, navigate];
}
