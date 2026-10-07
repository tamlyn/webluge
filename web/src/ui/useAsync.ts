import { type DependencyList, useEffect, useState } from "react";

// The latest result of an async function, recomputed when its dependencies change. Undefined while it runs.
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): T | undefined {
  const [result, setResult] = useState<{ deps: DependencyList; value: T }>();
  useEffect(() => {
    let current = true;
    load().then((value) => current && setResult({ deps, value }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return result && result.deps.every((d, i) => Object.is(d, deps[i])) ? result.value : undefined;
}
