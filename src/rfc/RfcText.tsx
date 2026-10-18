import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { RfcDoc } from "../data/types";
import { useMedia } from "../ui/hooks";

interface Props {
  doc: RfcDoc;
  section?: string;
  /** Lines to render around the section in compact mode; all when undefined. */
  window?: number;
  onSection: (n: number, section?: string) => void;
  onOpenFull?: () => void;
  bundled: Set<number>;
}

// "RFC 5246, Section 7.4", "Section 4.2 of [RFC8446]", "Appendix B", "[RFC5280]".
// A bare "Section N" points into the document being read.
const ref =
  /RFC ?(?<rfc>\d{3,5})(?:,? (?:Section|§) ?(?<rsec>\d+(?:\.\d+)*|[A-Z](?:\.\d+)*))?|(?:Section|Appendix) (?<sec>\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)(?: of (?:\[RFC(?<of>\d{3,5})\]|RFC ?(?<of2>\d{3,5})))?|\[RFC(?<br>\d{3,5})\]/g;

/**
 * Lines that belong to ASCII figures and tables, which keep their columns on
 * narrow screens while prose wraps. A single line is a weak signal (box
 * edges, arrows, rules, deep indentation, or a gap of three or more spaces
 * between words, where prose uses at most two), so whole blank-separated
 * blocks are judged: a block is a figure when at least 40% of its lines look
 * like one. A stray "--" in a paragraph then leaves the paragraph wrapping.
 */
export function figureLines(lines: string[]): Set<number> {
  const looks = (l: string) => /[|+]-|-[->+|]|<-|={3}|\S {3,}\S|^\s*[|+]|^ {10,}\S| [|^] /.test(l);
  const out = new Set<number>();
  for (let i = 0; i < lines.length; ) {
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    let j = i;
    let hits = 0;
    let braces = false;
    let decls = 0;
    for (; j < lines.length && lines[j].trim(); j++) {
      const t = lines[j].trim();
      if (looks(lines[j])) hits++;
      // Presentation-language structs and enums: an opening "{" line or a
      // closing "}" line, or a run of declarations that all end in ";".
      if (t.endsWith("{") || t.startsWith("}")) braces = true;
      if (t.endsWith(";")) decls++;
    }
    const n = j - i;
    if (braces || decls === n || hits / n >= 0.4) for (let k = i; k < j; k++) out.add(k);
    i = j;
  }
  return out;
}

export interface RefMatch {
  index: number;
  text: string;
  n: number;
  sec?: string;
}

export function refsIn(line: string, self: number): RefMatch[] {
  return [...line.matchAll(ref)].map((m) => {
    const g = m.groups!;
    return { index: m.index!, text: m[0], n: Number(g.rfc ?? g.of ?? g.of2 ?? g.br ?? self), sec: g.rsec ?? g.sec };
  });
}

