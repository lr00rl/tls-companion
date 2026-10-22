import { useEffect, useRef, useState } from "react";
import { href, navigate } from "../app/route";
import { useWB, type MobilePane } from "../app/store";
import { scenarioFor, scenariosFor } from "../i18n/content";
import { useLang, useTx } from "../i18n/lang";
import { defaultScenario, scenarioById } from "../scenarios";
import type { ScenarioDef } from "../scenarios/types";
import { trapTab } from "../ui/focus";
import { Splitter } from "../ui/Splitter";
import { useMedia, usePref, useViewportHeight } from "../ui/hooks";
import { CodePanel } from "./CodePanel";
import { Inspector } from "./Inspector";
import { Stage } from "./Stage";
import { StepBody, StepRail } from "./StepRail";
import { TracePanel } from "./TracePanel";
import { Transport } from "./Transport";
import "./workbench.css";

export function Workbench({ scenario, step }: { scenario?: string; step?: number }) {
  const lang = useLang();
  const t = useTx();
  const id = scenario && scenarioById.has(scenario) ? scenario : defaultScenario;
  const def = scenarioFor(lang, id)!;
  const loading = useWB((s) => s.loading);
  const loadError = useWB((s) => s.loadError);
  const model = useWB((s) => s.model);
  const wide = useMedia("(min-width: 1280px)");
  const mobile = useMedia("(max-width: 899px)");

  const unknown = !!scenario && !scenarioById.has(scenario);

  useEffect(() => {
    if (unknown) return;
    if (!scenario) navigate({ page: "play", scenario: id, step: 0 }, { replace: true });
    void useWB.getState().open(id, step);
  }, [id, step, scenario, unknown]);

  usePlayback();
  useKeys();

  if (unknown) return <UnknownScenario name={scenario!} />;

  if (loadError)
    return (
      <div className="empty wb-error">
        <strong>{t("Could not load this scenario", "场景数据加载失败")}</strong>
        {loadError}
        <div>
          <button className="btn outline" onClick={() => void useWB.getState().open(id, step)}>
            {t("Retry", "重试")}
          </button>
        </div>
      </div>
    );

  return (
    <div className={`workbench${mobile ? " is-mobile" : ""}`}>
      <Transport />
      {(loading || !model) && <div className="loading-bar" />}
      {model && (mobile ? <MobileLayout tcp={def.tcp} /> : <DesktopLayout tcp={def.tcp} wide={wide} defId={id} />)}
    </div>
  );
}

function DesktopLayout({ tcp, wide, defId }: { tcp: boolean; wide: boolean; defId: string }) {
  const [rail, setRail] = usePref("wb.rail", 330);
  const [right, setRight] = usePref("wb.right", 620);
  const [stageH, setStageH] = usePref("wb.stage", 400);
  const [traceH, setTraceH] = usePref("wb.trace", 260);
  // Until the reader folds or unfolds the step text, it follows the window:
  // folded under 720px tall, so the inspector keeps room.
  const [cardPref, setCardOpen] = usePref<boolean | null>("wb.card", null);
  const [drawer, setDrawer] = useState(false);
  const t = useTx();
  const step = useWB((s) => s.step);
  const steps = useWB((s) => s.steps);
  const def = scenarioFor(useLang(), defId)!;
  // The stored stage height is a preference; the window caps it so the
  // inspector below always keeps room (about 470px for the top bar, the
  // transport, and the inspector, plus the step card when the rail is folded).
  const vh = useViewportHeight();
  const cardOpen = cardPref ?? vh >= 720;
  const stageMax = Math.max(220, vh - 470 - (wide ? 0 : cardOpen ? 150 : 40));
  const stageShown = Math.min(stageH, stageMax);

  return (
    <div className="wb-body">
      {wide && (
        <>
          <aside className="wb-rail" style={{ width: rail }}>
            <StepRail def={def} />
          </aside>
          <Splitter axis="x" value={rail} min={260} max={520} onChange={setRail} label={t("Resize the step list", "调整步骤栏宽度")} />
        </>
      )}
      <div className="wb-center">
        {!wide && (
          <div className="step-card">
            <div className="step-card-head">
              <button className="btn outline" onClick={() => setDrawer(true)}>
                {t("All steps", "全部步骤")}
              </button>
              <strong>{steps[step]?.title}</strong>
              <span className="spacer" />
              <button className="btn" onClick={() => setCardOpen(!cardOpen)} aria-expanded={cardOpen} aria-controls="step-card-body">
                {cardOpen ? t("Hide note", "收起说明") : t("Show note", "展开说明")}
              </button>
            </div>
            {cardOpen && (
              <div id="step-card-body">
                <StepBody index={step} />
              </div>
            )}
          </div>
        )}
        <div className="wb-stage" style={{ height: stageShown }}>
          <Stage tcp={tcp} />
        </div>
        <Splitter axis="y" value={stageShown} min={220} max={stageMax} onChange={setStageH} label={t("Resize the sequence diagram", "调整时序图高度")} />
        <div className="wb-inspector">
          <Inspector />
        </div>
      </div>
      <Splitter axis="x" value={right} min={360} max={1000} dir={-1} onChange={setRight} label={t("Resize the code panel", "调整代码栏宽度")} />
      <div className="wb-right" style={{ width: right }}>
        <div className="wb-code">
          <CodePanel />
        </div>
        <Splitter axis="y" value={traceH} min={120} max={600} dir={-1} onChange={setTraceH} label={t("Resize the call trace", "调整调用追踪高度")} />
        <div className="wb-trace" style={{ height: traceH }}>
          <TracePanel />
        </div>
      </div>
      {!wide && drawer && <StepDrawer def={def} onClose={() => setDrawer(false)} />}
    </div>
  );
}

