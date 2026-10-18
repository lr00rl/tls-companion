import { EV_ENTER, EV_MARK, type Capture } from "../data/types";
import type { Model } from "../capture/model";
import type { Anchor, MsgSel, ScenarioDef, StepDef } from "./types";

export interface Step extends StepDef {
  index: number;
  start: number;
  end: number;
  msgIndex: number;
  /** For a record step without a message: the first record its side sends during the step. */
  recIndex: number;
}

export function findMessage(cap: Capture, sel: MsgSel): number {
  let seen = 0;
  for (let i = 0; i < cap.messages.length; i++) {
    const m = cap.messages[i];
    if (m.dir === sel.dir && m.type === sel.type) {
      if (seen === (sel.nth ?? 0)) return i;
      seen++;
    }
  }
  return -1;
}

function findAnchor(model: Model, a: Anchor, from: number): number {
  const { cap } = model;
  if ("readMsg" in a) {
    const mi = findMessage(cap, a.readMsg);
    return mi < 0 ? -1 : model.messageReadEv[mi];
  }
  if ("writeMsg" in a) {
    const mi = findMessage(cap, a.writeMsg);
    return mi < 0 ? -1 : model.messageWriteEv[mi];
  }
  for (let i = from; i < cap.events.length; i++) {
    const e = cap.events[i];
    if ("enter" in a) {
      if (e[0] === EV_ENTER && cap.fns[e[2]] === a.enter && (a.side === undefined || e[1] === a.side)) return i;
    } else if (e[0] === EV_MARK && e[2] === a.mark && e[1] === a.side) {
      return i;
    }
  }
  return -1;
}

export interface Resolved {
  steps: Step[];
  errors: string[];
}

/** Resolves a scenario's anchors against its capture. */
export function resolveSteps(model: Model, def: ScenarioDef): Resolved {
  const errors: string[] = [];
  const steps: Step[] = [];
  let from = 0;
  def.steps.forEach((s, index) => {
    const start = findAnchor(model, s.at, from);
    if (start < 0) {
      errors.push(`${def.id}/${s.id}: anchor ${JSON.stringify(s.at)} not found after event ${from}`);
      return;
    }
    if (start < from) errors.push(`${def.id}/${s.id}: starts at ${start}, before the previous step (${from})`);
    const msgIndex = s.msg ? findMessage(model.cap, s.msg) : -1;
    if (s.msg && msgIndex < 0) errors.push(`${def.id}/${s.id}: message ${JSON.stringify(s.msg)} not in capture`);
    steps.push({ ...s, index, start, end: model.last, msgIndex, recIndex: -1 });
    from = start;
  });
  for (let i = 0; i + 1 < steps.length; i++) steps[i].end = Math.max(steps[i].start, steps[i + 1].start - 1);
  // A record step anchors where the write begins, before the record exists, so
  // its record is found by write time rather than by what is already on the wire.
  for (const st of steps) {
    if (st.tab !== "record" || st.msgIndex >= 0) continue;
    const { records, writes } = model.cap;
    st.recIndex = records.findIndex((r) => r.dir === st.side && writes[r.write].ev >= st.start && writes[r.write].ev <= st.end);
    if (st.recIndex < 0) errors.push(`${def.id}/${st.id}: no record sent by side ${st.side} during the step`);
  }
  return { steps, errors };
}

/** The step containing event ev. */
export function stepAt(steps: Step[], ev: number): number {
  let lo = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i].start <= ev) lo = i;
  return lo;
}
