import { useMemo } from "react";
import { href } from "../app/route";
import { buildModel, dominantEpoch, type Model } from "../capture/model";
import { load, useLoad } from "../data/load";
import { EV_MARK } from "../data/types";
import { scenarioFor } from "../i18n/content";
import { useLang, useTx } from "../i18n/lang";
import { entries } from "../history/entries";
import { scenarioDefs } from "../scenarios";
import "./home.css";

interface Row {
  id: string;
  title: string;
  brief: string;
  version: string;
  suite: string;
  curve: string;
  tcp: boolean;
  /** RTTs until the client can send its request, TCP included. */
  firstWrite: number;
  hsBytes: number;
  records: number;
  calls: number;
  flights: { side: number; t0: number; t1: number; ep: string; bytes: number }[];
}

function summarize(m: Model, tcp: boolean): Row {
  const cap = m.cap;
  const off = tcp ? 1 : 0;
  const w = cap.events.findIndex((e) => e[0] === EV_MARK && e[1] === 0 && e[2] === "app:write");
  const firstWrite = (w >= 0 ? m.time[w] : 0) + off;
  let hsBytes = 0;
  for (const r of cap.records) if (cap.writes[r.write].ev < w) hsBytes += r.len + 5;
  const flights = m.flights
    .filter((f) => f.ev <= w + 40)
    .map((f) => ({ side: f.side, t0: f.tSend + off, t1: f.tArrive + off, ep: dominantEpoch(m, f.records), bytes: f.bytes }));
  return {
    id: cap.id,
    title: cap.title,
    brief: cap.brief,
    version: cap.state[0].version,
    suite: cap.state[0].cipherSuite,
    curve: cap.state[0].curve,
    tcp,
    firstWrite,
    hsBytes,
    records: cap.records.length,
    calls: m.calls.length,
    flights,
  };
}

