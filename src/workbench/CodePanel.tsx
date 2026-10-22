import { useMemo } from "react";
import { href } from "../app/route";
import { usePeek } from "../app/peek";
import { executingAt, useWB } from "../app/store";
import { CodeView, type ExecOverlay } from "../code/CodeView";
import { useTx } from "../i18n/lang";

export function BackForward({ back, fwd, onBack, onFwd }: { back: boolean; fwd: boolean; onBack: () => void; onFwd: () => void }) {
  const t = useTx();
  return (
    <>
      <button className="btn" disabled={!back} onClick={onBack} title={t("Back", "后退")} aria-label={t("Back", "后退")}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <button className="btn" disabled={!fwd} onClick={onFwd} title={t("Forward", "前进")} aria-label={t("Forward", "前进")}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </>
  );
}

/** The code panel inside the workbench, wired to the trace. */
export function CodePanel() {
  const t = useTx();
  const model = useWB((s) => s.model);
  const code = useWB((s) => s.code);
  const symbols = useWB((s) => s.symbols);
  const cursor = useWB((s) => s.cursor);
  const back = useWB((s) => s.codeBack.length > 0);
  const fwd = useWB((s) => s.codeFwd.length > 0);

  const lines = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    if (!model) return m;
    for (const c of model.calls) {
      if (!c.file || c.file.startsWith("app:")) continue;
      if (!m.has(c.file)) m.set(c.file, new Map());
      const f = m.get(c.file)!;
      f.set(c.line, (f.get(c.line) ?? 0) + 1);
    }
    return m;
  }, [model]);

  const cur = model ? executingAt(model, cursor) : null;
  const exec: ExecOverlay | null = model
    ? {
        lines,
        current: cur?.file ? { file: cur.file, line: cur.line } : null,
        onLine: (file, line) => {
          const c = model.calls.find((x) => x.file === file && x.line === line && x.enter >= cursor) ?? model.calls.find((x) => x.file === file && x.line === line);
          if (c) useWB.getState().setCursor(c.enter, { follow: true });
        },
      }
    : null;

  return (
    <div className="panel code-panel">
      <CodeView
        target={code}
        symbols={symbols}
        goVersion={model?.cap.go ?? "go1.26.1"}
        onNavigate={(t, push) => useWB.getState().openCode(t, { push })}
        onRfc={(n, s) => usePeek.getState().open(n, s)}
        exec={exec}
        toolbar={
          <>
            <BackForward back={back} fwd={fwd} onBack={() => useWB.getState().codeGoBack()} onFwd={() => useWB.getState().codeGoForward()} />
            {code && (
              <a className="btn" href={href({ page: "code", path: code.file, line: code.line })} title={t("Open in the code browser", "在源码浏览器中打开")}>
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path d="M9 3h4v4M13 3 7 9M11 9v4H3V5h4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </a>
            )}
          </>
        }
      />
    </div>
  );
}
