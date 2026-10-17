import { useEffect, useState } from "react";
import { navigate } from "../app/route";
import { useWB, type MobilePane } from "../app/store";
import { defaultScenario, scenarioById } from "../scenarios";
import { Splitter } from "../ui/Splitter";
import { useMedia, usePref } from "../ui/hooks";
import { CodePanel } from "./CodePanel";
import { Inspector } from "./Inspector";
import { Stage } from "./Stage";
import { StepBody, StepRail } from "./StepRail";
import { TracePanel } from "./TracePanel";
import { Transport } from "./Transport";
import "./workbench.css";

export function Workbench({ scenario, step }: { scenario?: string; step?: number }) {
  const id = scenario && scenarioById.has(scenario) ? scenario : defaultScenario;
  const def = scenarioById.get(id)!;
  const loading = useWB((s) => s.loading);
  const loadError = useWB((s) => s.loadError);
  const model = useWB((s) => s.model);
  const wide = useMedia("(min-width: 1280px)");
  const mobile = useMedia("(max-width: 899px)");

  useEffect(() => {
    if (!scenario) navigate({ page: "play", scenario: id, step: 0 }, { replace: true });
    void useWB.getState().open(id, step);
  }, [id, step, scenario]);

  usePlayback();
  useKeys();

  if (loadError)
    return (
      <div className="empty wb-error">
        <strong>场景数据加载失败</strong>
        {loadError}
        <div>
          <button className="btn outline" onClick={() => void useWB.getState().open(id, step)}>
            重试
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
  const [drawer, setDrawer] = useState(false);
  const step = useWB((s) => s.step);
  const steps = useWB((s) => s.steps);
  const def = scenarioById.get(defId)!;

  return (
    <div className="wb-body">
      {wide && (
        <>
          <aside className="wb-rail" style={{ width: rail }}>
            <StepRail def={def} />
          </aside>
          <Splitter axis="x" value={rail} min={260} max={520} onChange={setRail} label="调整步骤栏宽度" />
        </>
      )}
      <div className="wb-center">
        {!wide && (
          <div className="step-card">
            <div className="step-card-head">
              <button className="btn outline" onClick={() => setDrawer(true)}>
                全部步骤
              </button>
              <strong>{steps[step]?.title}</strong>
            </div>
            <StepBody index={step} />
          </div>
        )}
        <div className="wb-stage" style={{ height: stageH }}>
          <Stage tcp={tcp} />
        </div>
        <Splitter axis="y" value={stageH} min={220} max={760} onChange={setStageH} label="调整时序图高度" />
        <div className="wb-inspector">
          <Inspector />
        </div>
      </div>
      <Splitter axis="x" value={right} min={360} max={1000} dir={-1} onChange={setRight} label="调整代码栏宽度" />
      <div className="wb-right" style={{ width: right }}>
        <div className="wb-code">
          <CodePanel />
        </div>
        <Splitter axis="y" value={traceH} min={120} max={600} dir={-1} onChange={setTraceH} label="调整调用追踪高度" />
        <div className="wb-trace" style={{ height: traceH }}>
          <TracePanel />
        </div>
      </div>
      {!wide && drawer && (
        <div className="drawer-scrim" onClick={() => setDrawer(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="步骤列表">
            <StepRail def={def} />
          </aside>
        </div>
      )}
    </div>
  );
}

const panes: [MobilePane, string][] = [
  ["steps", "步骤"],
  ["inspect", "报文"],
  ["code", "源码"],
  ["trace", "调用"],
];

function MobileLayout({ tcp }: { tcp: boolean }) {
  const pane = useWB((s) => s.pane);
  const def = scenarioById.get(useWB.getState().scenario ?? defaultScenario)!;
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
      <nav className="tabbar" aria-label="面板">
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
      if (t.closest("input, textarea, select, [role=slider], [role=separator], [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
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
