import { useEffect, useReducer } from "react";
import type {
  Calls,
  Capture,
  CaptureIndexEntry,
  CodeFile,
  CodeMeta,
  Note,
  NoteIndexEntry,
  RefsFile,
  RfcDoc,
  RfcIndexEntry,
  Sym,
  SymbolsFile,
} from "./types";

const base = `${import.meta.env.BASE_URL}data/`;

const cache = new Map<string, Promise<unknown>>();
const settled = new Map<string, unknown>();

/** The requested data does not exist, as opposed to a load that failed and may succeed on retry. */
export class NotFoundError extends Error {}

function fetchJSON<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(base + path).then(async (r) => {
      // GitHub Pages answers a missing file with 404; the Vite dev server
      // answers it with index.html.
      if (r.status === 404 || (r.ok && !r.headers.get("content-type")?.includes("json"))) throw new NotFoundError(`${path} was not found`);
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      const v = (await r.json()) as T;
      settled.set(path, v);
      return v;
    });
    // A failed fetch must not stay cached, so retry can work.
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

/** Synchronous read of something already loaded, for render paths. */
export function peek<T>(path: string): T | undefined {
  return settled.get(path) as T | undefined;
}

/** Whether RFC n ships with the site; undefined until the RFC index has loaded. */
export function isBundledRfc(n: number): boolean | undefined {
  const ix = peek<RfcIndexEntry[]>(paths.rfcs);
  return ix ? ix.some((d) => d.n === n) : undefined;
}

export const paths = {
  codeMeta: "code/meta.json",
  symbols: "code/symbols.json",
  calls: "code/calls.json",
  file: (p: string) => `code/files/${p}.json`,
  refs: (pkg: string) => `code/refs/${pkg.replaceAll("/", "_")}.json`,
  captures: "captures/index.json",
  capture: (id: string) => `captures/${id}.json`,
  notes: "notes/index.json",
  note: (id: string) => `notes/${id}.json`,
  rfcs: "rfc/index.json",
  rfc: (n: number) => `rfc/rfc${n}.json`,
};

export const load = {
  codeMeta: () => fetchJSON<CodeMeta>(paths.codeMeta),
  symbols: () => fetchJSON<SymbolsFile>(paths.symbols).then(indexSymbols),
  calls: () => fetchJSON<Calls>(paths.calls),
  /** "8446#4.1.2" -> [file index, line] of Go comments citing it. */
  rfcRefs: () => fetchJSON<Record<string, [number, number][]>>("code/rfcrefs.json"),
  file: (p: string) => fetchJSON<CodeFile>(paths.file(p)),
  refs: (pkg: string) => fetchJSON<RefsFile>(paths.refs(pkg)),
  captures: () => fetchJSON<CaptureIndexEntry[]>(paths.captures),
  capture: (id: string) => fetchJSON<Capture>(paths.capture(id)),
  notes: (lang: "en" | "zh" = "en") => fetchJSON<NoteIndexEntry[]>(lang === "zh" ? "notes/zh/index.json" : paths.notes),
  note: (id: string, lang: "en" | "zh" = "en") => fetchJSON<Note>(lang === "zh" ? `notes/zh/${id}.json` : paths.note(id)),
  rfcs: () => fetchJSON<RfcIndexEntry[]>(paths.rfcs),
  rfc: (n: number) => fetchJSON<RfcDoc>(paths.rfc(n)),
};

export interface SymbolIndex {
  files: string[];
  /** The same files as a set: the only sources bundled with the site. */
  indexed: Set<string>;
  list: Sym[];
  byKey: Map<string, Sym>;
}

const symbolIndexes = new WeakMap<SymbolsFile, SymbolIndex>();

function indexSymbols(f: SymbolsFile): SymbolIndex {
  let ix = symbolIndexes.get(f);
  if (!ix) {
    ix = { files: f.files, indexed: new Set(f.files), list: f.symbols, byKey: new Map(f.symbols.map((s) => [s.k, s])) };
    symbolIndexes.set(f, ix);
  }
  return ix;
}

export type Loadable<T> =
  | { state: "loading"; data?: undefined; error?: undefined; retry: () => void }
  | { state: "ready"; data: T; error?: undefined; retry: () => void }
  | { state: "error"; data?: undefined; error: Error; retry: () => void };

/**
 * useLoad runs a loader keyed by `key` and re-renders when it settles. The
 * key must change whenever the loader would load something different.
 */
export function useLoad<T>(key: string | null, loader: () => Promise<T>): Loadable<T> {
  // retries carries over when a load settles, or the effect would run again.
  const [state, set] = useReducer(
    (prev: Store<T>, next: Store<T>) => ({ ...next, retries: next.retries ?? prev.retries }),
    { key: null, state: "loading" } as Store<T>,
  );
  useEffect(() => {
    if (key === null) return;
    let live = true;
    loader().then(
      (data) => live && set({ key, state: "ready", data }),
      (error: Error) => live && set({ key, state: "error", error }),
    );
    return () => {
      live = false;
    };
    // The loader is identified by the key.
  }, [key, state.retries]);
  const retry = () => set({ key: null, state: "loading", retries: (state.retries ?? 0) + 1 });
  if (key === null || state.key !== key || state.state === "loading") return { state: "loading", retry };
  if (state.state === "error") return { state: "error", error: state.error!, retry };
  return { state: "ready", data: state.data as T, retry };
}

interface Store<T> {
  key: string | null;
  state: "loading" | "ready" | "error";
  data?: T;
  error?: Error;
  retries?: number;
}
