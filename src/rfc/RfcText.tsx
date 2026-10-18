import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { RfcDoc } from "../data/types";

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

  const rows: ReactNode[] = [];
  for (let i = from; i < end; i++) {
    const line = doc.lines[i];
    const sec = sectionLines.get(i);
    rows.push(
      <div key={i} data-l={i} className={`rfc-line${sec ? " rfc-h" : ""}${sec && sec.id === section ? " target" : ""}`} id={sec ? `s-${sec.id}` : undefined}>
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
