import { useEffect, useRef } from "react";
import { navigate } from "../app/route";
import { usePeek } from "../app/peek";
import { useWB } from "../app/store";
import { useLoad, load } from "../data/load";
import type { ScenarioDef, StepRef } from "../scenarios/types";
import { RichText, type LinkHandlers } from "../ui/RichText";
import { RefChip } from "../ui/RefChip";

const sideLabel = { 0: "客户端", 1: "服务器", wire: "网络" } as const;

export function useLinkHandlers(): LinkHandlers {
  const steps = useWB((s) => s.steps);
  return {
    sym: (k) => void useWB.getState().openSymbol(k, { reason: "正文里的链接" }),
    rfc: (n, s) => usePeek.getState().open(n, s),
    note: (id, a) => navigate({ page: "notes", id, anchor: a }),
    step: (id) => {
      const i = steps.findIndex((s) => s.id === id);
      if (i >= 0) useWB.getState().goStep(i);
    },
  };
}

/** The narrative and references of one step. */
export function StepBody({ index }: { index: number }) {
  const s = useWB((st) => st.steps[index]);
  const on = useLinkHandlers();
  if (!s) return null;
  return (
    <div className="step-body">
      <RichText text={s.body} on={on} />
      {s.refs && s.refs.length > 0 && (
        <div className="step-refs">
          {s.refs.map((r, k) => (
            <RefChip key={k} r={r as StepRef} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StepRail({ def }: { def: ScenarioDef }) {
  const steps = useWB((s) => s.steps);
  const step = useWB((s) => s.step);
  const model = useWB((s) => s.model);
  const active = useRef<HTMLLIElement>(null);
  const index = useLoad("captures", load.captures);
  const entry = index.state === "ready" ? index.data.find((c) => c.id === def.id) : undefined;
  const on = useLinkHandlers();

  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step]);

  return (
    <div className="step-rail">
      <div className="rail-intro">
        <div className="kicker">场景</div>
        <h1>{entry?.title ?? def.id}</h1>
        <div className="rail-intro-text">
          <RichText text={def.intro} on={on} />
        </div>
        {model && (
          <div className="rail-facts num">
            <span>{model.cap.state[0].version}</span>
            <span>{model.cap.state[0].cipherSuite.replace("TLS_", "")}</span>
            <span>{model.cap.state[0].curve}</span>
            <span>{model.cap.records.length} 条记录</span>
            <span>{model.calls.length} 次调用</span>
          </div>
        )}
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id} ref={i === step ? active : undefined} className={i === step ? "cur" : i < step ? "done" : ""}>
            <button className="step-head" onClick={() => useWB.getState().goStep(i)} aria-current={i === step ? "step" : undefined}>
              <span className="num step-no">{i + 1}</span>
              <span className={`side-badge side-${s.side}`}>{sideLabel[s.side]}</span>
              <span className="step-label">{s.title}</span>
            </button>
            {i === step && <StepBody index={i} />}
          </li>
        ))}
      </ol>
      <div className="rail-foot">
        <p>
          数据由 <code>tools/cmd/tlscapture</code> 在 {model?.cap.go ?? "Go"} 下真实运行 crypto/tls 采集，每条记录都用 key log 解密并与 crypto/tls
          内部派生的密钥逐字节核对。
        </p>
      </div>
    </div>
  );
}
