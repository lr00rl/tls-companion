import { useMemo, useState } from "react";
import { usePeek } from "../app/peek";
import { useWB } from "../app/store";
import { buildKeyTree, sharedValues, type KeyNode } from "../capture/keys";
import { useLang, useTx } from "../i18n/lang";
import type { Model } from "../capture/model";

const opLabel: Record<string, string> = {
  "HKDF-Extract": "HKDF-Extract",
  "Derive-Secret": "Derive-Secret",
  "HKDF-Expand-Label": "HKDF-Expand-Label",
  PRF: "PRF",
  split: "split",
};

/** The key schedule as one endpoint ran it, with every real value. */
export function KeySchedule({ model }: { model: Model }) {
  const lang = useLang();
  const t = useTx();
  const side = useWB((s) => s.keySide);
  const cursor = useWB((s) => s.cursor);
  const steps = useWB((s) => s.steps);
  const step = useWB((s) => s.step);
  const roots = useMemo(() => buildKeyTree(model.cap, side), [model, side, lang]);
  const shared = useMemo(() => sharedValues(model.cap), [model]);
  const cur = steps[step];
  const tls13 = model.version === 0x0304;

  return (
    <div className="keys">
      <div className="keys-head">
        <div className="seg-ctl" role="group" aria-label={t("Which side", "查看哪一端")}>
          {([t("Client", "客户端"), t("Server", "服务器")] as const).map((l, i) => (
            <button key={l} className="btn" aria-pressed={side === i} onClick={() => useWB.getState().setKeySide(i as 0 | 1)}>
              {l}
            </button>
          ))}
        </div>
        <span className="muted">
          {tls13 ? t("The RFC 8446 §7.1 tree, with values from crypto/tls", "RFC 8446 §7.1 的推导树，值来自 crypto/tls 运行时") : t("The TLS 1.2 PRF, with values from crypto/tls", "TLS 1.2 PRF 推导，值来自 crypto/tls 运行时")}
        </span>
        <span className="spacer" />
        <button className="chip" onClick={() => usePeek.getState().open(tls13 ? 8446 : 5246, tls13 ? "7.1" : "8.1")}>
          <span className="k">RFC</span>
          {tls13 ? "8446 §7.1" : "5246 §8.1"}
        </button>
      </div>
      {roots.length === 0 && <div className="empty">{t("This side derived no secrets.", "这一端没有派生任何秘密。")}</div>}
      <ul className="ktree">
        {roots.map((n) => (
          <KeyRow key={n.secret + n.name} node={n} cursor={cursor} cur={cur ? [cur.start, cur.end] : [0, 0]} shared={shared} />
        ))}
      </ul>
    </div>
  );
}

function KeyRow({ node, cursor, cur, shared }: { node: KeyNode; cursor: number; cur: [number, number]; shared: Set<string> }) {
  const t = useTx();
  const [open, setOpen] = useState(false);
  const now = node.ev >= cur[0] && node.ev <= cur[1];
  // Secrets the current step derives are shown even before the cursor reaches them.
  const future = node.ev > cursor && !now;
  const isStage = node.op === "HKDF-Extract" || (node.op === "PRF" && node.name === "master_secret");
  return (
    <li className={`krow${future ? " future" : ""}${now ? " now" : ""}${isStage ? " stage" : ""}`}>
      <div className="k-line ep" data-ep={node.epoch ?? "plain"}>
        <button className="k-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="k-name mono">{node.name}</span>
          <span className="k-op">
            {node.op === "split" ? t("split", "切分") : opLabel[node.op]}
            {node.op === "Derive-Secret" || node.op === "HKDF-Expand-Label" || node.op === "PRF" ? `("${node.label}")` : ""}
          </span>
          <span className="k-val mono">{future ? t("not yet", "尚未派生") : node.value.slice(0, 16) + (node.value.length > 16 ? "…" : "")}</span>
          {now && <span className="k-now">{t("now", "本步")}</span>}
          {!future && shared.has(node.value) && node.op !== "split" && (
            <span className="k-same" title={t("The other side derived the same value", "另一端算出了同一个值")}>
              {t("both sides", "两端一致")}
            </span>
          )}
        </button>
        <button className="btn k-jump" title={t("Jump to the moment it was derived", "跳到派生它的那一刻")} onClick={() => useWB.getState().setCursor(node.ev, { follow: true })}>
          {t("Go", "定位")}
        </button>
      </div>
      {open && (
        <div className="k-detail mono">
          <div>
            <span className="muted">{t(`${node.value.length / 2} bytes`, `输出 ${node.value.length / 2} 字节`)}</span> {node.value}
          </div>
          {node.inputs.map((inp, i) => (
            <div key={i}>
              <span className="muted">{inp.name}</span> {inp.value}
            </div>
          ))}
        </div>
      )}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <KeyRow key={c.secret + c.name} node={c} cursor={cursor} cur={cur} shared={shared} />
          ))}
        </ul>
      )}
    </li>
  );
}
