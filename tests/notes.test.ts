// The English and Chinese notes must have the same headings, in the same order
// and at the same levels. Switching language keeps a reader's section by its
// position, and the scenario steps cite a heading in each edition, so a note
// that drifts out of step after a sync breaks both.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NoteIndexEntry } from "../src/data/types";
import { correspondingNoteAnchor, localizedNoteAnchor } from "../src/i18n/content";

const data = new URL("../public/data/notes/", import.meta.url).pathname;
const en = JSON.parse(readFileSync(`${data}index.json`, "utf8")) as NoteIndexEntry[];
const zh = JSON.parse(readFileSync(`${data}zh/index.json`, "utf8")) as NoteIndexEntry[];

describe("note editions", () => {
  it("have the same notes", () => {
    expect(en.map((n) => n.id)).toEqual(zh.map((n) => n.id));
  });

  it("use the same portable English filenames", () => {
    expect(en.map((n) => n.file)).toEqual(zh.map((n) => n.file));
    for (const note of en) expect(note.file).toMatch(/^(?:00|T\d{2})_[a-z0-9]+(?:-[a-z0-9]+)*\.md$/);
  });

  for (const n of en) {
    it(`${n.id} has matching heading levels in both editions`, () => {
      const z = zh.find((x) => x.id === n.id)!;
      expect(n.headings.map((h) => h.level)).toEqual(z.headings.map((h) => h.level));
    });

    it(`${n.id} maps every heading in both directions`, () => {
      const z = zh.find((x) => x.id === n.id)!;
      n.headings.forEach((heading, i) => {
        expect(correspondingNoteAnchor(n.id, heading.anchor, "en", "zh", en, zh)).toBe(z.headings[i].anchor);
        expect(correspondingNoteAnchor(n.id, z.headings[i].anchor, "zh", "en", en, zh)).toBe(heading.anchor);
        expect(localizedNoteAnchor(n.id, heading.anchor, "zh", en, zh)).toBe(z.headings[i].anchor);
        expect(localizedNoteAnchor(n.id, z.headings[i].anchor, "en", en, zh)).toBe(heading.anchor);
      });
    });
  }
});
