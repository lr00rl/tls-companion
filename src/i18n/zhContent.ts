// Chinese copy of the scenarios and the history timeline. English lives in
// the scenario and history modules. Taken from the text before this branch
// was translated.
export const zhScenarios = {
  "tls13-full": {
    "short": "TLS 1.3 完整",
    "intro": "Go 1.26 的客户端和服务器都用默认配置，只加了证书和 ALPN。默认的第一选择是 X25519MLKEM768 混合密钥交换，所以这条连接的 ClientHello 有 1.5 KB，放不进一个 TCP 段。握手 1 个往返完成，随后是一次 HTTP/1.1 请求和响应，最后双方互发 close_notify。",
    "steps": {
      "server-wait": {
        "title": "服务器进入 Handshake，等待 ClientHello",
        "body": "服务器的 goroutine 调用 `tls.Server(conn, config)` 得到 `*tls.Conn`，再调用 `Handshake()`。`serverHandshake` 做的第一件事是 `readClientHello`，它一路调到 `readRecord`，在网络读上阻塞。\n\n左边的时序图里，TCP 三次握手画成了灰色示意：这次采集在进程内用管道代替了 TCP，但真实连接在 TLS 开始前一定先花掉这 1 个往返。",
        "h": [
          "三次握手"
        ]
      },
      "client-hello-build": {
        "title": "客户端构造 ClientHello",
        "body": "`makeClientHello` 先把 `Config` 翻译成一条 `clientHelloMsg`：`supported_versions` 列出 TLS 1.3 和 1.2，开头的 `legacy_version` 却被压到 0x0303，因为 TLS 1.3 改用扩展协商版本，旧字段留给中间设备看。\n\n32 字节 `random` 和 32 字节 `legacy_session_id` 都来自 `config.rand()`。session id 在 TLS 1.3 里已经没有用处，填满随机数是为了让 ClientHello 看起来像一次 TLS 1.2 会话恢复，骗过只认识旧协议的中间设备（RFC 8446 附录 D.4）。",
        "h": [
          "clienthello"
        ]
      },
      "key-share": {
        "title": "生成 X25519MLKEM768 密钥份额",
        "body": "客户端在不知道服务器支持什么的情况下，先猜一组 `key_share`，猜中就省掉一个往返。`curvePreferences` 的第一项是 X25519MLKEM768，于是这里一次生成两把密钥：ML-KEM-768 的封装密钥（1184 字节）和 X25519 公钥（32 字节），拼成一个 1216 字节的份额。\n\n同时它还附上一份单独的 X25519 份额作为退路：如果服务器不支持后量子组，仍然可以直接用 X25519 完成握手，不必多走一次 HelloRetryRequest。在右侧字段树里展开 `key_share` 能看到这两条 entry。",
        "h": [
          "混合密钥交换x25519mlkem768",
          "keyshare客户端先猜"
        ]
      },
      "client-hello-send": {
        "title": "ClientHello 上线",
        "body": "`writeHandshakeRecord` 把消息序列化（`marshal`），写进握手转录（transcript），再交给记录层。第一条 ClientHello 的记录头版本号是 0x0301，代码注释写明了原因：有些老旧的 TLS 服务器在初始 ClientHello 的记录版本高于 TLS 1.0 时会出错。\n\n这条记录有 1536 字节，加上 5 字节记录头，超过了以太网上常见的 1460 字节 MSS，所以在真实网络里要拆成两个 TCP 段。时序图里的虚线就是这条界限：只带 X25519 份额的 TLS 1.3 ClientHello 大约 300 字节。",
        "h": [
          "部署的历程与现状",
          "字节别让握手多出一个往返"
        ]
      },
      "server-parse": {
        "title": "服务器解析 ClientHello",
        "body": "`readHandshake` 把记录层交上来的字节拼成完整的握手消息，`unmarshal` 用 `cryptobyte` 逐个解析扩展。不认识的扩展直接跳过，这是 TLS 能不断加新扩展的前提，也是 GREASE 要持续检验的性质。\n\n解析完后，`serverHandshake` 根据 `supported_versions` 选出 TLS 1.3，转进 `serverHandshakeStateTLS13`。",
        "h": []
      },
      "server-select": {
        "title": "服务器选定密码套件与密钥交换组",
        "body": "密码套件按偏好取双方都支持的第一个，有 AES 硬件时是 `TLS_AES_128_GCM_SHA256`。\n\n密钥交换组的选法更有意思：Go 把服务器自己的偏好列表重新排序，客户端已经给了份额的组排前面，后量子混合组再排前面（两次 `sort.SliceStable`）。这样既尽量避免 HelloRetryRequest，又在能用后量子的时候一定用上。这条连接选中了 X25519MLKEM768。",
        "h": [
          "keyshare客户端先猜"
        ]
      },
      "server-encap": {
        "title": "服务器封装，得到混合共享秘密",
        "body": "ML-KEM 不是 Diffie-Hellman：服务器用客户端的封装密钥做一次 `Encapsulate`，得到 1088 字节的密文和 32 字节的共享秘密；X25519 那一半照常做一次 ECDH。\n\n两个秘密按 RFC 10024 拼接，ML-KEM 在前，成为 64 字节的 (EC)DHE 共享秘密。在密钥面板里看 Handshake Secret 那一行的输入，长度就是 64 字节。服务器回给客户端的份额是密文加 X25519 公钥，共 1120 字节。",
        "h": [
          "kem-与-dh-的区别"
        ]
      },
      "server-hello": {
        "title": "ServerHello 和兼容性 ChangeCipherSpec",
        "body": "ServerHello 带着选中的密码套件、`supported_versions = 0x0304` 和自己的 `key_share`，`legacy_session_id_echo` 原样回显客户端的随机 session id。它是这次握手里服务器发出的最后一条明文握手消息。\n\n紧接着是一条只有 1 字节的 ChangeCipherSpec 记录。它在 TLS 1.3 里没有任何密码学含义，只是让中间设备相信这是一次正常的 TLS 1.2 会话恢复，`sendDummyChangeCipherSpec` 的注释里写明了这一点。",
        "h": [
          "serverhello"
        ]
      },
      "hs-keys-server": {
        "title": "服务器派生握手密钥",
        "body": "密钥调度的第一级：没有 PSK，Early Secret 是对全零做 HKDF-Extract。第二级用上一步的 64 字节共享秘密：先 `Derive-Secret(., \"derived\", \"\")`，再 HKDF-Extract 得到 Handshake Secret。\n\n然后对 ClientHello 和 ServerHello 的转录哈希分别派生 `s hs traffic` 和 `c hs traffic`，再各自展开出 AES 密钥和 IV。从这一刻起，服务器写出的记录都用 server_handshake_traffic_secret 加密，时序图里用玫红色和花括号 `{}` 标出。",
        "h": [
          "密钥调度"
        ]
      },
      "encrypted-extensions": {
        "title": "{EncryptedExtensions}",
        "body": "第一条加密的握手消息。凡是不参与密钥计算的协商结果都放进这里，于是只有被加密后才发出去，例如 ALPN 选中的 `http/1.1`。TLS 1.2 里这些都在明文的 ServerHello 里。\n\n切到「记录」页可以看到这条记录的保护方式：外层类型伪装成 application_data（23），真实类型 handshake（22）藏在密文末尾；nonce 是 IV 与记录序号异或，AAD 是 5 字节记录头。",
        "h": [
          "记录层"
        ]
      },
      "certificate": {
        "title": "{Certificate}：发送证书链",
        "body": "证书消息里是叶子证书和中间证书，根证书不发：客户端本来就有，发了也不会被信任。TLS 1.3 给每张证书都附了一个扩展块，OCSP 响应和 SCT 可以放在这里。\n\n这些证书由采集程序现场生成，是一条三级链：TLS Companion Root CA 签 Issuing CA E1，E1 签 `tls-companion.example`。在字段树里展开 `cert_data` 能看到 DER 编码的逐层结构。",
        "h": [
          "证书链为什么需要中间证书"
        ]
      },
      "certificate-verify": {
        "title": "{CertificateVerify}：用私钥签下握手转录",
        "body": "服务器用叶子证书的私钥签名，签的内容是 64 个空格、上下文串 `TLS 1.3, server CertificateVerify`、一个 0 字节，再加上到目前为止的转录哈希（`signedMessage`）。\n\n这一个签名同时证明两件事：服务器持有证书对应的私钥；它看到的 ClientHello 和客户端发出的是同一条，任何对前面消息的篡改都会让签名失效。",
        "h": [
          "certificateverify"
        ]
      },
      "server-finished": {
        "title": "{Finished}，以及应用流量密钥",
        "body": "`verify_data` 是用 finished_key 对转录哈希做的 HMAC，finished_key 由 server_handshake_traffic_secret 展开得到。\n\n发完 Finished，第三级 HKDF-Extract 得到 Master Secret，再对到服务器 Finished 为止的转录派生出两条应用流量秘密。服务器此刻已经可以发应用数据了，这就是 TLS 1.3 的 0.5-RTT 数据。",
        "h": []
      },
      "ticket": {
        "title": "[NewSessionTicket]：提前算出客户端的 Finished",
        "body": "会话票据要用 resumption_master_secret，而它要求转录哈希一直覆盖到客户端的 Finished。Go 的服务器不等客户端：它自己先算出客户端 Finished 应该是什么（`hs.clientFinished`），把它写进转录哈希，提前派生出恢复秘密，于是票据可以和第一组消息一起发出。\n\n收到真正的客户端 Finished 时，服务器只需比对它和预先算好的值是否相同。票据用应用流量密钥保护，所以标成方括号 `[]`。",
        "h": [
          "newsessionticket",
          "tls-1.3-的-psk-恢复"
        ]
      },
      "server-flush": {
        "title": "服务器的整组消息一次发出",
        "body": "上面这些记录都先写进 `sendBuf`，直到这里 `flush` 才一次性交给连接：ServerHello、CCS、{EncryptedExtensions}、{Certificate}、{CertificateVerify}、{Finished}、[NewSessionTicket]，约 2.5 KB。这组消息在客户端发出 ClientHello 半个往返之后从服务器发出，再过半个往返抵达客户端。\n\n把整组消息攒在一起发，是为了少用 TCP 段，也让客户端一次就能读到全部。",
        "h": []
      },
      "client-sh": {
        "title": "客户端检查 ServerHello",
        "body": "客户端在 `clientHandshake` 里读到 ServerHello，先用 `pickTLSVersion` 确认版本，检查 ServerHello 的 random 末尾 8 字节是不是降级哨兵 `DOWNGRD`，然后进入 `clientHandshakeStateTLS13`。\n\n`checkServerHelloOrHRR` 检查服务器选的套件是自己提供过的、session id 原样回显、没有出现不该出现的扩展。随后 random 还要和 HelloRetryRequest 的固定值比较。",
        "h": [
          "降级保护random-末尾的哨兵"
        ]
      },
      "client-decap": {
        "title": "客户端解封装，得到同样的握手密钥",
        "body": "客户端用自己的 ML-KEM 解封装密钥打开服务器的密文，再和服务器的 X25519 公钥做 ECDH，得到与服务器完全相同的 64 字节共享秘密。随后的 HKDF 链与服务器一字不差。\n\n在密钥面板里切换「客户端 / 服务器」，两边的每一个秘密值都相同。这正是 TLS 1.3 的核心：两台机器从未在网络上传过密钥，却各自算出了同一把。",
        "h": [
          "diffie-hellman在公开信道上谈出共享秘密"
        ]
      },
      "client-cert": {
        "title": "客户端验证证书链",
        "body": "`verifyServerCertificate` 先解析每张 DER 证书，再调用 `crypto/x509` 的 `Verify`：从叶子出发沿签名往上，必须走到 `RootCAs` 里的某个根；每一级都要在有效期内、用途允许服务器认证；叶子证书的 SAN 里要有 `tls-companion.example`。\n\n采集时 `Config.Time` 固定在 2026-10-17，证书有效期是围绕这一天签的，所以每次重放都能通过。",
        "h": [
          "路径验证客户端到底检查了什么"
        ]
      },
      "client-cv": {
        "title": "客户端验证 CertificateVerify 签名",
        "body": "客户端按同样的格式拼出被签名的内容，用证书里的公钥验证。到这里，客户端才确信对面持有 `tls-companion.example` 的私钥，而且双方看到的握手消息一致。",
        "h": []
      },
      "client-sfin": {
        "title": "客户端核对服务器 Finished，派生应用密钥",
        "body": "客户端自己算出服务器 Finished 应有的 HMAC，用常数时间的 `hmac.Equal` 比较。通过后派生两条应用流量秘密，并把读方向切到 server_application_traffic_secret_0，后面的 [NewSessionTicket] 就用它解密。",
        "h": []
      },
      "client-fin": {
        "title": "客户端发出 {Finished}，握手在客户端结束",
        "body": "客户端先补一条兼容性 CCS，再用 client_handshake_traffic_secret 加密自己的 Finished，然后把写方向切到应用流量密钥。`Handshake()` 在这里返回。\n\n从 ClientHello 发出算起正好 1 个往返，加上 TCP 的 1 个往返，客户端在第 2 个往返结束时就可以发出 HTTP 请求。TLS 1.2 要到第 3 个往返结束。",
        "h": [
          "客户端的第二组消息"
        ]
      },
      "app-request": {
        "title": "[应用数据]：HTTP 请求",
        "body": "应用调用 `conn.Write` 写出 `GET / HTTP/1.1`。记录层用 client_application_traffic_secret_0 展开出的 AES-128-GCM 密钥加密，序号从 0 开始，nonce 是 IV 与序号异或。\n\n点时序图上这条记录，「记录」页会同时列出密文、密钥、nonce、认证标签和解密后的明文。这些值是采集工具用 key log 独立解出的，并且和 crypto/tls 内部派生的密钥逐字节核对过。",
        "h": [
          "实验-10用-key-log-解密自己的抓包"
        ]
      },
      "server-cfin": {
        "title": "服务器核对客户端 Finished",
        "body": "服务器一直阻塞在 `readClientFinished` 里。客户端的 Finished 到达后，它与之前预先算好的 `hs.clientFinished` 比较，一致就把读方向切到 client_application_traffic_secret_0。服务器的 `Handshake()` 到此返回。",
        "h": []
      },
      "app-response": {
        "title": "[应用数据]：HTTP 响应",
        "body": "服务器读出请求，写回 `HTTP/1.1 200 OK`。客户端在第 3 个往返结束时才收到这些首字节：全新的 TCP 加 TLS 1.3 连接要等 2 个往返才能发出请求，再过 1 个往返拿到响应。",
        "h": [
          "时间都花在哪里"
        ]
      },
      "close": {
        "title": "close_notify：有序关闭",
        "body": "客户端 `Close()` 时先发一条 close_notify 告警，同样加密。它告诉对方数据到此为止，不是被人截断的：没有它，攻击者可以通过提前断开 TCP 来截短响应。服务器读到 close_notify 后也回一条，然后关闭。",
        "h": []
      }
    }
  },
  "tls13-hrr": {
    "short": "TLS 1.3 HRR",
    "intro": "服务器的 `CurvePreferences` 只有 P-256，而客户端照默认配置只为 X25519MLKEM768 和 X25519 准备了份额。客户端在 supported_groups 里列出了 P-256，所以握手不会失败，但服务器必须用 HelloRetryRequest 请它重来一次，整个握手因此多花 1 个往返。",
    "steps": {
      "server-wait": {
        "title": "服务器等待 ClientHello",
        "body": "和完整握手一样，服务器先阻塞在 `readClientHello` 里。区别只在它的配置：`CurvePreferences: []tls.CurveID{tls.CurveP256}`。",
        "h": []
      },
      "ch1": {
        "title": "第一个 ClientHello：份额猜错了",
        "body": "客户端只为偏好列表的第一项准备份额，也就是 X25519MLKEM768，外加一份 X25519 退路。`supported_groups` 里虽然列着 P-256，但没有它的份额。\n\n客户端预先生成所有组的份额就能避免重试，代价是每次握手多算几次密钥、ClientHello 再大一截。Go 的选择是只猜最可能的那一个。",
        "h": [
          "keyshare客户端先猜"
        ]
      },
      "hrr": {
        "title": "服务器发出 HelloRetryRequest",
        "body": "`processClientHello` 选出的组是 P-256，在客户端的份额里找不到，于是转入 `doHelloRetryRequest`。HelloRetryRequest 在线路上就是一条 ServerHello，只是 random 换成了一个固定值（SHA-256(\"HelloRetryRequest\")），`key_share` 扩展里只写要求的组。\n\n转录在这里被改写：第一个 ClientHello 先被哈希，再以一条合成的 `message_hash` 消息代替原文写回转录。RFC 这样设计是为了让无状态的服务器可以把转录哈希放进 cookie 里交给客户端保管。",
        "h": [
          "helloretryrequest"
        ]
      },
      "client-hrr": {
        "title": "客户端处理 HelloRetryRequest",
        "body": "客户端用同样的方式改写自己的转录，然后检查这次重试是否真的有必要：如果服务器要的组客户端已经给过份额，或者既没有 key_share 也没有 cookie，客户端会直接报错断开，防止被诱导做无意义的重试。\n\n通过检查后，客户端为 P-256 生成一份新的密钥，替换掉原来的份额。",
        "h": []
      },
      "ch2": {
        "title": "第二个 ClientHello",
        "body": "除了 `key_share` 换成一份 65 字节的 P-256 公钥，第二个 ClientHello 必须和第一个一模一样，服务器的 `illegalClientHelloChange` 会逐项比对。去掉了 1216 字节的混合份额，这条消息只剩三百多字节。\n\n注意两个 ClientHello 之间客户端还发了一条兼容性 CCS：TLS 1.3 允许它出现在第二个 ClientHello 之前。",
        "h": []
      },
      "server-continue": {
        "title": "服务器用 P-256 继续握手",
        "body": "从这里开始和完整握手相同：P-256 ECDH 得到 32 字节共享秘密，派生握手密钥，发出 ServerHello 和后面的加密消息。真正的 ServerHello 的 random 是新的随机数，不再是固定值。\n\n这条连接没有用上后量子密钥交换。HelloRetryRequest 在这里换来了互通，丢掉了抗量子的保护。",
        "h": [
          "先存后解为什么密钥交换先迁移"
        ]
      },
      "server-flight": {
        "title": "服务器的整组消息",
        "body": "ServerHello、{EncryptedExtensions}、{Certificate}、{CertificateVerify}、{Finished} 一次发出，比完整握手晚了整整 1 个往返。",
        "h": []
      },
      "client-finish": {
        "title": "客户端验证并发出 {Finished}",
        "body": "客户端在这一步之前完成了证书和签名验证。它的 `Handshake()` 在 2 个往返之后返回，加上 TCP 一共 3 个往返，和 TLS 1.2 一样慢。",
        "h": [
          "往返预算小结"
        ]
      },
      "app": {
        "title": "[应用数据]",
        "body": "之后的请求和响应与完整握手完全相同。",
        "h": []
      }
    }
  },
  "tls13-resume": {
    "short": "TLS 1.3 恢复",
    "intro": "采集程序先跑一条完整握手（没有录下来），客户端从中收到 NewSessionTicket 存进 `ClientSessionCache`；录下来的是第二条连接。客户端用票据里的 PSK 恢复会话，模式是 psk_dhe_ke：仍然做一次密钥交换以保持前向保密，但服务器不再发送证书，也不再签名。",
    "steps": {
      "server-wait": {
        "title": "服务器等待 ClientHello",
        "body": "服务器和上一条连接共用同一个 `tls.Config`，因此持有同一把会话票据密钥，能解开自己签发的票据。",
        "h": []
      },
      "load-session": {
        "title": "客户端取出票据，计算 binder",
        "body": "`loadSession` 从缓存里按服务器名取出会话，检查票据没有过期、密码套件仍然可用，然后把票据放进 `pre_shared_key` 扩展。报告票据年龄时加上服务器给的 `age_add`（`obfuscated_ticket_age`），可以混淆数值年龄；如果复用同一张票据，票据身份仍可能让旁观者关联连接。\n\n恢复用的 PSK 派生出新的 Early Secret，再派生 binder_key；binder 是对「截掉 binder 本身的 ClientHello」做的 HMAC。它证明发票据的人确实知道 PSK，而不只是重放了一张偷来的票据。",
        "h": [
          "恢复用的-psk"
        ]
      },
      "ch-psk": {
        "title": "带 pre_shared_key 的 ClientHello",
        "body": "`pre_shared_key` 必须是最后一个扩展，因为 binder 要覆盖它之前的全部内容。`psk_key_exchange_modes` 只列了 psk_dhe_ke，Go 的客户端从不提议不做密钥交换的 psk_ke。\n\n这条 ClientHello 仍然带着 X25519MLKEM768 份额，比完整握手的那条还大，因为多了一张票据。",
        "h": [
          "tls-1.3-的-psk-恢复"
        ]
      },
      "server-psk": {
        "title": "服务器解开票据，核对 binder",
        "body": "服务器用票据密钥解密票据（`decryptTicket`），得到上次会话的状态和恢复秘密，再检查票据有没有超过最长寿命、套件的哈希是否一致。然后它从 PSK 派生同样的 binder_key，算出 binder，用常数时间的 `hmac.Equal` 与客户端发来的比较。\n\n密钥面板里，这条连接的 Early Secret 不再是对全零的 Extract，它的输入是票据里的 PSK。",
        "h": []
      },
      "server-hello": {
        "title": "ServerHello 选中 PSK，仍然交换密钥",
        "body": "ServerHello 的 `pre_shared_key` 扩展只有两个字节：选中的身份序号 0。`key_share` 照常出现，Handshake Secret 的输入同时依赖 PSK 和这次新的共享秘密，所以即使票据密钥日后泄露，也解不开这次连接的流量。",
        "h": [
          "前向保密今天的私钥泄露不该解开昨天的流量"
        ]
      },
      "no-cert": {
        "title": "跳过 Certificate 和 CertificateVerify",
        "body": "`sendServerCertificate` 一进来就返回。选中的 PSK 把这次恢复认证到先前已由客户端认证的连接身份，因此服务器省略 Certificate 和 CertificateVerify；恢复握手不会再次验证证书。服务器的第一组消息因此从 2.5 KB 缩到 1.5 KB 左右，其中大部分是后量子份额。",
        "h": []
      },
      "server-flight": {
        "title": "服务器的整组消息",
        "body": "ServerHello、CCS、{EncryptedExtensions}、{Finished}、[NewSessionTicket]。新票据让客户端下次还能恢复，每张票据都只用一次是推荐做法。",
        "h": []
      },
      "client-psk": {
        "title": "客户端确认服务器接受了 PSK",
        "body": "客户端看到 `selected_identity` 指向自己发的唯一身份，检查套件的哈希一致，置 `usingPSK`，`ConnectionState().DidResume` 由此为真。随后 `readServerCertificate` 同样直接跳过证书验证。",
        "h": []
      },
      "client-finish": {
        "title": "客户端发出 {Finished}",
        "body": "往返数和完整握手一样是 1 个，省下的是证书传输和两次公钥签名运算。要连这 1 个往返也省掉，需要 0-RTT：Go 只在 QUIC 上支持客户端 0-RTT，TCP 上的 crypto/tls 不发送 early data。",
        "h": [
          "0-rtt让请求和握手一起出发",
          "0-rtt-的两个代价"
        ]
      },
      "new-ticket": {
        "title": "客户端收下新票据",
        "body": "客户端读响应时先读到 [NewSessionTicket]，`handleNewSessionTicket` 从 resumption_master_secret 和票据里的 nonce 派生出新的 PSK，存回缓存。",
        "h": []
      }
    }
  },
  "tls12-ecdhe": {
    "short": "TLS 1.2 ECDHE",
    "intro": "客户端把 `MaxVersion` 设为 TLS 1.2，只提供 `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256` 一个套件和 X25519 一个组；服务器是默认配置，本可以说 TLS 1.3。TLS 1.2 要先协商好参数才能交换密钥，客户端发出请求之前需要 2 个往返，再加上 TCP 一共 3 个。",
    "steps": {
      "server-wait": {
        "title": "服务器等待 ClientHello",
        "body": "服务器阻塞在 `readClientHello`。这一侧的配置没有变，它支持 TLS 1.3。",
        "h": []
      },
      "ch": {
        "title": "TLS 1.2 的 ClientHello",
        "body": "没有 `key_share`，`supported_versions` 里也只有 TLS 1.2：TLS 1.2 的客户端只能先报出能力，等服务器选完再交换密钥，这是它比 TLS 1.3 多一个往返的根源。\n\n留意几个为修补历史漏洞而加的扩展：`extended_master_secret` 防三次握手攻击，`renegotiation_info` 防 2009 年的重协商攻击。Go 默认总会发送它们。",
        "h": [
          "clienthello"
        ]
      },
      "server-pick": {
        "title": "服务器选套件，在 random 里埋下降级哨兵",
        "body": "服务器支持 TLS 1.3，却协商出了 TLS 1.2，于是按 RFC 8446 把 ServerHello.random 的最后 8 字节写成 `DOWNGRD\\x01`。在字段树里看 random 的末尾就是这串字节。\n\n如果有攻击者在中途删掉了客户端的 TLS 1.3 支持，一个同样支持 TLS 1.3 的客户端看到这个哨兵就会中止握手；而 random 被 ServerKeyExchange 的签名覆盖，攻击者改不掉它。这里的客户端自己声明了最高 TLS 1.2，所以哨兵不会触发。",
        "h": [
          "降级保护random-末尾的哨兵",
          "实验-5tls-1.2-和-tls-1.3-对照以及降级哨兵"
        ]
      },
      "ske": {
        "title": "Certificate 与 ServerKeyExchange",
        "body": "证书仍然是明文发送，旁观者能看到服务器是谁。ServerKeyExchange 带着服务器临时生成的 X25519 公钥，以及服务器用证书私钥对「client_random、server_random、曲线参数和这把公钥」的签名。\n\n签名只覆盖了这几项，不覆盖整个握手；完整性要等到最后的 Finished 才确认。TLS 1.3 的 CertificateVerify 改成了签整个转录哈希。",
        "h": [
          "serverkeyexchange"
        ]
      },
      "server-flight": {
        "title": "ServerHelloDone：第一个往返结束",
        "body": "ServerHello、Certificate、ServerKeyExchange、ServerHelloDone 一起发出，全是明文。到这里只交换了参数，双方还没有任何共享秘密。",
        "h": []
      },
      "client-verify": {
        "title": "客户端验证证书和签名",
        "body": "客户端先验证证书链，再用叶子证书的公钥验证 ServerKeyExchange 的签名，确认这把 X25519 公钥确实来自证书的持有者。",
        "h": [
          "路径验证客户端到底检查了什么"
        ]
      },
      "cke": {
        "title": "ClientKeyExchange 与扩展主密钥",
        "body": "客户端生成自己的 X25519 密钥，把公钥放进 ClientKeyExchange，与服务器公钥做 ECDH 得到预主密钥。\n\n协商了 extended_master_secret，主密钥就不再用两个 random 计算，而是 `PRF(预主密钥, \"extended master secret\", 会话哈希)`，会话哈希覆盖从 ClientHello 到 ClientKeyExchange 的全部消息，主密钥因此绑定到这一次握手，三次握手攻击无从下手。密钥面板展示了 crypto/tls 实际调用 PRF 的输入和输出。",
        "h": [
          "密钥是怎么推导出来的",
          "2014三次握手攻击"
        ]
      },
      "client-keys": {
        "title": "key expansion：主密钥展开成会话密钥",
        "body": "`keysFromMasterSecret` 用 PRF 把主密钥展开成一个密钥块，依次切出客户端写密钥、服务器写密钥和两个 4 字节的隐式 IV（AES-GCM 不需要 MAC 密钥）。TLS 1.2 两个方向的密钥来自同一次展开，TLS 1.3 则为每个方向、每个阶段分别派生。",
        "h": []
      },
      "client-finished": {
        "title": "ChangeCipherSpec 与客户端 Finished",
        "body": "在 TLS 1.2 里 ChangeCipherSpec 是真的：它之后，这个方向的记录开始加密，序号从 0 重新计数。Finished 是第一条加密记录，`verify_data` 是 `PRF(主密钥, \"client finished\", 握手哈希)` 的前 12 字节。\n\n「记录」页里能看到 TLS 1.2 GCM 的特点：每条记录带 8 字节显式 nonce，nonce = 隐式 IV ‖ 显式 nonce，AAD 里含有序号。",
        "h": []
      },
      "server-finish": {
        "title": "服务器算出同样的密钥，回 Finished",
        "body": "服务器用自己的临时私钥和客户端公钥做 ECDH，得到同一个预主密钥，派生同样的主密钥和密钥块，核对客户端 Finished，然后回自己的 CCS 和 Finished。服务器的握手在这里结束。",
        "h": []
      },
      "client-done": {
        "title": "第二个往返结束，客户端才能发请求",
        "body": "客户端核对服务器 Finished 之后，`Handshake()` 才返回。和 TLS 1.3 对比时序图：同样的请求在这里要晚 1 个往返才发出。False Start 允许客户端在发出自己的 Finished 后立即发送数据，Go 没有实现它。",
        "h": [
          "为什么-tls-1.2-是两个往返"
        ]
      },
      "app": {
        "title": "[应用数据]",
        "body": "应用数据用同一组会话密钥加密，外层类型就是真实类型 23，TLS 1.2 不隐藏记录类型。",
        "h": []
      }
    }
  },
  "tls12-rsa": {
    "short": "TLS 1.2 RSA",
    "intro": "`TLS_RSA_WITH_AES_128_GCM_SHA256`：没有 ServerKeyExchange，客户端直接用证书里的 RSA 公钥加密一个随机的预主密钥发给服务器。这条路在 TLS 1.3 里被整个删掉，Go 1.22 起也不在默认列表里，这里显式配置才能用上。看它是为了看清什么叫没有前向保密。",
    "steps": {
      "server-wait": {
        "title": "服务器等待 ClientHello",
        "body": "这一侧的证书换成了 RSA 2048，叶子证书带有 keyEncipherment 用途，RSA 密钥传输需要它。",
        "h": []
      },
      "ch": {
        "title": "ClientHello 只提供 RSA 密钥传输",
        "body": "套件列表里只有一项。RSA 密钥传输套件从 Go 1.22 起需要显式写进 `CipherSuites`（或设置 GODEBUG `tlsrsakex=1`）才会出现。",
        "h": [
          "rsa-密钥传输被删掉的那条路"
        ]
      },
      "server-flight": {
        "title": "ServerHello、Certificate、ServerHelloDone",
        "body": "没有 ServerKeyExchange，也就没有临时密钥和签名。服务器的长期 RSA 私钥同时承担了认证和密钥交换两件事。",
        "h": []
      },
      "cke": {
        "title": "客户端加密预主密钥",
        "body": "48 字节的预主密钥：前两字节是客户端版本，后 46 字节随机。客户端用 PKCS #1 v1.5 把它加密到服务器的 RSA 公钥，密文 256 字节，就在 ClientKeyExchange 里。\n\n这正是问题所在：谁拿到服务器私钥，谁就能解开这段密文，进而算出这条连接的全部密钥。今天录下的流量，在私钥泄露的那一天全部失守。",
        "h": [
          "前向保密今天的私钥泄露不该解开昨天的流量"
        ]
      },
      "finish": {
        "title": "Finished 与应用数据",
        "body": "客户端紧接着算出扩展主密钥、做 key expansion，发出 CCS 和 Finished，和 ECDHE 那一条完全相同，只是主密钥的输入换成了刚才加密传出去的预主密钥。",
        "h": []
      },
      "server-decrypt": {
        "title": "服务器用常数时间解密",
        "body": "服务器解密时传入 `SessionKeyLen: 48`：填充不对时不报错，而是悄悄换成一个随机的预主密钥，让握手在 Finished 处失败。错误路径和正确路径耗时一样，攻击者无法从响应里分辨填充是否合法。\n\n这是对 1998 年 Bleichenbacher 攻击的防御。2017 年的 ROBOT 发现很多实现在这一点上仍然有漏洞，RSA 密钥传输最终被移除。",
        "h": [
          "1998bleichenbacher-的百万消息攻击",
          "2017robot"
        ]
      },
      "app": {
        "title": "[应用数据]",
        "body": "在线路上看，它和 ECDHE 那条连接的应用数据没有区别。区别只在私钥泄露之后。",
        "h": []
      }
    }
  }
} as const;

