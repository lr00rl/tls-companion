import type { ScenarioDef } from "./types";

const T = "crypto/tls.";
const K = "crypto/internal/fips140/tls13.";

export const tls13Resume: ScenarioDef = {
  id: "tls13-resume",
  tcp: true,
  intro:
    "采集程序先跑一条完整握手（没有录下来），客户端从中收到 NewSessionTicket 存进 `ClientSessionCache`；录下来的是第二条连接。客户端用票据里的 PSK 恢复会话，模式是 psk_dhe_ke：仍然做一次密钥交换以保持前向保密，但服务器不再发送证书，也不再签名。",
  steps: [
    {
      id: "server-wait",
      title: "服务器等待 ClientHello",
      side: 1,
      at: { mark: "handshake", side: 1 },
      code: { fn: T + "Conn.serverHandshake", find: "readClientHello" },
      body: "服务器和上一条连接共用同一个 `tls.Config`，因此持有同一把会话票据密钥，能解开自己签发的票据。",
      refs: [{ sym: T + "Config.SessionTicketKey" }],
    },
    {
      id: "load-session",
      title: "客户端取出票据，计算 binder",
      side: 0,
      at: { enter: T + "Conn.loadSession" },
      code: { fn: T + "Conn.loadSession", find: "binderKey = earlySecret.ResumptionBinderKey()" },
      msg: { dir: 0, type: 1 },
      tab: "keys",
      body:
        "`loadSession` 从缓存里按服务器名取出会话，检查票据没有过期、密码套件仍然可用，然后把票据放进 `pre_shared_key` 扩展。票据的年龄要加上服务器给的 `age_add` 再发送（`obfuscated_ticket_age`），避免旁观者把两条连接关联起来。\n\n恢复用的 PSK 派生出新的 Early Secret，再派生 binder_key；binder 是对「截掉 binder 本身的 ClientHello」做的 HMAC。它证明发票据的人确实知道 PSK，而不只是重放了一张偷来的票据。",
      refs: [{ rfc: 8446, sec: "4.2.11" }, { rfc: 8446, sec: "4.2.11.2" }, { note: "T06", h: "恢复用的-psk" }],
    },
    {
      id: "ch-psk",
      title: "带 pre_shared_key 的 ClientHello",
      side: 0,
      at: { enter: T + "Conn.writeHandshakeRecord", side: 0 },
      code: { fn: T + "computeAndUpdatePSK" },
      msg: { dir: 0, type: 1 },
      tab: "fields",
      body:
        "`pre_shared_key` 必须是最后一个扩展，因为 binder 要覆盖它之前的全部内容。`psk_key_exchange_modes` 只列了 psk_dhe_ke，Go 的客户端从不提议不做密钥交换的 psk_ke。\n\n这条 ClientHello 仍然带着 X25519MLKEM768 份额，比完整握手的那条还大，因为多了一张票据。",
      refs: [{ rfc: 8446, sec: "4.2.9" }, { note: "T07", h: "tls-1.3-的-psk-恢复" }],
    },
    {
      id: "server-psk",
      title: "服务器解开票据，核对 binder",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.checkForResumption" },
      code: { fn: T + "serverHandshakeStateTLS13.checkForResumption", find: "pskBinder := hs.suite.finishedHash(binderKey, transcript)" },
      tab: "keys",
      body:
        "服务器用票据密钥解密票据（`decryptTicket`），得到上次会话的状态和恢复秘密，再检查票据有没有超过最长寿命、套件的哈希是否一致。然后它从 PSK 派生同样的 binder_key，算出 binder，用常数时间的 `hmac.Equal` 与客户端发来的比较。\n\n密钥面板里，这条连接的 Early Secret 不再是对全零的 Extract，它的输入是票据里的 PSK。",
      refs: [{ rfc: 8446, sec: "4.2.11.2" }, { sym: K + "NewEarlySecret" }],
    },
    {
      id: "server-hello",
      title: "ServerHello 选中 PSK，仍然交换密钥",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerParameters" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerParameters", find: "earlySecret.HandshakeSecret(hs.sharedKey)" },
      msg: { dir: 1, type: 2 },
      body:
        "ServerHello 的 `pre_shared_key` 扩展只有两个字节：选中的身份序号 0。`key_share` 照常出现，Handshake Secret 的输入同时依赖 PSK 和这次新的共享秘密，所以即使票据密钥日后泄露，也解不开这次连接的流量。",
      refs: [{ note: "T02", h: "前向保密今天的私钥泄露不该解开昨天的流量" }, { rfc: 8446, sec: "2.2" }],
    },
    {
      id: "no-cert",
      title: "跳过 Certificate 和 CertificateVerify",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerCertificate" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerCertificate", find: "if hs.usingPSK {" },
      body:
        "`sendServerCertificate` 一进来就返回：PSK 本身已经认证了服务器，因为只有当初完成过完整证书验证的那台服务器才发得出这张票据。服务器的第一组消息因此从 2.4 KB 缩到 1.5 KB 左右，其中大部分是后量子份额。",
      refs: [{ rfc: 8446, sec: "4.4.2" }],
    },
    {
      id: "server-flight",
      title: "服务器的整组消息",
      side: 1,
      at: { writeMsg: { dir: 1, type: 2 } },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerFinished" },
      msg: { dir: 1, type: 20 },
      body: "ServerHello、CCS、{EncryptedExtensions}、{Finished}、[NewSessionTicket]。新票据让客户端下次还能恢复，每张票据都只用一次是推荐做法。",
      refs: [{ rfc: 8446, sec: "C.4" }],
    },
    {
      id: "client-psk",
      title: "客户端确认服务器接受了 PSK",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.processServerHello" },
      code: { fn: T + "clientHandshakeStateTLS13.processServerHello", find: "hs.usingPSK = true" },
      msg: { dir: 1, type: 2 },
      body:
        "客户端看到 `selected_identity` 指向自己发的唯一身份，检查套件的哈希一致，置 `usingPSK`，`ConnectionState().DidResume` 由此为真。随后 `readServerCertificate` 同样直接跳过证书验证。",
      refs: [{ sym: T + "ConnectionState.DidResume" }],
    },
    {
      id: "client-finish",
      title: "客户端发出 {Finished}",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.sendClientFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.sendClientFinished" },
      msg: { dir: 0, type: 20 },
      body: "往返数和完整握手一样是 1 个，省下的是证书传输和两次公钥签名运算。要连这 1 个往返也省掉，需要 0-RTT：Go 只在 QUIC 上支持客户端 0-RTT，TCP 上的 crypto/tls 不发送 early data。",
      refs: [{ note: "T07", h: "0-rtt让请求和握手一起出发" }, { note: "T07", h: "0-rtt-的两个代价" }],
    },
    {
      id: "new-ticket",
      title: "客户端收下新票据",
      side: 0,
      at: { enter: T + "Conn.handleNewSessionTicket" },
      code: { fn: T + "Conn.handleNewSessionTicket" },
      msg: { dir: 1, type: 4 },
      body: "客户端读响应时先读到 [NewSessionTicket]，`handleNewSessionTicket` 从 resumption_master_secret 和票据里的 nonce 派生出新的 PSK，存回缓存。",
      refs: [{ rfc: 8446, sec: "4.6.1" }],
    },
  ],
};
