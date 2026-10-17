import { useState } from "react";
import { navigate } from "../app/route";
import { useWB } from "../app/store";
import type { Model } from "../capture/model";

const roleName = { leaf: "叶子证书", intermediate: "中间证书", root: "根证书" } as const;

/** The certificate chain the server sent, plus the root the client trusts. */
export function CertView({ model }: { model: Model }) {
  const certs = model.cap.certs;
  const resumed = model.cap.state[0].resumed;
  return (
    <div className="certs">
      {resumed && (
        <div className="note-banner">这条连接是会话恢复，服务器没有发送证书；下面是首次连接时用过的那条链。</div>
      )}
      <ol className="chain">
        {certs.map((c, i) => (
          <li key={c.sha256} className="cert">
            <div className="cert-head">
              <span className={`cert-role role-${c.role}`}>{roleName[c.role]}</span>
              <strong>{c.subject.replace(/^.*CN=/, "").replace(/,.*$/, "")}</strong>
              <span className="muted">{c.onWire ? `在 Certificate 消息里，第 ${i + 1} 张` : "不在线路上：客户端的 RootCAs 里本来就有"}</span>
            </div>
            <dl className="kv">
              <dt>Subject</dt>
              <dd className="mono">{c.subject}</dd>
              <dt>Issuer</dt>
              <dd className="mono">{c.issuer}</dd>
              <dt>有效期</dt>
              <dd className="mono">
                {c.notBefore.slice(0, 10)} → {c.notAfter.slice(0, 10)}
              </dd>
              {c.dnsNames && (
                <>
                  <dt>SAN</dt>
                  <dd className="mono">{c.dnsNames.join(", ")}</dd>
                </>
              )}
              <dt>公钥 / 签名</dt>
              <dd className="mono">
                {c.keyAlg} · {c.sigAlg}
              </dd>
              <dt>CA</dt>
              <dd>{c.isCA ? "是（basicConstraints CA:true）" : "否"}</dd>
              <dt>SHA-256</dt>
              <dd className="mono wrap">{c.sha256}</dd>
            </dl>
            {i < certs.length - 1 && <div className="signed-by">由下一张证书的私钥签名 ↓</div>}
          </li>
        ))}
      </ol>
      <div className="cert-links">
        <button className="chip" onClick={() => void useWB.getState().openSymbol("crypto/x509.Certificate.Verify", { reason: "证书链验证" })}>
          <span className="k">Go</span>x509.Certificate.Verify
        </button>
        <button className="chip" onClick={() => void useWB.getState().openSymbol("crypto/tls.Conn.verifyServerCertificate", { reason: "客户端验证服务器证书" })}>
          <span className="k">Go</span>Conn.verifyServerCertificate
        </button>
        <button className="chip" onClick={() => navigate({ page: "notes", id: "T03", anchor: "路径验证客户端到底检查了什么" })}>
          <span className="k">T03</span>路径验证客户端到底检查了什么
        </button>
      </div>
    </div>
  );
}

/** Configs, the resulting ConnectionState on both sides, and the key log. */
export function ConnView({ model }: { model: Model }) {
  const cap = model.cap;
  const [copied, setCopied] = useState(false);
  const keylog = cap.keylog.map((k) => `${k.label} ${k.random} ${k.secret}`).join("\n");
  return (
    <div className="conn">
      <div className="conn-grid">
        {(["客户端", "服务器"] as const).map((who, i) => (
          <section key={who}>
            <h3>{who} Config</h3>
            <pre className="go-config mono">{`&tls.Config{\n${cap.config[i].map((l) => "\t" + l + ",").join("\n")}\n}`}</pre>
            <h3>ConnectionState()</h3>
            <dl className="kv">
              <dt>Version</dt>
              <dd className="mono">{cap.state[i].version}</dd>
              <dt>CipherSuite</dt>
              <dd className="mono">{cap.state[i].cipherSuite}</dd>
              <dt>CurveID</dt>
              <dd className="mono">{cap.state[i].curve || "—"}</dd>
              <dt>NegotiatedProtocol</dt>
              <dd className="mono">{cap.state[i].alpn}</dd>
              <dt>DidResume</dt>
              <dd className="mono">{String(cap.state[i].resumed)}</dd>
              <dt>HelloRetryRequest</dt>
              <dd className="mono">{String(cap.state[i].hrr)}</dd>
            </dl>
          </section>
        ))}
      </div>
      <h3>
        Key log（NSS 格式）
        <button
          className="btn outline"
          onClick={() => {
            void navigator.clipboard?.writeText(keylog).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </h3>
      <p className="muted">
        `Config.KeyLogWriter` 写出的就是这几行。导入 Wireshark（TLS 协议首选项里的 (Pre)-Master-Secret log）就能解密同一次连接的抓包；本站的记录解密也只用了它们。
      </p>
      <pre className="keylog mono">{keylog}</pre>
      <p className="muted">
        采集：{cap.go}，{cap.taken.replace("T", " ").replace("Z", " UTC")}。地址是文档保留网段里的示意值，连接实际跑在进程内的管道上。
      </p>
    </div>
  );
}
