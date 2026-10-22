import type { ScenarioDef } from "./types";

const T = "crypto/tls.";
const K = "crypto/internal/fips140/tls13.";

export const tls13Full: ScenarioDef = {
  id: "tls13-full",
  short: "TLS 1.3 full",
  title: "TLS 1.3 full handshake",
  brief: "X25519MLKEM768 hybrid key exchange, an ECDSA chain, 1-RTT, then one HTTP/1.1 request and a session ticket",
  tcp: true,
  intro:
    "The Go 1.26 client and server both use the default config, plus a certificate and ALPN. The default first choice is the X25519MLKEM768 hybrid key exchange, so this ClientHello is 1.5 KB and does not fit in one TCP segment. The handshake finishes in 1 round trip, then one HTTP/1.1 request and response, then close_notify from both sides.",
  steps: [
    {
      id: "server-wait",
      title: "Server enters Handshake and waits for ClientHello",
      side: 1,
      at: { mark: "handshake", side: 1 },
      code: { fn: T + "Conn.serverHandshake", find: "readClientHello" },
      body:
        "The server goroutine calls `tls.Server(conn, config)` to get a `*tls.Conn`, then `Handshake()`. The first thing `serverHandshake` does is `readClientHello`, which reaches `readRecord` and blocks on a network read.\n\nOn the diagram the TCP handshake is drawn in grey. This capture used an in-process pipe instead of TCP, but a real connection always spends that round trip before TLS starts.",
      refs: [{ note: "T05", h: "the-three-way-handshake" }, { sym: T + "Conn.Handshake" }],
    },
    {
      id: "client-hello-build",
      title: "Client builds the ClientHello",
      side: 0,
      at: { enter: T + "Conn.makeClientHello" },
      code: { fn: T + "Conn.makeClientHello", find: "hello := &clientHelloMsg{" },
      msg: { dir: 0, type: 1 },
      body:
        "`makeClientHello` turns the `Config` into a `clientHelloMsg`. `supported_versions` lists TLS 1.3 and 1.2, but `legacy_version` at the front is pinned to 0x0303. TLS 1.3 negotiates the version in an extension, and leaves the old field for middleboxes.\n\nThe 32-byte `random` and the 32-byte `legacy_session_id` both come from `config.rand()`. The session id does nothing in TLS 1.3. Filling it with random bytes makes the ClientHello look like a TLS 1.2 resumption, which is how it gets past middleboxes that only know the old protocol (RFC 8446 Appendix D.4).",
      refs: [{ rfc: 8446, sec: "4.1.2" }, { note: "T06", h: "clienthello" }, { rfc: 8446, sec: "4.2.1" }],
    },
    {
      id: "key-share",
      title: "The X25519MLKEM768 key share",
      side: 0,
      at: { enter: T + "hybridKeyExchange.keyShares" },
      code: { fn: T + "hybridKeyExchange.keyShares" },
      msg: { dir: 0, type: 1 },
      tab: "fields",
      body:
        "The client does not yet know what the server supports, so it guesses a `key_share`. A correct guess saves a round trip. The first `curvePreferences` entry is X25519MLKEM768, so two keys are generated here: an ML-KEM-768 encapsulation key (1184 bytes) and an X25519 public key (32 bytes), concatenated into a 1216-byte share.\n\nIt also sends a standalone X25519 share as a fallback. If the server has no post-quantum group, the handshake can still finish on X25519 without a HelloRetryRequest. Expand `key_share` in the field tree to see both entries.",
      refs: [{ note: "T10", h: "hybrid-key-exchange-x25519mlkem768" }, { rfc: 10024 }, { note: "T06", h: "keyshare-the-client-guesses-first" }],
    },
    {
      id: "client-hello-send",
      title: "ClientHello on the wire",
      side: 0,
      at: { enter: T + "Conn.writeHandshakeRecord", side: 0 },
      code: { fn: T + "Conn.writeHandshakeRecord" },
      msg: { dir: 0, type: 1 },
      tab: "record",
      body:
        "`writeHandshakeRecord` serializes the message (`marshal`), writes it into the handshake transcript, and hands it to the record layer. The first ClientHello's record header version is 0x0301. The code comment gives the reason: some old TLS servers fail when the record version of the initial ClientHello is above TLS 1.0.\n\nThe record is 1536 bytes. With the 5-byte header that is more than the 1460-byte MSS common on Ethernet, so on a real network it splits into two TCP segments. The dashed line on the diagram is that limit. A TLS 1.3 ClientHello with only an X25519 share is about 300 bytes.",
      refs: [{ rfc: 8446, sec: "5.1" }, { note: "T10", h: "deployment-history-and-the-present" }, { note: "T07", h: "bytes-do-not-add-a-round-trip-to-the-handshake" }],
    },
    {
      id: "server-parse",
      title: "Server parses the ClientHello",
      side: 1,
      at: { enter: T + "clientHelloMsg.unmarshal" },
      code: { fn: T + "clientHelloMsg.unmarshal" },
      msg: { dir: 0, type: 1 },
      body:
        "`readHandshake` assembles the bytes from the record layer into a complete handshake message. `unmarshal` walks the extensions with `cryptobyte`. Unknown extensions are skipped. That is what lets TLS keep adding extensions, and it is the property GREASE keeps testing.\n\nAfter parsing, `serverHandshake` sees TLS 1.3 in `supported_versions` and moves into `serverHandshakeStateTLS13`.",
      refs: [{ rfc: 8701 }, { sym: T + "clientHelloMsg" }],
    },
    {
      id: "server-select",
      title: "Server picks the suite and the group",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.processClientHello" },
      code: { fn: T + "serverHandshakeStateTLS13.processClientHello", find: "selectedGroup := preferredGroups[0]" },
      body:
        "The cipher suite is the first one both sides support, in preference order. With AES hardware that is `TLS_AES_128_GCM_SHA256`.\n\nGroup selection is more interesting. Go reorders its own preference list so that groups the client already sent a share for come first, then moves post-quantum hybrid groups ahead of all the others (two `sort.SliceStable` passes). That avoids a HelloRetryRequest when it can, and still uses a post-quantum group when one is available. This connection selected X25519MLKEM768.",
      refs: [{ rfc: 8446, sec: "4.2.8" }, { note: "T06", h: "keyshare-the-client-guesses-first" }],
    },
    {
      id: "server-encap",
      title: "Server encapsulates and gets the hybrid secret",
      side: 1,
      at: { enter: T + "hybridKeyExchange.serverSharedSecret" },
      code: { fn: T + "hybridKeyExchange.serverSharedSecret" },
      tab: "keys",
      body:
        "ML-KEM is not Diffie-Hellman. The server calls `Encapsulate` on the client's encapsulation key and gets a 1088-byte ciphertext and a 32-byte shared secret. The X25519 half is an ordinary ECDH.\n\nThe two secrets are concatenated as RFC 10024 specifies, ML-KEM first, into a 64-byte (EC)DHE shared secret. In the key panel, the Handshake Secret row's input is 64 bytes. The share the server sends back is the ciphertext plus its X25519 public key, 1120 bytes.",
      refs: [{ note: "T10", h: "how-a-kem-differs-from-dh" }, { rfc: 10024 }, { sym: "crypto/mlkem.EncapsulationKey768.Encapsulate" }],
    },
    {
      id: "server-hello",
      title: "ServerHello and the compatibility CCS",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerParameters" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerParameters" },
      msg: { dir: 1, type: 2 },
      body:
        "The ServerHello carries the selected cipher suite, `supported_versions = 0x0304`, and the server's `key_share`. `legacy_session_id_echo` repeats the client's random session id. It is the last cleartext handshake message the server sends.\n\nNext is a ChangeCipherSpec record of one byte. In TLS 1.3 it has no cryptographic meaning. It exists so a middlebox will believe this is an ordinary TLS 1.2 resumption. The comment on `sendDummyChangeCipherSpec` says so.",
      refs: [{ rfc: 8446, sec: "4.1.3" }, { note: "T06", h: "serverhello" }, { rfc: 8446, sec: "D.4" }],
    },
    {
      id: "hs-keys-server",
      title: "Server derives the handshake keys",
      side: 1,
      at: { enter: K + "EarlySecret.HandshakeSecret", side: 1 },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerParameters", find: "earlySecret.HandshakeSecret(hs.sharedKey)" },
      tab: "keys",
      body:
        "First stage of the key schedule: there is no PSK, so the Early Secret is HKDF-Extract over zeros. The second stage uses the 64-byte shared secret from the last step: `Derive-Secret(., \"derived\", \"\")`, then HKDF-Extract, producing the Handshake Secret.\n\n`s hs traffic` and `c hs traffic` are then derived from the transcript hash of ClientHello and ServerHello, and each is expanded into an AES key and an IV. From this moment the server's records are encrypted under server_handshake_traffic_secret. The diagram marks them in the handshake color, with braces `{}`.",
      refs: [{ rfc: 8446, sec: "7.1" }, { note: "T06", h: "key-schedule" }, { sym: K + "EarlySecret.HandshakeSecret" }],
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
        "The first encrypted handshake message. Anything negotiated that does not feed the key schedule goes here, so it is sent only after encryption. ALPN's choice of `http/1.1` is one example. In TLS 1.2 those values sat in the cleartext ServerHello.\n\nThe Record tab shows how this record is protected. The outer type pretends to be application_data (23). The real type, handshake (22), is at the end of the plaintext. The nonce is the IV XORed with the record sequence number, and the AAD is the 5-byte record header.",
      refs: [{ rfc: 8446, sec: "4.3.1" }, { rfc: 8446, sec: "5.2" }, { note: "T06", h: "record-layer" }],
    },
    {
      id: "certificate",
      title: "{Certificate}: the chain",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerCertificate" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerCertificate" },
      msg: { dir: 1, type: 11 },
      tab: "certs",
      body:
        "The certificate message carries the leaf and the intermediate. The root is not sent: the client already has it, and a root that arrived on the wire would not be trusted. TLS 1.3 attaches an extension block to each certificate, which is where an OCSP response and SCTs can go.\n\nThe capture program generated these certificates on the spot. The chain has three levels: TLS Companion Root CA signs Issuing CA E1, and E1 signs `tls-companion.example`. Expand `cert_data` in the field tree to see the DER, layer by layer.",
      refs: [{ rfc: 8446, sec: "4.4.2" }, { note: "T03", h: "the-certificate-chain-why-an-intermediate-is-required" }],
    },
    {
      id: "certificate-verify",
      title: "{CertificateVerify}: signing the transcript",
      side: 1,
      at: { enter: T + "signedMessage", side: 1 },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerCertificate", find: "signedMessage(serverSignatureContext" },
      msg: { dir: 1, type: 15 },
      body:
        "The server signs with the leaf private key. The signed content is 64 spaces, the context string `TLS 1.3, server CertificateVerify`, a 0 byte, and the transcript hash so far (`signedMessage`).\n\nOne signature proves two things: the server holds the private key for the certificate, and the ClientHello it saw is the one the client sent. Any change to an earlier message breaks the signature.",
      refs: [{ rfc: 8446, sec: "4.4.3" }, { note: "T06", h: "certificateverify" }],
    },
    {
      id: "server-finished",
      title: "{Finished}, and the application keys",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerFinished" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerFinished", find: "hs.masterSecret = hs.handshakeSecret.MasterSecret()" },
      msg: { dir: 1, type: 20 },
      tab: "keys",
      body:
        "`verify_data` is an HMAC of the transcript hash under finished_key, and finished_key is expanded from server_handshake_traffic_secret.\n\nAfter Finished, the third HKDF-Extract produces the Master Secret, and two application traffic secrets are derived from the transcript through the server's Finished. The server could send application data now. That is TLS 1.3's 0.5-RTT data.",
      refs: [{ rfc: 8446, sec: "4.4.4" }, { rfc: 8446, sec: "7.1" }],
    },
    {
      id: "ticket",
      title: "[NewSessionTicket], computed ahead of the client's Finished",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendSessionTickets" },
      code: { fn: T + "serverHandshakeStateTLS13.sendSessionTickets", find: "hs.clientFinished = hs.suite.finishedHash" },
      msg: { dir: 1, type: 4 },
      body:
        "A session ticket needs resumption_master_secret, and that secret's transcript has to include the client's Finished. Go's server does not wait. It computes what the client's Finished should be (`hs.clientFinished`), writes that into the transcript, derives the resumption secret early, and can send the ticket with the first flight.\n\nWhen the real client Finished arrives, the server only checks that it matches the value it computed. The ticket is protected by the application traffic key, so it is marked with brackets `[]`.",
      refs: [{ rfc: 8446, sec: "4.6.1" }, { note: "T06", h: "newsessionticket" }, { note: "T07", h: "psk-resumption-in-tls-1.3" }],
    },
    {
      id: "server-flush",
      title: "The server's flight goes out at once",
      side: 1,
      at: { writeMsg: { dir: 1, type: 2 } },
      code: { fn: T + "Conn.flush" },
      msg: { dir: 1, type: 2 },
      body:
        "Those records were written into `sendBuf` and are handed to the connection only here, in one `flush`: ServerHello, CCS, {EncryptedExtensions}, {Certificate}, {CertificateVerify}, {Finished}, [NewSessionTicket], about 2.5 KB. The flight leaves the server half a round trip after the client sent the ClientHello, and reaches the client half a round trip later.\n\nSending the flight together uses fewer TCP segments, and the client can read all of it at once.",
      refs: [{ sym: T + "Conn.flush" }],
    },
    {
      id: "client-sh",
      title: "Client checks the ServerHello",
      side: 0,
      at: { enter: T + "serverHelloMsg.unmarshal" },
      code: { fn: T + "clientHandshakeStateTLS13.checkServerHelloOrHRR" },
      msg: { dir: 1, type: 2 },
      body:
        "In `clientHandshake` the client reads the ServerHello, confirms the version with `pickTLSVersion`, checks the last 8 bytes of ServerHello.random for the `DOWNGRD` sentinel, and enters `clientHandshakeStateTLS13`.\n\n`checkServerHelloOrHRR` checks that the selected suite was one the client offered, that the session id was echoed, and that no unexpected extension appeared. The client then compares ServerHello.random with the fixed HelloRetryRequest value.",
      refs: [{ rfc: 8446, sec: "4.1.3" }, { note: "T06", h: "downgrade-protection-the-sentinel-at-the-end-of-random" }],
    },
    {
      id: "client-decap",
      title: "Client decapsulates and gets the same handshake keys",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.establishHandshakeKeys" },
      code: { fn: T + "clientHandshakeStateTLS13.establishHandshakeKeys", find: "ke.clientSharedSecret" },
      tab: "keys",
      body:
        "The client opens the server's ciphertext with its ML-KEM decapsulation key, then does ECDH with the server's X25519 public key. The result is the same 64-byte shared secret the server has. The HKDF chain that follows matches the server's byte for byte.\n\nSwitch between Client and Server in the key panel. Every secret matches. That is the point of TLS 1.3: the two machines never sent a key, and each computed the same one.",
      refs: [{ note: "T02", h: "diffie-hellman-a-shared-secret-on-a-public-channel" }, { rfc: 8446, sec: "7.1" }],
    },
    {
      id: "client-cert",
      title: "Client verifies the certificate chain",
      side: 0,
      at: { enter: T + "Conn.verifyServerCertificate" },
      code: { fn: T + "Conn.verifyServerCertificate", find: "Verify(opts)" },
      msg: { dir: 1, type: 11 },
      tab: "certs",
      body:
        "`verifyServerCertificate` parses each DER certificate, then calls `Verify` in `crypto/x509`. From the leaf, following signatures, the chain must reach a root in `RootCAs`. Each certificate must be in its validity period and allowed to authenticate a server. The leaf SAN must contain `tls-companion.example`.\n\nThe capture fixed `Config.Time` at 2026-10-17, and the certificates were issued around that day, so every replay still verifies.",
      refs: [{ note: "T03", h: "path-validation-what-the-client-actually-checks" }, { sym: "crypto/x509.Certificate.Verify" }, { rfc: 5280, sec: "6" }],
    },
    {
      id: "client-cv",
      title: "Client verifies the CertificateVerify signature",
      side: 0,
      at: { enter: T + "verifyHandshakeSignature" },
      code: { fn: T + "clientHandshakeStateTLS13.readServerCertificate", find: "verifyHandshakeSignature(sigType" },
      msg: { dir: 1, type: 15 },
      body:
        "The client builds the signed content in the same format and verifies it with the public key in the certificate. Only now is the client sure that the peer holds the private key for `tls-companion.example`, and that both sides saw the same handshake messages.",
      refs: [{ rfc: 8446, sec: "4.4.3" }],
    },
    {
      id: "client-sfin",
      title: "Client checks Finished and derives the application keys",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.readServerFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.readServerFinished", find: "hmac.Equal(expectedMAC" },
      msg: { dir: 1, type: 20 },
      body:
        "The client computes the HMAC the server's Finished should have and compares it with constant-time `hmac.Equal`. It then derives the two application traffic secrets and switches its read direction to server_application_traffic_secret_0. The [NewSessionTicket] that follows is decrypted with that key.",
      refs: [{ rfc: 8446, sec: "4.4.4" }],
    },
    {
      id: "client-fin",
      title: "Client sends {Finished}. The handshake ends on this side",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.sendClientFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.sendClientFinished" },
      msg: { dir: 0, type: 20 },
      body:
        "The client first sends a compatibility CCS, encrypts its Finished under client_handshake_traffic_secret, then switches its write direction to the application traffic key. `Handshake()` returns here.\n\nFrom the ClientHello that is exactly 1 round trip. With TCP's round trip, the client can send the HTTP request at the end of round trip 2. TLS 1.2 waits until the end of round trip 3.",
      refs: [{ note: "T01" }, { note: "T06", h: "the-clients-second-flight" }],
    },
    {
      id: "app-request",
      title: "[app data]: the HTTP request",
      side: 0,
      at: { mark: "app:write", side: 0 },
      code: { fn: T + "Conn.Write" },
      tab: "record",
      body:
        "The application calls `conn.Write` with `GET / HTTP/1.1`. The record layer encrypts it with the AES-128-GCM key expanded from client_application_traffic_secret_0. The sequence number starts at 0, and the nonce is the IV XORed with that number.\n\nSelect the record on the diagram. The Record tab lists the ciphertext, the key, the nonce, the authentication tag, and the decrypted plaintext. The capture tool decrypted these from the key log on its own, and checked them byte for byte against the keys crypto/tls derived.",
      refs: [{ rfc: 8446, sec: "5.3" }, { note: "T13", h: "experiment-10-decrypt-your-own-capture-with-a-key-log" }],
    },
    {
      id: "server-cfin",
      title: "Server checks the client's Finished",
      side: 1,
      at: { readMsg: { dir: 0, type: 20 } },
      code: { fn: T + "serverHandshakeStateTLS13.readClientFinished", find: "hmac.Equal" },
      msg: { dir: 0, type: 20 },
      body:
        "The server has been blocked in `readClientFinished`. When the client's Finished arrives, it is compared with the `hs.clientFinished` computed earlier. On a match, the read direction switches to client_application_traffic_secret_0. The server's `Handshake()` returns.",
      refs: [{ rfc: 8446, sec: "4.4.4" }],
    },
    {
      id: "app-response",
      title: "[app data]: the HTTP response",
      side: 1,
      at: { mark: "app:write", side: 1 },
      code: { fn: T + "Conn.Write" },
      tab: "record",
      body: "The server reads the request and writes `HTTP/1.1 200 OK`. The client receives these first response bytes at the end of round trip 3. A new TCP plus TLS 1.3 connection waits 2 round trips before it can send the request, and gets the response one round trip after that.",
      refs: [{ note: "T07", h: "where-the-time-goes" }],
    },
    {
      id: "close",
      title: "close_notify: an orderly close",
      side: 0,
      at: { mark: "close", side: 0 },
      code: { fn: T + "Conn.closeNotify" },
      tab: "record",
      body:
        "On `Close()` the client first sends a close_notify alert, encrypted like the other records. It tells the peer that the data ended here and was not cut short. Without it, an attacker could truncate the response by closing TCP early. The server reads close_notify, sends one back, and closes.",
      refs: [{ rfc: 8446, sec: "6.1" }],
    },
  ],
};
