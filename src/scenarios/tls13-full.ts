import type { ScenarioDef } from "./types";

const T = "crypto/tls.";
const K = "crypto/internal/fips140/tls13.";

export const tls13Full: ScenarioDef = {
  id: "tls13-full",
  tcp: true,
  intro:
    "Go 1.26 的客户端和服务器都用默认配置，只加了证书和 ALPN。默认的第一选择是 X25519MLKEM768 混合密钥交换，所以这条连接的 ClientHello 有 1.5 KB，放不进一个 TCP 段。握手 1 个往返完成，随后是一次 HTTP/1.1 请求和响应，最后双方互发 close_notify。",
  steps: [
    {
      id: "server-wait",
      title: "服务器进入 Handshake，等待 ClientHello",
      side: 1,
      at: { mark: "handshake", side: 1 },
      code: { fn: T + "Conn.serverHandshake", find: "readClientHello" },
      body:
        "服务器的 goroutine 调用 `tls.Server(conn, config)` 得到 `*tls.Conn`，再调用 `Handshake()`。`serverHandshake` 做的第一件事是 `readClientHello`，它一路调到 `readRecord`，在网络读上阻塞。\n\n左边的时序图里，TCP 三次握手画成了灰色示意：这次采集在进程内用管道代替了 TCP，但真实连接在 TLS 开始前一定先花掉这 1 个往返。",
      refs: [{ note: "T05", h: "三次握手" }, { sym: T + "Conn.Handshake" }],
    },
    {
      id: "client-hello-build",
      title: "客户端构造 ClientHello",
      side: 0,
      at: { enter: T + "Conn.makeClientHello" },
      code: { fn: T + "Conn.makeClientHello", find: "hello := &clientHelloMsg{" },
      msg: { dir: 0, type: 1 },
      body:
        "`makeClientHello` 先把 `Config` 翻译成一条 `clientHelloMsg`：`supported_versions` 列出 TLS 1.3 和 1.2，开头的 `legacy_version` 却被压到 0x0303，因为 TLS 1.3 改用扩展协商版本，旧字段留给中间设备看。\n\n32 字节 `random` 和 32 字节 `legacy_session_id` 都来自 `config.rand()`。session id 在 TLS 1.3 里已经没有用处，填满随机数是为了让 ClientHello 看起来像一次 TLS 1.2 会话恢复，骗过只认识旧协议的中间盒（RFC 8446 附录 D.4）。",
      refs: [{ rfc: 8446, sec: "4.1.2" }, { note: "T06", h: "clienthello" }, { rfc: 8446, sec: "4.2.1" }],
    },
    {
      id: "key-share",
      title: "生成 X25519MLKEM768 密钥份额",
      side: 0,
      at: { enter: T + "hybridKeyExchange.keyShares" },
      code: { fn: T + "hybridKeyExchange.keyShares" },
      msg: { dir: 0, type: 1 },
      tab: "fields",
      body:
        "客户端在不知道服务器支持什么的情况下，先猜一组 `key_share`，猜中就省掉一个往返。`curvePreferences` 的第一项是 X25519MLKEM768，于是这里一次生成两把密钥：ML-KEM-768 的封装密钥（1184 字节）和 X25519 公钥（32 字节），拼成一个 1216 字节的份额。\n\n同时它还附上一份单独的 X25519 份额作为退路：如果服务器不支持后量子组，仍然可以直接用 X25519 完成握手，不必多走一次 HelloRetryRequest。在右侧字段树里展开 `key_share` 能看到这两条 entry。",
      refs: [{ note: "T10", h: "混合密钥交换x25519mlkem768" }, { rfc: 10024 }, { note: "T06", h: "keyshare客户端先猜" }],
    },
    {
      id: "client-hello-send",
      title: "ClientHello 上线",
      side: 0,
      at: { enter: T + "Conn.writeHandshakeRecord", side: 0 },
      code: { fn: T + "Conn.writeHandshakeRecord" },
      msg: { dir: 0, type: 1 },
      tab: "record",
      body:
        "`writeHandshakeRecord` 把消息序列化（`marshal`），写进握手记录（transcript），再交给记录层。第一条 ClientHello 的记录头版本号是 0x0301，同样是为了兼容老旧的中间设备。\n\n这条记录有 1536 字节，加上 5 字节记录头，超过了以太网上常见的 1460 字节 MSS，所以在真实网络里要拆成两个 TCP 段。时序图里的虚线就是这条界限：只带 X25519 份额的 TLS 1.3 ClientHello 大约 300 字节。",
      refs: [{ rfc: 8446, sec: "5.1" }, { note: "T10", h: "部署的历程与现状" }, { note: "T07", h: "字节别让握手多出一个往返" }],
    },
    {
      id: "server-parse",
      title: "服务器解析 ClientHello",
      side: 1,
      at: { enter: T + "clientHelloMsg.unmarshal" },
      code: { fn: T + "clientHelloMsg.unmarshal" },
      msg: { dir: 0, type: 1 },
      body:
        "`readHandshake` 把记录层交上来的字节拼成完整的握手消息，`unmarshal` 用 `cryptobyte` 逐个解析扩展。不认识的扩展直接跳过，这是 TLS 能不断加新扩展的前提，也是 GREASE 要持续检验的性质。\n\n解析完后，`serverHandshake` 根据 `supported_versions` 选出 TLS 1.3，转进 `serverHandshakeStateTLS13`。",
      refs: [{ rfc: 8701 }, { sym: T + "clientHelloMsg" }],
    },
    {
      id: "server-select",
      title: "服务器选定密码套件与密钥交换组",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.processClientHello" },
      code: { fn: T + "serverHandshakeStateTLS13.processClientHello", find: "selectedGroup := preferredGroups[0]" },
      body:
        "密码套件按偏好取双方都支持的第一个，有 AES 硬件时是 `TLS_AES_128_GCM_SHA256`。\n\n密钥交换组的选法更有意思：Go 把服务器自己的偏好列表重新排序，客户端已经给了份额的组排前面，后量子混合组再排前面（两次 `sort.SliceStable`）。这样既尽量避免 HelloRetryRequest，又在能用后量子的时候一定用上。这条连接选中了 X25519MLKEM768。",
      refs: [{ rfc: 8446, sec: "4.2.8" }, { note: "T06", h: "keyshare客户端先猜" }],
    },
    {
      id: "server-encap",
      title: "服务器封装，得到混合共享秘密",
      side: 1,
      at: { enter: T + "hybridKeyExchange.serverSharedSecret" },
      code: { fn: T + "hybridKeyExchange.serverSharedSecret" },
      tab: "keys",
      body:
        "ML-KEM 不是 Diffie-Hellman：服务器用客户端的封装密钥做一次 `Encapsulate`，得到 1088 字节的密文和 32 字节的共享秘密；X25519 那一半照常做一次 ECDH。\n\n两个秘密按 RFC 10024 拼接，ML-KEM 在前，成为 64 字节的 (EC)DHE 共享秘密。在密钥面板里看 Handshake Secret 那一行的输入，长度就是 64 字节。服务器回给客户端的份额是密文加 X25519 公钥，共 1120 字节。",
      refs: [{ note: "T10", h: "kem-与-dh-的区别" }, { rfc: 10024 }, { sym: "crypto/mlkem.EncapsulationKey768.Encapsulate" }],
    },
    {
      id: "server-hello",
      title: "ServerHello 和兼容性 ChangeCipherSpec",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerParameters" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerParameters" },
      msg: { dir: 1, type: 2 },
      body:
        "ServerHello 带着选中的密码套件、`supported_versions = 0x0304` 和自己的 `key_share`，`legacy_session_id_echo` 原样回显客户端的随机 session id。它是这次握手里服务器发出的最后一条明文握手消息。\n\n紧接着是一条只有 1 字节的 ChangeCipherSpec 记录。它在 TLS 1.3 里没有任何密码学含义，只是让中间盒相信这是一次正常的 TLS 1.2 会话恢复，`sendDummyChangeCipherSpec` 的注释里写明了这一点。",
      refs: [{ rfc: 8446, sec: "4.1.3" }, { note: "T06", h: "serverhello" }, { rfc: 8446, sec: "D.4" }],
    },
    {
      id: "hs-keys-server",
      title: "服务器派生握手密钥",
      side: 1,
      at: { enter: K + "EarlySecret.HandshakeSecret", side: 1 },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerParameters", find: "earlySecret.HandshakeSecret(hs.sharedKey)" },
      tab: "keys",
      body:
        "密钥调度的第一级：没有 PSK，Early Secret 是对全零做 HKDF-Extract。第二级用上一步的 64 字节共享秘密：先 `Derive-Secret(., \"derived\", \"\")`，再 HKDF-Extract 得到 Handshake Secret。\n\n然后对 ClientHello 和 ServerHello 的记录哈希分别派生 `s hs traffic` 和 `c hs traffic`，再各自展开出 AES 密钥和 IV。从这一刻起，服务器写出的记录都用 server_handshake_traffic_secret 加密，时序图里用玫红色和花括号 `{}` 标出。",
      refs: [{ rfc: 8446, sec: "7.1" }, { note: "T06", h: "密钥调度" }, { sym: K + "EarlySecret.HandshakeSecret" }],
    },
    {
      id: "encrypted-extensions",
      title: "{EncryptedExtensions}",
      side: 1,
      at: { enter: T + "encryptedExtensionsMsg.marshal" },
      code: { fn: T + "encryptedExtensionsMsg.marshal" },
      msg: { dir: 1, type: 8 },
      tab: "record",
      body:
        "第一条加密的握手消息。凡是不参与密钥计算的协商结果都放进这里，于是只有被加密后才发出去，例如 ALPN 选中的 `http/1.1`。TLS 1.2 里这些都在明文的 ServerHello 里。\n\n切到「记录」页可以看到这条记录的保护方式：外层类型伪装成 application_data（23），真实类型 handshake（22）藏在密文末尾；nonce 是 IV 与记录序号异或，AAD 是 5 字节记录头。",
      refs: [{ rfc: 8446, sec: "4.3.1" }, { rfc: 8446, sec: "5.2" }, { note: "T06", h: "记录层" }],
    },
    {
      id: "certificate",
      title: "{Certificate}：发送证书链",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerCertificate" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerCertificate" },
      msg: { dir: 1, type: 11 },
      tab: "certs",
      body:
        "证书消息里是叶子证书和中间证书，根证书不发：客户端本来就有，发了也不会被信任。TLS 1.3 给每张证书都附了一个扩展块，OCSP 响应和 SCT 可以放在这里。\n\n这些证书由采集程序现场生成，是一条三级链：TLS Companion Root CA 签 Issuing CA E1，E1 签 `tls-companion.example`。在字段树里展开 `cert_data` 能看到 DER 编码的逐层结构。",
      refs: [{ rfc: 8446, sec: "4.4.2" }, { note: "T03", h: "证书链为什么需要中间证书" }],
    },
    {
      id: "certificate-verify",
      title: "{CertificateVerify}：用私钥签下握手记录",
      side: 1,
      at: { enter: T + "signedMessage", side: 1 },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerCertificate", find: "signedMessage(serverSignatureContext" },
      msg: { dir: 1, type: 15 },
      body:
        "服务器用叶子证书的私钥签名，签的内容是 64 个空格、上下文串 `TLS 1.3, server CertificateVerify`、一个 0 字节，再加上到目前为止的记录哈希（`signedMessage`）。\n\n这一个签名同时证明两件事：服务器持有证书对应的私钥；它看到的 ClientHello 和客户端发出的是同一条，任何对前面消息的篡改都会让签名失效。",
      refs: [{ rfc: 8446, sec: "4.4.3" }, { note: "T06", h: "certificateverify" }],
    },
    {
      id: "server-finished",
      title: "{Finished}，以及应用流量密钥",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerFinished" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerFinished", find: "hs.masterSecret = hs.handshakeSecret.MasterSecret()" },
      msg: { dir: 1, type: 20 },
      tab: "keys",
      body:
        "`verify_data` 是用 finished_key 对记录哈希做的 HMAC，finished_key 由 server_handshake_traffic_secret 展开得到。\n\n发完 Finished，第三级 HKDF-Extract 得到 Master Secret，再对到服务器 Finished 为止的记录派生出两条应用流量秘密。服务器此刻已经可以发应用数据了，这就是 TLS 1.3 的 0.5-RTT 数据。",
      refs: [{ rfc: 8446, sec: "4.4.4" }, { rfc: 8446, sec: "7.1" }],
    },
    {
      id: "ticket",
      title: "[NewSessionTicket]：提前算出客户端的 Finished",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendSessionTickets" },
      code: { fn: T + "serverHandshakeStateTLS13.sendSessionTickets", find: "hs.clientFinished = hs.suite.finishedHash" },
      msg: { dir: 1, type: 4 },
      body:
        "会话票据要用 resumption_master_secret，而它要求记录哈希一直覆盖到客户端的 Finished。Go 的服务器不等客户端：它自己先算出客户端 Finished 应该是什么（`hs.clientFinished`），把它写进记录哈希，提前派生出恢复秘密，于是票据可以和第一组消息一起发出。\n\n收到真正的客户端 Finished 时，服务器只需比对它和预先算好的值是否相同。票据用应用流量密钥保护，所以标成方括号 `[]`。",
      refs: [{ rfc: 8446, sec: "4.6.1" }, { note: "T06", h: "newsessionticket" }, { note: "T07", h: "tls-1.3-的-psk-恢复" }],
    },
    {
      id: "server-flush",
      title: "服务器的整组消息一次发出",
      side: 1,
      at: { writeMsg: { dir: 1, type: 2 } },
      code: { fn: T + "Conn.flush" },
      msg: { dir: 1, type: 2 },
      body:
        "上面这些记录都先写进 `sendBuf`，直到这里 `flush` 才一次性交给连接：ServerHello、CCS、{EncryptedExtensions}、{Certificate}、{CertificateVerify}、{Finished}、[NewSessionTicket]，约 2.4 KB，在客户端发出 ClientHello 半个往返之后抵达。\n\n把整组消息攒在一起发，是为了少用 TCP 段，也让客户端一次就能读到全部。",
      refs: [{ sym: T + "Conn.flush" }],
    },
    {
      id: "client-sh",
      title: "客户端检查 ServerHello",
      side: 0,
      at: { enter: T + "serverHelloMsg.unmarshal" },
      code: { fn: T + "clientHandshakeStateTLS13.checkServerHelloOrHRR" },
      msg: { dir: 1, type: 2 },
      body:
        "客户端在 `clientHandshake` 里读到 ServerHello，先用 `pickTLSVersion` 确认版本，然后进入 `clientHandshakeStateTLS13`。\n\n`checkServerHelloOrHRR` 检查服务器选的套件是自己提供过的、session id 原样回显、没有出现不该出现的扩展。ServerHello 的 random 还要和 HelloRetryRequest 的固定值比较，同时检查末尾 8 字节是不是降级哨兵 `DOWNGRD`。",
      refs: [{ rfc: 8446, sec: "4.1.3" }, { note: "T06", h: "降级保护random-末尾的哨兵" }],
    },
    {
      id: "client-decap",
      title: "客户端解封装，得到同样的握手密钥",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.establishHandshakeKeys" },
      code: { fn: T + "clientHandshakeStateTLS13.establishHandshakeKeys", find: "ke.clientSharedSecret" },
      tab: "keys",
      body:
        "客户端用自己的 ML-KEM 解封装密钥打开服务器的密文，再和服务器的 X25519 公钥做 ECDH，得到与服务器完全相同的 64 字节共享秘密。随后的 HKDF 链与服务器一字不差。\n\n在密钥面板里切换「客户端 / 服务器」，两边的每一个秘密值都相同。这正是 TLS 1.3 的核心：两台机器从未在网络上传过密钥，却各自算出了同一把。",
      refs: [{ note: "T02", h: "diffie-hellman在公开信道上谈出共享秘密" }, { rfc: 8446, sec: "7.1" }],
    },
    {
      id: "client-cert",
      title: "客户端验证证书链",
      side: 0,
      at: { enter: T + "Conn.verifyServerCertificate" },
      code: { fn: T + "Conn.verifyServerCertificate", find: "Verify(opts)" },
      msg: { dir: 1, type: 11 },
      tab: "certs",
      body:
        "`verifyServerCertificate` 先解析每张 DER 证书，再调用 `crypto/x509` 的 `Verify`：从叶子出发沿签名往上，必须走到 `RootCAs` 里的某个根；每一级都要在有效期内、用途允许服务器认证；叶子证书的 SAN 里要有 `tls-companion.example`。\n\n采集时 `Config.Time` 固定在 2026-10-17，证书有效期是围绕这一天签的，所以每次重放都能通过。",
      refs: [{ note: "T03", h: "路径验证客户端到底检查了什么" }, { sym: "crypto/x509.Certificate.Verify" }, { rfc: 5280, sec: "6" }],
    },
    {
      id: "client-cv",
      title: "客户端验证 CertificateVerify 签名",
      side: 0,
      at: { enter: T + "verifyHandshakeSignature" },
      code: { fn: T + "clientHandshakeStateTLS13.readServerCertificate", find: "verifyHandshakeSignature(sigType" },
      msg: { dir: 1, type: 15 },
      body:
        "客户端按同样的格式拼出被签名的内容，用证书里的公钥验证。到这里，客户端才确信对面持有 `tls-companion.example` 的私钥，而且双方看到的握手消息一致。",
      refs: [{ rfc: 8446, sec: "4.4.3" }],
    },
    {
      id: "client-sfin",
      title: "客户端核对服务器 Finished，派生应用密钥",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.readServerFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.readServerFinished", find: "hmac.Equal(expectedMAC" },
      msg: { dir: 1, type: 20 },
      body:
        "客户端自己算出服务器 Finished 应有的 HMAC，用常数时间的 `hmac.Equal` 比较。通过后派生两条应用流量秘密，并把读方向切到 server_application_traffic_secret_0，后面的 [NewSessionTicket] 就用它解密。",
      refs: [{ rfc: 8446, sec: "4.4.4" }],
    },
    {
      id: "client-fin",
      title: "客户端发出 {Finished}，握手在客户端结束",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.sendClientFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.sendClientFinished" },
      msg: { dir: 0, type: 20 },
      body:
        "客户端先补一条兼容性 CCS，再用 client_handshake_traffic_secret 加密自己的 Finished，然后把写方向切到应用流量密钥。`Handshake()` 在这里返回。\n\n从 ClientHello 发出算起正好 1 个往返，加上 TCP 的 1 个往返，客户端在第 2 个往返结束时就可以发出 HTTP 请求。TLS 1.2 要到第 3 个往返结束。",
      refs: [{ note: "T01" }, { note: "T06", h: "客户端的第二组消息" }],
    },
    {
      id: "app-request",
      title: "[应用数据]：HTTP 请求",
      side: 0,
      at: { mark: "app:write", side: 0 },
      code: { fn: T + "Conn.Write" },
      tab: "record",
      body:
        "应用调用 `conn.Write` 写出 `GET / HTTP/1.1`。记录层用 client_application_traffic_secret_0 展开出的 AES-128-GCM 密钥加密，序号从 0 开始，nonce 是 IV 与序号异或。\n\n点时序图上这条记录，「记录」页会同时列出密文、密钥、nonce、认证标签和解密后的明文。这些值是采集工具用 key log 独立解出的，并且和 crypto/tls 内部派生的密钥逐字节核对过。",
      refs: [{ rfc: 8446, sec: "5.3" }, { note: "T13", h: "实验-10用-key-log-解密自己的抓包" }],
    },
    {
      id: "server-cfin",
      title: "服务器核对客户端 Finished",
      side: 1,
      at: { readMsg: { dir: 0, type: 20 } },
      code: { fn: T + "serverHandshakeStateTLS13.readClientFinished", find: "hmac.Equal" },
      msg: { dir: 0, type: 20 },
      body:
        "服务器一直阻塞在 `readClientFinished` 里。客户端的 Finished 到达后，它与之前预先算好的 `hs.clientFinished` 比较，一致就把读方向切到 client_application_traffic_secret_0。服务器的 `Handshake()` 到此返回。",
      refs: [{ rfc: 8446, sec: "4.4.4" }],
    },
    {
      id: "app-response",
      title: "[应用数据]：HTTP 响应",
      side: 1,
      at: { mark: "app:write", side: 1 },
      code: { fn: T + "Conn.Write" },
      tab: "record",
      body: "服务器读出请求，写回 `HTTP/1.1 200 OK`。这是第 2 个往返结束时客户端收到的首字节，TCP 加 TLS 1.3 的完整连接一共 2 个往返之后才拿到响应。",
      refs: [{ note: "T07", h: "时间都花在哪里" }],
    },
    {
      id: "close",
      title: "close_notify：有序关闭",
      side: 0,
      at: { mark: "close", side: 0 },
      code: { fn: T + "Conn.closeNotify" },
      tab: "record",
      body:
        "客户端 `Close()` 时先发一条 close_notify 告警，同样加密。它告诉对方数据到此为止，不是被人截断的：没有它，攻击者可以通过提前断开 TCP 来截短响应。服务器读到 close_notify 后也回一条，然后关闭。",
      refs: [{ rfc: 8446, sec: "6.1" }],
    },
  ],
};
