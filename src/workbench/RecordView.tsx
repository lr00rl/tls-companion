import { usePeek } from "../app/peek";
import { useWB } from "../app/store";
import { epochOf, messageName, recordLabel, type Model } from "../capture/model";
import { alertDescriptions, contentTypes, versions } from "../capture/names";
import { useTx } from "../i18n/lang";

const short = (h: string, n = 48) => (h.length > n ? `${h.slice(0, n)}…` : h);
const group = (h: string) => h.replace(/(..)/g, "$1 ").trim();

/** Record-layer view: header, protection, and plaintext of the selected record(s). */
export function RecordView({ model }: { model: Model }) {
  const t = useTx();
  const sel = useWB((s) => s.sel);
  const cursor = useWB((s) => s.cursor);
  let indices: number[] = [];
  if (sel?.kind === "rec") indices = [sel.index];
  if (sel?.kind === "msg") indices = [...new Set(model.cap.messages[sel.index].parts.map((p) => p[0]))];
  if (!indices.length) {
    // Fall back to the latest record sent before the cursor.
    let last = -1;
    model.cap.records.forEach((r, i) => {
      if (model.cap.writes[r.write].ev <= cursor) last = i;
    });
    if (last >= 0) indices = [last];
  }
  if (!indices.length)
    return (
      <div className="empty">
        <strong>{t("No records yet", "还没有记录")}</strong>
        {t("Nothing has been written to the wire at this moment.", "到这个时刻为止线路上还没有字节。")}
      </div>
    );
  return (
    <div className="record-view">
      {indices.map((i) => (
        <RecordCard key={i} model={model} index={i} />
      ))}
    </div>
  );
}

