import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export interface Polled<T> {
  data: T | null;
  error: string | null;
  reload: () => Promise<void>;
}

/** Loads on mount and then every `ms` while the tab is visible. A 403 "passkey required" calls `onLocked`. */
export function usePolled<T>(load: () => Promise<T>, ms: number, onLocked: () => void): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lockedRef = useRef(onLocked);
  lockedRef.current = onLocked;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /passkey/i.test(e.message)) lockedRef.current();
      else setError((e as Error).message);
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
