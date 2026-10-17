import { useEffect, useMemo, useRef } from "react";
import type { Field } from "../capture/dissect";
import { useSize } from "./clock";

interface Props {
  bytes: Uint8Array;
  fields: Field[];
  range: [number, number] | null;
  onPick: (offset: number) => void;
}

const hex = (b: number) => b.toString(16).padStart(2, "0");

/** Offset, hex, and ASCII columns, with length prefixes dimmed. */
export function HexView({ bytes, fields, range, onPick }: Props) {
  const [box, size] = useSize<HTMLDivElement>();
  const perRow = size.w > 520 ? 16 : 8;
  const scroller = useRef<HTMLDivElement>(null);

  const lenMask = useMemo(() => {
    const m = new Uint8Array(bytes.length);
    const mark = (fs: Field[]) => {
      for (const f of fs) {
        if (f.len) m.fill(1, f.start, f.end);
        if (f.children) mark(f.children);
      }
    };
    mark(fields);
    return m;
  }, [bytes, fields]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !range) return;
    const row = Math.floor(range[0] / perRow);
    const y = row * 18;
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 36) el.scrollTop = Math.max(0, y - 36);
  }, [range, perRow]);

  const rows = [];
  for (let r = 0; r * perRow < bytes.length; r++) {
    const a = r * perRow;
    const cells = [];
    const ascii = [];
    for (let i = a; i < Math.min(a + perRow, bytes.length); i++) {
      const on = range && i >= range[0] && i < range[1];
      const cls = `${on ? "on" : ""}${lenMask[i] ? " lenb" : ""}${i % 8 === 7 && i % perRow !== perRow - 1 ? " gap" : ""}`;
      cells.push(
        <span key={i} className={cls} data-o={i}>
          {hex(bytes[i])}
        </span>,
      );
      const c = bytes[i];
      ascii.push(
        <span key={i} className={on ? "on" : ""} data-o={i}>
          {c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : "·"}
        </span>,
      );
    }
    rows.push(
      <div key={r} className="hx-row">
        <span className="hx-off">{a.toString(16).padStart(4, "0")}</span>
        <span className="hx-bytes">{cells}</span>
        <span className="hx-ascii">{ascii}</span>
      </div>,
    );
  }

  return (
    <div className="hex-view" ref={box}>
      <div
        className="hx-scroll mono"
        ref={scroller}
        onClick={(e) => {
          const o = (e.target as HTMLElement).dataset.o;
          if (o !== undefined) onPick(Number(o));
        }}
      >
        {rows}
      </div>
    </div>
  );
}
