import { useEffect, useMemo, useRef, useState } from "react";
import { href } from "../app/route";
import { usePeek } from "../app/peek";
import { load, useLoad } from "../data/load";
import type { Note } from "../data/types";
import { scenarioDefs } from "../scenarios";
import { useMedia } from "../ui/hooks";
import "./pages.css";
import "./notes.css";

interface StepLink {
  scenario: string;
  step: number;
  title: string;
  h?: string;
}

/** Steps that cite a note, keyed by heading anchor ("" for the whole note). */
function stepLinks(noteId: string): Map<string, StepLink[]> {
  const m = new Map<string, StepLink[]>();
  for (const d of scenarioDefs) {
    d.steps.forEach((s, i) => {
      for (const r of s.refs ?? []) {
        if (!("note" in r) || r.note !== noteId) continue;
        const k = r.h ?? "";
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push({ scenario: d.id, step: i, title: s.title, h: r.h });
      }
    });
  }
  return m;
}

export default function NotesPage({ id, anchor }: { id?: string; anchor?: string }) {
  const index = useLoad("notes", load.notes);
  const captures = useLoad("captures", load.captures);
  const noteId = id ?? "00";
  const note = useLoad(`note:${noteId}`, () => load.note(noteId));
  const wide = useMedia("(min-width: 1180px)");
  const [toc, setToc] = useState(false);
  const [active, setActive] = useState<string>("");
  const article = useRef<HTMLDivElement>(null);
  const links = useMemo(() => stepLinks(noteId), [noteId]);
  const scenarioTitle = (sid: string) => (captures.state === "ready" ? captures.data.find((c) => c.id === sid)?.title : sid) ?? sid;

  // Put workbench links under cited headings. Scenario titles arrive with the
  // captures index, which may load after the note, so existing boxes are
  // refilled in place rather than skipped.
  useEffect(() => {
    const el = article.current;
    if (!el || note.state !== "ready") return;
    for (const [h, ls] of links) {
      if (!h) continue;
      const head = el.querySelector(`[id="${CSS.escape(h)}"]`);
      if (!head) continue;
      let box = head.nextElementSibling;
      if (!box?.classList.contains("wb-links")) {
        box = document.createElement("div");
        box.className = "wb-links";
        head.after(box);
      }
      box.innerHTML =
        `<span>在工作台里看：</span>` +
        ls
          .map((l) => `<a href="${href({ page: "play", scenario: l.scenario, step: l.step })}">${escape(scenarioTitle(l.scenario))} · ${l.step + 1} ${escape(l.title)}</a>`)
          .join("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.state, noteId, links, captures.state]);

  // Draw mermaid and jump to the anchor once per note or anchor, so a late
  // captures load does not pull the reader back to the top.
  useEffect(() => {
    const el = article.current;
    if (!el || note.state !== "ready") return;
    if (note.data.mermaid > 0) void drawMermaid(el);
    // Wait for the article to lay out before jumping.
    requestAnimationFrame(() => {
      // parse() has already decoded the anchor.
      const target = anchor ? el.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
      if (target) target.scrollIntoView({ block: "start" });
      else el.closest(".notes-scroll")?.scrollTo({ top: 0 });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.state, noteId, anchor]);

  // Scroll spy for the table of contents.
  useEffect(() => {
    const el = article.current;
    if (!el || note.state !== "ready") return;
    const heads = [...el.querySelectorAll("h2[id], h3[id]")];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).map((e) => e.target.id);
        if (vis.length) setActive(vis[0]);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [note.state, noteId]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    if (a.classList.contains("rfc-ref")) {
      e.preventDefault();
      usePeek.getState().open(Number(a.dataset.rfc), a.dataset.sec);
    } else if (a.classList.contains("wiki-missing")) {
      e.preventDefault();
    }
  };

  const tocNode = index.state === "ready" && (
    <nav className="notes-toc" aria-label="笔记目录">
      {index.data.map((n) => (
        <div key={n.id} className={n.id === noteId ? "toc-note cur" : "toc-note"}>
          <a href={href({ page: "notes", id: n.id })} onClick={() => setToc(false)}>
            <span className="num">{n.id}</span>
            {n.title.replace(/^T\d+ · /, "").replace(/^TLS 系列 · /, "")}
          </a>
          {n.id === noteId && (
            <ul>
              {n.headings
                .filter((h) => h.level === 2)
                .map((h) => (
                  <li key={h.anchor}>
                    <a className={active === h.anchor ? "on" : ""} href={href({ page: "notes", id: n.id, anchor: h.anchor })} onClick={() => setToc(false)}>
                      {h.text}
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="notes-page">
      {wide ? <aside className="notes-side">{tocNode}</aside> : toc && (
        <div className="drawer-scrim" onClick={() => setToc(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            {tocNode}
          </aside>
        </div>
      )}
      <div className="notes-scroll">
        {!wide && (
          <div className="notes-bar">
            <button className="btn outline" onClick={() => setToc(true)}>
              目录
            </button>
          </div>
        )}
        {note.state === "loading" && <div className="loading-bar" />}
        {note.state === "error" && (
          <div className="empty">
            <strong>笔记加载失败</strong>
            {note.error.message}
          </div>
        )}
        {note.state === "ready" && (
          <article className="note">
            <header>
              <div className="kicker">{note.data.type === "moc" ? "总览" : note.data.type === "runbook" ? "实验手册" : "笔记"}</div>
              <h1>{note.data.title}</h1>
              <div className="note-tags">
                {note.data.tags.slice(0, 10).map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            </header>
            <div className="note-body" ref={article} onClick={onClick} dangerouslySetInnerHTML={{ __html: note.data.html }} />
            <NoteNav id={noteId} />
          </article>
        )}
      </div>
      {wide && note.state === "ready" && <Related note={note.data} links={links} scenarioTitle={scenarioTitle} />}
    </div>
  );
}

function NoteNav({ id }: { id: string }) {
  const index = useLoad("notes", load.notes);
  if (index.state !== "ready") return null;
  const i = index.data.findIndex((n) => n.id === id);
  const prev = index.data[i - 1];
  const next = index.data[i + 1];
  return (
    <nav className="note-nav">
      {prev ? <a href={href({ page: "notes", id: prev.id })}>← {prev.title}</a> : <span />}
      {next ? <a href={href({ page: "notes", id: next.id })}>{next.title} →</a> : <span />}
    </nav>
  );
}

function Related({ note, links, scenarioTitle }: { note: Note; links: Map<string, StepLink[]>; scenarioTitle: (id: string) => string }) {
  const rfcs = useMemo(() => {
    const m = new Map<number, number>();
    for (const x of note.html.matchAll(/data-rfc="(\d+)"/g)) m.set(Number(x[1]), (m.get(Number(x[1])) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [note]);
  const all = [...links.values()].flat();
  return (
    <aside className="notes-related">
      <div className="kicker">工作台中的对应步骤</div>
      {all.length === 0 && <p className="muted">还没有步骤引用这篇笔记。</p>}
      {[...links.entries()].map(([h, ls]) => (
        <div key={h} className="rel-group">
          {h && (
            <a className="rel-h" href={href({ page: "notes", id: note.id, anchor: h })}>
              {note.headings.find((x) => x.anchor === h)?.text ?? h}
            </a>
          )}
          {ls.map((l) => (
            <a key={l.scenario + l.step} className="rel-step" href={href({ page: "play", scenario: l.scenario, step: l.step })}>
              <span className="muted">{scenarioTitle(l.scenario)}</span>
              {l.step + 1}. {l.title}
            </a>
          ))}
        </div>
      ))}
      {rfcs.length > 0 && (
        <>
          <div className="kicker" style={{ marginTop: 18 }}>
            文中提到的规范
          </div>
          <div className="rel-rfcs">
            {rfcs.map(([n, c]) => (
              <button key={n} className="chip" onClick={() => usePeek.getState().open(n)}>
                <span className="k">RFC</span>
                {n}
                {c > 1 && <span className="k">×{c}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

async function drawMermaid(root: HTMLElement) {
  const nodes = [...root.querySelectorAll<HTMLElement>("pre.mermaid:not([data-processed])")];
  if (!nodes.length) return;
  const dark =
    document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  mermaidReady ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidReady;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "neutral",
    fontFamily: getComputedStyle(document.body).fontFamily,
    sequence: { useMaxWidth: true },
    flowchart: { useMaxWidth: true },
  });
  try {
    await mermaid.run({ nodes });
  } catch (e) {
    console.warn("[tls-companion] mermaid", e);
  }
}
