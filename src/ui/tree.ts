import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

export interface TreeRow {
  key: string;
  /** 1 for top-level rows. */
  level: number;
  expandable: boolean;
  open: boolean;
}

/**
 * Keyboard model for a rendered tree, after the WAI-ARIA tree view pattern.
 * The tree is one tab stop. Up and Down move between visible rows, Right
 * opens a row or steps into its first child, Left closes a row or steps out to
 * its parent, Home and End jump to the ends, and Enter or Space does what a
 * click does. Keys the tree handles stop here; the rest reach the
 * workbench, whose Left and Right change step.
 */
export function useTreeNav(rows: TreeRow[], preferred: string | undefined, ops: { toggle(key: string): void; activate(key: string): void }) {
  const [active, setActive] = useState<string | null>(null);
  const has = (k: string | null | undefined) => !!k && rows.some((r) => r.key === k);
  const current = has(active) ? active! : has(preferred) ? preferred! : rows[0]?.key;
  // Set by a pointer press on a row, cleared once the keyboard takes over or
  // focus leaves. :focus-visible cannot tell: browsers turn it on for the
  // focused element as soon as a key is pressed, before the handler runs.
  const byPointer = useRef(false);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const el = document.activeElement as HTMLElement | null;
    const i = rows.findIndex((r) => r.key === el?.dataset.treeKey);
    if (i < 0) return;
    // A row focused by a click takes only Up, Down, Home, and End, which start
    // keyboard use; Left, Right, Enter, and Space go on to the workbench, so
    // clicking a field and pressing Right still steps.
    const moves = ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key);
    if (byPointer.current && !moves) return;
    if (moves) byPointer.current = false;
    const r = rows[i];
    let to = -1;
    switch (e.key) {
      case "ArrowDown":
        to = Math.min(rows.length - 1, i + 1);
        break;
      case "ArrowUp":
        to = Math.max(0, i - 1);
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = rows.length - 1;
        break;
      case "ArrowRight":
        if (r.expandable && !r.open) ops.toggle(r.key);
        else if (r.expandable && rows[i + 1]?.level > r.level) to = i + 1;
        break;
      case "ArrowLeft":
        if (r.expandable && r.open) ops.toggle(r.key);
        else for (let j = i - 1; j >= 0 && to < 0; j--) if (rows[j].level < r.level) to = j;
        break;
      case "Enter":
      case " ":
        ops.activate(r.key);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (to < 0) return;
    const key = rows[to].key;
    setActive(key);
    e.currentTarget.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`)?.focus();
  };

  const rowProps = (key: string) => ({
    "data-tree-key": key,
    tabIndex: key === current ? 0 : -1,
    onFocus: () => setActive(key),
    onPointerDown: () => {
      byPointer.current = true;
    },
  });

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) byPointer.current = false;
  };

  /** Spread on the element with role="tree". */
  const treeProps = { onKeyDown, onBlur };

  return { treeProps, rowProps };
}
