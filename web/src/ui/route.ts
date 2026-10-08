import { useEffect, useState } from "react";
import { baseName } from "../card/card";
import type { Selection } from "./Browser";

// The selection lives in the URL's hash, as GitHub Pages can't route other paths to the app. Folders end in "/". The
// card-wide list of missing samples is "#missing", which no path can be, as paths start with "/".

export type Route = Selection | { view: "missing" };

const missingHash = "#missing";

export function hashOf(route: Route): string {
  if ("view" in route) return missingHash;
  const { path, folder } = route;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `#/${encoded}${folder && path ? "/" : ""}`;
}

export function routeOf(hash: string): Route {
  if (hash === missingHash) return { view: "missing" };
  const rest = hash.replace(/^#\/?/, "");
  const folder = rest === "" || rest.endsWith("/");
  try {
    return { path: rest.replace(/\/$/, "").split("/").map(decodeURIComponent).join("/"), folder };
  } catch {
    return { path: "", folder: true };
  }
}

export type Navigate = (route: Route, options?: { replace?: boolean }) => void;

export function useRoute(): [Route, Navigate] {
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const update = () => setHash(location.hash);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const route = routeOf(hash);
  const name = "view" in route ? "Missing samples" : route.path && baseName(route.path);

  useEffect(() => {
    document.title = name ? `${name} · Webluge` : "Webluge";
  }, [name]);

  const navigate: Navigate = (next, { replace = false } = {}) => {
    const nextHash = hashOf(next);
    if (nextHash === location.hash) return;
    if (replace) history.replaceState(null, "", nextHash);
    else history.pushState(null, "", nextHash);
    setHash(location.hash);
  };

  return [route, navigate];
}
