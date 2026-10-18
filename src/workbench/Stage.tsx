import { useEffect, useMemo, useRef } from "react";
import { executingAt, useWB } from "../app/store";
import { dominantEpoch, recordLabel, shortFn, type Epoch, type Model } from "../capture/model";
import type { Side } from "../data/types";
import { useEased, useSize } from "./clock";
import "./stage.css";

/** Ethernet MSS for IPv4 without options: what fits in one TCP segment. */
const MSS = 1460;

interface VFlight {
  id: number;
  side: Side;
  tSend: number;
  tArrive: number;
  records: number[];
  bytes: number;
  ev: number;
  tcp?: string;
}

interface Marker {
  side: Side;
  t: number;
  epoch: Epoch;
  label: string;
}

function layout(model: Model, tcp: boolean) {
  const off = tcp ? 1 : 0;
  const flights: VFlight[] = [];
  if (tcp) {
    flights.push({ id: -1, side: 0, tSend: 0, tArrive: 0.5, records: [], bytes: 0, ev: -1, tcp: "SYN" });
    flights.push({ id: -2, side: 1, tSend: 0.5, tArrive: 1, records: [], bytes: 0, ev: -1, tcp: "SYN + ACK" });
  }
  for (const f of model.flights) {
    const prev = flights[flights.length - 1];
    // Writes from one side at the same instant travel together.
    if (prev && !prev.tcp && prev.side === f.side && prev.tSend === f.tSend + off) {
      prev.records.push(...f.records);
      prev.bytes += f.bytes;
      continue;
    }
    flights.push({ id: f.id, side: f.side, tSend: f.tSend + off, tArrive: f.tArrive + off, records: [...f.records], bytes: f.bytes, ev: f.ev });
  }
  const markers: Marker[] = [];
  const seen = new Set<string>();
  for (const s of model.cap.secrets) {
    let ep: Epoch | null = null;
    let label = "";
    if (s.op === "Derive-Secret" && s.label === "c hs traffic") [ep, label] = ["hs", "握手密钥"];
    else if (s.op === "Derive-Secret" && s.label === "c ap traffic") [ep, label] = ["app", "应用密钥"];
    else if (s.op === "Derive-Secret" && s.label === "c e traffic") [ep, label] = ["early", "0-RTT 密钥"];
    else if (s.op === "PRF" && s.label === "key expansion") [ep, label] = ["app", "会话密钥"];
    if (!ep || seen.has(`${s.side}${ep}`)) continue;
    seen.add(`${s.side}${ep}`);
    markers.push({ side: s.side, t: model.time[s.ev] + off, epoch: ep, label });
  }
  const tMax = Math.max(...flights.map((f) => f.tArrive), model.time[model.last] + off) + 0.15;
  const maxBytes = Math.max(...flights.map((f) => f.bytes), 400);
  return { flights, markers, off, tMax, maxBytes };
}

