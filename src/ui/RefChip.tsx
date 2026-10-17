import { navigate } from "../app/route";
import { usePeek } from "../app/peek";
import { useWB } from "../app/store";
import { useLoad, load } from "../data/load";
import type { StepRef } from "../scenarios/types";

/** A link to an RFC section, a note heading, or a Go symbol. */
export function RefChip({ r }: { r: StepRef }) {
  const notes = useLoad("notes", load.notes);
  const rfcs = useLoad("rfcs", load.rfcs);
  if ("rfc" in r) {
    const doc = rfcs.state === "ready" ? rfcs.data.find((d) => d.n === r.rfc) : undefined;
    const sec = doc?.sections.find((s) => s.id === r.sec);
    return (
      <button className="chip" title={doc ? `${doc.title}${sec ? " · " + sec.title : ""}` : `RFC ${r.rfc}`} onClick={() => usePeek.getState().open(r.rfc, r.sec)}>
        <span className="k">RFC</span>
        {r.rfc}
        {r.sec ? ` §${r.sec}` : ""}
      </button>
    );
  }
  if ("note" in r) {
    const note = notes.state === "ready" ? notes.data.find((n) => n.id === r.note) : undefined;
    const h = note?.headings.find((x) => x.anchor === r.h);
    return (
      <a className="chip" href={`#/notes/${r.note}${r.h ? "/" + encodeURIComponent(r.h) : ""}`} title={note?.title}>
        <span className="k">{r.note}</span>
        {r.label ?? h?.text ?? note?.title.replace(/^T\d+ · /, "") ?? ""}
      </a>
    );
  }
  const name = r.sym.replace(/^crypto\/(internal\/fips140\/)?/, "");
  return (
    <button className="chip" title={r.sym} onClick={() => void useWB.getState().openSymbol(r.sym, { reason: "参考符号" })}>
      <span className="k">Go</span>
      {r.label ?? name}
    </button>
  );
}

export function goNote(id: string, anchor?: string) {
  navigate({ page: "notes", id, anchor });
}