function RecordCard({ model, index }: { model: Model; index: number }) {
  const t = useTx();
  const r = model.cap.records[index];
  const ep = epochOf(r.prot?.secret);
  const raw = r.raw;
  const tls13 = model.version === 0x0304;
  const msgs = model.recordMessages[index].map((mi) => messageName(model.cap.messages[mi]));
  const peek = usePeek.getState().open;

  let plainText: string | null = null;
  if (r.inner === 23) {
    const bytes = new Uint8Array((r.plain.match(/../g) ?? []).map((x) => parseInt(x, 16)));
    plainText = new TextDecoder().decode(bytes);
  }

  return (
    <section className="rec-card ep" data-ep={ep}>
      <header>
        <span className="rec-swatch" />
        <strong className="mono">{recordLabel(model, index)}</strong>
        <span className="muted">
          {t("record", "记录")} #{index} · {r.dir === 0 ? t("client → server", "客户端 → 服务器") : t("server → client", "服务器 → 客户端")} · {r.len + 5} {t("bytes", "字节")}
        </span>
        <button className="btn" onClick={() => useWB.getState().setCursor(model.cap.writes[r.write].ev, { follow: true })}>
          {t("Jump to the write", "跳到发送处")}
        </button>
      </header>

      <dl className="kv">
        <dt>{t("Header", "记录头")}</dt>
        <dd className="mono">
          <span className="hb">{raw.slice(0, 2)}</span> <span className="hb">{group(raw.slice(2, 6))}</span> <span className="hb">{group(raw.slice(6, 10))}</span>
          <span className="muted">
            {"  "}type={contentTypes[r.type]} ({r.type}) · version={versions[r.ver] ?? r.ver.toString(16)} · length={r.len}
          </span>
        </dd>
        {r.prot ? (
          <>
            <dt>{t("Key", "保护密钥")}</dt>
            <dd>
              <span className="chip ep-chip">{r.prot.secret}</span>
              {r.prot.secret === "CLIENT_RANDOM" ? (
                <span className="muted">{t(" from the TLS 1.2 master secret, via key expansion", " 由 TLS 1.2 主密钥经 key expansion 得到")}</span>
              ) : (
                <span className="muted">{t(" expanded to a key and an iv by HKDF-Expand-Label", " 经 HKDF-Expand-Label 展开出 key 与 iv")}</span>
              )}
            </dd>
            <dt>key</dt>
            <dd className="mono">{r.prot.key}</dd>
            <dt>iv</dt>
            <dd className="mono">{r.prot.iv}</dd>
            <dt>{t("Sequence", "序号")}</dt>
            <dd className="mono">{r.prot.seq}</dd>
            <dt>nonce</dt>
            <dd className="mono">
              {r.prot.nonce}
              <span className="muted">
                {r.prot.explicitNonce ? t(`  = implicit IV ‖ explicit nonce ${r.prot.explicitNonce}`, `  = 隐式 IV ‖ 显式 nonce ${r.prot.explicitNonce}`) : `  = iv ⊕ ${r.prot.seq.toString(16).padStart(24, "0")}`}
              </span>
            </dd>
            <dt>AAD</dt>
            <dd className="mono">
              {group(r.prot.aad)}
              <span className="muted">{tls13 ? t("  the record header", "  就是记录头") : t("  = seq ‖ type ‖ version ‖ plaintext length", "  = 序号 ‖ 类型 ‖ 版本 ‖ 明文长度")}</span>
            </dd>
            <dt>{t("Tag", "认证标签")}</dt>
            <dd className="mono">{r.prot.tag}</dd>
            <dt>{t("Ciphertext", "密文")}</dt>
            <dd className="mono wrap">{short(raw.slice(10), 96)}</dd>
            {tls13 && (
              <>
                <dt>{t("Inner type", "真实类型")}</dt>
                <dd>
                  {contentTypes[r.inner]} ({r.inner})
                  <span className="muted">{t(", at the end of the plaintext. The outer type is always application_data", "，藏在明文末尾；外层一律写成 application_data")}</span>
                  {r.pad ? <span className="muted">{t(`, plus ${r.pad} bytes of zero padding`, `，另有 ${r.pad} 字节零填充`)}</span> : null}
                </dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>{t("Protection", "保护")}</dt>
            <dd className="muted">{t("None. This record is sent in the clear, and anyone on the path can read it.", "无：这条记录以明文发送，线路上任何人都能读到")}</dd>
          </>
        )}
        <dt>{t("Plaintext", "明文")}</dt>
        <dd>
          {r.inner === 22 && <span className="mono">{msgs.join(" + ")}</span>}
          {r.inner === 21 && (
            <span className="mono">
              {parseInt(r.plain.slice(0, 2), 16) === 2 ? "fatal" : "warning"} · {alertDescriptions[parseInt(r.plain.slice(2, 4), 16)]}
            </span>
          )}
          {r.inner === 20 && <span className="mono">change_cipher_spec (01)</span>}
          {plainText !== null && <pre className="app-text">{plainText}</pre>}
        </dd>
      </dl>
      {r.prot && (
        <div className="rec-links">
          <button className="chip" onClick={() => peek(tls13 ? 8446 : 5246, tls13 ? "5.2" : "6.2.3.3")}>
            <span className="k">RFC</span>
            {tls13 ? t("8446 §5.2 record protection", "8446 §5.2 记录保护") : "5246 §6.2.3.3 AEAD"}
          </button>
          {tls13 && (
            <button className="chip" onClick={() => peek(8446, "5.3")}>
              <span className="k">RFC</span>
              {t("8446 §5.3 per-record nonce", "8446 §5.3 每条记录的 nonce")}
            </button>
          )}
          <button className="chip" onClick={() => void useWB.getState().openSymbol("crypto/tls.halfConn.encrypt", { reason: ["Record encryption", "记录层加密"] })}>
            <span className="k">Go</span>halfConn.encrypt
          </button>
          <button className="chip" onClick={() => void useWB.getState().openSymbol("crypto/tls.halfConn.decrypt", { reason: ["Record decryption", "记录层解密"] })}>
            <span className="k">Go</span>halfConn.decrypt
          </button>
        </div>
      )}
    </section>
  );
}
