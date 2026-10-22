import type { CodeFile, Sym } from "../data/types";
import type { SymbolIndex } from "../data/load";
import { tx } from "../i18n/lang";

/** Token kinds written by tools/cmd/tlsindex. */
export const KIND_CLASS = ["", "kw", "cm", "st", "nu", "id", "fn", "me", "ty", "fd", "co", "va", "pk", "bi", "lo", "lb", "", "lk"];
export const DEF_BIT = 32;

const kindNames: Record<number, readonly [string, string]> = {
  6: ["func", "函数"],
  7: ["method", "方法"],
  8: ["type", "类型"],
  9: ["field", "字段"],
  10: ["const", "常量"],
  11: ["var", "包级变量"],
  12: ["package", "包"],
  14: ["local", "局部"],
};

/** A symbol kind in the active language; call it while rendering. */
export function kindName(k: number): string {
  const n = kindNames[k];
  return n ? tx(n[0], n[1]) : "";
}

export type Resolved =
  | { kind: "sym"; key: string; sym: Sym }
  | { kind: "external"; key: string; sym?: Sym; url: string }
  | { kind: "local"; line: number; col: number; sig: string }
  | { kind: "pkg"; path: string; indexed: boolean; url: string }
  | { kind: "rfc"; n: number; section?: string }
  | { kind: "url"; url: string };

export function goUpstream(goVersion: string, file: string, line?: number) {
  return `https://github.com/golang/go/blob/${goVersion}/src/${file}${line ? `#L${line}` : ""}`;
}

export function pkgDocUrl(key: string): string {
  // crypto/tls.Conn.Handshake -> https://pkg.go.dev/crypto/tls#Conn.Handshake
  const m = key.match(/^(.*?)\.([A-Za-z_][\w.]*)$/);
  if (!m) return `https://pkg.go.dev/${key}`;
  const pkg = m[1].replace(/^vendor\//, "");
  return `https://pkg.go.dev/${pkg}#${m[2]}`;
}

/** Splits a symbol key into package path and declaration path. */
export function splitKey(key: string): [string, string] {
  const slash = key.lastIndexOf("/");
  const dot = key.indexOf(".", slash);
  return [key.slice(0, dot), key.slice(dot + 1)];
}

export function resolveRef(ref: string, file: CodeFile, ix: SymbolIndex | null, goVersion: string): Resolved | null {
  if (ref.startsWith("L:")) {
    const l = file.locals[Number(ref.slice(2))];
    return l ? { kind: "local", line: l[0], col: l[1], sig: l[2] } : null;
  }
  if (ref.startsWith("rfc:")) {
    const [n, section] = ref.slice(4).split("#");
    return { kind: "rfc", n: Number(n), section: section || undefined };
  }
  if (ref.startsWith("url:")) return { kind: "url", url: ref.slice(4) };
  if (ref.startsWith("pkg:")) {
    const path = ref.slice(4);
    return { kind: "pkg", path, indexed: false, url: `https://pkg.go.dev/${path.replace(/^vendor\//, "")}` };
  }
  if (ref.startsWith("ext:")) return { kind: "external", key: ref.slice(4), url: pkgDocUrl(ref.slice(4)) };
  const sym = ix?.byKey.get(ref);
  if (!sym) return { kind: "external", key: ref, url: pkgDocUrl(ref) };
  if (sym.x) return { kind: "external", key: ref, sym, url: goUpstream(goVersion, sym.f, sym.l) };
  return { kind: "sym", key: ref, sym };
}

/** Display name for a symbol, Go-doc style. */
export function symDisplay(s: Sym): string {
  const [, rest] = splitKey(s.k);
  if (s.r) return `(${s.r}).${s.n}`;
  return rest;
}

export function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

/** For each line, the index of its first token quadruple. */
export function tokenLines(tokens: number[], starts: number[]): Int32Array {
  const idx = new Int32Array(starts.length + 1);
  let t = 0;
  for (let l = 0; l < starts.length; l++) {
    while (t < tokens.length && tokens[t] < starts[l]) t += 4;
    idx[l] = t;
  }
  idx[starts.length] = tokens.length;
  return idx;
}

/** The outline entry (function or type) enclosing a line. */
export function enclosingDecl(file: CodeFile, line: number): { start: number; end: number; ref: string; kind: number } | null {
  let best: { start: number; end: number; ref: string; kind: number } | null = null;
  for (const [s, e, r, k] of file.outline) {
    if (s <= line && line <= e && (!best || s >= best.start)) best = { start: s, end: e, ref: file.refs[r], kind: k };
  }
  return best;
}
