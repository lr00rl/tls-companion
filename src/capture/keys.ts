// Rebuilds the key schedule tree from the secrets one endpoint derived. Every
// value here was reported by crypto/tls itself through the instrumented HKDF
// and PRF primitives; nothing is recomputed.
import { tx } from "../i18n/lang";
import type { Capture, SecretEvent, Side } from "../data/types";
import type { Epoch } from "./model";

export interface KeyInput {
  name: string;
  value: string;
}

export interface KeyNode {
  secret: number;
  ev: number;
  op: SecretEvent["op"] | "split";
  label: string;
  name: string;
  value: string;
  inputs: KeyInput[];
  children: KeyNode[];
  epoch?: Epoch;
}

const deriveNames: Record<string, [string, Epoch?]> = {
  "c hs traffic": ["client_handshake_traffic_secret", "hs"],
  "s hs traffic": ["server_handshake_traffic_secret", "hs"],
  "c ap traffic": ["client_application_traffic_secret_0", "app"],
  "s ap traffic": ["server_application_traffic_secret_0", "app"],
  "c e traffic": ["client_early_traffic_secret", "early"],
  "e exp master": ["early_exporter_master_secret"],
  "exp master": ["exporter_master_secret"],
  "res master": ["resumption_master_secret"],
  "res binder": ["binder_key"],
  "ext binder": ["binder_key"],
  derived: ["derived"],
};

const expandNames: Record<string, string> = {
  key: "key",
  iv: "iv",
  finished: "finished_key",
};

function expandName(label: string): string {
  if (label === "resumption") return tx("PSK (for the next resumption)", "PSK（给下次恢复用）");
  if (label === "traffic upd") return tx("next traffic_secret", "下一代 traffic_secret");
  return expandNames[label] ?? label;
}

const prfNames: Record<string, string> = {
  "extended master secret": "master_secret",
  "master secret": "master_secret",
  "key expansion": "key_block",
  "client finished": "client verify_data",
  "server finished": "server verify_data",
};

const zero = (h: string) => /^0*$/.test(h);

export function buildKeyTree(cap: Capture, side: Side): KeyNode[] {
  const roots: KeyNode[] = [];
  const byValue = new Map<string, KeyNode>();
  let extracts = 0;
  cap.secrets.forEach((s, i) => {
    if (s.side !== side) return;
    const node: KeyNode = { secret: i, ev: s.ev, op: s.op, label: s.label, name: s.label, value: s.out, inputs: [], children: [] };
    let parent: KeyNode | undefined;
    switch (s.op) {
      case "HKDF-Extract": {
        const stage = ["Early Secret", "Handshake Secret", "Master Secret"][Math.min(extracts, 2)];
        extracts++;
        node.name = stage;
        parent = byValue.get(s.in1);
        node.inputs.push({ name: "salt", value: s.in1 || tx("(empty, taken as zeros)", "（空，按 0 处理）") });
        const ikmName =
          stage === "Early Secret"
            ? zero(s.in2)
              ? tx("IKM: no PSK, all zeros", "IKM：无 PSK，全零")
              : tx("IKM: PSK", "IKM：PSK")
            : stage === "Handshake Secret"
              ? tx(`IKM: (EC)DHE shared secret, ${s.in2.length / 2} bytes`, `IKM：(EC)DHE 共享秘密，${s.in2.length / 2} 字节`)
              : tx("IKM: all zeros", "IKM：全零");
        node.inputs.push({ name: ikmName, value: s.in2 });
        break;
      }
      case "Derive-Secret": {
        const [n, ep] = deriveNames[s.label] ?? [s.label];
        node.name = n;
        node.epoch = ep;
        parent = byValue.get(s.in1);
        node.inputs.push({ name: s.label === "derived" ? 'Transcript-Hash("")' : tx("Transcript-Hash (handshake messages so far)", "Transcript-Hash（到此为止的握手消息）"), value: s.in2 });
        break;
      }
      case "HKDF-Expand-Label": {
        node.name = expandName(s.label);
        parent = byValue.get(s.in1);
        if (s.in2) node.inputs.push({ name: "context", value: s.in2 });
        if (parent?.epoch) node.epoch = parent.epoch;
        break;
      }
      case "PRF": {
        node.name = prfNames[s.label] ?? s.label;
        parent = byValue.get(s.in1);
        node.inputs.push({ name: parent ? "secret" : "pre_master_secret", value: s.in1 });
        node.inputs.push({
          name: s.label === "key expansion" ? tx("seed: server_random ‖ client_random", "seed：server_random ‖ client_random") : s.label.includes("master") ? tx("seed: session hash", "seed：会话哈希") : tx("seed: handshake hash", "seed：握手哈希"),
          value: s.in2,
        });
        if (s.label === "key expansion") node.children.push(...splitKeyBlock(s, i));
        if (s.label.includes("master")) node.epoch = "app";
        break;
      }
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
    // Later derivations hang off the first node with a given value.
    if (!byValue.has(s.out)) byValue.set(s.out, node);
  });
  return roots;
}

/** AES-GCM key blocks: two keys, then two 4-byte implicit IVs (RFC 5246, 6.3). */
function splitKeyBlock(s: SecretEvent, i: number): KeyNode[] {
  const n = s.out.length / 2;
  const keyLen = (n - 8) / 2;
  if (!Number.isInteger(keyLen) || keyLen <= 0) return [];
  const part = (name: string, at: number, len: number): KeyNode => ({
    secret: i,
    ev: s.ev,
    op: "split",
    label: name,
    name,
    value: s.out.slice(at * 2, (at + len) * 2),
    inputs: [],
    children: [],
    epoch: "app",
  });
  return [
    part("client_write_key", 0, keyLen),
    part("server_write_key", keyLen, keyLen),
    part("client_write_IV", 2 * keyLen, 4),
    part("server_write_IV", 2 * keyLen + 4, 4),
  ];
}

/** Values both endpoints derived, to show they agree. */
export function sharedValues(cap: Capture): Set<string> {
  const a = new Set(cap.secrets.filter((s) => s.side === 0).map((s) => s.out));
  return new Set(cap.secrets.filter((s) => s.side === 1 && a.has(s.out)).map((s) => s.out));
}
