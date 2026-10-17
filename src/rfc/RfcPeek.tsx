import { useEffect } from "react";
import { href, navigate } from "../app/route";
import { usePeek } from "../app/peek";
import { useWB } from "../app/store";
import { load, useLoad } from "../data/load";
import { RfcText } from "./RfcText";
import "./rfc.css";

/** A side drawer with one RFC section, openable from anywhere. */
export function RfcPeek() {
  const rfc = usePeek((s) => s.rfc);
  const close = usePeek((s) => s.close);
  const index = useLoad("rfcs", load.rfcs);
  const bundled = new Set(index.state === "ready" ? index.data.map((d) => d.n) : []);
  const isBundled = rfc && index.state === "ready" && bundled.has(rfc.n);
  const doc = useLoad(isBundled ? `rfc:${rfc!.n}` : null, () => load.rfc(rfc!.n));
  const cites = useLoad("rfcrefs", load.rfcRefs);
  const symbols = useWB((s) => s.symbols);

  useEffect(() => {
    if (!rfc) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rfc, close]);

  useEffect(() => {
    if (rfc && index.state === "ready" && !bundled.has(rfc.n)) {
      window.open(`https://www.rfc-editor.org/rfc/rfc${rfc.n}${rfc.section ? `#section-${rfc.section}` : ""}`, "_blank", "noopener");
      close();
    }
  });

  if (!rfc || !isBundled) return null;
  const sec = doc.state === "ready" ? doc.data.sections.find((s) => s.id === rfc.section) : undefined;
  const key = rfc.section ? `${rfc.n}#${rfc.section}` : `${rfc.n}`;
  const sites = cites.state === "ready" ? cites.data[key] ?? [] : [];

  return (
    <div className="peek-scrim" onClick={close}>
      <aside className="peek" onClick={(e) => e.stopPropagation()} aria-label={`RFC ${rfc.n}`}>
        <header className="peek-head">
          <div>
            <div className="kicker">RFC {rfc.n}{doc.state === "ready" ? ` · ${doc.data.date}` : ""}</div>
            <strong>{sec ? `${sec.id}. ${sec.title}` : doc.state === "ready" ? doc.data.title : "加载中"}</strong>
          </div>
          <span className="spacer" />
          <a className="btn outline" href={href({ page: "rfc", n: rfc.n, section: rfc.section })} onClick={close}>
            全文
          </a>
          <button className="btn" onClick={close} aria-label="关闭">
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </header>
        {sites.length > 0 && symbols && (
          <div className="peek-cites">
            <span className="muted">Go 源码中引用这一节的注释：</span>
            {sites.slice(0, 8).map(([fi, line], i) => (
              <button
                key={i}
                className="chip"
                onClick={() => {
                  useWB.getState().openCode({ file: symbols.files[fi], line, reason: `注释引用 RFC ${key.replace("#", " §")}` }, { push: true });
                  close();
                }}
              >
                {symbols.files[fi].split("/").pop()}:{line}
              </button>
            ))}
            {sites.length > 8 && <span className="muted">等 {sites.length} 处</span>}
          </div>
        )}
        <div className="peek-body">
          {doc.state === "loading" && <div className="loading-bar" />}
          {doc.state === "error" && <div className="empty">规范加载失败：{doc.error.message}</div>}
          {doc.state === "ready" && (
            <RfcText
              doc={doc.data}
              section={rfc.section}
              window={rfc.section ? 140 : 80}
              bundled={bundled}
              onSection={(n, s) => usePeek.getState().open(n, s)}
              onOpenFull={() => navigate({ page: "rfc", n: rfc.n, section: rfc.section })}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
