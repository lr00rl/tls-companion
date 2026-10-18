import { useState, type KeyboardEvent, type MouseEvent } from "react";

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
 * click does. Handled keys stop here, so the workbench's own arrow keys (step
 * back and forward) do not fire while the tree has focus.
 */
export function useTreeNav(rows: TreeRow[], preferred: string | undefined, ops: { toggle(key: string): void; activate(key: string): void }) {
  const [active, setActive] = useState<string | null>(null);
  const has = (k: string | null | undefined) => !!k && rows.some((r) => r.key === k);
  const current = has(active) ? active! : has(preferred) ? preferred! : rows[0]?.key;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const at = (document.activeElement as HTMLElement | null)?.dataset.treeKey;
    const i = rows.findIndex((r) => r.key === at);
    if (i < 0) return;
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

  // A click selects a row without focusing it, so the arrow keys keep stepping
  // the workbench for pointer users; keyboard users reach the tree with Tab.
  const rowProps = (key: string) => ({
    "data-tree-key": key,
    tabIndex: key === current ? 0 : -1,
    onFocus: () => setActive(key),
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
  });

  return { onKeyDown, rowProps };
}
