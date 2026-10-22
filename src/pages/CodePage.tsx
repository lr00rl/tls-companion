import { useEffect, useMemo, useState } from "react";
import { href, navigate } from "../app/route";
import { usePeek } from "../app/peek";
import { useWB, type CodeTarget } from "../app/store";
import { buildModel } from "../capture/model";
import { CodeView } from "../code/CodeView";
import { enclosingDecl, kindName, symDisplay } from "../code/resolve";
import { load, useLoad } from "../data/load";
import { EV_ENTER } from "../data/types";
import { scenarioFor } from "../i18n/content";
import { useLang, useTx } from "../i18n/lang";
import { scenarioDefs } from "../scenarios";
import { resolveSteps, stepAt } from "../scenarios/resolve";
import { useMedia } from "../ui/hooks";
import "./pages.css";

const DEFAULT = "crypto/tls/handshake_client_tls13.go";
const traced = /^crypto\/(tls|internal\/fips140\/tls1[23])\./;

export default function CodePage({ path, line }: { path?: string; line?: number }) {
  const t = useTx();
  const meta = useLoad("codeMeta", load.codeMeta);
  const symbols = useWB((s) => s.symbols);
  const [filter, setFilter] = useState("");
  const [drawer, setDrawer] = useState(false);
  const wide = useMedia("(min-width: 1100px)");
  const file = path ?? DEFAULT;
  const data = useLoad(`file:${file}`, () => load.file(file));

  useEffect(() => {
    void useWB.getState().ensureSymbols();
  }, []);

  const target: CodeTarget = useMemo(() => ({ file, line: line ?? 1 }), [file, line]);
  const go = (t: CodeTarget) => navigate({ page: "code", path: t.file, line: t.line });
  const decl = data.state === "ready" && line ? enclosingDecl(data.data, line) : null;
  const declSym = decl ? symbols?.byKey.get(decl.ref) : undefined;

  const q = filter.trim().toLowerCase();
  const match = (f: { p: string }) => !q || f.p.toLowerCase().includes(q);
  const tree = meta.state === "ready" && (
    <nav className="file-tree" aria-label={t("Files", "文件")}>
      <input className="filter" name="file-filter" autoComplete="off" spellCheck={false} placeholder={t("Filter files…", "筛选文件…")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Filter files", "筛选文件")} />
      {meta.data.packages.map((p) => {
        const files = p.files.filter(match);
        if (!files.length) return null;
        return (
          <div key={p.path} className="pkg">
            <div className="pkg-name mono" title={p.synopsis}>
              {p.display}
            </div>
            {files.map((f) => (
              <a
                key={f.p}
                className={`file-link mono${f.p === file ? " cur" : ""}${f.ignored ? " ignored" : ""}`}
                href={href({ page: "code", path: f.p })}
                title={f.constraint ? t(`Build constraint: ${f.constraint}`, `构建约束：${f.constraint}`) : undefined}
                onClick={() => setDrawer(false)}
              >
                {f.p.split("/").pop()}
                <span className="num">{f.lines}</span>
              </a>
            ))}
          </div>
        );
      })}
      {q && !meta.data.packages.some((p) => p.files.some(match)) && (
        <div className="empty">
          <strong>{t(`No file matches "${filter.trim()}"`, `没有匹配“${filter.trim()}”的文件`)}</strong>
        </div>
      )}
    </nav>
  );

  return (
    <div className="code-page">
      {wide ? <aside className="cp-side">{tree}</aside> : drawer && (
        <div className="drawer-scrim" onClick={() => setDrawer(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            {tree}
          </aside>
        </div>
      )}
      <div className="cp-main">
        <CodeView
          target={target}
          symbols={symbols}
          goVersion={meta.state === "ready" ? meta.data.go : "go1.26.1"}
          onNavigate={(t) => go(t)}
          onRfc={(n, s) => usePeek.getState().open(n, s)}
          toolbar={
            !wide && (
              <button className="btn outline" onClick={() => setDrawer(true)}>
                {t("Files", "文件")}
              </button>
            )
          }
        />
      </div>
      {wide && data.state === "ready" && (
        <aside className="cp-right">
          {declSym && <Runs symKey={declSym.k} title={symDisplay(declSym)} />}
          <div className="outline">
            <div className="kicker">
              {t("Outline", "大纲")} · {data.data.outline.length}
            </div>
            {data.data.outline.map(([l, , r, k]) => {
              const s = symbols?.byKey.get(data.data.refs[r]);
              const kind = kindName(k);
              return (
                <a
                  key={l}
                  className={`ol-item${decl && decl.start === l ? " cur" : ""}`}
                  href={href({ page: "code", path: file, line: l })}
                  title={s ? symDisplay(s) : data.data.refs[r]}
                >
                  <span className={`ol-kind k${k}`} aria-label={kind} title={kind}>
                    {kind[0] ?? ""}
                  </span>
                  <span className="ol-name mono">{s ? symDisplay(s) : data.data.refs[r]}</span>
                </a>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}

/** Where a function ran in the recorded scenarios, with links into the workbench. */
function Runs({ symKey, title }: { symKey: string; title: string }) {
  const t = useTx();
  const lang = useLang();
  const caps = useLoad("allCaptures", () => Promise.all(scenarioDefs.map((d) => load.capture(d.id))));
  const rows = useMemo(() => {
    if (caps.state !== "ready") return [];
    return caps.data.flatMap((cap) => {
      const fi = cap.fns.indexOf(symKey);
      if (fi < 0) return [];
      let count = 0;
      let first = -1;
      cap.events.forEach((e, ev) => {
        if (e[0] === EV_ENTER && e[2] === fi) {
          count++;
          if (first < 0) first = ev;
        }
      });
      const model = buildModel(cap);
      const def = scenarioFor(lang, cap.id)!;
      const { steps } = resolveSteps(model, def);
      const si = stepAt(steps, first);
      return [{ id: cap.id, title: def.title, count, step: si, stepTitle: steps[si]?.title ?? "" }];
    });
  }, [caps, symKey, lang]);
  return (
    <div className="runs">
      <div className="kicker">{t("Where it ran", "运行记录")}</div>
      {/* Break only after a dot or a closing paren, never inside a name. */}
      <div className="runs-title mono">
        {title.split(/(?<=[.)])/).map((part, i) => (
          <span key={i}>
            {i > 0 && <wbr />}
            {part}
          </span>
        ))}
      </div>
      {caps.state === "loading" && <div className="loading-bar" />}
      {caps.state === "ready" && rows.length === 0 && (
        <p className="muted">
          {traced.test(symKey)
            ? t("None of the five captures reached this function.", "五个采集场景都没有执行到这个函数。")
            : t("The trace covers crypto/tls and the fips140 tls12 and tls13 packages. This function is outside that set.", "执行追踪只覆盖 crypto/tls 和 fips140 的 tls12、tls13 包，这个函数不在其中。")}
        </p>
      )}
      {rows.map((r) => (
        <a key={r.id} className="run-item" href={href({ page: "play", scenario: r.id, step: r.step })}>
          <strong>{r.title}</strong>
          <span>
            {t(`called ${r.count} times, first at step ${r.step + 1}: ${r.stepTitle}`, `调用 ${r.count} 次，第一次在步骤 ${r.step + 1}：${r.stepTitle}`)}
          </span>
        </a>
      ))}
    </div>
  );
}
