import { useMemo, useRef } from "react";
import { useWB } from "../app/store";
import { useLoad, load } from "../data/load";
import { EV_WRITE } from "../data/types";
import { scenarioDefs } from "../scenarios";
import { navigate } from "../app/route";
import { useSize } from "./clock";
import "./transport.css";

const Icon = {
  prev: <path d="M4 3v10M13 3 6 8l7 5z" fill="currentColor" />,
  next: <path d="M12 3v10M3 3l7 5-7 5z" fill="currentColor" />,
  play: <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />,
  pause: <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />,
};

export function Transport() {
  const model = useWB((s) => s.model);
  const steps = useWB((s) => s.steps);
  const step = useWB((s) => s.step);
  const cursor = useWB((s) => s.cursor);
  const playing = useWB((s) => s.playing);
  const speed = useWB((s) => s.speed);
  const rttMs = useWB((s) => s.rttMs);
  const scenario = useWB((s) => s.scenario);
  const wb = useWB.getState;
  const index = useLoad("captures", load.captures);
  const titles = new Map(index.state === "ready" ? index.data.map((c) => [c.id, c.title]) : []);

  const cur = steps[step];
  return (
    <div className="transport">
      <div className="transport-row">
        <label className="scenario-pick">
          <span className="sr-only">场景</span>
          <select
            value={scenario ?? ""}
            onChange={(e) => navigate({ page: "play", scenario: e.target.value, step: 0 })}
          >
            {scenarioDefs.map((d) => (
              <option key={d.id} value={d.id}>
                {titles.get(d.id) ?? d.id}
              </option>
            ))}
          </select>
        </label>
        <div className="controls">
          <button className="btn" onClick={() => wb().goStep(step - 1)} disabled={step <= 0} title="上一步（←）" aria-label="上一步">
            <svg viewBox="0 0 16 16">{Icon.prev}</svg>
          </button>
          <button
            className="btn play"
            onClick={() => {
              if (!playing && step >= steps.length - 1) wb().goStep(0);
              wb().setPlaying(!playing);
            }}
            title="播放 / 暂停（空格）"
            aria-label={playing ? "暂停" : "播放"}
            aria-pressed={playing}
          >
            <svg viewBox="0 0 16 16">{playing ? Icon.pause : Icon.play}</svg>
          </button>
          <button className="btn" onClick={() => wb().goStep(step + 1)} disabled={step >= steps.length - 1} title="下一步（→）" aria-label="下一步">
            <svg viewBox="0 0 16 16">{Icon.next}</svg>
          </button>
        </div>
        <div className="step-title">
          <span className="num step-count">
            {steps.length ? step + 1 : 0}/{steps.length}
          </span>
          <span className="step-name">{cur?.title ?? "加载中"}</span>
        </div>
        <span className="spacer" />
        <div className="seg-ctl hide-md" role="group" aria-label="播放速度">
          {[0.5, 1, 2].map((v) => (
            <button key={v} className="btn" aria-pressed={speed === v} onClick={() => wb().setSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
        <label className="rtt hide-md" title="往返时延只影响时序图上的毫秒数">
          RTT
          <select value={rttMs} onChange={(e) => wb().setRtt(Number(e.target.value))}>
            {[10, 40, 80, 150, 300].map((v) => (
              <option key={v} value={v}>
                {v} ms
              </option>
            ))}
          </select>
        </label>
      </div>
      {model && <Scrubber cursor={cursor} />}
    </div>
  );
}

function Scrubber({ cursor }: { cursor: number }) {
  const model = useWB((s) => s.model)!;
  const steps = useWB((s) => s.steps);
  const step = useWB((s) => s.step);
  const [box, size] = useSize<HTMLDivElement>();
  const dragging = useRef(false);
  const n = model.last + 1;
  const x = (ev: number) => (ev / Math.max(1, n - 1)) * size.w;
  const evAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.round(((clientX - r.left) / r.width) * (n - 1));
  };

  // Which endpoint was running, as runs of consecutive events.
  const runs = useMemo(() => {
    const out: { side: number; a: number; b: number }[] = [];
    model.cap.events.forEach((e, i) => {
      const last = out[out.length - 1];
      if (last && last.side === e[1]) last.b = i;
      else out.push({ side: e[1], a: i, b: i });
    });
    return out;
  }, [model]);
  const writes = useMemo(
    () => model.cap.events.map((e, i) => (e[0] === EV_WRITE ? i : -1)).filter((i) => i >= 0),
    [model],
  );

  const set = (ev: number) => useWB.getState().setCursor(ev, { follow: true });
  return (
    <div
      ref={box}
      className="scrubber"
      role="slider"
      tabIndex={0}
      aria-label="事件时间轴"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={cursor}
      aria-valuetext={`第 ${cursor} 个事件，步骤 ${step + 1}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        useWB.getState().setScrubbing(true);
        useWB.getState().setPlaying(false);
        set(evAt(e.clientX));
      }}
      onPointerMove={(e) => dragging.current && set(evAt(e.clientX))}
      onPointerUp={() => {
        dragging.current = false;
        useWB.getState().setScrubbing(false);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        useWB.getState().setScrubbing(false);
      }}
      onKeyDown={(e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        set(cursor + d * (e.shiftKey ? 25 : 1));
      }}
    >
      <svg width={size.w} height={28} aria-hidden>
        {steps.map((s, i) => (
          <rect key={s.id} x={x(s.start)} width={Math.max(1, x(s.end + 1) - x(s.start))} y={0} height={28} className={`seg-bg${i === step ? " cur" : i % 2 ? " odd" : ""}`} />
        ))}
        {runs.map((r) => (
          <rect key={r.a} x={x(r.a)} width={Math.max(1, x(r.b + 1) - x(r.a))} y={r.side === 0 ? 6 : 15} height={7} className={`run side-${r.side}`} />
        ))}
        {writes.map((ev) => (
          <line key={ev} x1={x(ev)} x2={x(ev)} y1={2} y2={26} className="write-tick" />
        ))}
        {steps.map((s) => (
          <line key={s.id} x1={x(s.start)} x2={x(s.start)} y1={0} y2={28} className="step-edge" />
        ))}
      </svg>
      <div className="playhead" style={{ transform: `translateX(${x(cursor)}px)` }} />
      <div className="scrub-legend">
        <span className="c">客户端</span>
        <span className="s">服务器</span>
      </div>
    </div>
  );
}
