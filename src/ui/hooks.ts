import { useEffect, useState } from "react";

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`tlsc.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

/** A per-viewer preference (panel sizes, theme) kept in localStorage when it is available. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => read(key, fallback));
  const set = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(`tlsc.${key}`, JSON.stringify(next));
    } catch {
      // Private windows and blocked storage: keep it for this session only.
    }
  };
  return [v, set];
}

export function readPref<T>(key: string, fallback: T): T {
  return read(key, fallback);
}
