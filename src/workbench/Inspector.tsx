import { useEffect, useMemo, useState } from "react";
import { usePeek } from "../app/peek";
import { useWB } from "../app/store";
import { dissect, dissectRecordPlain, type Field } from "../capture/dissect";
import { hexBytes, messageName, recordLabel, wrapEpoch, type Model } from "../capture/model";
import { contentTypes } from "../capture/names";
import type { InspectorTab } from "../scenarios/types";
import { useTreeNav, type TreeRow } from "../ui/tree";
import { useFieldSites } from "./fieldSites";
import { HexView } from "./HexView";
import { KeySchedule } from "./KeySchedule";
import { CertView, ConnView } from "./CertView";
import { RecordView } from "./RecordView";
import "./inspector.css";

const tabs: [InspectorTab, string][] = [
  ["fields", "字段"],
  ["record", "记录"],
  ["keys", "密钥"],
  ["certs", "证书"],
  ["conn", "连接"],
];

export function Inspector() {
  const model = useWB((s) => s.model);
  const tab = useWB((s) => s.tab);
  const sel = useWB((s) => s.sel);
  if (!model) return <div className="panel" />;
  return (
    <div className="panel inspector">
      <div className="panel-head">
        <div className="tabs" role="tablist" aria-label="检查器">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => useWB.getState().setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="sel-name mono">{selectionName(model, sel)}</span>
      </div>
      <div className="panel-body">
        {tab === "fields" && <FieldsTab model={model} />}
        {tab === "record" && <RecordView model={model} />}
        {tab === "keys" && <KeySchedule model={model} />}
        {tab === "certs" && <CertView model={model} />}
        {tab === "conn" && <ConnView model={model} />}
      </div>
    </div>
  );
}

function selectionName(model: Model, sel: ReturnType<typeof useWB.getState>["sel"]): string {
  if (!sel) return "";
  if (sel.kind === "msg") {
    const m = model.cap.messages[sel.index];
    return wrapEpoch(messageName(m), m.epoch === "plaintext" ? "plain" : model.recordEpoch[m.parts[0][0]]);
  }
  return recordLabel(model, sel.index);
}

