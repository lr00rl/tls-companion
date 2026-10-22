import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CodeTarget } from "../app/store";
import { href } from "../app/route";
import { pick, useLang, useTx } from "../i18n/lang";
import { load, NotFoundError, useLoad, type SymbolIndex } from "../data/load";
import type { CodeFile } from "../data/types";
import {
  DEF_BIT,
  KIND_CLASS,
  enclosingDecl,
  goUpstream,
  kindName,
  lineStarts,
  resolveRef,
  splitKey,
  symDisplay,
  tokenLines,
  type Resolved,
} from "./resolve";
import { References } from "./References";
import "./code.css";

const LINE = 20;
const OVERSCAN = 16;

export interface ExecOverlay {
  /** file -> line -> number of calls made from that line in the capture. */
  lines: Map<string, Map<number, number>>;
  current?: { file: string; line: number } | null;
  onLine?: (file: string, line: number) => void;
}

interface Props {
  target: CodeTarget | null;
  symbols: SymbolIndex | null;
  goVersion: string;
  onNavigate: (t: CodeTarget, push: boolean) => void;
  onRfc: (n: number, section?: string) => void;
  exec?: ExecOverlay | null;
  toolbar?: ReactNode;
  empty?: ReactNode;
}

interface Hover {
  rect: DOMRect;
  res: Resolved;
  isDef: boolean;
}

