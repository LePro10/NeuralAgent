import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | null;
  error: string | null;
  reload: () => Promise<void>;
}

/** Loads on mount and then every `ms` while the tab is visible. */
export function usePolled<T>(load: () => Promise<T>, ms: number): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => document.visibilityState === "visible" && void reload(), ms);
    const vis = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ms, reload]);

  return { data, error, reload };
}
