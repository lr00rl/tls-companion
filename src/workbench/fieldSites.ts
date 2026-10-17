import type { CodeTarget } from "../app/store";
import { load, useLoad, type SymbolIndex } from "../data/load";
import { symDisplay } from "../code/resolve";

export interface Site {
  target: CodeTarget;
  fn: string;
  line: number;
}

export interface FieldSites {
  def?: Site;
  writes: Site[];
  reads: Site[];
}

const reader = /unmarshal|parse|Parse/;
const writer = /marshal|Marshal|CreateCertificate|build/;

/**
 * Where a Go struct field is written to and read from the wire: uses of the
 * field whose enclosing function is a marshal or an unmarshal/parse function.
 * Comes straight from the reference index, so it tracks upstream exactly.
 */
export function useFieldSites(goKey: string | undefined, symbols: SymbolIndex | null): FieldSites | null {
  const sym = goKey ? symbols?.byKey.get(goKey) : undefined;
  const pkg = sym && !sym.x ? sym.p : null;
  const refs = useLoad(pkg ? `refs:${pkg}` : null, () => load.refs(pkg!));
  if (!sym || !symbols) return null;
  const site = (file: string, line: number, fn: string): Site => {
    const enc = symbols.byKey.get(fn);
    return {
      fn,
      line,
      target: {
        file,
        line,
        range: enc && enc.f === file ? [enc.l, enc.e ?? enc.l] : undefined,
        reason: `${enc ? symDisplay(enc) : fn} 第 ${line} 行使用 ${symDisplay(sym)}`,
      },
    };
  };
  const out: FieldSites = {
    def: { fn: sym.k, line: sym.l, target: { file: sym.f, line: sym.l, reason: `定义：${symDisplay(sym)}` } },
    writes: [],
    reads: [],
  };
  if (refs.state !== "ready") return out;
  for (const [fi, line, , enc] of refs.data[goKey!] ?? []) {
    const name = enc.split(".").pop() ?? "";
    const file = symbols.files[fi];
    if (reader.test(name)) out.reads.push(site(file, line, enc));
    else if (writer.test(name)) out.writes.push(site(file, line, enc));
  }
  return out;
}
