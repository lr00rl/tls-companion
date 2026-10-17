// Shapes of the JSON written by tools/cmd/tlsindex, tools/cmd/tlscapture,
// scripts/build-notes.mjs, and scripts/build-rfc.mjs.

export interface CodeMeta {
  go: string;
  upstream: string;
  generated: string;
  packages: PkgMeta[];
}

export interface PkgMeta {
  path: string;
  name: string;
  display: string;
  synopsis: string;
  files: FileMeta[];
}

export interface FileMeta {
  p: string;
  lines: number;
  ignored?: boolean;
  constraint?: string;
}

/** A declaration. Keys look like crypto/tls.Conn.Handshake. */
export interface Sym {
  k: string;
  n: string;
  t: number;
  p: string;
  f: string;
  l: number;
  c: number;
  e?: number;
  s?: string;
  d?: string;
  r?: string;
  x?: 1;
}

export interface SymbolsFile {
  files: string[];
  symbols: Sym[];
}

export interface CodeFile {
  path: string;
  pkg: string;
  text: string;
  ignored?: boolean;
  /** Flat [start, length, kind, ref] quadruples in UTF-16 units. */
  tokens: number[];
  refs: string[];
  /** Local declarations: line, column, signature. */
  locals: [number, number, string][];
  /** Top-level declarations: line, end line, ref index, kind. */
  outline: [number, number, number, number][];
}

/** References to a symbol: file index, line, column, enclosing func key. */
export type RefsFile = Record<string, [number, number, number, string][]>;

export type Calls = Record<string, string[]>;

export type Side = 0 | 1;

export type TraceEvent =
  | [0, Side, number, number, number]
  | [1, Side, number]
  | [2, Side, number]
  | [3, Side, number]
  | [4, Side, number]
  | [5, Side, string];

export const EV_ENTER = 0;
export const EV_LEAVE = 1;
export const EV_WRITE = 2;
export const EV_READ = 3;
export const EV_SECRET = 4;
export const EV_MARK = 5;

export interface WireWrite {
  side: Side;
  ev: number;
  off: number;
  len: number;
}

export interface Protection {
  secret: string;
  seq: number;
  key: string;
  iv: string;
  nonce: string;
  aad: string;
  tag: string;
  explicitNonce?: string;
}

export interface WireRecord {
  dir: Side;
  off: number;
  type: number;
  ver: number;
  len: number;
  write: number;
  readEv: number;
  prot?: Protection;
  inner: number;
  plain: string;
  /** The whole record as sent: header and (encrypted) payload. */
  raw: string;
  pad?: number;
}

export interface HsMessage {
  dir: Side;
  type: number;
  data: string;
  /** [record index, start, end] slices of record plaintext. */
  parts: [number, number, number][];
  epoch: string;
}

export interface SecretEvent {
  side: Side;
  ev: number;
  op: "HKDF-Extract" | "Derive-Secret" | "HKDF-Expand-Label" | "PRF";
  label: string;
  in1: string;
  in2: string;
  out: string;
}

export interface KeylogLine {
  side: Side;
  ev: number;
  label: string;
  random: string;
  secret: string;
}

export interface CertInfo {
  role: "leaf" | "intermediate" | "root";
  subject: string;
  issuer: string;
  serial: string;
  notBefore: string;
  notAfter: string;
  dnsNames?: string[];
  keyAlg: string;
  sigAlg: string;
  isCA: boolean;
  sha256: string;
  der: string;
  onWire: boolean;
}

export interface StateInfo {
  version: string;
  cipherSuite: string;
  curve: string;
  alpn: string;
  serverName: string;
  resumed: boolean;
  hrr: boolean;
  peerCerts?: string[];
}

export interface Capture {
  id: string;
  title: string;
  brief: string;
  go: string;
  taken: string;
  addrs: [string, string];
  fns: string[];
  files: string[];
  events: TraceEvent[];
  writes: WireWrite[];
  records: WireRecord[];
  messages: HsMessage[];
  secrets: SecretEvent[];
  keylog: KeylogLine[];
  certs: CertInfo[];
  state: [StateInfo, StateInfo];
  config: [string[], string[]];
  stats: Record<string, number>;
}

export interface CaptureIndexEntry {
  id: string;
  title: string;
  brief: string;
  records: number;
  messages: number;
  events: number;
}

export interface NoteHeading {
  level: number;
  text: string;
  anchor: string;
}

export interface NoteIndexEntry {
  id: string;
  file: string;
  title: string;
  tags: string[];
  headings: NoteHeading[];
  chars: number;
}

export interface Note {
  id: string;
  file: string;
  title: string;
  tags: string[];
  type: string;
  headings: NoteHeading[];
  html: string;
  search: { anchor: string; heading: string; text: string }[];
  mermaid: number;
}

export interface RfcSection {
  id: string;
  title: string;
  level: number;
  line?: number;
}

export interface RfcIndexEntry {
  n: number;
  title: string;
  date: string;
  obsoletes: number[];
  updates: number[];
  sections: RfcSection[];
}

export interface RfcDoc extends RfcIndexEntry {
  lines: string[];
}