export function Stage({ tcp }: { tcp: boolean }) {
  const model = useWB((s) => s.model);
  const cursor = useWB((s) => s.cursor);
  const sel = useWB((s) => s.sel);
  const scrubbing = useWB((s) => s.scrubbing);
  const speed = useWB((s) => s.speed);
  const rttMs = useWB((s) => s.rttMs);
  const selectRecord = useWB((s) => s.selectRecord);
  const [box, size] = useSize<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);

  const lay = useMemo(() => (model ? layout(model, tcp) : null), [model, tcp]);
  const target = model && lay ? model.time[cursor] + lay.off : 0;
  const t = useEased(target, { msPerUnit: 1400 / speed, maxMs: 1200 / speed, instant: scrubbing });

  const narrow = size.w < 520;
  const padX = narrow ? 30 : 70;
  const top = 46;
  const pxPerRTT = lay ? Math.max(narrow ? 150 : 170, (size.h - top - 24) / lay.tMax) : 160;
  const y = (tau: number) => top + tau * pxPerRTT;
  const xC = padX;
  const xS = Math.max(padX + 120, size.w - padX);
  const height = lay ? y(lay.tMax) + 12 : size.h;
  const bytePx = lay ? Math.min(0.42, (xS - xC - 24) / Math.max(lay.maxBytes, MSS * 1.15)) : 0.2;

  // Keep the cursor line in view when the diagram is taller than the panel.
  useEffect(() => {
    const el = scroller.current;
    if (!el || height <= el.clientHeight) return;
    const cy = y(t);
    if (cy < el.scrollTop + 40 || cy > el.scrollTop + el.clientHeight - 60) el.scrollTop = cy - el.clientHeight * 0.4;
  });

  if (!model || !lay) return <div ref={box} className="stage" />;

  const selectedRecords = new Set<number>();
  if (sel?.kind === "rec") selectedRecords.add(sel.index);
  if (sel?.kind === "msg") for (const [ri] of model.cap.messages[sel.index].parts) selectedRecords.add(ri);

  const exec = executingAt(model, cursor);
  const execSide = exec?.side ?? model.cap.events[cursor]?.[1] ?? 0;
  const ticks: number[] = [];
  for (let k = 0; k <= lay.tMax; k += 0.5) ticks.push(k);

  return (
    <div ref={box} className="stage">
      <div className="stage-scroll" ref={scroller}>
        <div className="stage-canvas" style={{ height }}>
          <svg className="stage-svg" width={size.w} height={height} aria-hidden>
            {ticks.map((k) => (
              <g key={k}>
                <line x1={xC} x2={xS} y1={y(k)} y2={y(k)} className={k % 1 === 0 ? "tick major" : "tick"} />
                {!narrow && (
                  <text x={4} y={y(k) + 4} className="tick-label">
                    {k.toFixed(1)}
                  </text>
                )}
              </g>
            ))}
            <line x1={xC} x2={xC} y1={top - 6} y2={height} className="lifeline" />
            <line x1={xS} x2={xS} y1={top - 6} y2={height} className="lifeline" />
            {lay.flights.map((f) => {
              const x1 = f.side === 0 ? xC : xS;
              const x2 = f.side === 0 ? xS : xC;
              const y1 = y(f.tSend);
              const y2 = y(f.tArrive);
              const p = Math.max(0, Math.min(1, (t - f.tSend) / (f.tArrive - f.tSend)));
              const ep = f.tcp ? "tcp" : dominantEpoch(model, f.records);
              const len = Math.hypot(x2 - x1, y2 - y1);
              return (
                <g key={f.id} className={`flight ep${p === 0 ? " future" : ""}`} data-ep={ep}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} className="arrow-ghost" />
                  {p > 0 && (
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      className="arrow"
                      strokeDasharray={`${len} ${len}`}
                      strokeDashoffset={len * (1 - p)}
                      markerEnd={p === 1 ? `url(#head-${ep})` : undefined}
                    />
                  )}
                  {p > 0 && p < 1 && <circle cx={x1 + (x2 - x1) * p} cy={y1 + (y2 - y1) * p} r={4.5} className="pulse" />}
                </g>
              );
            })}
            {lay.markers.map((m) => (
              <g key={`${m.side}${m.epoch}`} className={`marker ep${t + 1e-6 < m.t ? " future" : ""}`} data-ep={m.epoch}>
                <rect x={(m.side === 0 ? xC : xS) - 5} y={y(m.t) - 5} width={10} height={10} transform={`rotate(45 ${m.side === 0 ? xC : xS} ${y(m.t)})`} />
              </g>
            ))}
            <line x1={xC - 8} x2={xS + 8} y1={y(t)} y2={y(t)} className="now-line" />
            <defs>
              {(["plain", "hs", "app", "early", "tcp"] as const).map((ep) => (
                <marker key={ep} id={`head-${ep}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" className="ep head" data-ep={ep} />
                </marker>
              ))}
            </defs>
          </svg>

          <div className="endpoint" style={{ left: xC }}>
            <strong>客户端</strong>
            {!narrow && <span className="mono">{model.cap.addrs[0]}</span>}
          </div>
          <div className="endpoint right" style={{ left: xS }}>
            <strong>服务器</strong>
            {!narrow && <span className="mono">{model.cap.addrs[1]}</span>}
          </div>

          {lay.markers.map((m) => (
            <div
              key={`l${m.side}${m.epoch}`}
              className={`marker-label ep${m.side === 1 ? " right" : ""}${t + 1e-6 < m.t ? " future" : ""}`}
              data-ep={m.epoch}
              style={{ left: m.side === 0 ? xC : xS, top: y(m.t) }}
            >
              {m.label}
            </div>
          ))}

          {lay.flights.map((f) => {
            const p = Math.max(0, Math.min(1, (t - f.tSend) / (f.tArrive - f.tSend)));
            const midX = (xC + xS) / 2;
            const midY = (y(f.tSend) + y(f.tArrive)) / 2;
            // Future flights keep only their ghost arrow, so the diagram's
            // shape is visible without labels piling up.
            if (p === 0 && !f.tcp) return null;
            if (f.tcp)
              return (
                <div key={f.id} className={`tcp-label${p === 0 ? " future" : ""}`} style={{ left: midX, top: midY }}>
                  {f.tcp} <span>TCP 示意</span>
                </div>
              );
            const w = Math.max(f.records.length * 4, f.bytes * bytePx);
            const labels = f.records.map((ri) => recordLabel(model, ri));
            return (
              <div key={f.id} className={`packet${p === 0 ? " future" : p < 1 ? " flying" : ""}`} style={{ left: midX, top: midY }}>
                <div className="packet-labels">
                  {f.records.map((ri, k) => (
                    <button
                      key={ri}
                      className={`plabel ep${selectedRecords.has(ri) ? " sel" : ""}`}
                      data-ep={model.recordEpoch[ri]}
                      onClick={() => selectRecord(ri, { moveCursor: true })}
                      title={`${labels[k]} · 记录 ${model.cap.records[ri].len + 5} 字节`}
                    >
                      {narrow ? labels[k].replace("EncryptedExtensions", "EE").replace("CertificateVerify", "CV").replace("NewSessionTicket", "NST").replace("ChangeCipherSpec", "CCS") : labels[k].replace("ChangeCipherSpec", "CCS")}
                    </button>
                  ))}
                </div>
                <div className="bar" style={{ width: w }}>
                  {f.records.map((ri) => (
                    <button
                      key={ri}
                      className={`seg ep${selectedRecords.has(ri) ? " sel" : ""}`}
                      data-ep={model.recordEpoch[ri]}
                      style={{ flexGrow: model.cap.records[ri].len + 5 }}
                      onClick={() => selectRecord(ri, { moveCursor: true })}
                      aria-label={labels[f.records.indexOf(ri)]}
                    />
                  ))}
                  {f.bytes > MSS && <span className="mss" style={{ left: MSS * bytePx }} title="一个 TCP 段装得下的 1460 字节（以太网 MSS）" />}
                </div>
                <div className="packet-bytes num">
                  {f.bytes} B{f.bytes > MSS ? ` · ${Math.ceil(f.bytes / MSS)} 个 TCP 段` : ""}
                </div>
              </div>
            );
          })}

          {exec && (
            <div className={`exec-tag${execSide === 1 ? " right" : ""}`} style={{ left: execSide === 0 ? xC : xS, top: y(t) }}>
              <span className="mono">{shortFn(exec.fn)}</span>
            </div>
          )}
          <div className="now-tag num" style={{ top: y(t) }}>
            {(t).toFixed(2)} RTT · {Math.round(t * rttMs)} ms
          </div>
        </div>
      </div>
      <div className="legend">
        <span className="ep sw" data-ep="plain">明文</span>
        <span className="ep sw" data-ep="hs">{"{握手密钥}"}</span>
        <span className="ep sw" data-ep="app">[应用密钥]</span>
        <span className="ep sw" data-ep="tcp">TCP</span>
      </div>
    </div>
  );
}