export function CodeView({ target, symbols, goVersion, onNavigate, onRfc, exec, toolbar, empty }: Props) {
  const file = useLoad<CodeFile>(target ? target.file : null, () => load.file(target!.file));
  const t = useTx();
  const lang = useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const [hover, setHover] = useState<Hover | null>(null);
  const [refsFor, setRefsFor] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  const data = file.state === "ready" ? file.data : null;
  const prepared = useMemo(() => {
    if (!data) return null;
    const starts = lineStarts(data.text);
    return { starts, tokIdx: tokenLines(data.tokens, starts), lines: data.text.split("\n") };
  }, [data]);

  // Resolve the caret line: an explicit line, or the first match of `find`.
  const caret = useMemo(() => {
    if (!target || !prepared) return undefined;
    if (target.find && target.range) {
      for (let l = target.range[0]; l <= target.range[1]; l++) {
        if (prepared.lines[l - 1]?.includes(target.find)) return l;
      }
    }
    return target.line;
  }, [target, prepared]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !prepared || !caret) return;
    const y = (caret - 1) * LINE;
    const visible = y >= el.scrollTop + LINE && y <= el.scrollTop + el.clientHeight - 3 * LINE;
    if (!visible) el.scrollTop = Math.max(0, y - el.clientHeight * 0.3);
    setScroll({ top: el.scrollTop, height: el.clientHeight });
  }, [caret, prepared, target]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setRefsFor(null), [target?.file]);

  // Keyboard cursor: a line, and which linked identifier on it. It turns on
  // only when focus arrives by keyboard, so a click into the code leaves the
  // arrow keys to the workbench and text selection to the mouse.
  const [kb, setKb] = useState<{ line: number; tok: number } | null>(null);
  // The line a pointer press landed on: after a click, Left and Right go to the
  // workbench, and Up or Down start the cursor here, as in the trees.
  const clicked = useRef<number | null>(null);
  useEffect(() => setKb((k) => (k && caret ? { line: caret, tok: 0 } : k)), [caret, target]);
  const lineLinks = (ln: number): { r: number; def: boolean }[] => {
    if (!prepared || !data) return [];
    const out: { r: number; def: boolean }[] = [];
    for (let t = prepared.tokIdx[ln - 1]; t < prepared.tokIdx[ln]; t += 4) {
      if (data.tokens[t + 3] >= 0) out.push({ r: data.tokens[t + 3], def: !!(data.tokens[t + 2] & DEF_BIT) });
    }
    return out;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !kb) return;
    const y = (kb.line - 1) * LINE;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + LINE > el.scrollTop + el.clientHeight) el.scrollTop = y + LINE - el.clientHeight;
  }, [kb]);

  const execLines = target ? exec?.lines.get(target.file) : undefined;
  const execCur = exec?.current && target && exec.current.file === target.file ? exec.current.line : undefined;

  const resolve = useCallback(
    (r: number) => (data ? resolveRef(data.refs[r], data, symbols, goVersion) : null),
    [data, symbols, goVersion],
  );

  const activate = (res: Resolved, isDef: boolean) => {
    setHover(null);
    switch (res.kind) {
      case "sym":
        if (isDef) setRefsFor(res.key);
        else onNavigate({ file: res.sym.f, line: res.sym.l, range: [res.sym.l, res.sym.e ?? res.sym.l], reason: [`Definition: ${symDisplay(res.sym)}`, `定义：${symDisplay(res.sym)}`] }, true);
        break;
      case "local":
        if (target && !isDef) onNavigate({ file: target.file, line: res.line, range: target.range, reason: ["Local definition", "局部定义"] }, true);
        break;
      case "rfc":
        onRfc(res.n, res.section);
        break;
      case "external":
      case "pkg":
      case "url":
        window.open(res.url, "_blank", "noopener");
        break;
    }
  };

  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!el) return;
    const res = resolve(Number(el.dataset.r));
    if (res) activate(res, el.dataset.def === "1");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!prepared) return;
    if (!kb) {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && clicked.current) {
        e.preventDefault();
        e.stopPropagation();
        setKb({ line: clicked.current, tok: 0 });
        clicked.current = null;
      }
      return;
    }
    const total = prepared.lines.length;
    const page = Math.max(1, Math.floor(scroll.height / LINE) - 2);
    const links = lineLinks(kb.line);
    let { line, tok } = kb;
    switch (e.key) {
      case "ArrowDown":
        line = Math.min(total, line + 1);
        tok = 0;
        break;
      case "ArrowUp":
        line = Math.max(1, line - 1);
        tok = 0;
        break;
      case "PageDown":
        line = Math.min(total, line + page);
        tok = 0;
        break;
      case "PageUp":
        line = Math.max(1, line - page);
        tok = 0;
        break;
      case "ArrowRight":
        tok = Math.min(Math.max(0, links.length - 1), tok + 1);
        break;
      case "ArrowLeft":
        tok = Math.max(0, tok - 1);
        break;
      case "Enter": {
        const l = links[tok];
        const res = l && resolve(l.r);
        if (res) activate(res, l.def);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    setKb({ line, tok });
  };

  const onOver = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    window.clearTimeout(hoverTimer.current);
    if (!el) {
      hoverTimer.current = window.setTimeout(() => setHover(null), 200);
      return;
    }
    hoverTimer.current = window.setTimeout(() => {
      const res = resolve(Number(el.dataset.r));
      if (res) setHover({ rect: el.getBoundingClientRect(), res, isDef: el.dataset.def === "1" });
    }, 320);
  };

  const total = prepared ? prepared.lines.length : 0;
  const first = Math.max(0, Math.floor(scroll.top / LINE) - OVERSCAN);
  const last = Math.min(total, Math.ceil((scroll.top + scroll.height) / LINE) + OVERSCAN);
  const decl = data && caret ? enclosingDecl(data, caret) : null;
  // Without an explicit range, tint the function or type around the caret.
  const effRange = target?.range ?? (decl && decl.end - decl.start < 400 ? ([decl.start, decl.end] as [number, number]) : undefined);
  const declSym = decl && symbols?.byKey.get(decl.ref);
  const [pkgPath] = target ? [target.file.split("/").slice(0, -1).join("/")] : [""];

  const rows: ReactNode[] = [];
  if (prepared && data) {
    for (let l = first; l < last; l++) {
      const ln = l + 1;
      const text = prepared.lines[l];
      const ls = prepared.starts[l];
      const parts: ReactNode[] = [];
      let pos = 0;
      let link = 0;
      for (let t = prepared.tokIdx[l]; t < prepared.tokIdx[l + 1]; t += 4) {
        const s = data.tokens[t] - ls;
        const n = data.tokens[t + 1];
        const k = data.tokens[t + 2];
        const r = data.tokens[t + 3];
        if (s > pos) parts.push(text.slice(pos, s));
        const kf = r >= 0 && kb?.line === ln && link === kb.tok;
        if (r >= 0) link++;
        const cls = KIND_CLASS[k & 31] + (k & DEF_BIT ? " def" : "") + (r >= 0 ? " link" : "") + (kf ? " kfocus" : "");
        parts.push(
          <span key={t} className={cls} data-r={r >= 0 ? r : undefined} data-def={k & DEF_BIT ? "1" : undefined}>
            {text.slice(s, s + n)}
          </span>,
        );
        pos = s + n;
      }
      if (pos < text.length) parts.push(text.slice(pos));
      const inRange = effRange && ln >= effRange[0] && ln <= effRange[1];
      const calls = execLines?.get(ln);
      rows.push(
        <div
          key={ln}
          data-ln={ln}
          className={`row${inRange ? " in-range" : ""}${ln === caret ? " caret" : ""}${ln === execCur ? " exec" : ""}${ln === kb?.line ? " kcur" : ""}`}
          style={{ top: l * LINE }}
        >
          <span className="gutter">
            {calls ? (
              <button
                className={`dot${ln === execCur ? " now" : ""}`}
                title={t(`This line made ${calls} traced calls in the capture. Click to jump to the first.`, `这一行在本次采集中发起了 ${calls} 次被追踪的调用，点击跳到第一次`)}
                onClick={() => exec?.onLine?.(target!.file, ln)}
              />
            ) : (
              <i />
            )}
            <span className="ln">{ln}</span>
          </span>
          <span className="src">{parts.length ? parts : " "}</span>
        </div>,
      );
    }
  }

  return (
    <div className="code-view">
      <div className="code-head">
        {toolbar}
        <div className="crumbs mono" title={target?.file}>
          {target ? (
            <>
              <span className="crumb-pkg">{pkgPath.replace(/^vendor\//, "")}/</span>
              <span className="crumb-file">{target.file.split("/").pop()}</span>
              {declSym && <span className="crumb-fn"> › {symDisplay(declSym)}</span>}
            </>
          ) : (
            <span className="muted">{t("No file open", "未打开文件")}</span>
          )}
        </div>
        <span className="spacer" />
        {target && (
          <a className="btn" href={goUpstream(goVersion, target.file, caret)} target="_blank" rel="noopener" title={t("View this file in golang/go on GitHub", "在 GitHub 上查看 golang/go 的原始文件")}>
            <svg viewBox="0 0 16 16" aria-hidden>
              <path fill="currentColor" d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.7 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0Z" />
            </svg>
            <span className="hide-sm">{t("Upstream", "上游")}</span>
          </a>
        )}
      </div>
      {target?.reason && <div className="code-reason">{pick(target.reason, lang)}</div>}
      {data?.ignored && <div className="code-reason warn">{t("A build constraint excludes this file from the default build. It is highlighted only, with no cross-references.", "这个文件在默认构建里被构建约束排除，只做语法高亮，没有交叉引用。")}</div>}
      <div
        className="code-scroll"
        ref={scroller}
        // Keyed on the target, not the loaded file: dropping tabIndex while
        // the next file loads would blur it and hand the arrows to the workbench.
        tabIndex={target ? 0 : undefined}
        role={target ? "region" : undefined}
        aria-label={target ? t(`${target.file.split("/").pop()} source. Up and Down move lines, Left and Right pick an identifier, Enter follows it.`, `${target.file.split("/").pop()} 源码：上下键换行，左右键选标识符，回车跳转`) : undefined}
        onFocus={(e) => {
          if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible")) setKb((k) => k ?? { line: caret ?? 1, tok: 0 });
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKb(null);
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          clicked.current = Number((e.target as HTMLElement).closest<HTMLElement>("[data-ln]")?.dataset.ln) || null;
          setKb(null);
        }}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onClick={onClick}
        onPointerOver={onOver}
        onPointerLeave={() => {
          window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => setHover(null), 200);
        }}
      >
        {!target && (empty ?? <div className="empty">{t("Choose a step, a field, or a call to open the code.", "选择一个步骤、字段或调用来打开代码。")}</div>)}
        {target && file.state === "loading" && <div className="loading-bar" />}
        {file.state === "error" &&
          (file.error instanceof NotFoundError ? (
            <div className="empty">
              <strong>{t(`${target?.file} is not in the index`, `${target?.file} 不在索引里`)}</strong>
              {t("The index covers crypto/tls and the cryptography it depends on. ", "这里只收录 crypto/tls 和它的密码学依赖。")}
              <a href={href({ page: "code" })}>{t("Back to the file list", "回到源码目录")}</a>
            </div>
          ) : (
            <div className="empty">
              <strong>{t("Could not load the source", "源码加载失败")}</strong>
              {file.error.message}{" "}
              <button className="btn outline" onClick={file.retry}>
                {t("Retry", "重试")}
              </button>
            </div>
          ))}
        {prepared && (
          <div className="code-canvas" style={{ height: total * LINE }}>
            {rows}
          </div>
        )}
      </div>
      {refsFor && symbols && (
        <References
          symKey={refsFor}
          symbols={symbols}
          onClose={() => setRefsFor(null)}
          onOpen={(t: CodeTarget) => onNavigate(t, true)}
        />
      )}
      {hover &&
        createPortal(
          <HoverCard
            hover={hover}
            onEnter={() => window.clearTimeout(hoverTimer.current)}
            onLeave={() => setHover(null)}
            onRefs={(k) => {
              setHover(null);
              setRefsFor(k);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function HoverCard({ hover, onEnter, onLeave, onRefs }: { hover: Hover; onEnter: () => void; onLeave: () => void; onRefs: (k: string) => void }) {
  const { rect, res, isDef } = hover;
  const t = useTx();
  const below = rect.top < 240;
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 488)),
    ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
  };
  let body: ReactNode = null;
  switch (res.kind) {
    case "sym":
    case "external": {
      const s = res.sym;
      body = (
        <>
          <div className="hc-kind">
            {s ? kindName(s.t) : ""} · <span className="mono">{splitKey(res.key)[0].replace(/^vendor\//, "")}</span>
            {res.kind === "external" && t(" · not indexed. Click to open upstream", " · 未收录，点击打开上游")}
          </div>
          {s?.s && <pre className="hc-sig">{s.s}</pre>}
          {s?.d && <div className="hc-doc">{s.d}</div>}
          <div className="hc-actions">
            {res.kind === "sym" && (isDef ? <span>{t("Click for every reference", "点击查看所有引用")}</span> : <span>{t("Click to jump to the definition", "点击跳到定义")}</span>)}
            {res.kind === "sym" && !isDef && (
              <button className="btn" onClick={() => onRefs(res.key)}>
                {t("References", "查看引用")}
              </button>
            )}
          </div>
        </>
      );
      break;
    }
    case "local":
      body = (
        <>
          <div className="hc-kind">{t(`local · line ${res.line}`, `局部声明 · 第 ${res.line} 行`)}</div>
          <pre className="hc-sig">{res.sig}</pre>
        </>
      );
      break;
    case "rfc":
      body = (
        <div className="hc-kind">
          RFC {res.n}
          {res.section ? ` §${res.section}` : ""}
          {t(" · click to open the RFC", " · 点击打开规范原文")}
        </div>
      );
      break;
    case "pkg":
      body = <div className="hc-kind">{t(`package ${res.path} · click to open on pkg.go.dev`, `包 ${res.path} · 点击在 pkg.go.dev 打开`)}</div>;
      break;
    case "url":
      body = <div className="hc-kind mono">{res.url}</div>;
      break;
  }
  return (
    <div className="hover-card" style={style} onPointerEnter={onEnter} onPointerLeave={onLeave} role="tooltip">
      {body}
    </div>
  );
}
