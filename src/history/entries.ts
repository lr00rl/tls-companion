// The evolution timeline. Protocol and attack entries follow T04; every "in Go"
// claim points at code the validation test resolves against the index, and the
// Go release entries follow doc/godebug.md and the Go release notes.

export type Track = "proto" | "attack" | "go";

export interface CodeRef {
  fn: string;
  find?: string;
  label: string;
}

export interface Diff {
  file: string;
  from: string;
  to: string;
  /** What to look for in the diff. */
  hint: string;
}

export interface Entry {
  id: string;
  date: string;
  track: Track;
  title: string;
  /** What was wrong, or what changed. */
  problem: string;
  /** How the protocol or the ecosystem fixed it. */
  fix?: string;
  /** How Go's crypto/tls stands on it today, with code. */
  go?: string;
  code?: CodeRef[];
  rfcs?: [number, string?][];
  note?: [string, string?];
  play?: [string, string];
  diff?: Diff;
}

const T = "crypto/tls.";

export const tracks: Record<Track, string> = {
  proto: "协议与标准",
  attack: "攻击与事件",
  go: "Go crypto/tls",
};

export const entries: Entry[] = [
  {
    id: "ssl2",
    date: "1995",
    track: "proto",
    title: "SSL 2.0",
    problem:
      "第一个被广泛使用的版本。握手没有完整性保护，中间人可以把双方的套件列表删到只剩最弱的一个；加密和 MAC 共用一把密钥；没有安全关闭，截断无法察觉。",
    fix: "2011 年 RFC 6176 禁止使用。",
    go: "Go 从来没有实现 SSL 2.0，所以 DROWN 这类借道 SSLv2 的跨协议攻击对 Go 的服务器无从下手。",
    note: ["T04", "ssl-1.0-与-2.0先能用再说"],
  },
  {
    id: "ssl3",
    date: "1996",
    track: "proto",
    title: "SSL 3.0：现代 TLS 的骨架",
    problem: "重新设计，确立了记录层与握手层分层、Finished 覆盖整个握手、close_notify 防截断、会话恢复。遗留问题是 CBC 填充不校验内容。",
    fix: "2014 年被 POODLE 终结，2015 年 RFC 7568 废弃。",
    go: "`VersionSSL30` 常量还在，只为了兼容旧代码，标着 Deprecated；Go 1.14 起完全不再支持 SSLv3。",
    code: [{ fn: T + "VersionSSL30", label: "VersionSSL30" }],
    rfcs: [[6101]],
    note: ["T04", "ssl-3.0现代-tls-的骨架"],
  },
  {
    id: "tls10",
    date: "1999",
    track: "proto",
    title: "TLS 1.0（RFC 2246）",
    problem: "IETF 接手，线上版本号写作 3.1。用 HMAC 取代 SSL 3.0 自创的 MAC，PRF 同时用 MD5 和 SHA-1。隐患是 CBC 的 IV 取自上一条记录的密文末块，可以预测。",
    fix: "2021 年 RFC 8996 与 TLS 1.1 一起废弃。",
    go: "Go 1.22 起客户端和服务器的默认最低版本都是 TLS 1.2，TLS 1.0 只能显式打开。",
    code: [{ fn: T + "Config.MinVersion", label: "Config.MinVersion" }],
    rfcs: [[2246], [8996]],
    note: ["T04", "tls-1.0ietf-接手"],
  },
  {
    id: "tls11",
    date: "2006",
    track: "proto",
    title: "TLS 1.1（RFC 4346）：显式 IV",
    problem: "每条 CBC 记录带一个显式的随机 IV，堵住 BEAST 利用的 IV 可预测问题；填充错误和 MAC 错误返回同一个告警。",
    go: "Go 的记录层按版本决定是否在每条 CBC 记录前放显式 IV，注释直接写明是为了 BEAST。",
    code: [{ fn: T + "halfConn.explicitNonceLen", find: "BEAST", label: "halfConn.explicitNonceLen" }],
    rfcs: [[4346]],
    note: ["T04", "tls-1.1修补-cbc"],
  },
  {
    id: "tls12",
    date: "2008",
    track: "proto",
    title: "TLS 1.2（RFC 5246）：可协商的密码学",
    problem: "PRF 由套件决定，signature_algorithms 协商签名，引入 AEAD。也保留了 RSA 密钥传输、CBC、RC4、压缩、重协商等后来被逐一证明有问题的选项，安全取决于配置。",
    go: "Go 默认只给 TLS 1.2 提供 ECDHE 加 AEAD（和少量 CBC）套件，扩展主密钥默认开启。工作台里有两条 TLS 1.2 的真实握手。",
    play: ["tls12-ecdhe", "ch"],
    rfcs: [[5246]],
    note: ["T04", "tls-1.2可协商的密码学"],
  },
  {
    id: "tls13",
    date: "2018-08",
    track: "proto",
    title: "TLS 1.3（RFC 8446）",
    problem: "删掉 RSA 密钥传输、静态 DH、CBC、RC4、压缩、重协商、自定义 DH 群；ServerHello 之后全部加密；一个往返完成握手；HKDF 密钥调度；降级哨兵；发布前做了大量形式化分析。",
    fix: "为了穿过只认识旧协议的中间设备，legacy_version 固定写 0x0303，真实版本放进 supported_versions，并发送兼容性 CCS（附录 D.4）。",
    go: "TLS 1.3 的状态机在 handshake_client_tls13.go 与 handshake_server_tls13.go，密钥调度在 FIPS 模块的 tls13 包里。",
    code: [
      { fn: T + "serverHandshakeStateTLS13.handshake", label: "serverHandshakeStateTLS13.handshake" },
      { fn: "crypto/internal/fips140/tls13.EarlySecret.HandshakeSecret", label: "tls13 密钥调度" },
    ],
    play: ["tls13-full", "client-hello-build"],
    rfcs: [[8446], [8446, "D.4"]],
    note: ["T04", "tls-1.3删掉一切可疑的东西"],
  },
  {
    id: "rfc8996",
    date: "2021-03",
    track: "proto",
    title: "RFC 8996：废弃 TLS 1.0 与 1.1",
    problem: "正式宣布 TLS 1.0 和 1.1 不再安全可用，要求实现不再协商它们。",
    rfcs: [[8996]],
  },
  {
    id: "ech",
    date: "2026-03",
    track: "proto",
    title: "ECH 发布为 RFC 9849",
    problem: "握手里最后一块明文是 SNI，旁观者能看到你访问的域名。ECH 用 HPKE 把真实的 ClientHello 整个加密进外层 ClientHello。",
    go: "Go 1.23 起客户端支持 ECH（`EncryptedClientHelloConfigList`），1.24 起服务器也支持（`EncryptedClientHelloKeys`）。",
    code: [
      { fn: T + "Config.EncryptedClientHelloConfigList", label: "Config.EncryptedClientHelloConfigList" },
      { fn: T + "Config.EncryptedClientHelloKeys", label: "Config.EncryptedClientHelloKeys" },
    ],
    rfcs: [[9849], [9180]],
    note: ["T08", "ech-的角色与外层内层-clienthello"],
  },
  {
    id: "rfc9846",
    date: "2026-07",
    track: "proto",
    title: "RFC 9846：TLS 1.3 修订版",
    problem: "合并 RFC 8446 发布以来的勘误和澄清，取代 RFC 8446，同时废止 RFC 5077、5246、6961、7627、8422。协议版本号不变。",
    rfcs: [[9846]],
    note: ["T04", "版本时间线"],
  },
  {
    id: "rfc10024",
    date: "2026-08",
    track: "proto",
    title: "RFC 10024：混合后量子密钥交换",
    problem: "量子计算机威胁的是今天录下、将来解密的流量。X25519MLKEM768 把 ML-KEM-768 与 X25519 并用，任何一个没被攻破就安全。",
    go: "Go 把两个共享秘密按 RFC 拼接：X25519MLKEM768 是 ML-KEM 在前，另外两个混合组是 ECDH 在前。",
    code: [{ fn: T + "hybridKeyExchange.serverSharedSecret", find: "sharedKey = append(mlkemSharedSecret", label: "hybridKeyExchange.serverSharedSecret" }],
    play: ["tls13-full", "server-encap"],
    rfcs: [[10024]],
    note: ["T10", "混合密钥交换x25519mlkem768"],
  },

  {
    id: "bleichenbacher",
    date: "1998",
    track: "attack",
    title: "Bleichenbacher 百万消息攻击",
    problem: "RSA 密钥传输里，服务器如果对 PKCS #1 v1.5 填充的对错有任何可观察的区别，就成了预言机。约一百万次查询即可解出一个被截获的预主密钥。",
    fix: "规范要求解密失败时换成随机预主密钥继续握手，但要实现真正的恒定时间很难。最终是 TLS 1.3 删掉 RSA 密钥传输。",
    go: "Go 解密时传 `SessionKeyLen: 48`，填充错误不报错而是返回随机值，错误路径与正确路径无从区分。",
    code: [{ fn: T + "rsaKeyAgreement.processClientKeyExchange", find: "SessionKeyLen: 48", label: "rsaKeyAgreement.processClientKeyExchange" }],
    play: ["tls12-rsa", "server-decrypt"],
    rfcs: [[5246, "7.4.7.1"]],
    note: ["T04", "1998bleichenbacher-的百万消息攻击"],
  },
  {
    id: "renego",
    date: "2009",
    track: "attack",
    title: "重协商攻击",
    problem: "重协商的新握手与旧连接之间没有密码学绑定，中间人可以把自己的数据拼接到受害者的请求前面。",
    fix: "RFC 5746 的 renegotiation_info 把重协商绑定到之前的 Finished；TLS 1.3 取消重协商。",
    go: "Go 的服务器从不重协商；客户端默认 `RenegotiateNever`，并总是发送 renegotiation_info。",
    code: [{ fn: T + "Conn.handleRenegotiation", find: "RenegotiateNever", label: "Conn.handleRenegotiation" }],
    rfcs: [[5746]],
    note: ["T04", "2009重协商攻击"],
  },
  {
    id: "beast",
    date: "2011",
    track: "attack",
    title: "BEAST",
    problem: "TLS 1.0 的 CBC IV 可预测，结合浏览器里注入的脚本做选择明文攻击，可以逐字节猜出 Cookie。",
    fix: "TLS 1.1 的显式 IV；浏览器在 TLS 1.0 上用 1/n-1 记录拆分缓解；最终是 AEAD 和 TLS 1.3。",
    go: "Go 至今保留了 1/n-1 拆分：TLS 1.0 加 CBC 时，每次 Write 先单独发出 1 字节的记录，让后面那条记录的 IV 变得不可预测。",
    code: [{ fn: T + "Conn.Write", find: "c.vers == VersionTLS10", label: "Conn.Write 的 1/n-1 拆分" }],
    note: ["T04", "2011beast"],
  },
  {
    id: "crime",
    date: "2012",
    track: "attack",
    title: "CRIME 与 BREACH",
    problem: "压缩让密文长度依赖明文内容。让攻击者控制的字符串和秘密一起被压缩，猜对时密文更短。BREACH 针对 HTTP 层的 gzip，TLS 本身修不了。",
    fix: "普遍关闭 TLS 压缩，TLS 1.3 删除；HTTP/2、HTTP/3 的头部压缩改用 HPACK 和 QPACK。",
    go: "Go 从来只支持 null 压缩，服务器在客户端不提供 null 压缩时直接拒绝握手。",
    code: [{ fn: T + "serverHandshakeState.processClientHello", find: "compression == compressionNone", label: "serverHandshakeState.processClientHello" }],
    note: ["T04", "2012crime-与-2013breach"],
  },
  {
    id: "lucky13",
    date: "2013",
    track: "attack",
    title: "Lucky Thirteen",
    problem: "MAC-then-Encrypt 的 CBC 记录，填充长度不同 MAC 计算的数据量就不同，时间差构成填充预言机。",
    fix: "实现改写为恒定时间的 CBC 解密，非常难写对；根本修复是 AEAD。",
    go: "Go 把填充之后的字节作为额外数据喂给 HMAC，让 MAC 计算大致恒定时间；SHA-256 版本的 CBC 套件因为没有这层防护，默认不启用。",
    code: [
      { fn: T + "halfConn.decrypt", find: "Lucky13", label: "halfConn.decrypt" },
      { fn: T + "extractPadding", label: "extractPadding" },
    ],
    note: ["T04", "2013lucky-thirteen"],
  },
  {
    id: "rc4",
    date: "2013",
    track: "attack",
    title: "RC4 的偏差",
    problem: "RC4 密钥流统计上不均匀，同一个秘密在大量连接里被反复加密时可以被统计恢复。",
    fix: "2015 年 RFC 7465 禁止在 TLS 中使用 RC4。",
    go: "RC4 套件只出现在 `InsecureCipherSuites()` 里，默认不会被协商。",
    code: [{ fn: T + "InsecureCipherSuites", label: "InsecureCipherSuites" }],
    note: ["T04", "2013-至-2015rc4-的偏差"],
  },
  {
    id: "heartbleed",
    date: "2014-04",
    track: "attack",
    title: "Heartbleed",
    problem: "OpenSSL 心跳扩展的实现漏洞：不检查声明的负载长度，回送服务器内存，可读出会话密钥甚至私钥。",
    fix: "打补丁并更换私钥；催生了 LibreSSL 与 BoringSSL 分支和关键开源设施的资助。",
    go: "这是实现漏洞而非协议漏洞。Go 没有实现心跳扩展，内存安全的语言也让这种越界读无从发生。",
    note: ["T04", "2014heartbleed"],
  },
  {
    id: "triple",
    date: "2014",
    track: "attack",
    title: "三次握手攻击",
    problem: "结合 RSA 密钥传输、会话恢复和重协商，让两条不同的连接得到相同的主密钥和 Finished，绕过重协商保护。",
    fix: "RFC 7627 的扩展主密钥，让主密钥依赖整个握手的哈希；TLS 1.3 的密钥调度天然绑定转录。",
    go: "Go 默认协商扩展主密钥；没有它时 Go 1.22 起拒绝导出密钥材料（`tlsunsafeekm`）。",
    code: [{ fn: T + "extMasterFromPreMasterSecret", label: "extMasterFromPreMasterSecret" }],
    play: ["tls12-ecdhe", "cke"],
    rfcs: [[7627]],
    note: ["T04", "2014三次握手攻击"],
  },
  {
    id: "poodle",
    date: "2014-10",
    track: "attack",
    title: "POODLE",
    problem: "SSL 3.0 的 CBC 填充不校验内容，加上浏览器握手失败就降版本重试，攻击者可以把连接逼降到 SSL 3.0 再利用。",
    fix: "禁用 SSL 3.0；RFC 7507 的 TLS_FALLBACK_SCSV 让服务器识破被迫的降级；TLS 1.3 用 random 末尾的降级哨兵。",
    go: "Go 的服务器识别 TLS_FALLBACK_SCSV，在客户端被迫降级时回 inappropriate_fallback；TLS 1.3 服务器协商低版本时在 random 里写入哨兵。",
    code: [
      { fn: T + "serverHandshakeState.pickCipherSuite", find: "TLS_FALLBACK_SCSV", label: "pickCipherSuite 处理 SCSV" },
      { fn: T + "serverHandshakeState.processClientHello", find: "downgradeCanaryTLS12", label: "写入降级哨兵" },
    ],
    play: ["tls12-ecdhe", "server-pick"],
    rfcs: [[7507], [8446, "4.1.3"]],
    note: ["T04", "2014poodle"],
  },
  {
    id: "freak-logjam",
    date: "2015",
    track: "attack",
    title: "FREAK 与 Logjam",
    problem: "1990 年代出口管制留下的 512 位 RSA 与 DH 套件，被中间人降级利用；大量服务器共用少数 1024 位 DH 素数，国家级对手可以预计算。",
    fix: "移除出口级套件，DH 至少 2048 位或用 RFC 7919 的标准群，或改用 ECDHE；TLS 1.3 不允许自定义 DH 群。",
    go: "Go 从未实现出口级套件，也从未实现有限域 DHE，TLS 1.2 的前向保密只走 ECDHE。",
    code: [{ fn: T + "ecdheKeyAgreement.generateServerKeyExchange", label: "ecdheKeyAgreement" }],
    rfcs: [[7919]],
    note: ["T04", "2015freak-与-logjam"],
  },
  {
    id: "2016",
    date: "2016",
    track: "attack",
    title: "DROWN、Sweet32、SLOTH",
    problem: "DROWN 借共用私钥的 SSLv2 服务当 Bleichenbacher 预言机；Sweet32 让 64 位分组的 3DES 在约 32GB 后发生碰撞；SLOTH 证明握手签名用 MD5、SHA-1 会遭转录碰撞。",
    fix: "关掉一切 SSLv2；弃用 3DES；签名和转录哈希禁用 MD5 与 SHA-1。",
    go: "Go 1.23 起 3DES 不在默认套件里（`tls3des`）；Go 1.25 起 TLS 1.2 不再接受 SHA-1 签名（`tlssha1`，RFC 9155）。",
    code: [{ fn: T + "isDisabledSignatureAlgorithm", label: "isDisabledSignatureAlgorithm" }],
    note: ["T04", "2016drownsweet32sloth"],
  },
  {
    id: "robot",
    date: "2017",
    track: "attack",
    title: "ROBOT",
    problem: "自动化扫描发现 Bleichenbacher 预言机二十年来从未消失，大量厂商设备和大站服务器仍对填充错误有可区分的反应。",
    fix: "成为“RSA 密钥传输必须删除”的最后一记重锤。",
    go: "Go 1.22 起 RSA 密钥传输套件不在默认列表里（`tlsrsakex`），工作台里的 RSA 场景是显式配置出来的。",
    code: [{ fn: T + "rsaKeyAgreement.processClientKeyExchange", label: "rsaKeyAgreement.processClientKeyExchange" }],
    play: ["tls12-rsa", "cke"],
    note: ["T04", "2017robot"],
  },
  {
    id: "alpaca",
    date: "2021",
    track: "attack",
    title: "Raccoon 与 ALPACA",
    problem: "Raccoon 利用 TLS 1.2 DH 去掉前导零带来的时间差；ALPACA 把 HTTPS 请求重定向到同证书的 FTP、邮件服务，在错误的协议语境下处理。",
    fix: "TLS 1.3 不受 Raccoon 影响；服务器严格校验 ALPN 和 SNI，拒绝与自己协议不符的连接。",
    go: "Go 没有有限域 DHE。服务器在 ALPN 没有交集时直接拒绝握手（no_application_protocol），只为 h2 服务器保留了 http/1.1 客户端的兼容例外。",
    code: [{ fn: T + "negotiateALPN", find: "client requested unsupported application protocols", label: "negotiateALPN" }],
    rfcs: [[7301]],
    note: ["T04", "2020raccoon-与-2021alpaca"],
  },
  {
    id: "diginotar",
    date: "2011-08",
    track: "attack",
    title: "DigiNotar 与 CA 事件",
    problem: "DigiNotar 被入侵签出 500 多张伪造证书，*.google.com 被用于大规模中间人攻击。根库里任何一个 CA 都能为任何域名签证书。",
    fix: "移出根库、证书透明度、CAA、根程序治理、证书寿命缩短。",
    go: "Go 按 RFC 5280 做路径验证：只问链能不能走到 RootCAs 里的某个根，域名是否匹配。信任边界由根库决定。",
    code: [{ fn: "crypto/x509.Certificate.Verify", label: "x509.Certificate.Verify" }],
    play: ["tls13-full", "client-cert"],
    note: ["T03", "这个根签出来的任何证书都会被信任"],
  },

  {
    id: "go112",
    date: "2019-02",
    track: "go",
    title: "Go 1.12：TLS 1.3（可选）",
    problem: "crypto/tls 加入 TLS 1.3，需要用 GODEBUG 显式开启。客户端和服务器的 TLS 1.3 状态机作为独立文件出现。",
    code: [{ fn: T + "clientHandshakeStateTLS13.handshake", label: "clientHandshakeStateTLS13.handshake" }],
    diff: { file: "crypto/tls/handshake_client_tls13.go", from: "go1.12", to: "go1.26.0", hint: "Go 1.12 的第一版 TLS 1.3 客户端，与今天对比：混合密钥交换、ECH、QUIC 都是后来加的。" },
  },
  {
    id: "go113",
    date: "2019-09",
    track: "go",
    title: "Go 1.13：TLS 1.3 默认开启",
    problem: "TLS 1.3 成为默认，同时支持 Ed25519 证书。",
    diff: { file: "crypto/tls/common.go", from: "go1.12", to: "go1.13", hint: "isTLS13Supported 的判断从 GODEBUG tls13=1 才开启，改成 tls13=0 才关闭。" },
  },
  {
    id: "go114",
    date: "2020-02",
    track: "go",
    title: "Go 1.14：移除 SSLv3",
    problem: "SSL 3.0 支持被彻底删除，`VersionSSL30` 只剩一个标着 Deprecated 的常量。",
    code: [{ fn: T + "VersionSSL30", label: "VersionSSL30" }],
    diff: { file: "crypto/tls/common.go", from: "go1.13", to: "go1.14", hint: "VersionSSL30 从支持的版本列表里删掉，Deprecated 注释从“将被移除”改成“不再支持”。" },
  },
  {
    id: "go118",
    date: "2022-03",
    track: "go",
    title: "Go 1.18：客户端默认最低 TLS 1.2",
    problem: "客户端不再默认提议 TLS 1.0 和 1.1；crypto/x509 拒绝大多数 SHA-1 证书签名。",
    diff: { file: "crypto/tls/common.go", from: "go1.17", to: "go1.18", hint: "supportedVersions 新增了客户端的判断：MinVersion 为 0 时跳过 TLS 1.0 和 1.1。" },
  },
  {
    id: "go121",
    date: "2023-08",
    track: "go",
    title: "Go 1.21：QUIC API 与扩展主密钥",
    problem: "新增 `QUICConn`，让 QUIC 实现借用 crypto/tls 的 TLS 1.3 握手而不用它的记录层；实现扩展主密钥（RFC 7627）。",
    code: [{ fn: T + "QUICClient", label: "QUICClient" }],
    note: ["T09", "quic-怎么使用-tls-1.3"],
    diff: { file: "crypto/tls/quic.go", from: "go1.21.0", to: "go1.26.0", hint: "quic.go 在 1.21 首次出现；对比看后来加的 0-RTT 与会话事件。" },
  },
  {
    id: "go122",
    date: "2024-02",
    track: "go",
    title: "Go 1.22：RSA 密钥传输退出默认",
    problem: "默认套件去掉 RSA 密钥传输（`tlsrsakex`）；客户端和服务器默认最低版本 TLS 1.2（`tls10server`）；没有扩展主密钥时禁用 ExportKeyingMaterial（`tlsunsafeekm`）。",
    play: ["tls12-rsa", "ch"],
    diff: { file: "crypto/tls/cipher_suites.go", from: "go1.21.0", to: "go1.22.0", hint: "TLS_RSA_* 在套件表里的 insecure 标记从 false 变成 true，默认列表随之去掉它们。" },
  },
  {
    id: "go123",
    date: "2024-08",
    track: "go",
    title: "Go 1.23：Kyber 默认、3DES 退出、ECH 客户端",
    problem: "默认启用实验性的 X25519Kyber768Draft00；默认套件去掉 3DES（`tls3des`）；客户端支持 ECH。",
    diff: { file: "crypto/tls/key_schedule.go", from: "go1.22.0", to: "go1.23.0", hint: "第一次出现混合密钥交换：keyShares 生成两份份额。" },
  },
  {
    id: "go124",
    date: "2025-02",
    track: "go",
    title: "Go 1.24：X25519MLKEM768 与 FIPS 140-3",
    problem: "标准化后的 X25519MLKEM768 取代 Kyber 草案成为默认（`tlsmlkem`）；服务器支持 ECH；密码学原语迁入 crypto/internal/fips140 模块，TLS 1.3 密钥调度也在其中。",
    code: [{ fn: T + "hybridKeyExchange.keyShares", label: "hybridKeyExchange.keyShares" }],
    play: ["tls13-full", "key-share"],
    diff: { file: "crypto/tls/key_schedule.go", from: "go1.23.0", to: "go1.24.0", hint: "Kyber 草案换成 ML-KEM，密钥调度换成 fips140/tls13。" },
  },
  {
    id: "go125",
    date: "2025-08",
    track: "go",
    title: "Go 1.25：TLS 1.2 禁用 SHA-1 签名",
    problem: "按 RFC 9155，TLS 1.2 握手不再接受 SHA-1 签名算法（`tlssha1`）。",
    code: [{ fn: T + "isDisabledSignatureAlgorithm", label: "isDisabledSignatureAlgorithm" }],
    diff: { file: "crypto/tls/auth.go", from: "go1.24.0", to: "go1.25.0", hint: "看 SHA-1 签名在 TLS 1.2 里的判断。" },
  },
  {
    id: "go126",
    date: "2026-02",
    track: "go",
    title: "Go 1.26：更多后量子组",
    problem: "默认再加入 SecP256r1MLKEM768 与 SecP384r1MLKEM1024（`tlssecpmlkem`）；crypto/hpke 成为公开包；各密码学函数的 rand 参数被忽略，总是使用安全随机源。",
    code: [{ fn: T + "keyExchangeForCurveID", label: "keyExchangeForCurveID" }],
    diff: { file: "crypto/tls/key_schedule.go", from: "go1.25.0", to: "go1.26.0", hint: "新增两个 NIST 曲线混合组；注意它们与 X25519MLKEM768 拼接顺序不同。" },
  },
];
