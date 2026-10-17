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

const ref = /(RFC ?(\d{3,5})(?:,? (?:Section|§) ?(\d+(?:\.\d+)*|[A-Z](?:\.\d+)*))?)|((?:Section|Appendix) (\d+(?:\.\d+)*|[A-Z](?:\.\d+)*))|\[RFC(\d{3,5})\]/g;

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
  for (const m of line.matchAll(ref)) {
    if (m.index! > last) out.push(line.slice(last, m.index));
    const n = m[2] ? Number(m[2]) : m[6] ? Number(m[6]) : self;
    const sec = m[3] ?? m[5];
    const text = m[0];
    const external = !bundled.has(n);
    out.push(
      <a
        key={m.index}
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
    last = m.index! + text.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
