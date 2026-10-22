// Every step anchor, code focus, message, and reference must resolve against
// the generated data. When a Go release renames a function or moves a line,
// this is the test that says which step to fix.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildModel } from "../src/capture/model";
import type { Capture, CodeFile, NoteIndexEntry, RfcIndexEntry, SymbolsFile } from "../src/data/types";
import { historyFor, scenariosFor } from "../src/i18n/content";
import { zhHistory, zhScenarios } from "../src/i18n/zhContent";
import { scenarioDefs } from "../src/scenarios";
import { resolveSteps } from "../src/scenarios/resolve";

const data = new URL("../public/data/", import.meta.url).pathname;
const json = <T>(p: string): T => JSON.parse(readFileSync(data + p, "utf8")) as T;

const symbols = json<SymbolsFile>("code/symbols.json");
const byKey = new Map(symbols.symbols.map((s) => [s.k, s]));
const notes = json<NoteIndexEntry[]>("notes/index.json");
const notesZh = json<NoteIndexEntry[]>("notes/zh/index.json");
const rfcs = json<RfcIndexEntry[]>("rfc/index.json");

function lineOf(fn: string, find: string): number {
  const s = byKey.get(fn)!;
  const file = json<CodeFile>(`code/files/${s.f}.json`);
  const lines = file.text.split("\n");
  for (let l = s.l; l <= (s.e ?? s.l); l++) if (lines[l - 1].includes(find)) return l;
  return -1;
}

for (const def of scenarioDefs) {
  describe(def.id, () => {
    it("has a capture", () => expect(existsSync(`${data}captures/${def.id}.json`)).toBe(true));
    const cap = json<Capture>(`captures/${def.id}.json`);
    const model = buildModel(cap);
    const { steps, errors } = resolveSteps(model, def);

    it("keeps generated presentation metadata in step with the English definition", () => {
      expect({ title: cap.title, brief: cap.brief }).toEqual({ title: def.title, brief: def.brief });
    });

    it("resolves every anchor in order", () => {
      expect(errors).toEqual([]);
      expect(steps).toHaveLength(def.steps.length);
    });

    // A record step must show the record it sends, not the one before it:
    // application data for the app steps, an alert for close_notify.
    for (const st of steps.filter((x) => x.recIndex >= 0)) {
      it(`${st.id}: selects the record its own side sends`, () => {
        const r = cap.records[st.recIndex];
        expect(r.dir).toBe(st.side);
        expect(r.inner).toBe(st.id === "close" ? 21 : 23);
        expect(cap.writes[r.write].ev).toBeGreaterThanOrEqual(st.start);
      });
    }

    for (const s of def.steps) {
      it(`${s.id}: code, refs, and markup resolve`, () => {
        if (s.code) {
          expect(byKey.has(s.code.fn), `symbol ${s.code.fn}`).toBe(true);
          expect(byKey.get(s.code.fn)!.x, `${s.code.fn} is indexed`).toBeUndefined();
          if (s.code.find) expect(lineOf(s.code.fn, s.code.find), `"${s.code.find}" in ${s.code.fn}`).toBeGreaterThan(0);
        }
        const links = [...s.body.matchAll(/\]\((\w+):([^)]+)\)/g)].map((m) => ({ [m[1]]: m[2] }));
        for (const r of [...(s.refs ?? []), ...links] as Record<string, unknown>[]) {
          if ("sym" in r) expect(byKey.has(r.sym as string), `symbol ${r.sym}`).toBe(true);
          if ("note" in r) {
            const n = notes.find((x) => x.id === r.note);
            expect(n, `note ${r.note}`).toBeTruthy();
            if (r.h) expect(n!.headings.map((h) => h.anchor), `heading ${r.note}#${r.h}`).toContain(r.h);
          }
          if ("rfc" in r && r.sec) {
            const doc = rfcs.find((x) => x.n === r.rfc);
            if (doc) expect(doc.sections.map((x) => x.id), `RFC ${r.rfc} §${r.sec}`).toContain(r.sec);
          }
        }
        expect(s.body).not.toMatch(/[–—]/);
      });
    }
  });
}

describe("history", async () => {
  const { entries } = await import("../src/history/entries");
  for (const e of entries) {
    it(`${e.id}: code, links, and text resolve`, () => {
      for (const c of e.code ?? []) {
        expect(byKey.has(c.fn), `symbol ${c.fn}`).toBe(true);
        expect(byKey.get(c.fn)!.x, `${c.fn} is indexed`).toBeUndefined();
        if (c.find) expect(lineOf(c.fn, c.find), `"${c.find}" in ${c.fn}`).toBeGreaterThan(0);
      }
      if (e.play) {
        const def = scenarioDefs.find((d) => d.id === e.play![0]);
        expect(def?.steps.map((s) => s.id), `step ${e.play.join("/")}`).toContain(e.play[1]);
      }
      if (e.note) {
        const n = notes.find((x) => x.id === e.note![0]);
        expect(n, `note ${e.note[0]}`).toBeTruthy();
        if (e.note[1]) expect(n!.headings.map((h) => h.anchor)).toContain(e.note[1]);
      }
      for (const [n, sec] of e.rfcs ?? []) {
        const doc = rfcs.find((x) => x.n === n);
        expect(doc, `RFC ${n} bundled`).toBeTruthy();
        if (sec) expect(doc!.sections.map((x) => x.id)).toContain(sec);
      }
      expect(`${e.title}${e.problem}${e.fix ?? ""}${e.go ?? ""}`).not.toMatch(/[–—]/);
    });
  }
});

describe("chinese edition", () => {
  it("covers every scenario and step without an English fallback", () => {
    expect(Object.keys(zhScenarios)).toEqual(scenarioDefs.map((def) => def.id));
    for (const def of scenarioDefs) {
      const localized = zhScenarios[def.id as keyof typeof zhScenarios];
      expect(Object.keys(localized.steps)).toEqual(def.steps.map((step) => step.id));
      const rendered = scenariosFor("zh").find((scenario) => scenario.id === def.id)!;
      expect(rendered.title).toBeTruthy();
      expect(rendered.brief).not.toBe(def.brief);
    }
  });

  it("covers every history entry and code label without an English fallback", () => {
    const english = historyFor("en").entries;
    expect(Object.keys(zhHistory.entries).sort()).toEqual(english.map((entry) => entry.id).sort());
    for (const entry of english) {
      const localized = zhHistory.entries[entry.id as keyof typeof zhHistory.entries];
      expect(localized.labels).toHaveLength(entry.code?.length ?? 0);
    }
  });

  for (const def of scenariosFor("zh")) {
    for (const s of def.steps) {
      for (const r of s.refs ?? []) {
        if (!("note" in r) || !r.h) continue;
        it(`${def.id}/${s.id} cites ${r.note}#${r.h}`, () => {
          const n = notesZh.find((x) => x.id === r.note);
          expect(n, `note ${r.note}`).toBeTruthy();
          expect(n!.headings.map((h) => h.anchor)).toContain(r.h);
        });
      }
    }
  }
  for (const e of historyFor("zh").entries) {
    if (!e.note?.[1]) continue;
    it(`history ${e.id} cites ${e.note[0]}#${e.note[1]}`, () => {
      const n = notesZh.find((x) => x.id === e.note![0]);
      expect(n).toBeTruthy();
      expect(n!.headings.map((h) => h.anchor)).toContain(e.note![1]);
    });
  }
});
