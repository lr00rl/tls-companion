import type { ScenarioDef } from "./types";

const T = "crypto/tls.";

export const tls13Hrr: ScenarioDef = {
  id: "tls13-hrr",
  short: "TLS 1.3 HRR",
  tcp: true,
  intro:
    "服务器的 `CurvePreferences` 只有 P-256，而客户端照默认配置只为 X25519MLKEM768 和 X25519 准备了份额。客户端在 supported_groups 里列出了 P-256，所以握手不会失败，但服务器必须用 HelloRetryRequest 请它重来一次，整个握手因此多花 1 个往返。",
  steps: [
    {
      id: "server-wait",
      title: "服务器等待 ClientHello",
      side: 1,
      at: { mark: "handshake", side: 1 },
      code: { fn: T + "Conn.serverHandshake", find: "readClientHello" },
      body: "和完整握手一样，服务器先阻塞在 `readClientHello` 里。区别只在它的配置：`CurvePreferences: []tls.CurveID{tls.CurveP256}`。",
      refs: [{ sym: T + "Config.CurvePreferences" }],
    },
    {
      id: "ch1",
      title: "第一个 ClientHello：份额猜错了",
      side: 0,
      at: { enter: T + "Conn.makeClientHello" },
      code: { fn: T + "Conn.makeClientHello", find: "curveID := hello.supportedCurves[0]" },
      msg: { dir: 0, type: 1 },
      body:
        "客户端只为偏好列表的第一项准备份额，也就是 X25519MLKEM768，外加一份 X25519 退路。`supported_groups` 里虽然列着 P-256，但没有它的份额。\n\n客户端预先生成所有组的份额就能避免重试，代价是每次握手多算几次密钥、ClientHello 再大一截。Go 的选择是只猜最可能的那一个。",
      refs: [{ rfc: 8446, sec: "4.2.8" }, { note: "T06", h: "keyshare客户端先猜" }],
    },
    {
      id: "hrr",
      title: "服务器发出 HelloRetryRequest",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.doHelloRetryRequest" },
      code: { fn: T + "serverHandshakeStateTLS13.doHelloRetryRequest", find: "selectedGroup:     selectedGroup" },
      msg: { dir: 1, type: 2, nth: 0 },
      body:
        "`processClientHello` 选出的组是 P-256，在客户端的份额里找不到，于是转入 `doHelloRetryRequest`。HelloRetryRequest 在线路上就是一条 ServerHello，只是 random 换成了一个固定值（SHA-256(\"HelloRetryRequest\")），`key_share` 扩展里只写要求的组。\n\n记录哈希在这里被改写：第一个 ClientHello 先被哈希，再以一条合成的 `message_hash` 消息代替原文写回记录。RFC 这样设计是为了让无状态的服务器可以把记录哈希放进 cookie 里交给客户端保管。",
      refs: [{ rfc: 8446, sec: "4.1.4" }, { rfc: 8446, sec: "4.4.1" }, { note: "T06", h: "helloretryrequest" }],
    },
    {
      id: "client-hrr",
      title: "客户端处理 HelloRetryRequest",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.processHelloRetryRequest" },
      code: { fn: T + "clientHandshakeStateTLS13.processHelloRetryRequest", find: "hs.transcript.Write([]byte{typeMessageHash" },
      msg: { dir: 1, type: 2, nth: 0 },
      body:
        "客户端用同样的方式改写自己的记录哈希，然后检查这次重试是否真的有必要：如果服务器要的组客户端已经给过份额，或者既没有 key_share 也没有 cookie，客户端会直接报错断开，防止被诱导做无意义的重试。\n\n通过检查后，客户端为 P-256 生成一份新的密钥，替换掉原来的份额。",
      refs: [{ rfc: 8446, sec: "4.1.4" }],
    },
    {
      id: "ch2",
      title: "第二个 ClientHello",
      side: 0,
      at: { writeMsg: { dir: 0, type: 1, nth: 1 } },
      code: { fn: T + "clientHandshakeStateTLS13.processHelloRetryRequest", find: "ke.keyShares(c.config.rand())" },
      msg: { dir: 0, type: 1, nth: 1 },
      tab: "fields",
      body:
        "除了 `key_share` 换成一份 65 字节的 P-256 公钥，第二个 ClientHello 必须和第一个一模一样，服务器的 `illegalClientHelloChange` 会逐项比对。去掉了 1216 字节的混合份额，这条消息只剩三百多字节。\n\n注意两个 ClientHello 之间客户端还发了一条兼容性 CCS：TLS 1.3 允许它出现在第二个 ClientHello 之前。",
      refs: [{ rfc: 8446, sec: "4.1.2" }, { sym: T + "illegalClientHelloChange" }],
    },
    {
      id: "server-continue",
      title: "服务器用 P-256 继续握手",
      side: 1,
      at: { enter: T + "ecdhKeyExchange.serverSharedSecret" },
      code: { fn: T + "ecdhKeyExchange.serverSharedSecret" },
      tab: "keys",
      body:
        "从这里开始和完整握手相同：P-256 ECDH 得到 32 字节共享秘密，派生握手密钥，发出 ServerHello 和后面的加密消息。真正的 ServerHello 的 random 是新的随机数，不再是固定值。\n\n这条连接没有用上后量子密钥交换。HelloRetryRequest 在这里换来了互通，丢掉了抗量子的保护。",
      refs: [{ note: "T10", h: "先存后解为什么密钥交换先迁移" }],
    },
    {
      id: "server-flight",
      title: "服务器的整组消息",
      side: 1,
      at: { writeMsg: { dir: 1, type: 2, nth: 1 } },
      code: { fn: T + "Conn.flush" },
      msg: { dir: 1, type: 2, nth: 1 },
      body: "ServerHello、{EncryptedExtensions}、{Certificate}、{CertificateVerify}、{Finished} 一次发出，比完整握手晚了整整 1 个往返。",
    },
    {
      id: "client-finish",
      title: "客户端验证并发出 {Finished}",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.sendClientFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.sendClientFinished" },
      msg: { dir: 0, type: 20 },
      body: "客户端在这一步之前完成了证书和签名验证。它的 `Handshake()` 在 2 个往返之后返回，加上 TCP 一共 3 个往返，和 TLS 1.2 一样慢。",
      refs: [{ note: "T07", h: "往返预算小结" }],
    },
    {
      id: "app",
      title: "[应用数据]",
      side: 0,
      at: { mark: "app:write", side: 0 },
      code: { fn: T + "Conn.Write" },
      tab: "record",
      body: "之后的请求和响应与完整握手完全相同。",
    },
  ],
};