export const zhHistory = {
  "tracks": {
    "proto": "协议与标准",
    "attack": "攻击与事件",
    "go": "Go crypto/tls"
  },
  "entries": {
    "2016": {
      "title": "DROWN、Sweet32、SLOTH",
      "problem": "DROWN 借共用私钥的 SSLv2 服务当 Bleichenbacher 预言机；Sweet32 让 64 位分组的 3DES 在约 32GB 后发生碰撞；SLOTH 证明握手签名用 MD5、SHA-1 会遭转录碰撞。",
      "fix": "关掉一切 SSLv2；弃用 3DES；签名和转录哈希禁用 MD5 与 SHA-1。",
      "go": "Go 1.23 起 3DES 不在默认套件里（`tls3des`）；Go 1.25 起 TLS 1.2 不再接受 SHA-1 签名（`tlssha1`，RFC 9155）。",
      "labels": [
        "isDisabledSignatureAlgorithm"
      ],
      "noteH": "2016drownsweet32sloth",
      "hint": ""
    },
    "ssl2": {
      "title": "SSL 2.0",
      "problem": "第一个被广泛使用的版本。握手没有完整性保护，中间人可以把双方的套件列表删到只剩最弱的一个；加密和 MAC 共用一把密钥；没有安全关闭，截断无法察觉。",
      "fix": "2011 年 RFC 6176 禁止使用。",
      "go": "Go 从来没有实现 SSL 2.0，所以 DROWN 这类借道 SSLv2 的跨协议攻击对 Go 的服务器无从下手。",
      "labels": [],
      "noteH": "ssl-1.0-与-2.0先能用再说",
      "hint": ""
    },
    "ssl3": {
      "title": "SSL 3.0：现代 TLS 的骨架",
      "problem": "重新设计，确立了记录层与握手层分层、Finished 覆盖整个握手、close_notify 防截断、会话恢复。遗留问题是 CBC 填充不校验内容。",
      "fix": "2014 年被 POODLE 终结，2015 年 RFC 7568 废弃。",
      "go": "`VersionSSL30` 常量还在，只为了兼容旧代码，标着 Deprecated；Go 1.14 起完全不再支持 SSLv3。",
      "labels": [
        "VersionSSL30"
      ],
      "noteH": "ssl-3.0现代-tls-的骨架",
      "hint": ""
    },
    "tls10": {
      "title": "TLS 1.0（RFC 2246）",
      "problem": "IETF 接手，线上版本号写作 3.1。用 HMAC 取代 SSL 3.0 自创的 MAC，PRF 同时用 MD5 和 SHA-1。隐患是 CBC 的 IV 取自上一条记录的密文末块，可以预测。",
      "fix": "2021 年 RFC 8996 与 TLS 1.1 一起废弃。",
      "go": "Go 1.22 起客户端和服务器的默认最低版本都是 TLS 1.2，TLS 1.0 只能显式打开。",
      "labels": [
        "Config.MinVersion"
      ],
      "noteH": "tls-1.0ietf-接手",
      "hint": ""
    },
    "tls11": {
      "title": "TLS 1.1（RFC 4346）：显式 IV",
      "problem": "每条 CBC 记录带一个显式的随机 IV，堵住 BEAST 利用的 IV 可预测问题；填充错误和 MAC 错误返回同一个告警。",
      "fix": "",
      "go": "Go 的记录层按版本决定是否在每条 CBC 记录前放显式 IV，注释直接写明是为了 BEAST。",
      "labels": [
        "halfConn.explicitNonceLen"
      ],
      "noteH": "tls-1.1修补-cbc",
      "hint": ""
    },
    "tls12": {
      "title": "TLS 1.2（RFC 5246）：可协商的密码学",
      "problem": "PRF 由套件决定，signature_algorithms 协商签名，引入 AEAD。也保留了 RSA 密钥传输、CBC、RC4、压缩、重协商等后来被逐一证明有问题的选项，安全取决于配置。",
      "fix": "",
      "go": "Go 默认只给 TLS 1.2 提供 ECDHE 加 AEAD（和少量 CBC）套件，扩展主密钥默认开启。工作台里有两条 TLS 1.2 的真实握手。",
      "labels": [],
      "noteH": "tls-1.2可协商的密码学",
      "hint": ""
    },
    "tls13": {
      "title": "TLS 1.3（RFC 8446）",
      "problem": "删掉 RSA 密钥传输、静态 DH、CBC、RC4、压缩、重协商、自定义 DH 群；ServerHello 之后全部加密；一个往返完成握手；HKDF 密钥调度；降级哨兵；发布前做了大量形式化分析。",
      "fix": "为了穿过只认识旧协议的中间设备，legacy_version 固定写 0x0303，真实版本放进 supported_versions，并发送兼容性 CCS（附录 D.4）。",
      "go": "TLS 1.3 的状态机在 handshake_client_tls13.go 与 handshake_server_tls13.go，密钥调度在 FIPS 模块的 tls13 包里。",
      "labels": [
        "serverHandshakeStateTLS13.handshake",
        "tls13 密钥调度"
      ],
      "noteH": "tls-1.3删掉一切可疑的东西",
      "hint": ""
    },
    "rfc8996": {
      "title": "RFC 8996：废弃 TLS 1.0 与 1.1",
      "problem": "正式宣布 TLS 1.0 和 1.1 不再安全可用，要求实现不再协商它们。",
      "fix": "",
      "go": "",
      "labels": [],
      "noteH": "",
      "hint": ""
    },
    "ech": {
      "title": "ECH 发布为 RFC 9849",
      "problem": "握手里最后一块明文是 SNI，旁观者能看到你访问的域名。ECH 用 HPKE 把真实的 ClientHello 整个加密进外层 ClientHello。",
      "fix": "",
      "go": "Go 1.23 起客户端支持 ECH（`EncryptedClientHelloConfigList`），1.24 起服务器也支持（`EncryptedClientHelloKeys`）。",
      "labels": [
        "Config.EncryptedClientHelloConfigList",
        "Config.EncryptedClientHelloKeys"
      ],
      "noteH": "ech-的角色与外层内层-clienthello",
      "hint": ""
    },
    "rfc9846": {
      "title": "RFC 9846：TLS 1.3 修订版",
      "problem": "合并 RFC 8446 发布以来的勘误和澄清，取代 RFC 8446，同时废止 RFC 5077、5246、6961、7627、8422。协议版本号不变。",
      "fix": "",
      "go": "",
      "labels": [],
      "noteH": "版本时间线",
      "hint": ""
    },
    "rfc10024": {
      "title": "RFC 10024：混合后量子密钥交换",
      "problem": "量子计算机威胁的是今天录下、将来解密的流量。X25519MLKEM768 把 ML-KEM-768 与 X25519 并用，任何一个没被攻破就安全。",
      "fix": "",
      "go": "Go 把两个共享秘密按 RFC 拼接：X25519MLKEM768 是 ML-KEM 在前，另外两个混合组是 ECDH 在前。",
      "labels": [
        "hybridKeyExchange.serverSharedSecret"
      ],
      "noteH": "混合密钥交换x25519mlkem768",
      "hint": ""
    },
    "bleichenbacher": {
      "title": "Bleichenbacher 百万消息攻击",
      "problem": "RSA 密钥传输里，服务器如果对 PKCS #1 v1.5 填充的对错有任何可观察的区别，就成了预言机。约一百万次查询即可解出一个被截获的预主密钥。",
      "fix": "规范要求解密失败时换成随机预主密钥继续握手，但要实现真正的恒定时间很难。最终是 TLS 1.3 删掉 RSA 密钥传输。",
      "go": "Go 解密时传 `SessionKeyLen: 48`，填充错误不报错而是返回随机值，错误路径与正确路径无从区分。",
      "labels": [
        "rsaKeyAgreement.processClientKeyExchange"
      ],
      "noteH": "1998bleichenbacher-的百万消息攻击",
      "hint": ""
    },
    "renego": {
      "title": "重协商攻击",
      "problem": "重协商的新握手与旧连接之间没有密码学绑定，中间人可以把自己的数据拼接到受害者的请求前面。",
      "fix": "RFC 5746 的 renegotiation_info 把重协商绑定到之前的 Finished；TLS 1.3 取消重协商。",
      "go": "Go 的服务器从不重协商；客户端默认 `RenegotiateNever`，并总是发送 renegotiation_info。",
      "labels": [
        "Conn.handleRenegotiation"
      ],
      "noteH": "2009重协商攻击",
      "hint": ""
    },
    "beast": {
      "title": "BEAST",
      "problem": "TLS 1.0 的 CBC IV 可预测，结合浏览器里注入的脚本做选择明文攻击，可以逐字节猜出 Cookie。",
      "fix": "TLS 1.1 的显式 IV；浏览器在 TLS 1.0 上用 1/n-1 记录拆分缓解；最终是 AEAD 和 TLS 1.3。",
      "go": "Go 至今保留了 1/n-1 拆分：TLS 1.0 加 CBC 时，每次 Write 先单独发出 1 字节的记录，让后面那条记录的 IV 变得不可预测。",
      "labels": [
        "Conn.Write 的 1/n-1 拆分"
      ],
      "noteH": "2011beast",
      "hint": ""
    },
    "crime": {
      "title": "CRIME 与 BREACH",
      "problem": "压缩让密文长度依赖明文内容。让攻击者控制的字符串和秘密一起被压缩，猜对时密文更短。BREACH 针对 HTTP 层的 gzip，TLS 本身修不了。",
      "fix": "普遍关闭 TLS 压缩，TLS 1.3 删除；HTTP/2、HTTP/3 的头部压缩改用 HPACK 和 QPACK。",
      "go": "Go 从来只支持 null 压缩，服务器在客户端不提供 null 压缩时直接拒绝握手。",
      "labels": [
        "serverHandshakeState.processClientHello"
      ],
      "noteH": "2012crime-与-2013breach",
      "hint": ""
    },
    "lucky13": {
      "title": "Lucky Thirteen",
      "problem": "MAC-then-Encrypt 的 CBC 记录，填充长度不同 MAC 计算的数据量就不同，时间差构成填充预言机。",
      "fix": "实现改写为恒定时间的 CBC 解密，非常难写对；根本修复是 AEAD。",
      "go": "Go 把 MAC 之后的填充字节作为额外数据喂给 HMAC，让 MAC 计算大致恒定时间；SHA-256 版本的 CBC 套件因为没有这层防护，默认不启用。",
      "labels": [
        "halfConn.decrypt",
        "extractPadding"
      ],
      "noteH": "2013lucky-thirteen",
      "hint": ""
    },
    "rc4": {
      "title": "RC4 的偏差",
      "problem": "RC4 密钥流统计上不均匀，同一个秘密在大量连接里被反复加密时可以被统计恢复。",
      "fix": "2015 年 RFC 7465 禁止在 TLS 中使用 RC4。",
      "go": "RC4 套件只出现在 `InsecureCipherSuites()` 里，默认不会被协商。",
      "labels": [
        "InsecureCipherSuites"
      ],
      "noteH": "2013-至-2015rc4-的偏差",
      "hint": ""
    },
    "heartbleed": {
      "title": "Heartbleed",
      "problem": "OpenSSL 心跳扩展的实现漏洞：不检查声明的负载长度，回送服务器内存，可读出会话密钥甚至私钥。",
      "fix": "打补丁并更换私钥；催生了 LibreSSL 与 BoringSSL 分支和关键开源设施的资助。",
      "go": "这是实现漏洞而非协议漏洞。Go 没有实现心跳扩展，内存安全的语言也让这种越界读无从发生。",
      "labels": [],
      "noteH": "2014heartbleed",
      "hint": ""
    },
    "triple": {
      "title": "三次握手攻击",
      "problem": "结合 RSA 密钥传输、会话恢复和重协商，让两条不同的连接得到相同的主密钥和 Finished，绕过重协商保护。",
      "fix": "RFC 7627 的扩展主密钥，让主密钥依赖整个握手的哈希；TLS 1.3 的密钥调度天然绑定转录。",
      "go": "Go 默认协商扩展主密钥；没有它时 Go 1.22 起拒绝导出密钥材料（`tlsunsafeekm`）。",
      "labels": [
        "extMasterFromPreMasterSecret"
      ],
      "noteH": "2014三次握手攻击",
      "hint": ""
    },
    "poodle": {
      "title": "POODLE",
      "problem": "SSL 3.0 的 CBC 填充不校验内容，加上浏览器握手失败就降版本重试，攻击者可以把连接逼降到 SSL 3.0 再利用。",
      "fix": "禁用 SSL 3.0；RFC 7507 的 TLS_FALLBACK_SCSV 让服务器识破被迫的降级；TLS 1.3 用 random 末尾的降级哨兵。",
      "go": "Go 的服务器识别 TLS_FALLBACK_SCSV，在客户端被迫降级时回 inappropriate_fallback；TLS 1.3 服务器协商低版本时在 random 里写入哨兵。",
      "labels": [
        "pickCipherSuite 处理 SCSV",
        "写入降级哨兵"
      ],
      "noteH": "2014poodle",
      "hint": ""
    },
    "freak-logjam": {
      "title": "FREAK 与 Logjam",
      "problem": "1990 年代出口管制留下的 512 位 RSA 与 DH 套件，被中间人降级利用；大量服务器共用少数 1024 位 DH 素数，国家级对手可以预计算。",
      "fix": "移除出口级套件，DH 至少 2048 位或用 RFC 7919 的标准群，或改用 ECDHE；TLS 1.3 不允许自定义 DH 群。",
      "go": "Go 从未实现出口级套件，也从未实现有限域 DHE，TLS 1.2 的前向保密只走 ECDHE。",
      "labels": [
        "ecdheKeyAgreement"
      ],
      "noteH": "2015freak-与-logjam",
      "hint": ""
    },
    "robot": {
      "title": "ROBOT",
      "problem": "自动化扫描发现 Bleichenbacher 预言机二十年来从未消失，大量厂商设备和大站服务器仍对填充错误有可区分的反应。",
      "fix": "成为“RSA 密钥传输必须删除”的最后一记重锤。",
      "go": "Go 1.22 起 RSA 密钥传输套件不在默认列表里（`tlsrsakex`），工作台里的 RSA 场景是显式配置出来的。",
      "labels": [
        "rsaKeyAgreement.processClientKeyExchange"
      ],
      "noteH": "2017robot",
      "hint": ""
    },
    "alpaca": {
      "title": "Raccoon 与 ALPACA",
      "problem": "Raccoon 利用 TLS 1.2 DH 去掉前导零带来的时间差；ALPACA 把 HTTPS 请求重定向到同证书的 FTP、邮件服务，在错误的协议语境下处理。",
      "fix": "TLS 1.3 不受 Raccoon 影响；服务器严格校验 ALPN 和 SNI，拒绝与自己协议不符的连接。",
      "go": "Go 没有有限域 DHE。服务器在 ALPN 没有交集时直接拒绝握手（no_application_protocol），只为 h2 服务器保留了 http/1.1 客户端的兼容例外。",
      "labels": [
        "negotiateALPN"
      ],
      "noteH": "2020raccoon-与-2021alpaca",
      "hint": ""
    },
    "diginotar": {
      "title": "DigiNotar 与 CA 事件",
      "problem": "DigiNotar 被入侵签出 500 多张伪造证书，*.google.com 被用于大规模中间人攻击。根库里任何一个 CA 都能为任何域名签证书。",
      "fix": "移出根库、证书透明度、CAA、根程序治理、证书寿命缩短。",
      "go": "Go 按 RFC 5280 做路径验证：只问链能不能走到 RootCAs 里的某个根，域名是否匹配。信任边界由根库决定。",
      "labels": [
        "x509.Certificate.Verify"
      ],
      "noteH": "这个根签出来的任何证书都会被信任",
      "hint": ""
    },
    "go112": {
      "title": "Go 1.12：TLS 1.3（可选）",
      "problem": "crypto/tls 加入 TLS 1.3，需要用 GODEBUG 显式开启。客户端和服务器的 TLS 1.3 状态机作为独立文件出现。",
      "fix": "",
      "go": "",
      "labels": [
        "clientHandshakeStateTLS13.handshake"
      ],
      "noteH": "",
      "hint": "Go 1.12 的第一版 TLS 1.3 客户端，与今天对比：混合密钥交换、ECH、QUIC 都是后来加的。"
    },
    "go113": {
      "title": "Go 1.13：TLS 1.3 默认开启",
      "problem": "TLS 1.3 成为默认，同时支持 Ed25519 证书。",
      "fix": "",
      "go": "",
      "labels": [],
      "noteH": "",
      "hint": "isTLS13Supported 的判断从 GODEBUG tls13=1 才开启，改成 tls13=0 才关闭。"
    },
    "go114": {
      "title": "Go 1.14：移除 SSLv3",
      "problem": "SSL 3.0 支持被彻底删除，`VersionSSL30` 只剩一个标着 Deprecated 的常量。",
      "fix": "",
      "go": "",
      "labels": [
        "VersionSSL30"
      ],
      "noteH": "",
      "hint": "VersionSSL30 从支持的版本列表里删掉，Deprecated 注释从“将被移除”改成“不再支持”。"
    },
    "go118": {
      "title": "Go 1.18：客户端默认最低 TLS 1.2",
      "problem": "客户端不再默认提议 TLS 1.0 和 1.1；crypto/x509 拒绝大多数 SHA-1 证书签名。",
      "fix": "",
      "go": "",
      "labels": [],
      "noteH": "",
      "hint": "supportedVersions 新增了客户端的判断：MinVersion 为 0 时跳过 TLS 1.0 和 1.1。"
    },
    "go121": {
      "title": "Go 1.21：QUIC API 与扩展主密钥",
      "problem": "新增 `QUICConn`，让 QUIC 实现借用 crypto/tls 的 TLS 1.3 握手而不用它的记录层；实现扩展主密钥（RFC 7627）。",
      "fix": "",
      "go": "",
      "labels": [
        "QUICClient"
      ],
      "noteH": "quic-怎么使用-tls-1.3",
      "hint": "quic.go 在 1.21 首次出现；对比看后来加的 0-RTT 与会话事件。"
    },
    "go122": {
      "title": "Go 1.22：RSA 密钥传输退出默认",
      "problem": "默认套件去掉 RSA 密钥传输（`tlsrsakex`）；客户端和服务器默认最低版本 TLS 1.2（`tls10server`）；没有扩展主密钥时禁用 ExportKeyingMaterial（`tlsunsafeekm`）。",
      "fix": "",
      "go": "",
      "labels": [],
      "noteH": "",
      "hint": "TLS_RSA_* 在套件表里的 insecure 标记从 false 变成 true，默认列表随之去掉它们。"
    },
    "go123": {
      "title": "Go 1.23：Kyber 默认、3DES 退出、ECH 客户端",
      "problem": "默认启用实验性的 X25519Kyber768Draft00；默认套件去掉 3DES（`tls3des`）；客户端支持 ECH。",
      "fix": "",
      "go": "",
      "labels": [],
      "noteH": "",
      "hint": "第一次出现混合密钥交换：keyShares 生成两份份额。"
    },
    "go124": {
      "title": "Go 1.24：X25519MLKEM768 与 FIPS 140-3",
      "problem": "标准化后的 X25519MLKEM768 取代 Kyber 草案成为默认（`tlsmlkem`）；服务器支持 ECH；密码学原语迁入 crypto/internal/fips140 模块，TLS 1.3 密钥调度也在其中。",
      "fix": "",
      "go": "",
      "labels": [
        "hybridKeyExchange.keyShares"
      ],
      "noteH": "",
      "hint": "Kyber 草案换成 ML-KEM，密钥调度换成 fips140/tls13。"
    },
    "go125": {
      "title": "Go 1.25：TLS 1.2 禁用 SHA-1 签名",
      "problem": "按 RFC 9155，TLS 1.2 握手不再接受 SHA-1 签名算法（`tlssha1`）。",
      "fix": "",
      "go": "",
      "labels": [
        "isDisabledSignatureAlgorithm"
      ],
      "noteH": "",
      "hint": "看 SHA-1 签名在 TLS 1.2 里的判断。"
    },
    "go126": {
      "title": "Go 1.26：更多后量子组",
      "problem": "默认再加入 SecP256r1MLKEM768 与 SecP384r1MLKEM1024（`tlssecpmlkem`）；crypto/hpke 成为公开包；各密码学函数的 rand 参数被忽略，总是使用安全随机源。",
      "fix": "",
      "go": "",
      "labels": [
        "keyExchangeForCurveID"
      ],
      "noteH": "",
      "hint": "新增两个 NIST 曲线混合组；注意它们与 X25519MLKEM768 拼接顺序不同。"
    }
  }
} as const;
