import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CodeTarget } from "../app/store";
import { load, useLoad, type SymbolIndex } from "../data/load";
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
        else onNavigate({ file: res.sym.f, line: res.sym.l, range: [res.sym.l, res.sym.e ?? res.sym.l], reason: `定义：${symDisplay(res.sym)}` }, true);
        break;
      case "local":
        if (target && !isDef) onNavigate({ file: target.file, line: res.line, range: target.range, reason: "局部定义" }, true);
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
      for (let t = prepared.tokIdx[l]; t < prepared.tokIdx[l + 1]; t += 4) {
        const s = data.tokens[t] - ls;
        const n = data.tokens[t + 1];
        const k = data.tokens[t + 2];
        const r = data.tokens[t + 3];
        if (s > pos) parts.push(text.slice(pos, s));
        const cls = KIND_CLASS[k & 31] + (k & DEF_BIT ? " def" : "") + (r >= 0 ? " link" : "");
        parts.push(
          <span key={t} className={cls} data-r={r >= 0 ? r : undefined} data-def={k & DEF_BIT ? "1" : undefined}>
            {text.slice(s, s + n)}
          </span>,
        );
        pos = s + n;
      }
      if (pos < text.length) parts.push(text.slice(pos));
      const inRange = target?.range && ln >= target.range[0] && ln <= target.range[1];
      const calls = execLines?.get(ln);
      rows.push(
        <div
          key={ln}
          className={`row${inRange ? " in-range" : ""}${ln === caret ? " caret" : ""}${ln === execCur ? " exec" : ""}`}
          style={{ top: l * LINE }}
        >
          <span className="gutter">
            {calls ? (
              <button
                className={`dot${ln === execCur ? " now" : ""}`}
                title={`这一行在本次采集中发起了 ${calls} 次被追踪的调用，点击跳到第一次`}
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
            <span className="muted">未打开文件</span>
          )}
        </div>
        <span className="spacer" />
        {target && (
          <a className="btn" href={goUpstream(goVersion, target.file, caret)} target="_blank" rel="noopener" title="在 GitHub 上查看 golang/go 的原始文件">
            <svg viewBox="0 0 16 16" aria-hidden>
              <path fill="currentColor" d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.7 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0Z" />
            </svg>
            <span className="hide-sm">上游</span>
          </a>
        )}
      </div>
      {target?.reason && <div className="code-reason">{target.reason}</div>}
      {data?.ignored && <div className="code-reason warn">这个文件在默认构建里被构建约束排除，只做语法高亮，没有交叉引用。</div>}
      <div
        className="code-scroll"
        ref={scroller}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onClick={onClick}
        onPointerOver={onOver}
        onPointerLeave={() => {
          window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => setHover(null), 200);
        }}
      >
        {!target && (empty ?? <div className="empty">选择一个步骤、字段或调用来打开代码。</div>)}
        {target && file.state === "loading" && <div className="loading-bar" />}
        {file.state === "error" && (
          <div className="empty">
            <strong>源码加载失败</strong>
            {file.error.message}{" "}
            <button className="btn outline" onClick={file.retry}>
              重试
            </button>
          </div>
        )}
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
            {s ? kindName[s.t] ?? "" : ""} · <span className="mono">{splitKey(res.key)[0].replace(/^vendor\//, "")}</span>
            {res.kind === "external" && " · 未收录，点击打开上游"}
          </div>
          {s?.s && <pre className="hc-sig">{s.s}</pre>}
          {s?.d && <div className="hc-doc">{s.d}</div>}
          <div className="hc-actions">
            {res.kind === "sym" && (isDef ? <span>点击查看所有引用</span> : <span>点击跳到定义</span>)}
            {res.kind === "sym" && !isDef && (
              <button className="btn" onClick={() => onRefs(res.key)}>
                查看引用
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
          <div className="hc-kind">局部声明 · 第 {res.line} 行</div>
          <pre className="hc-sig">{res.sig}</pre>
        </>
      );
      break;
    case "rfc":
      body = (
        <div className="hc-kind">
          RFC {res.n}
          {res.section ? ` §${res.section}` : ""} · 点击打开规范原文
        </div>
      );
      break;
    case "pkg":
      body = <div className="hc-kind">包 {res.path} · 点击在 pkg.go.dev 打开</div>;
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