function UnknownScenario({ name }: { name: string }) {
  const t = useTx();
  const defs = scenariosFor(useLang());
  return (
    <div className="empty wb-error">
      <strong>{t("No scenario named", "没有名为")} {name}</strong>
      {t("Recorded connections:", "录下来的连接有：")}
      <ul>
        {defs.map((d) => (
          <li key={d.id}>
            <a href={href({ page: "play", scenario: d.id, step: 0 })}>{d.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The step list as a drawer when the rail is folded: focus moves in, Escape closes, focus goes back. */
function StepDrawer({ def, onClose }: { def: ScenarioDef; onClose: () => void }) {
  const t = useTx();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("Steps", "步骤列表")}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
      >
        <StepRail def={def} />
      </aside>
    </div>
  );
}

function MobileLayout({ tcp }: { tcp: boolean }) {
  const t = useTx();
  const pane = useWB((s) => s.pane);
  const def = scenarioFor(useLang(), useWB((s) => s.scenario) ?? defaultScenario)!;
  const panes: [MobilePane, string][] = [
    ["steps", t("Steps", "步骤")],
    ["inspect", t("Packet", "报文")],
    ["code", t("Code", "源码")],
    ["trace", t("Calls", "调用")],
  ];
  return (
    <div className="wb-mobile">
      <div className="wb-stage">
        <Stage tcp={tcp} />
      </div>
      <div className="wb-pane">
        {pane === "steps" && <StepRail def={def} />}
        {pane === "inspect" && <Inspector />}
        {pane === "code" && <CodePanel />}
        {pane === "trace" && <TracePanel />}
      </div>
      <nav className="tabbar" aria-label={t("Panels", "面板")}>
        {panes.map(([id, label]) => (
          <button key={id} aria-current={pane === id ? "page" : undefined} onClick={() => useWB.getState().setPane(id)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Advances steps while playing; each step dwells long enough for its flights. */
function usePlayback() {
  const playing = useWB((s) => s.playing);
  const step = useWB((s) => s.step);
  const speed = useWB((s) => s.speed);
  const n = useWB((s) => s.steps.length);
  useEffect(() => {
    if (!playing) return;
    if (step >= n - 1) {
      useWB.getState().setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => useWB.getState().goStep(step + 1), 2600 / speed);
    return () => window.clearTimeout(t);
  }, [playing, step, speed, n]);
}

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const wb = useWB.getState();
      if (e.key === "ArrowRight") {
        e.preventDefault();
        wb.goStep(Math.min(wb.steps.length - 1, wb.step + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        wb.goStep(Math.max(0, wb.step - 1));
      } else if (e.key === " " && !t.closest("button, a")) {
        e.preventDefault();
        wb.setPlaying(!wb.playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
