import { useRef } from "react";

interface Props {
  /** "x" resizes widths (vertical bar), "y" resizes heights. */
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  /** +1 when dragging right/down grows the value, -1 when it shrinks it. */
  dir?: 1 | -1;
  onChange: (v: number) => void;
  label: string;
}

/** A drag handle that tracks the pointer 1:1 from where it was grabbed. */
export function Splitter({ axis, value, min, max, dir = 1, onChange, label }: Props) {
  const start = useRef<{ p: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div
      className={`splitter splitter-${axis}`}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { p: axis === "x" ? e.clientX : e.clientY, v: value };
        document.body.classList.add(`resizing-${axis}`);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = (axis === "x" ? e.clientX : e.clientY) - start.current.p;
        onChange(clamp(start.current.v + d * dir));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove("resizing-x", "resizing-y");
      }}
      onPointerCancel={() => {
        start.current = null;
        document.body.classList.remove("resizing-x", "resizing-y");
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const k = e.key;
        const grow = axis === "x" ? (k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0) : k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0;
        if (!grow) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(clamp(value + grow * step * dir));
      }}
    />
  );
}
