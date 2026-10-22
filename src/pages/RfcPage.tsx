import { useEffect, useMemo, useState } from "react";
import { href, navigate } from "../app/route";
import { useWB } from "../app/store";
import { load, useLoad } from "../data/load";
import { RfcText } from "../rfc/RfcText";
import { scenariosFor } from "../i18n/content";
import { useLang, useTx } from "../i18n/lang";
import { useMedia } from "../ui/hooks";
import "../rfc/rfc.css";
import "./pages.css";

export default function RfcPage({ n, section }: { n?: number; section?: string }) {
  const num = n ?? 8446;
  const index = useLoad("rfcs", load.rfcs);
  const doc = useLoad(`rfc:${num}`, () => load.rfc(num));
  const cites = useLoad("rfcrefs", load.rfcRefs);
  const symbols = useWB((s) => s.symbols);
  const wide = useMedia("(min-width: 1180px)");
  const [filter, setFilter] = useState("");
  const bundled = useMemo(() => new Set(index.state === "ready" ? index.data.map((d) => d.n) : []), [index]);

  useEffect(() => {
    void useWB.getState().ensureSymbols();
  }, []);

  useEffect(() => {
    document.querySelector(".rfc-doc-link.cur")?.scrollIntoView({ block: "nearest" });
  }, [num, index.state]);

  const lang = useLang();
  const t = useTx();
  const steps = useMemo(() => {
    const out: { scenario: string; step: number; title: string; sec?: string }[] = [];
    for (const d of scenariosFor(lang))
      d.steps.forEach((s, i) => {
        for (const r of s.refs ?? []) if ("rfc" in r && r.rfc === num && (!section || r.sec === section)) out.push({ scenario: d.id, step: i, title: s.title, sec: r.sec });
      });
    return out;
  }, [num, section, lang]);

  const key = section ? `${num}#${section}` : `${num}`;
  const sites = cites.state === "ready" ? cites.data[key] ?? [] : [];
  const anySites = cites.state === "ready" ? Object.entries(cites.data).filter(([k]) => k.split("#")[0] === String(num)).reduce((a, [, v]) => a + v.length, 0) : 0;

  const side = index.state === "ready" && (
    <nav className="rfc-side" aria-label={t("RFC list", "规范列表")}>
      <input className="filter" name="rfc-filter" autoComplete="off" spellCheck={false} placeholder={t("Filter by number or title…", "筛选 RFC 编号或标题…")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Filter RFCs", "筛选 RFC")} />
      {index.data
        .filter((d) => !filter || String(d.n).includes(filter) || d.title.toLowerCase().includes(filter.toLowerCase()))
        .map((d) => (
          <div key={d.n}>
            <a className={`rfc-doc-link${d.n === num ? " cur" : ""}`} href={href({ page: "rfc", n: d.n })}>
              <span className="num">{d.n}</span>
              <span>{d.title}</span>
            </a>
            {d.n === num && (
              <ul className="rfc-toc">
                {d.sections
                  .filter((s) => s.level <= 2)
                  .map((s) => (
                    <li key={s.id}>
                      <a className={s.id === section ? "on" : ""} href={href({ page: "rfc", n: d.n, section: s.id })} title={`${s.id} ${s.title}`}>
                        {s.id} {s.title}
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
    <div className="rfc-page">
      {wide && side}
      <div className="rfc-main">
        {doc.state === "ready" && (
          <div className="rfc-head">
            <div className="kicker">
              RFC {doc.data.n} · {doc.data.date}
            </div>
            <h1>{doc.data.title}</h1>
            <div className="rfc-meta">
              {doc.data.obsoletes.length > 0 && (
                <span>
                  {t("Obsoletes:", "取代：")}
                  {doc.data.obsoletes.map((o) => (
                    <RfcLink key={o} n={o} bundled={bundled} />
                  ))}
                </span>
              )}
              {doc.data.updates.length > 0 && (
                <span>
                  {t("Updates:", "更新：")}
                  {doc.data.updates.map((o) => (
                    <RfcLink key={o} n={o} bundled={bundled} />
                  ))}
                </span>
              )}
              <a href={`https://www.rfc-editor.org/rfc/rfc${doc.data.n}`} target="_blank" rel="noopener">
                rfc-editor.org
              </a>
              {!wide && (
                <select value={section ?? ""} onChange={(e) => navigate({ page: "rfc", n: num, section: e.target.value || undefined })} aria-label={t("Jump to a section", "跳到章节")}>
                  <option value="">{t("Jump to a section…", "跳到章节…")}</option>
                  {doc.data.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} {s.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
        {doc.state === "loading" && <div className="loading-bar" />}
        {doc.state === "error" && (
          <div className="empty">
            <strong>{t(`RFC ${num} is not included`, `RFC ${num} 没有收录`)}</strong>
            <a href={`https://www.rfc-editor.org/rfc/rfc${num}`} target="_blank" rel="noopener">
              {t("Open on rfc-editor.org", "在 rfc-editor.org 打开")}
            </a>
          </div>
        )}
        {doc.state === "ready" && section && !doc.data.sections.some((s) => s.id === section) && (
          <div className="rfc-missing" role="status">
            {t(`RFC ${num} has no §${section}. Showing it from the start.`, `RFC ${num} 没有 §${section}，下面从开头显示。`)}
          </div>
        )}
        {doc.state === "ready" && <RfcText doc={doc.data} section={section} bundled={bundled} onSection={(m, s) => navigate({ page: "rfc", n: m, section: s })} />}
      </div>
      {wide && (
        <aside className="rfc-right">
          <div className="kicker">{section ? t(`Cites of §${section}`, `§${section} 的引用`) : t(`Cites of RFC ${num}`, `RFC ${num} 的引用`)}</div>
          <p className="muted">{t(`Go comments citing ${section ? "this section" : "any section of this RFC"}: ${section ? sites.length : anySites}`, `Go 源码注释里引用${section ? "这一节" : "这份 RFC 的任意章节"}：${section ? sites.length : anySites} 处`)}</p>
          {symbols &&
            sites.slice(0, 30).map(([fi, line], i) => (
              <a key={i} className="chip" href={href({ page: "code", path: symbols.files[fi], line })}>
                {symbols.files[fi].replace(/^crypto\//, "").replace(/^vendor\/golang.org\/x\/crypto\//, "")}:{line}
              </a>
            ))}
          <div className="kicker" style={{ marginTop: 16 }}>
            {t("Workbench steps", "工作台步骤")}
          </div>
          {steps.length === 0 && <p className="muted">{t(section ? "No step cites this section directly." : "No step cites it directly.", section ? "没有步骤直接引用这一节。" : "没有步骤直接引用它。")}</p>}
          {steps.map((s) => (
            <a key={s.scenario + s.step + (s.sec ?? "")} className="rel-step" href={href({ page: "play", scenario: s.scenario, step: s.step })}>
              <span className="muted">
                {s.scenario}
                {s.sec ? ` · §${s.sec}` : ""}
              </span>
              {s.step + 1}. {s.title}
            </a>
          ))}
        </aside>
      )}
      {!wide && null}
    </div>
  );
}

function RfcLink({ n, bundled }: { n: number; bundled: Set<number> }) {
  return bundled.has(n) ? (
    <a href={href({ page: "rfc", n })} style={{ marginRight: 6 }}>
      {n}
    </a>
  ) : (
    <a href={`https://www.rfc-editor.org/rfc/rfc${n}`} target="_blank" rel="noopener" style={{ marginRight: 6 }}>
      {n}
    </a>
  );
}
