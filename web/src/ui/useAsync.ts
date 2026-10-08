import { type DependencyList, useEffect, useState } from "react";

// The latest result of an async function, recomputed when its dependencies change. Undefined while it runs. If it
// fails, the error is thrown while rendering, for the nearest ErrorBoundary to show.
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): T | undefined {
  const [result, setResult] = useState<{ deps: DependencyList } & ({ value: T } | { error: unknown })>();
  useEffect(() => {
    let current = true;
    load().then(
      (value) => current && setResult({ deps, value }),
      (error) => current && setResult({ deps, error }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  if (!result || !result.deps.every((d, i) => Object.is(d, deps[i]))) return undefined;
  if ("error" in result) throw result.error;
  return result.value;
}
