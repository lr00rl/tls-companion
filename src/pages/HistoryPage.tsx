import { useEffect, useMemo, useState } from "react";
import { structuredPatch } from "diff";
import { href, navigate } from "../app/route";
import { usePeek } from "../app/peek";
import { useWB, type CodeTarget } from "../app/store";
import { CodeView } from "../code/CodeView";
import { symDisplay } from "../code/resolve";
import { load, useLoad } from "../data/load";
import { entries, tracks, type Entry, type Track } from "../history/entries";
import { scenarioById } from "../scenarios";
import { useMedia } from "../ui/hooks";
import { RefChip } from "../ui/RefChip";
import "./history.css";

const order: Track[] = ["proto", "attack", "go"];

export default function HistoryPage({ entry }: { entry?: string }) {
  const wide = useMedia("(min-width: 1100px)");
  const [show, setShow] = useState<Set<Track>>(new Set(order));
  const selected = entries.find((e) => e.id === entry) ?? null;

  useEffect(() => {
    void useWB.getState().ensureSymbols();
  }, []);

  // On narrow screens the detail opens inline below the entry, so the entry
  // goes to the top to leave the detail room below it.
  useEffect(() => {
    document.querySelector(".entry.on")?.scrollIntoView({ block: wide ? "nearest" : "start" });
  }, [entry, wide]);

  const years = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
      const y = e.date.slice(0, 4);
      if (!m.has(y)) m.set(y, []);
      m.get(y)!.push(e);
    }
    return [...m.entries()];
  }, []);

  const pick = (id: string) => navigate({ page: "history", entry: id }, { replace: !!entry });

  return (
    <div className="history-page">
      <div className="hist-main">
        <header className="hist-head">
          <div className="kicker">1995 – 2026</div>
          <h1>从 SSL 2.0 到后量子：版本、攻击与 Go 的应对</h1>
          <p>
            三条线并排：协议和标准怎么变，二十年里的主要攻击，以及 Go 的 crypto/tls 今天如何应对每一个。点开任何一条，右边是它在真实源码里的位置；Go 版本那一条线可以直接对比相邻两个 Go 版本的源文件。
          </p>
          <div className="track-filter" role="group" aria-label="显示哪些线">
            {order.map((t) => (
              <button
                key={t}
                className={`tf tf-${t}`}
                aria-pressed={show.has(t)}
                onClick={() => {
                  const n = new Set(show);
                  if (n.has(t) && n.size > 1) n.delete(t);
                  else n.add(t);
                  setShow(n);
                }}
              >
                {tracks[t]}
              </button>
            ))}
          </div>
        </header>
        <div className={`lanes${wide ? "" : " narrow"}`}>
          {wide && (
            <div className="lane-heads">
              <span />
              {order.filter((t) => show.has(t)).map((t) => (
                <span key={t} className={`lane-head tf-${t}`}>
                  {tracks[t]}
                </span>
              ))}
            </div>
          )}
          {years.map(([y, list]) => {
            const visible = list.filter((e) => show.has(e.track));
            if (!visible.length) return null;
            return (
              <div key={y} className="year-row" style={wide ? { gridTemplateColumns: `64px repeat(${show.size}, 1fr)` } : undefined}>
                <div className="year num">{y}</div>
                {wide
                  ? order
                      .filter((t) => show.has(t))
                      .map((t) => (
                        <div key={t} className="cell">
                          {visible
                            .filter((e) => e.track === t)
                            .map((e) => (
                              <EntryCard key={e.id} e={e} on={selected?.id === e.id} onPick={pick} />
                            ))}
                        </div>
                      ))
                  : (
                      <div className="cell">
                        {visible.map((e) => (
                          <div key={e.id}>
                            <EntryCard e={e} on={selected?.id === e.id} onPick={pick} />
                            {selected?.id === e.id && <Detail e={e} compact />}
                          </div>
                        ))}
                      </div>
                    )}
              </div>
            );
          })}
        </div>
      </div>
      {wide && (
        <aside className="hist-detail">
          {selected ? (
            <Detail e={selected} />
          ) : (
            <div className="empty">
              <strong>选一条看细节</strong>
              每条都写了问题、修复，以及 Go 的 crypto/tls 今天怎么处理，带源码位置。
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function EntryCard({ e, on, onPick }: { e: Entry; on: boolean; onPick: (id: string) => void }) {
  return (
    <button className={`entry tf-${e.track}${on ? " on" : ""}`} onClick={() => onPick(e.id)} aria-expanded={on}>
      <span className="entry-date num">{e.date}</span>
      <span className="entry-title">{e.title}</span>
    </button>
  );
}

function Detail({ e, compact }: { e: Entry; compact?: boolean }) {
  const symbols = useWB((s) => s.symbols);
  const meta = useLoad("codeMeta", load.codeMeta);
  const [codeIdx, setCodeIdx] = useState(0);
  useEffect(() => setCodeIdx(0), [e.id]);
  const ref = e.code?.[codeIdx];
  const sym = ref ? symbols?.byKey.get(ref.fn) : undefined;
  const target: CodeTarget | null = sym && !sym.x ? { file: sym.f, line: sym.l, range: [sym.l, sym.e ?? sym.l], find: ref?.find, reason: ref?.label } : null;
  const play = e.play ? scenarioById.get(e.play[0]) : undefined;
  const stepIdx = play ? play.steps.findIndex((s) => s.id === e.play![1]) : -1;

  return (
    <div className={`detail${compact ? " compact" : ""}`}>
      <div className={`detail-track tf-${e.track}`}>
        {tracks[e.track]} · {e.date}
      </div>
      <h2>{e.title}</h2>
      <section>
        <h3>{e.track === "go" ? "变化" : "问题"}</h3>
        <p>{fmt(e.problem)}</p>
      </section>
      {e.fix && (
        <section>
          <h3>修复</h3>
          <p>{fmt(e.fix)}</p>
        </section>
      )}
      {e.go && (
        <section>
          <h3>Go 的 crypto/tls</h3>
          <p>{fmt(e.go)}</p>
        </section>
      )}
      <div className="detail-links">
        {play && stepIdx >= 0 && (
          <a className="chip play-chip" href={href({ page: "play", scenario: play.id, step: stepIdx })}>
            <span className="k">工作台</span>
            {play.steps[stepIdx].title}
          </a>
        )}
        {e.note && <RefChip r={{ note: e.note[0], h: e.note[1] }} />}
        {e.rfcs?.map(([n, s]) => (
          <button key={`${n}${s ?? ""}`} className="chip" onClick={() => usePeek.getState().open(n, s)}>
            <span className="k">RFC</span>
            {n}
            {s ? ` §${s}` : ""}
          </button>
        ))}
      </div>
      {e.code && e.code.length > 0 && (
        <section className="detail-code">
          <div className="tabs">
            {e.code.map((c, i) => (
              <button key={c.fn + i} className="tab" aria-selected={i === codeIdx} onClick={() => setCodeIdx(i)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="mini-code">
            <CodeView
              target={target}
              symbols={symbols}
              goVersion={meta.state === "ready" ? meta.data.go : "go1.26.1"}
              onNavigate={(t) => navigate({ page: "code", path: t.file, line: t.line })}
              onRfc={(n, s) => usePeek.getState().open(n, s)}
              empty={<div className="empty">{sym ? `${symDisplay(sym)} 不在收录的包里` : "加载符号索引…"}</div>}
            />
          </div>
        </section>
      )}
      {e.diff && <DiffView d={e.diff} />}
    </div>
  );
}

function fmt(s: string) {
  return s.split(/(`[^`]+`)/).map((p, i) => (p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p));
}

const raw = (tag: string, file: string) => `https://raw.githubusercontent.com/golang/go/${tag}/src/${file}`;

function DiffView({ d }: { d: NonNullable<Entry["diff"]> }) {
  const [open, setOpen] = useState(false);
  const res = useLoad(open ? `diff:${d.file}:${d.from}:${d.to}` : null, async () => {
    const [a, b] = await Promise.all(
      [d.from, d.to].map(async (t) => {
        const r = await fetch(raw(t, d.file));
        if (!r.ok) throw new Error(`${t}: HTTP ${r.status}`);
        return r.text();
      }),
    );
    return structuredPatch(`${d.from}/${d.file}`, `${d.to}/${d.file}`, a, b, "", "", { context: 3 });
  });
  const stats = useMemo(() => {
    if (res.state !== "ready") return null;
    let add = 0;
    let del = 0;
    for (const h of res.data.hunks)
      for (const l of h.lines) {
        if (l[0] === "+") add++;
        else if (l[0] === "-") del++;
      }
    return { add, del, hunks: res.data.hunks.length };
  }, [res]);

  return (
    <section className="diff">
      <h3>源码对比</h3>
      <p className="muted">{d.hint}</p>
      {!open ? (
        <button className="btn outline" onClick={() => setOpen(true)}>
          对比 {d.from} → {d.to} 的 {d.file.split("/").pop()}
        </button>
      ) : (
        <>
          <div className="diff-meta mono">
            <a href={`https://github.com/golang/go/blob/${d.from}/src/${d.file}`} target="_blank" rel="noopener">
              {d.from}
            </a>
            {" → "}
            <a href={`https://github.com/golang/go/blob/${d.to}/src/${d.file}`} target="_blank" rel="noopener">
              {d.to}
            </a>
            {stats && (
              <span>
                {"  "}
                <span className="add">+{stats.add}</span> <span className="del">−{stats.del}</span> · {stats.hunks} 处
              </span>
            )}
          </div>
          {res.state === "loading" && <div className="loading-bar" />}
          {res.state === "error" && (
            <div className="empty">
              <strong>无法从 GitHub 取回源文件</strong>
              {res.error.message}。可以直接在 GitHub 上打开两个版本对比。{" "}
              <button className="btn outline" onClick={res.retry}>
                重试
              </button>
            </div>
          )}
          {res.state === "ready" && (
            <div className="diff-body mono">
              {res.data.hunks.map((h, i) => (
                <div key={i} className="hunk">
                  <div className="hunk-head">
                    @@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
                  </div>
                  {h.lines.map((l, k) => (
                    <div key={k} className={l[0] === "+" ? "dl add" : l[0] === "-" ? "dl del" : "dl"}>
                      {l || " "}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
