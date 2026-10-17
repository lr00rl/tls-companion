import type { Capture, HsMessage, Side, WireRecord } from "../data/types";
import { EV_ENTER, EV_LEAVE, EV_READ, EV_SECRET, EV_WRITE } from "../data/types";
import { alertDescriptions, contentTypes, handshakeShort, hrrRandom } from "./names";

export type Epoch = "plain" | "early" | "hs" | "app";

/** One function invocation in the trace. */
export interface Call {
  id: number;
  enter: number;
  leave: number;
  side: Side;
  fn: string;
  /** Where it was called from, relative to GOROOT/src, or "app:main.go". */
  file: string | null;
  line: number;
  depth: number;
  parent: number;
  children: number[];
}

/** One write to the transport: a burst of records sent together. */
export interface Flight {
  id: number;
  write: number;
  side: Side;
  ev: number;
  records: number[];
  bytes: number;
  tSend: number;
  tArrive: number;
}

export interface Model {
  cap: Capture;
  calls: Call[];
  /** For each event, the innermost call open on that event's side after it. */
  callAt: Int32Array;
  /** Network time of each event in RTTs, monotonic over the event log. */
  time: Float64Array;
  flights: Flight[];
  flightOfRecord: number[];
  recordEpoch: Epoch[];
  /** Message indices carried (wholly or partly) by each record. */
  recordMessages: number[][];
  /** Event at which each message was fully written / read. */
  messageWriteEv: number[];
  messageReadEv: number[];
  secretByEv: Map<number, number>;
  version: number;
  last: number;
}

export function epochOf(secret: string | undefined): Epoch {
  if (!secret) return "plain";
  if (secret.includes("EARLY")) return "early";
  if (secret.includes("HANDSHAKE")) return "hs";
  return "app";
}

export function buildModel(cap: Capture): Model {
  const n = cap.events.length;
  const calls: Call[] = [];
  const callAt = new Int32Array(n).fill(-1);
  const stacks: [number[], number[]] = [[], []];
  const fileOf = (i: number) => (i >= 0 ? cap.files[i] : null);

  cap.events.forEach((e, i) => {
    const side = e[1];
    const stack = stacks[side];
    if (e[0] === EV_ENTER) {
      const parent = stack.length ? stack[stack.length - 1] : -1;
      const c: Call = {
        id: calls.length,
        enter: i,
        leave: n - 1,
        side,
        fn: cap.fns[e[2]],
        file: fileOf(e[3]),
        line: e[4],
        depth: stack.length,
        parent,
        children: [],
      };
      if (parent >= 0) calls[parent].children.push(c.id);
      calls.push(c);
      stack.push(c.id);
    } else if (e[0] === EV_LEAVE) {
      const id = stack.pop();
      if (id !== undefined) calls[id].leave = i;
    }
    callAt[i] = stack.length ? stack[stack.length - 1] : -1;
  });

  // Network time: a side's clock only moves when it reads bytes that arrived
  // later than its current time. Each one-way trip is half an RTT.
  const recsByDir: [WireRecord[], WireRecord[]] = [[], []];
  cap.records.forEach((r) => recsByDir[r.dir].push(r));
  const flights: Flight[] = cap.writes.map((w, id) => ({
    id,
    write: id,
    side: w.side,
    ev: w.ev,
    records: [],
    bytes: w.len,
    tSend: 0,
    tArrive: 0,
  }));
  const flightOfRecord = cap.records.map((r) => r.write);
  cap.records.forEach((r, i) => flights[r.write]?.records.push(i));

  const side = [0, 0];
  const consumed = [0, 0];
  const time = new Float64Array(n);
  let clock = 0;
  cap.events.forEach((e, i) => {
    const s = e[1];
    if (e[0] === EV_WRITE) {
      const f = flights[e[2] as number];
      f.tSend = side[s];
      f.tArrive = side[s] + 0.5;
    } else if (e[0] === EV_READ) {
      consumed[s] += e[2] as number;
      // The last byte consumed belongs to the latest flight from the peer
      // whose start offset is below it.
      let arrive = side[s];
      for (const f of flights) {
        if (f.side === 1 - s && cap.writes[f.write].off < consumed[s]) arrive = Math.max(arrive, f.tArrive);
      }
      side[s] = Math.max(side[s], arrive);
    }
    clock = Math.max(clock, side[s]);
    time[i] = clock;
  });

  const recordEpoch: Epoch[] = cap.records.map((r) => epochOf(r.prot?.secret));
  const recordMessages: number[][] = cap.records.map(() => []);
  const messageWriteEv: number[] = [];
  const messageReadEv: number[] = [];
  cap.messages.forEach((m, mi) => {
    let w = 0;
    let rd = 0;
    for (const [ri] of m.parts) {
      recordMessages[ri].push(mi);
      const r = cap.records[ri];
      w = Math.max(w, cap.writes[r.write].ev);
      rd = Math.max(rd, r.readEv < 0 ? n : r.readEv);
    }
    messageWriteEv.push(w);
    messageReadEv.push(rd);
  });

  const secretByEv = new Map<number, number>();
  cap.events.forEach((e, i) => {
    if (e[0] === EV_SECRET) secretByEv.set(i, e[2] as number);
  });

  const sh = cap.messages.find((m) => m.type === 2 && !isHRR(m));
  return {
    cap,
    calls,
    callAt,
    time,
    flights,
    flightOfRecord,
    recordEpoch,
    recordMessages,
    messageWriteEv,
    messageReadEv,
    secretByEv,
    version: sh ? negotiatedVersion(sh) : 0x0303,
    last: n - 1,
  };
}