/** RFC plain text with section and RFC references turned into links. */
export function RfcText({ doc, section, window: win, onSection, bundled }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const start = useMemo(() => {
    if (!section) return 0;
    return doc.sections.find((s) => s.id === section)?.line ?? 0;
  }, [doc, section]);
  const end = useMemo(() => {
    if (win === undefined) return doc.lines.length;
    const idx = doc.sections.findIndex((s) => s.id === section);
    const next = idx >= 0 ? doc.sections.slice(idx + 1).find((s) => s.level <= doc.sections[idx].level) : undefined;
    return Math.min(doc.lines.length, next?.line ?? start + win, start + 400);
  }, [doc, section, start, win]);
  const from = win === undefined ? 0 : start;

  useLayoutEffect(() => {
    if (win !== undefined) {
      box.current?.scrollTo({ top: 0 });
      return;
    }
    const b = box.current;
    const el = b?.querySelector(`[data-l="${start}"]`) as HTMLElement | null;
    if (el && b) b.scrollTop += el.getBoundingClientRect().top - b.getBoundingClientRect().top - 12;
  }, [start, win, doc]);

  const sectionLines = useMemo(() => new Map(doc.sections.map((s) => [s.line, s])), [doc]);
  const figures = useMemo(() => figureLines(doc.lines), [doc]);
  const narrow = useMedia("(max-width: 700px)");

  const rows: ReactNode[] = [];
  for (let i = from; i < end; i++) {
    const line = doc.lines[i];
    const sec = sectionLines.get(i);
    // On a narrow screen a paragraph hard-wrapped at 72 columns is joined
    // back into one block, so it wraps once instead of alternating long and
    // short lines. Headings and figures keep their lines.
    if (narrow && figures.has(i)) {
      // One horizontal scroller per figure, blank lines inside it included,
      // so panning a diagram leaves the prose around it in place.
      let j = i + 1;
      for (;;) {
        let k = j;
        while (k < end && !doc.lines[k].trim()) k++;
        if (k < end && figures.has(k)) j = k + 1;
        else break;
      }
      rows.push(
        <div key={i} data-l={i} className="rfc-fig">
          {doc.lines.slice(i, j).map((l, k) => (
            <div key={k} className="rfc-line fig">
              {linkify(l, doc.n, onSection, bundled)}
            </div>
          ))}
        </div>,
      );
      i = j - 1;
      continue;
    }
    if (narrow && line.trim() && !sec) {
      const indent = (l: string) => l.length - l.trimStart().length;
      const item = (l: string) => /^\s*(-|o|\*|\d+\.)\s/.test(l);
      let j = i + 1;
      while (
        j < end &&
        doc.lines[j].trim() &&
        !sectionLines.has(j) &&
        !figures.has(j) &&
        !item(doc.lines[j]) &&
        !(item(line) && indent(doc.lines[j]) <= indent(line))
      )
        j++;
      const text = doc.lines
        .slice(i, j)
        .map((l) => l.trim())
        // RFCs break lines only at existing hyphens ("Diffie-\n Hellman"), so a
        // line-end hyphen joins the next line without a space.
        .reduce((acc, l) => (/[A-Za-z0-9]-$/.test(acc) ? acc + l : `${acc} ${l}`));
      // Keep the RFC's indentation. Wrapped lines take the indent of the
      // paragraph's second line, which gives list items and "name:  text"
      // definitions their hanging indent; a one-line item hangs past its marker.
      const marker = /^(-|o|\*|\d+\.)\s+/.exec(text)?.[0].length ?? 0;
      const cont = j > i + 1 ? indent(doc.lines[i + 1]) : indent(line) + marker;
      rows.push(
        <div key={i} data-l={i} className="rfc-line rfc-para" style={{ paddingLeft: `${cont}ch`, textIndent: `${indent(line) - cont}ch` }}>
          {linkify(text, doc.n, onSection, bundled)}
        </div>,
      );
      i = j - 1;
      continue;
    }
    rows.push(
      <div key={i} data-l={i} className={`rfc-line${sec ? " rfc-h" : ""}${sec && sec.id === section ? " target" : ""}${figures.has(i) ? " fig" : ""}`} id={sec ? `s-${sec.id}` : undefined}>
        {linkify(line, doc.n, onSection, bundled)}
      </div>,
    );
  }
  return (
    <div className="rfc-text mono" ref={box}>
      {rows}
    </div>
  );
}

function linkify(line: string, self: number, onSection: Props["onSection"], bundled: Set<number>): ReactNode {
  if (!line) return " ";
  const out: ReactNode[] = [];
  let last = 0;
  for (const { index, text, n, sec } of refsIn(line, self)) {
    if (index > last) out.push(line.slice(last, index));
    const external = !bundled.has(n);
    out.push(
      <a
        key={index}
        href={external ? `https://www.rfc-editor.org/rfc/rfc${n}${sec ? `#section-${sec}` : ""}` : `#/rfc/${n}${sec ? "/" + sec : ""}`}
        target={external ? "_blank" : undefined}
        rel="noopener"
        onClick={(e) => {
          if (external) return;
          e.preventDefault();
          onSection(n, sec);
        }}
      >
        {text}
      </a>,
    );
    last = index + text.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
