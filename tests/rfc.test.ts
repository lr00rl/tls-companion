// Cross references in RFC prose must link to the RFC they name, not to the
// document being read.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RfcDoc } from "../src/data/types";
import { figureLines, refsIn } from "../src/rfc/RfcText";

const pick = (line: string, self = 8446) => refsIn(line, self).map(({ text, n, sec }) => ({ text, n, sec }));

describe("refsIn", () => {
  it("links a bare section into the current RFC", () => {
    expect(pick("as described in Section 4.2.8.")).toEqual([{ text: "Section 4.2.8", n: 8446, sec: "4.2.8" }]);
    expect(pick("see Appendix B.4")).toEqual([{ text: "Appendix B.4", n: 8446, sec: "B.4" }]);
  });

  it("links 'Section N of [RFCx]' and 'Section N of RFC x' to RFC x", () => {
    expect(pick("described in Section 2.1 of [RFC5116].")).toEqual([{ text: "Section 2.1 of [RFC5116]", n: 5116, sec: "2.1" }]);
    expect(pick("available in Section 2 of RFC 7841.")).toEqual([{ text: "Section 2 of RFC 7841", n: 7841, sec: "2" }]);
  });

  it("keeps the RFC-first and bracket-only forms", () => {
    expect(pick("RFC 5246, Section 7.4.1.4")).toEqual([{ text: "RFC 5246, Section 7.4.1.4", n: 5246, sec: "7.4.1.4" }]);
    expect(pick("[RFC5280] and RFC 6066")).toEqual([
      { text: "[RFC5280]", n: 5280, sec: undefined },
      { text: "RFC 6066", n: 6066, sec: undefined },
    ]);
  });

  it("resolves every 'Section N of RFC' line in the bundled RFC 8446 to another RFC", () => {
    const doc = JSON.parse(readFileSync(new URL("../public/data/rfc/rfc8446.json", import.meta.url), "utf8")) as RfcDoc;
    const lines = doc.lines.filter((l) => /(Section|Appendix) [0-9A-Z.]+ of (\[RFC|RFC ?)\d+/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const m = refsIn(l, 8446).find((r) => / of /.test(r.text));
      expect(m, l).toBeDefined();
      expect(m!.n, l).not.toBe(8446);
    }
  });
});

// On narrow screens prose wraps and figures keep their columns, so the
// handshake diagram in RFC 8446 section 2 must be kept whole, and the
// paragraphs around it must wrap.
describe("figureLines", () => {
  const doc = JSON.parse(readFileSync(new URL("../public/data/rfc/rfc8446.json", import.meta.url), "utf8")) as RfcDoc;
  const fig = figureLines(doc.lines);
  const at = (text: string, from = 0) => doc.lines.findIndex((l, i) => i >= from && l.includes(text));
  const s2 = doc.sections.find((s) => s.id === "2")!.line;

  it("keeps every line of the full handshake diagram", () => {
    const first = at("Client                                           Server", s2);
    const last = at("[Application Data]      <------->  [Application Data]", s2);
    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(first);
    for (let i = first; i <= last; i++) if (doc.lines[i].trim()) expect(fig.has(i), doc.lines[i]).toBe(true);
  });

  it("lets prose wrap, including a paragraph with a stray '--'", () => {
    expect(fig.has(at("Figure 1 below shows the basic full TLS handshake:", s2))).toBe(false);
    expect(fig.has(at("is reduced -- as, for"))).toBe(false);
  });
});

describe("figureLines on presentation-language structs", () => {
  const doc = JSON.parse(readFileSync(new URL("../public/data/rfc/rfc8446.json", import.meta.url), "utf8")) as RfcDoc;
  const fig = figureLines(doc.lines);

  it("keeps every struct and enum block, however short, as a figure", () => {
    const opens = doc.lines.map((l, i) => [l.trim(), i] as const).filter(([t]) => /^(struct|enum)\b.*\{$/.test(t) || t === "struct {" || t === "enum {");
    expect(opens.length).toBeGreaterThan(30);
    for (const [, i] of opens) expect(fig.has(i), doc.lines[i]).toBe(true);
    const short = doc.lines.findIndex((l) => l.includes("KeyShareEntry client_shares<0..2^16-1>;"));
    expect(fig.has(short)).toBe(true);
  });
});

describe("figureLines edge cases from RFC 5246 and RFC 9849", () => {
  const load = (n: number) => JSON.parse(readFileSync(new URL(`../public/data/rfc/rfc${n}.json`, import.meta.url), "utf8")) as RfcDoc;

  it("keeps a two-line enum whose first line ends in '}' as a figure", () => {
    const d = load(5246);
    const fig = figureLines(d.lines);
    const i = d.lines.findIndex((l) => /^\s*enum \{ null\(0\), rc4\(1\)/.test(l) || /^\s*enum \{.*\}\s*$/.test(l));
    expect(i).toBeGreaterThan(0);
    expect(fig.has(i), d.lines[i]).toBe(true);
  });

  it("lets a one-line list item ending in ';' wrap", () => {
    const d = load(9849);
    const fig = figureLines(d.lines);
    const items = d.lines
      .map((l, i) => [l, i] as const)
      .filter(([l, i]) => /;\s*$/.test(l) && /^\s+(-|o|\*|\d+\.)\s+[A-Za-z]/.test(l) && !d.lines[i - 1]?.trim() && !d.lines[i + 1]?.trim());
    expect(items.length).toBeGreaterThan(0);
    for (const [l, i] of items) expect(fig.has(i), l).toBe(false);
  });
});
