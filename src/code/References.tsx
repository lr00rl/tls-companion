import { useMemo } from "react";
import type { CodeTarget } from "../app/store";
import { load, useLoad, type SymbolIndex } from "../data/load";
import { useTx } from "../i18n/lang";
import { splitKey, symDisplay } from "./resolve";

interface Props {
  symKey: string;
  symbols: SymbolIndex;
  onClose: () => void;
  onOpen: (t: CodeTarget) => void;
}

/** Every use of a symbol across the indexed packages, grouped by file. */
export function References({ symKey, symbols, onClose, onOpen }: Props) {
  const t = useTx();
  const sym = symbols.byKey.get(symKey);
  const pkg = sym && !sym.x ? sym.p : "external";
  const refs = useLoad(`refs:${pkg}`, () => load.refs(pkg));
  const groups = useMemo(() => {
    if (refs.state !== "ready") return [];
    const list = refs.data[symKey] ?? [];
    const by = new Map<string, { line: number; col: number; enclosing: string }[]>();
    for (const [fi, line, col, enclosing] of list) {
      const f = symbols.files[fi];
      if (!by.has(f)) by.set(f, []);
      by.get(f)!.push({ line, col, enclosing });
    }
    return [...by.entries()];
  }, [refs, symKey, symbols]);
  const count = groups.reduce((n, [, l]) => n + l.length, 0);

  return (
    <div className="refs" role="dialog" aria-label={t("References", "引用")}>
      <div className="refs-head">
        <strong className="mono">{sym ? symDisplay(sym) : splitKey(symKey)[1]}</strong>
        <span className="muted">{refs.state === "ready" ? t(`${count} references in ${groups.length} files`, `${count} 处引用，${groups.length} 个文件`) : t("Loading", "加载中")}</span>
        <span className="spacer" />
        {sym && !sym.x && (
          <button className="btn" onClick={() => onOpen({ file: sym.f, line: sym.l, range: [sym.l, sym.e ?? sym.l], reason: ["Definition", "定义"] })}>
            {t("Definition", "定义")}
          </button>
        )}
        <button className="btn" onClick={onClose} aria-label={t("Close references", "关闭引用列表")}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      <div className="refs-body">
        {refs.state === "error" && <div className="empty">
            {t("Could not load the reference index: ", "引用索引加载失败：")}
            {refs.error.message}
          </div>}
        {refs.state === "ready" && count === 0 && (
          <div className="empty">
            <strong>{t("No references in the indexed packages", "收录的包里没有引用它")}</strong>
            {t("It may only be used from tests, or from a package that is not indexed.", "它可能只在测试或未收录的包里被用到。")}
          </div>
        )}
        {groups.map(([file, list]) => (
          <div key={file} className="refs-file">
            <div className="refs-file-name mono">{file}</div>
            {list.map((r, i) => {
              const enc = symbols.byKey.get(r.enclosing);
              return (
                <button
                  key={i}
                  className="refs-item"
                  onClick={() => {
                    const range: [number, number] | undefined = enc && enc.f === file ? [enc.l, enc.e ?? enc.l] : undefined;
                    onOpen({ file, line: r.line, range, reason: [`Reference: ${sym ? symDisplay(sym) : symKey}`, `引用：${sym ? symDisplay(sym) : symKey}`] });
                  }}
                >
                  <span className="num">{r.line}</span>
                  <span className="mono">{enc ? symDisplay(enc) : t("package level", "包级声明")}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
