import { useEffect, useRef, useState } from "react";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Eases a displayed value toward `target`, always starting from what is on
 * screen, so a new target mid-flight retargets instead of jumping. Duration
 * scales with distance and is capped; `instant` (scrubbing, reduced motion)
 * snaps.
 */
export function useEased(target: number, opts: { msPerUnit: number; maxMs: number; instant: boolean }): number {
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  const frame = useRef(0);
  const moving = useRef(false);

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    const from = shown.current;
    const dist = Math.abs(target - from);
    if (opts.instant || reduced() || dist < 1e-6) {
      shown.current = target;
      moving.current = false;
      setValue(target);
      return;
    }
    // Retargeting while already moving keeps going (ease-out) instead of
    // stopping dead and accelerating again.
    const wasMoving = moving.current;
    moving.current = true;
    const dur = Math.min(opts.maxMs, Math.max(160, dist * opts.msPerUnit));
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = wasMoving ? 1 - Math.pow(1 - t, 3) : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      shown.current = from + (target - from) * e;
      setValue(shown.current);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else moving.current = false;
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, opts.instant, opts.msPerUnit, opts.maxMs]);

  return value;
}

export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