function FieldsTab({ model }: { model: Model }) {
  const sel = useWB((s) => s.sel);
  const hover = useWB((s) => s.hover);
  const symbols = useWB((s) => s.symbols);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Selecting a field replaces sel, so the dissection keys on the message alone.
  const selKind = sel?.kind;
  const selIndex = sel?.index;
  const view = useMemo(() => {
    if (selKind === undefined || selIndex === undefined) return null;
    if (selKind === "msg") {
      const m = model.cap.messages[selIndex];
      const bytes = hexBytes(m.data);
      return { bytes, fields: dissect(bytes, { version: model.version, certs: model.cap.certs }), dir: m.dir, title: messageName(m), epoch: m.epoch };
    }
    const r = model.cap.records[selIndex];
    const bytes = hexBytes(r.plain);
    return { bytes, fields: dissectRecordPlain(r.inner, bytes), dir: r.dir, title: contentTypes[r.inner] ?? "记录", epoch: r.prot?.secret ?? "plaintext" };
  }, [selKind, selIndex, model]);

  // A new message opens at its top level.
  useEffect(() => {
    if (!view) return;
    const next = new Set<string>();
    view.fields.forEach((f, i) => f.children && !f.len && next.add(String(i)));
    setOpen(next);
  }, [view]);

  // Selecting a field opens the path to it and leaves the rest as the reader set it.
  const fieldKey = sel?.kind === "msg" && sel.field ? sel.field.join("/") : "";
  useEffect(() => {
    if (!fieldKey) return;
    const parts = fieldKey.split("/");
    setOpen((o) => {
      const next = new Set(o);
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join("/")));
      return next;
    });
  }, [view, fieldKey]);

  const selPath = sel?.kind === "msg" ? sel.field : undefined;
  const selKey = selPath?.join("/");
  const selected = selPath && view ? findPath(view.fields, selPath) : undefined;
  const sites = useFieldSites(selected?.go, symbols);

  // The visible rows in order, shared by rendering and the keyboard model.
  const flat: (TreeRow & { f: Field; path: string[] })[] = [];
  const walk = (fs: Field[], path: string[], level: number) => {
    fs.forEach((f, i) => {
      const p = [...path, String(i)];
      const key = p.join("/");
      const isOpen = open.has(key);
      flat.push({ key, level, expandable: !!f.children, open: isOpen, f, path: p });
      if (f.children && isOpen) walk(f.children, p, level + 1);
    });
  };
  if (view) walk(view.fields, [], 1);

  const toggle = (key: string) => {
    const n = new Set(open);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setOpen(n);
  };
  const choose = (f: Field, path: string[]) => {
    useWB.getState().selectField(path, undefined, [f.start, f.end]);
  };
  const nav = useTreeNav(flat, selKey, {
    toggle,
    activate: (key) => {
      const r = flat.find((x) => x.key === key);
      if (r) choose(r.f, r.path);
    },
  });

  if (!view)
    return (
      <div className="empty">
        <strong>没有选中报文</strong>
        在时序图上点一条记录，或者选一个步骤。
      </div>
    );

  const rows = flat.map(({ key, level, f, path, open: isOpen }) => {
    const isSel = key === selKey;
    const inHover = hover && f.start <= hover[0] && hover[1] <= f.end && !f.len;
    return (
      <div
        key={key + f.start}
        role="treeitem"
        aria-level={level}
        aria-expanded={f.children ? isOpen : undefined}
        aria-selected={isSel}
        {...nav.rowProps(key)}
        className={`ft-row${isSel ? " sel" : ""}${f.len ? " len" : ""}${inHover && !isSel ? " hov" : ""}`}
        style={{ paddingLeft: 8 + (level - 1) * 14 }}
        onClick={() => choose(f, path)}
        onPointerEnter={() => useWB.getState().setHover([f.start, f.end])}
      >
        {f.children ? (
          <button
            className={`ft-tw${isOpen ? " open" : ""}`}
            tabIndex={-1}
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              toggle(key);
            }}
          />
        ) : (
          <span className="ft-tw none" />
        )}
        <span className="ft-name mono">{f.name}</span>
        {f.value && <span className="ft-val">{f.value}</span>}
        <span className="ft-size num">{f.end - f.start}</span>
      </div>
    );
  });

  return (
    <div className="fields-tab">
      <div className="ft-meta">
        <span className={`dir dir-${view.dir}`}>{view.dir === 0 ? "客户端 → 服务器" : "服务器 → 客户端"}</span>
        <strong className="mono">{view.title}</strong>
        <span className="num">{view.bytes.length} 字节</span>
        <span className="muted">{view.epoch === "plaintext" ? "明文" : `解密自 ${view.epoch}`}</span>
      </div>
      <div className="ft-split">
        <div
          className="field-tree"
          role="tree"
          aria-label={`${view.title} 的字段`}
          onKeyDown={nav.onKeyDown}
          onPointerLeave={() => useWB.getState().setHover(selected ? [selected.start, selected.end] : null)}
        >
          {rows}
        </div>
        <HexView
          bytes={view.bytes}
          fields={view.fields}
          range={hover ?? (selected ? [selected.start, selected.end] : null)}
          onPick={(off) => {
            const path = leafIndices(view.fields, off);
            const f = findPath(view.fields, path);
            if (f) choose(f, path);
          }}
        />
      </div>
      {selected && (
        <div className="field-detail">
          <div className="fd-title">
            <span className="mono">{namePath(view.fields, selPath!)}</span>
            <span className="num muted">
              偏移 {selected.start}–{selected.end - 1}，{selected.end - selected.start} 字节
            </span>
          </div>
          {selected.note && <p className="fd-note">{selected.note}</p>}
          <div className="fd-links">
            {selected.rfc && (
              <button className="chip" onClick={() => usePeek.getState().open(selected.rfc![0], selected.rfc![1])}>
                <span className="k">RFC</span>
                {selected.rfc[0]} §{selected.rfc[1]}
              </button>
            )}
            {sites?.def && (
              <button className="chip" onClick={() => useWB.getState().openCode(sites.def!.target, { push: true })}>
                <span className="k">Go 字段</span>
                {selected.go?.split(".").slice(-2).join(".")}
              </button>
            )}
            {sites?.writes.slice(0, 3).map((s, i) => (
              <button key={"w" + i} className="chip" onClick={() => useWB.getState().openCode(s.target, { push: true })}>
                <span className="k">写入</span>
                {s.fn.split(".").slice(-2).join(".")}:{s.line}
              </button>
            ))}
            {sites?.reads.slice(0, 3).map((s, i) => (
              <button key={"r" + i} className="chip" onClick={() => useWB.getState().openCode(s.target, { push: true })}>
                <span className="k">解析</span>
                {s.fn.split(".").slice(-2).join(".")}:{s.line}
              </button>
            ))}
            {selected.cert !== undefined && (
              <button className="chip" onClick={() => useWB.getState().setTab("certs")}>
                <span className="k">证书</span>
                查看第 {selected.cert + 1} 张
              </button>
            )}
          </div>
        </div>
      )}
      <AutoOpenSite sites={sites} dir={view.dir} goKey={selected?.go} />
    </div>
  );
}

/** When a field is picked, show the line that wrote it on the sending side. */
function AutoOpenSite({ sites, dir, goKey }: { sites: ReturnType<typeof useFieldSites>; dir: number; goKey?: string }) {
  const [done, setDone] = useState<string | undefined>();
  useEffect(() => {
    if (!goKey || done === goKey || !sites) return;
    const pick = dir === 0 || dir === 1 ? (sites.writes[0] ?? sites.def) : sites.def;
    if (pick && (sites.writes.length || sites.reads.length)) {
      useWB.getState().openCode(pick.target, { push: true });
      setDone(goKey);
    }
  }, [sites, goKey, dir, done]);
  return null;
}

// Field paths are child indices joined by "/", so repeated names stay distinct.
function findPath(fs: Field[], path: string[]): Field | undefined {
  let cur: Field | undefined;
  let list = fs;
  for (const i of path) {
    cur = list[Number(i)];
    if (!cur) return undefined;
    list = cur.children ?? [];
  }
  return cur;
}

function namePath(fs: Field[], path: string[]): string {
  const names: string[] = [];
  let list = fs;
  for (const i of path) {
    const f = list[Number(i)];
    if (!f) break;
    names.push(f.name);
    list = f.children ?? [];
  }
  return names.join(" › ");
}

function leafIndices(fs: Field[], off: number): string[] {
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    if (off >= f.start && off < f.end) return [String(i), ...(f.children ? leafIndices(f.children, off) : [])];
  }
  return [];
}
