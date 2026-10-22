import type { NoteIndexEntry } from "../data/types";
import { entries, tracks, type Entry, type Track } from "../history/entries";
import { scenarioDefs } from "../scenarios";
import type { ScenarioDef, StepRef } from "../scenarios/types";
import type { Lang } from "./lang";
import { zhHistory, zhScenarios } from "./zhContent";

type ZhStep = { title: string; body: string; h: readonly string[] };
type ZhScenario = { short: string; intro: string; steps: Record<string, ZhStep> };
type ZhEntry = { title: string; problem: string; fix: string; go: string; labels: readonly string[]; noteH: string; hint: string };

const scenarios = zhScenarios as unknown as Record<string, ZhScenario>;
const historyZh = zhHistory.entries as unknown as Record<string, ZhEntry>;

const zhMeta: Record<string, { title: string; brief: string }> = {
  "tls13-full": {
    title: "TLS 1.3 完整握手",
    brief: "X25519MLKEM768 混合密钥交换，ECDSA 证书链，1-RTT，随后一次 HTTP/1.1 请求和会话票据",
  },
  "tls13-hrr": {
    title: "TLS 1.3 HelloRetryRequest",
    brief: "服务器只接受 P-256，客户端猜的 key_share 落空，多花一个往返重发 ClientHello",
  },
  "tls13-resume": {
    title: "TLS 1.3 PSK 会话恢复",
    brief: "用上一条连接收到的 NewSessionTicket 恢复会话，psk_dhe_ke 模式，不再发送证书",
  },
  "tls12-ecdhe": {
    title: "TLS 1.2 ECDHE 握手",
    brief: "ECDHE_ECDSA_WITH_AES_128_GCM_SHA256，X25519，扩展主密钥，2-RTT",
  },
  "tls12-rsa": {
    title: "TLS 1.2 RSA 密钥传输",
    brief: "TLS_RSA_WITH_AES_128_GCM_SHA256：预主密钥用服务器公钥加密传输，没有前向保密",
  },
};

function localizeScenario(def: ScenarioDef): ScenarioDef {
  const z = scenarios[def.id];
  const meta = zhMeta[def.id];
  const copy = structuredClone(def);
  if (meta) {
    copy.title = meta.title;
    copy.brief = meta.brief;
  }
  if (!z) return copy;
  copy.short = z.short;
  copy.intro = z.intro;
  for (const step of copy.steps) {
    const zs = z.steps[step.id];
    if (!zs) continue;
    step.title = zs.title;
    step.body = zs.body;
    let i = 0;
    for (const r of step.refs ?? []) {
      if ("h" in r && r.h) (r as StepRef & { h: string }).h = zs.h[i++] || r.h;
    }
  }
  return copy;
}

let zhScenariosCache: ScenarioDef[] | null = null;

/** Scenario text for the active language. English is the source the tests check. */
export function scenariosFor(lang: Lang): ScenarioDef[] {
  if (lang === "en") return scenarioDefs;
  if (!zhScenariosCache) zhScenariosCache = scenarioDefs.map(localizeScenario);
  return zhScenariosCache;
}

export function scenarioFor(lang: Lang, id: string): ScenarioDef | undefined {
  return scenariosFor(lang).find((d) => d.id === id);
}

function localizeEntry(e: Entry): Entry {
  const z = historyZh[e.id];
  if (!z) return e;
  const copy = structuredClone(e);
  copy.title = z.title || copy.title;
  copy.problem = z.problem || copy.problem;
  if (z.fix) copy.fix = z.fix;
  if (z.go) copy.go = z.go;
  if (copy.code && z.labels.length === copy.code.length) copy.code = copy.code.map((c, i) => ({ ...c, label: z.labels[i] || c.label }));
  if (copy.note && z.noteH) copy.note = [copy.note[0], z.noteH];
  if (copy.diff && z.hint) copy.diff = { ...copy.diff, hint: z.hint };
  return copy;
}

let zhHistoryCache: { entries: Entry[]; tracks: Record<Track, string> } | null = null;

export function historyFor(lang: Lang): { entries: Entry[]; tracks: Record<Track, string> } {
  if (lang === "en") return { entries, tracks };
  if (!zhHistoryCache) {
    zhHistoryCache = {
      entries: entries.map(localizeEntry),
      tracks: { proto: zhHistory.tracks.proto, attack: zhHistory.tracks.attack, go: zhHistory.tracks.go },
    };
  }
  return zhHistoryCache;
}

/** Map a note heading to the heading at the same position in the other edition. */
export function correspondingNoteAnchor(
  noteId: string,
  anchor: string,
  from: Lang,
  to: Lang,
  en: NoteIndexEntry[],
  zh: NoteIndexEntry[],
): string | undefined {
  const source = (from === "zh" ? zh : en).find((note) => note.id === noteId);
  const target = (to === "zh" ? zh : en).find((note) => note.id === noteId);
  const index = source?.headings.findIndex((heading) => heading.anchor === anchor) ?? -1;
  return index >= 0 ? target?.headings[index]?.anchor : undefined;
}

/** Resolve a language-neutral note URL to the active edition's heading. */
export function localizedNoteAnchor(noteId: string, anchor: string, lang: Lang, en: NoteIndexEntry[], zh: NoteIndexEntry[]): string | undefined {
  const current = (lang === "zh" ? zh : en).find((note) => note.id === noteId);
  if (current?.headings.some((heading) => heading.anchor === anchor)) return anchor;
  return correspondingNoteAnchor(noteId, anchor, lang === "zh" ? "en" : "zh", lang, en, zh);
}
