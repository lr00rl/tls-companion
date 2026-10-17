import { useEffect, useMemo, useRef, useState } from "react";
import { href, navigate, parse } from "../app/route";
import { usePeek } from "../app/peek";
import { useWB } from "../app/store";
import { kindName, symDisplay } from "../code/resolve";
import { load, useLoad } from "../data/load";
import { entries } from "../history/entries";
import { scenarioDefs } from "../scenarios";
import "./palette.css";

interface Item {
  group: string;
  title: string;
  sub?: string;
  /** Text the query is matched against, lowercased. */
  key: string;
  /** Secondary text matched with a lower weight (note bodies). */
  body?: string;
  go: () => void;
}

const groupOrder = ["步骤", "符号", "文件", "笔记", "RFC", "演进"];

/** Substring beats subsequence; earlier and shorter matches rank higher. */
function score(q: string, key: string): number {
  const i = key.indexOf(q);
  if (i === 0) return 1000 - key.length;
  if (i > 0) return 700 - i - key.length * 0.1;
  if (!/^[\x20-\x7e]+$/.test(q)) return -1;
  let k = 0;
  let gaps = 0;
  for (const ch of q) {
    const j = key.indexOf(ch, k);
    if (j < 0) return -1;
    gaps += j - k;
    k = j + 1;
  }
  return 300 - gaps - key.length * 0.1;
}

