// Cross references in RFC prose must link to the RFC they name, not to the
// document being read.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RfcDoc } from "../src/data/types";
import { refsIn } from "../src/rfc/RfcText";

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