export function isHRR(m: HsMessage): boolean {
  return m.type === 2 && m.data.slice(12, 76) === hrrRandom;
}

/** The version a ServerHello selected, honoring supported_versions. */
export function negotiatedVersion(m: HsMessage): number {
  const b = hexBytes(m.data);
  let p = 4 + 2 + 32;
  p += 1 + b[p];
  p += 3;
  if (p + 2 > b.length) return (b[4] << 8) | b[5];
  const end = p + 2 + ((b[p] << 8) | b[p + 1]);
  p += 2;
  while (p + 4 <= end) {
    const t = (b[p] << 8) | b[p + 1];
    const l = (b[p + 2] << 8) | b[p + 3];
    if (t === 43 && l === 2) return (b[p + 4] << 8) | b[p + 5];
    p += 4 + l;
  }
  return (b[4] << 8) | b[5];
}

export function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function messageName(m: HsMessage): string {
  if (isHRR(m)) return "HelloRetryRequest";
  return handshakeShort[m.type] ?? `handshake(${m.type})`;
}

/** Label in RFC 8446 notation: {} for handshake keys, [] for application keys. */
export function wrapEpoch(label: string, ep: Epoch): string {
  if (ep === "hs") return `{${label}}`;
  if (ep === "app" || ep === "early") return `[${label}]`;
  return label;
}

export function recordLabel(model: Model, ri: number): string {
  const r = model.cap.records[ri];
  const ep = model.recordEpoch[ri];
  let label: string;
  if (r.inner === 22) {
    const ms = model.recordMessages[ri].map((mi) => messageName(model.cap.messages[mi]));
    label = ms.length ? ms.join(" + ") : "Handshake";
  } else if (r.inner === 21) {
    const d = parseInt(r.plain.slice(2, 4), 16);
    label = `Alert ${alertDescriptions[d] ?? d}`;
  } else if (r.inner === 23) {
    label = "应用数据";
  } else {
    label = contentTypes[r.inner] ?? `type ${r.inner}`;
  }
  return wrapEpoch(label, ep);
}

/** The network time of an event index, clamped. */
export function timeAt(model: Model, ev: number): number {
  return model.time[Math.max(0, Math.min(model.last, ev))];
}

export function callStackAt(model: Model, ev: number, side: Side): Call[] {
  let id = -1;
  for (let i = Math.min(ev, model.last); i >= 0; i--) {
    if (model.cap.events[i][1] === side) {
      id = model.callAt[i];
      break;
    }
  }
  const out: Call[] = [];
  while (id >= 0) {
    out.unshift(model.calls[id]);
    id = model.calls[id].parent;
  }
  return out;
}

/** Secrets each side has derived up to and including ev. */
export function secretsUpTo(model: Model, ev: number): number[] {
  return model.cap.secrets.map((s, i) => (s.ev <= ev ? i : -1)).filter((i) => i >= 0);
}

/** The innermost call active at ev on whichever side ran that event. */
export function activeCall(model: Model, ev: number): Call | null {
  const id = model.callAt[Math.max(0, Math.min(model.last, ev))];
  return id >= 0 ? model.calls[id] : null;
}

export function shortFn(key: string): string {
  return key
    .replace(/^crypto\/tls\./, "")
    .replace(/^crypto\/internal\/fips140\//, "")
    .replace(/^vendor\/golang\.org\/x\/crypto\//, "")
    .replace(/^crypto\//, "");
}