export function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const symbols = useLoad("symbols", load.symbols);
  const meta = useLoad("codeMeta", load.codeMeta);
  const rfcs = useLoad("rfcs", load.rfcs);
  const noteIndex = useLoad("notes", load.notes);
  const notes = useLoad(noteIndex.state === "ready" ? "allNotes" : null, () =>
    Promise.all((noteIndex as { data: { id: string }[] }).data.map((n) => load.note(n.id))),
  );
  const inWorkbench = parse(location.hash).page === "play";

  useEffect(() => input.current?.focus(), []);

  const items = useMemo(() => {
    const out: Item[] = [];
    const close = (f: () => void) => () => {
      onClose();
      f();
    };
    for (const d of scenarioDefs)
      d.steps.forEach((s, i) =>
        out.push({
          group: "步骤",
          title: s.title,
          sub: d.id,
          key: `${s.title} ${s.id}`.toLowerCase(),
          go: close(() => navigate({ page: "play", scenario: d.id, step: i })),
        }),
      );
    if (symbols.state === "ready")
      for (const s of symbols.data.list) {
        if (s.x) continue;
        out.push({
          group: "符号",
          title: symDisplay(s),
          sub: `${kindName[s.t] ?? ""} · ${s.f}:${s.l}`,
          key: `${s.n} ${symDisplay(s)}`.toLowerCase(),
          go: close(() =>
            inWorkbench
              ? useWB.getState().openCode({ file: s.f, line: s.l, range: [s.l, s.e ?? s.l], reason: `搜索：${symDisplay(s)}` }, { push: true })
              : navigate({ page: "code", path: s.f, line: s.l }),
          ),
        });
      }
    if (meta.state === "ready")
      for (const p of meta.data.packages)
        for (const f of p.files)
          out.push({
            group: "文件",
            title: f.p.split("/").pop()!,
            sub: f.p,
            key: f.p.toLowerCase(),
            go: close(() => (inWorkbench ? useWB.getState().openCode({ file: f.p, line: 1 }, { push: true }) : navigate({ page: "code", path: f.p }))),
          });
    if (noteIndex.state === "ready") {
      const bodies = new Map(notes.state === "ready" ? notes.data.map((n) => [n.id, n]) : []);
      for (const n of noteIndex.data) {
        out.push({ group: "笔记", title: n.title, key: n.title.toLowerCase(), go: close(() => navigate({ page: "notes", id: n.id })) });
        const full = bodies.get(n.id);
        for (const h of n.headings) {
          const sec = full?.search.find((x) => x.anchor === h.anchor);
          out.push({
            group: "笔记",
            title: h.text,
            sub: n.title,
            key: h.text.toLowerCase(),
            body: sec?.text.toLowerCase(),
            go: close(() => navigate({ page: "notes", id: n.id, anchor: h.anchor })),
          });
        }
      }
    }
    if (rfcs.state === "ready")
      for (const d of rfcs.data) {
        out.push({ group: "RFC", title: `RFC ${d.n}`, sub: d.title, key: `rfc ${d.n} rfc${d.n} ${d.title}`.toLowerCase(), go: close(() => navigate({ page: "rfc", n: d.n })) });
        for (const s of d.sections)
          out.push({
            group: "RFC",
            title: `${d.n} §${s.id} ${s.title}`,
            sub: d.title,
            key: `${d.n} ${s.id} ${s.title}`.toLowerCase(),
            go: close(() => (inWorkbench ? usePeek.getState().open(d.n, s.id) : navigate({ page: "rfc", n: d.n, section: s.id }))),
          });
      }
    for (const e of entries)
      out.push({ group: "演进", title: e.title, sub: e.date, key: `${e.title} ${e.id}`.toLowerCase(), go: close(() => navigate({ page: "history", entry: e.id })) });
    return out;
  }, [symbols, meta, rfcs, noteIndex, notes, inWorkbench, onClose]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) {
      return [
        { group: "常用", title: "回放 TLS 1.3 完整握手", key: "", go: () => (onClose(), navigate({ page: "play", scenario: "tls13-full", step: 0 })) },
        { group: "常用", title: "crypto/tls 的 TLS 1.3 客户端", sub: "handshake_client_tls13.go", key: "", go: () => (onClose(), navigate({ page: "code", path: "crypto/tls/handshake_client_tls13.go" })) },
        { group: "常用", title: "RFC 8446 §7.1 密钥调度", key: "", go: () => (onClose(), navigate({ page: "rfc", n: 8446, section: "7.1" })) },
        { group: "常用", title: "T06 TLS 1.3 握手与密钥调度逐包拆解", key: "", go: () => (onClose(), navigate({ page: "notes", id: "T06" })) },
      ] as Item[];
    }
    const scored: [number, Item][] = [];
    for (const it of items) {
      let s = score(query, it.key);
      if (s < 0 && it.body && query.length >= 2 && it.body.includes(query)) s = 120;
      if (s >= 0) scored.push([s, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const per = new Map<string, number>();
    const out: Item[] = [];
    for (const [, it] of scored) {
      const n = per.get(it.group) ?? 0;
      if (n >= 7) continue;
      per.set(it.group, n + 1);
      out.push(it);
    }
    return out.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));
  }, [q, items, onClose]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const loading = symbols.state === "loading" || noteIndex.state === "loading";
  return (
    <div className="pal-scrim" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="搜索" onClick={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <input
            ref={input}
            value={q}
            placeholder="搜索步骤、Go 符号、文件、笔记、RFC 章节"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") results[sel]?.go();
            }}
            aria-controls="pal-list"
            aria-activedescendant={`pal-${sel}`}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list" id="pal-list" role="listbox" ref={list}>
          {loading && <div className="loading-bar" />}
          {q && !loading && results.length === 0 && (
            <div className="empty">
              <strong>没有匹配“{q}”</strong>
              试试函数名（handshake、marshal）、消息名（ServerHello）、RFC 章节号（8446 4.2.8）或笔记里的中文词。
            </div>
          )}
          {results.map((r, i) => (
            <div key={i}>
              {(i === 0 || results[i - 1].group !== r.group) && <div className="pal-group">{r.group}</div>}
              <button
                id={`pal-${i}`}
                role="option"
                aria-selected={i === sel}
                className="pal-item"
                onMouseMove={() => setSel(i)}
                onClick={r.go}
              >
                <span className="pal-title">{r.title}</span>
                {r.sub && <span className="pal-sub mono">{r.sub}</span>}
              </button>
            </div>
          ))}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>↵</kbd> 打开
          </span>
          <a href={href({ page: "code" })} onClick={onClose}>
            浏览全部源码
          </a>
        </div>
      </div>
    </div>
  );
}
