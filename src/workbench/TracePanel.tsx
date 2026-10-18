import { useEffect, useMemo, useRef, useState } from "react";
import { executingAt, useWB } from "../app/store";
import { shortFn, type Call, type Model } from "../capture/model";
import { useTreeNav } from "../ui/tree";

interface Row {
  call: Call;
  depth: number;
  repeat: number;
  hasKids: boolean;
}

/** The real call tree of crypto/tls for the current step, both endpoints. */
export function TracePanel() {
  const model = useWB((s) => s.model);
  const steps = useWB((s) => s.steps);
  const step = useWB((s) => s.step);
  const cursor = useWB((s) => s.cursor);
  const traceSel = useWB((s) => s.traceSel);
  const [whole, setWhole] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const list = useRef<HTMLDivElement>(null);

  const range: [number, number] = whole || !steps[step] ? [0, model?.last ?? 0] : [steps[step].start, steps[step].end];
  const roots = useMemo(() => (model ? sliceRoots(model, range[0], range[1]) : []), [model, range[0], range[1]]);
  const current = model ? executingAt(model, cursor) : null;
  const focus = traceSel ?? current?.id ?? null;

  // A new range opens two levels.
  useEffect(() => {
    if (!model) return;
    const s = new Set<number>();
    for (const r of roots) {
      s.add(r.id);
      for (const c of r.children) s.add(c);
    }
    setOpen(s);
  }, [model, roots]);

  // Moving the cursor opens the path down to the focused call and keeps
  // whatever the reader expanded or collapsed by hand.
  useEffect(() => {
    if (!model || focus === null) return;
    setOpen((o) => {
      const s = new Set(o);
      for (let id = focus; id >= 0; id = model.calls[id].parent) s.add(id);
      return s;
    });
  }, [model, roots, focus]);

  useEffect(() => {
    list.current?.querySelector(".tr-row.focus")?.scrollIntoView({ block: "nearest" });
  }, [focus, open]);

  const rows: Row[] = [];
  if (model) {
    const visit = (ids: number[], depth: number) => {
      for (let i = 0; i < ids.length; i++) {
        const c = model.calls[ids[i]];
        if (c.enter < range[0] || c.enter > range[1]) continue;
        // Fold runs of identical leaf calls.
        let repeat = 1;
        while (i + repeat < ids.length && model.calls[ids[i + repeat]].fn === c.fn && !c.children.length && !model.calls[ids[i + repeat]].children.length) repeat++;
        rows.push({ call: c, depth, repeat, hasKids: c.children.length > 0 });
        if (open.has(c.id)) visit(c.children, depth + 1);
        i += repeat - 1;
      }
    };
    visit(
      roots.map((r) => r.id),
      0,
    );
  }

  const toggle = (id: number) => {
    const n = new Set(open);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setOpen(n);
  };
  const nav = useTreeNav(
    rows.map((r) => ({ key: String(r.call.id), level: r.depth + 1, expandable: r.hasKids, open: open.has(r.call.id) })),
    focus === null ? undefined : String(focus),
    { toggle: (k) => toggle(Number(k)), activate: (k) => useWB.getState().selectCall(Number(k)) },
  );

  if (!model) return <div className="panel" />;

  return (
    <div className="panel trace">
      <div className="panel-head">
        <h2>调用追踪</h2>
        <span className="muted num">{rows.length} 行</span>
        <span className="spacer" />
        <div className="seg-ctl" role="group" aria-label="追踪范围">
          <button className="btn" aria-pressed={!whole} onClick={() => setWhole(false)}>
            当前步骤
          </button>
          <button className="btn" aria-pressed={whole} onClick={() => setWhole(true)}>
            整条连接
          </button>
        </div>
      </div>
      <div className="panel-body tr-list" ref={list} role="tree" aria-label="调用追踪" onKeyDown={nav.onKeyDown}>
        {rows.length === 0 && <div className="empty">这一步里没有被追踪的 crypto/tls 调用。</div>}
        {rows.map(({ call, depth, repeat, hasKids }) => {
          const isOpen = open.has(call.id);
          const done = call.enter <= cursor;
          return (
            <div
              key={call.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasKids ? isOpen : undefined}
              aria-selected={call.id === focus}
              {...nav.rowProps(String(call.id))}
              className={`tr-row side-${call.side}${call.id === focus ? " focus" : ""}${done ? "" : " later"}`}
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => useWB.getState().selectCall(call.id)}
            >
              {hasKids ? (
                <button
                  className={`ft-tw${isOpen ? " open" : ""}`}
                  tabIndex={-1}
                  aria-hidden
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(call.id);
                  }}
                />
              ) : (
                <span className="ft-tw none" />
              )}
              <span className="tr-side">{call.side === 0 ? "C" : "S"}</span>
              <span className="tr-fn mono">{shortFn(call.fn)}</span>
              {repeat > 1 && <span className="tr-rep num">×{repeat}</span>}
              <span className="tr-site mono">{call.file ? `${call.file.split("/").pop()}:${call.line}` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Calls entered inside [a, b] whose parent was entered before a. */
function sliceRoots(model: Model, a: number, b: number): Call[] {
  const out: Call[] = [];
  for (const c of model.calls) {
    if (c.enter < a || c.enter > b) continue;
    const p = c.parent >= 0 ? model.calls[c.parent] : null;
    if (!p || p.enter < a) out.push(c);
  }
  return out;
}