export default function Home() {
  const lang = useLang();
  const t = useTx();
  const caps = useLoad("allCaptures", () => Promise.all(scenarioDefs.map((d) => load.capture(d.id))));
  const meta = useLoad("codeMeta", load.codeMeta);
  const notes = useLoad(`notes:${lang}`, () => load.notes(lang));
  const rfcs = useLoad("rfcs", load.rfcs);
  const rows = useMemo(() => {
    if (caps.state !== "ready") return [];
    return caps.data.map((capture) => {
      const def = scenarioFor(lang, capture.id)!;
      return { ...summarize(buildModel(capture), def.tcp), title: def.title, brief: def.brief };
    });
  }, [caps, lang]);
  const files = meta.state === "ready" ? meta.data.packages.reduce((n, p) => n + p.files.length, 0) : 0;
  const lines = meta.state === "ready" ? meta.data.packages.reduce((n, p) => n + p.files.reduce((a, f) => a + f.lines, 0), 0) : 0;

  return (
    <div className="home">
      <section className="home-top">
        <div className="home-intro">
          <div className="kicker">TLS Companion · {meta.state === "ready" ? meta.data.go : "Go"}</div>
          <h1>{t("A workbench for TLS", "TLS 学习工作台")}</h1>
          <p>
            {t(
              "Every handshake here actually ran. A capture program starts Go's crypto/tls client and server in one process and records every byte on the wire, every secret in the key log, and every function both sides entered. The workbench replays that recording. The diagram, the fields, the key schedule, the source, and the call trace all point at the same moment.",
              "这里的每一次握手都真实地跑过：采集程序在同一个进程里启动 Go 的 crypto/tls 客户端和服务器，记下线路上的每个字节、key log 里的每个秘密、两端经过的每一个函数。工作台逐步回放这些记录，时序图、报文字段、密钥调度、源码和调用追踪始终指向同一个时刻。",
            )}
          </p>
          <p>
            {t(
              "The notes run from HTTP to HTTPS, through cryptography, certificates and PKI, TLS 1.2 and 1.3 packet by packet, resumption, ECH, QUIC, and post-quantum, and on to how operators run it.",
              "内容来自 TLS 系列笔记：从 HTTP 到 HTTPS，密码学、证书与 PKI，TLS 1.2 与 1.3 的逐包拆解，会话恢复、ECH、QUIC、后量子，直到各家的工程实践。",
            )}
          </p>
          <div className="home-actions">
            <a className="btn-primary" href={href({ page: "play", scenario: "tls13-full", step: 0 })}>
              {t("Replay the TLS 1.3 handshake", "回放 TLS 1.3 完整握手")}
            </a>
            <a className="btn outline" href={href({ page: "notes", id: "00" })}>
              {t("Start with the overview", "先读总览")}
            </a>
          </div>
        </div>
        <RttChart rows={rows} loading={caps.state === "loading"} />
      </section>

      <section className="home-section">
        <h2>{t("Five recorded connections", "五条录下来的连接")}</h2>
        <div className="table-wrap">
          <table className="scen-table">
            <thead>
              <tr>
                <th>{t("Scenario", "场景")}</th>
                <th>{t("Negotiated", "协商结果")}</th>
                <th className="num-col">{t("First request", "可以发请求时")}</th>
                <th className="num-col">{t("Handshake", "握手字节")}</th>
                <th className="num-col">{t("Records", "记录")}</th>
                <th className="num-col">{t("Calls", "被追踪的调用")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={href({ page: "play", scenario: r.id, step: 0 })}>{r.title}</a>
                    <div className="muted">{r.brief}</div>
                  </td>
                  <td className="mono small">
                    {r.version}
                    <br />
                    {r.suite.replace("TLS_", "")}
                    <br />
                    {r.curve}
                  </td>
                  <td className="num num-col">{r.firstWrite.toFixed(1)} RTT</td>
                  <td className="num num-col">{r.hsBytes.toLocaleString()} B</td>
                  <td className="num num-col">{r.records}</td>
                  <td className="num num-col">{r.calls.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t("Round trips include the TCP handshake. Handshake bytes are every TLS record on the wire before the client sends its request.", "往返数包含 TCP 三次握手的 1 个往返。握手字节是客户端发出请求之前双方在线路上传的全部 TLS 记录。")}</p>
      </section>

      <section className="home-section areas">
        <a className="area" href={href({ page: "code" })}>
          <span className="area-name">{t("Code", "源码")}</span>
          <span className="area-fig num">{t(`${files} files · ${lines.toLocaleString()} lines`, `${files} 个文件 · ${lines.toLocaleString()} 行`)}</span>
          <span className="area-desc">{t("crypto/tls and the key schedule, ML-KEM, HPKE, x509, and cryptobyte it depends on, with go-to-definition, references, and where each function ran.", "crypto/tls 与它依赖的密钥调度、ML-KEM、HPKE、x509、cryptobyte，带定义跳转、引用列表和运行记录。")}</span>
        </a>
        <a className="area" href={href({ page: "notes" })}>
          <span className="area-name">{t("Notes", "笔记")}</span>
          <span className="area-fig num">{t(`${notes.state === "ready" ? notes.data.length : 15} notes`, `${notes.state === "ready" ? notes.data.length : 15} 篇`)}</span>
          <span className="area-desc">{t("Each section that a workbench step cites links back to that step. RFC mentions open the text in place.", "每个小节都标出了工作台里对应的步骤，文中的 RFC 引用点开即是原文。")}</span>
        </a>
        <a className="area" href={href({ page: "history" })}>
          <span className="area-name">{t("History", "演进")}</span>
          <span className="area-fig num">{t(`${entries.length} entries`, `${entries.length} 个节点`)}</span>
          <span className="area-desc">{t("Versions, attacks, and Go's response side by side. Each Go release diffs the relevant file between two tags.", "版本、攻击和 Go 的应对并排；Go 的每个版本都能直接对比相邻两版的源文件。")}</span>
        </a>
        <a className="area" href={href({ page: "rfc", n: 8446 })}>
          <span className="area-name">{t("RFCs", "规范")}</span>
          <span className="area-fig num">{t(`${rfcs.state === "ready" ? rfcs.data.length : 40} RFCs`, `${rfcs.state === "ready" ? rfcs.data.length : 40} 份 RFC`)}</span>
          <span className="area-desc">{t("The full text, unpaginated, with sections linked to each other and to the Go comments that cite them.", "去掉分页的全文，章节互相链接，并列出 Go 源码里引用每一节的注释。")}</span>
        </a>
      </section>

      <section className="home-section paths">
        <h2>{t("Three ways to read", "三条读法")}</h2>
        <ol>
          <li>
            <strong>{t("Get the shape of it:", "建立直觉：")}</strong>{" "}
            <a href="#/notes/T01">T01</a>, <a href="#/notes/T03">T03</a>, <a href="#/notes/T06">T06</a>, <a href="#/notes/T08">T08</a>, <a href="#/notes/T10">T10</a>
            {t(", with the TLS 1.3 full handshake in the workbench.", "，配合工作台的 TLS 1.3 完整握手。")}
          </li>
          <li>
            <strong>{t("Learn the protocol:", "吃透协议：")}</strong>{" "}
            <a href="#/notes/T02">T02</a>, <a href="#/notes/T05">T05</a>, <a href="#/notes/T06">T06</a>, <a href="#/notes/T07">T07</a>, <a href="#/notes/T09">T09</a>.{" "}
            {t("Compare the TLS 1.2 and 1.3 key schedules in the workbench, then use the experiments in", "在工作台里对照 TLS 1.2 与 1.3 的密钥调度，再用")} <a href="#/notes/T13">T13</a> {t("to find each message in real output.", "的实验在真实输出里找到每条消息。")}
          </li>
          <li>
            <strong>{t("Deploy and operate:", "部署和运维：")}</strong>{" "}
            <a href="#/notes/T03">T03</a>, <a href="#/notes/T07">T07</a>, <a href="#/notes/T11">T11</a>, <a href="#/notes/T12">T12</a>
            {t(", and the history page for how Go's defaults changed.", "，以及演进页里 Go 各版本默认配置的变化。")}
          </li>
        </ol>
      </section>

      <footer className="home-foot">
        {t(
          `The data is generated by tools/ in this repository. tlsindex type-checks the standard library of ${meta.state === "ready" ? meta.data.go : "Go"} and builds the cross-references. tlsinstrument writes a build overlay that traces crypto/tls. tlscapture runs the handshakes, decrypts each record from the key log, and checks those keys against what crypto/tls derived. Go source is under the BSD license. RFC text is copyright of the IETF Trust.`,
          `数据由仓库里的 tools/ 生成：tlsindex 对 ${meta.state === "ready" ? meta.data.go : "Go"} 的标准库源码做类型检查建立交叉引用，tlsinstrument 生成编译覆盖层给 crypto/tls 插桩，tlscapture 运行握手并用 key log 独立解密、与 crypto/tls 内部派生的密钥逐字节核对。Go 源码以 BSD 许可证分发，RFC 文本版权归 IETF Trust。`,
        )}
      </footer>
    </div>
  );
}

/** Round trips until the first request, drawn per scenario. */
function RttChart({ rows, loading }: { rows: Row[]; loading: boolean }) {
  const t = useTx();
  const max = Math.max(3.5, ...rows.map((r) => r.firstWrite + 0.6));
  return (
    <figure className="rtt-chart" aria-label={t("Round trips before the first request, by scenario", "各场景发出第一个请求前的往返数")}>
      <figcaption>
        <span className="kicker">{t("Round trips", "往返账")}</span>
        <span>{t("What happens on the wire before the client can send its first request", "客户端能发出第一个请求之前，线路上发生了什么")}</span>
      </figcaption>
      {loading && <div className="loading-bar" />}
      {rows.map((r) => (
        <a key={r.id} className="rtt-row" href={href({ page: "play", scenario: r.id, step: 0 })}>
          <span className="rtt-name">{r.title}</span>
          <span className="rtt-track">
            {Array.from({ length: Math.ceil(max) }, (_, k) => (
              <i key={k} className="rtt-grid" style={{ left: `${(k / max) * 100}%` }} />
            ))}
            {r.tcp && <span className="rtt-seg tcp" style={{ left: 0, width: `${(1 / max) * 100}%` }} title={t("TCP handshake", "TCP 三次握手")} />}
            {r.flights
              .filter((f) => f.t0 < r.firstWrite)
              .map((f, k) => (
                <span
                  key={k}
                  className="rtt-seg ep"
                  data-ep={f.ep}
                  style={{ left: `${(f.t0 / max) * 100}%`, width: `${((f.t1 - f.t0) / max) * 100}%`, top: f.side === 0 ? 3 : 13 }}
                  title={t(`${f.side === 0 ? "Client" : "Server"} sent ${f.bytes} bytes`, `${f.side === 0 ? "客户端" : "服务器"}发出 ${f.bytes} 字节`)}
                />
              ))}
            <span className="rtt-mark" style={{ left: `${(r.firstWrite / max) * 100}%` }} />
          </span>
          <span className="rtt-val num">{r.firstWrite.toFixed(1)}</span>
        </a>
      ))}
      <div className="rtt-axis num">
        <span />
        <span className="rtt-ticks">
          {Array.from({ length: Math.ceil(max) }, (_, k) => (
            <i key={k} style={{ left: `${(k / max) * 100}%` }}>
              {k}
            </i>
          ))}
        </span>
        <span>RTT</span>
      </div>
    </figure>
  );
}
