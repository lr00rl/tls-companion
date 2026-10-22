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
  proto: "Protocol",
  attack: "Attacks",
  go: "Go crypto/tls",
};

export const entries: Entry[] = [
  {
    id: "ssl2",
    date: "1995",
    track: "proto",
    title: "SSL 2.0",
    problem:
      "The first version that was widely used. The handshake had no integrity protection, so a man in the middle could cut both sides' suite lists down to the weakest suite. Encryption and the MAC shared one key. There was no secure close, so truncation could not be detected.",
    fix: "RFC 6176 prohibited it in 2011.",
    go: "Go never implemented SSL 2.0, so a cross-protocol attack such as DROWN, which borrows an SSLv2 server, has nothing to use against a Go server.",
    note: ["T04", "ssl-1.0-and-2.0-make-it-work-first"],
  },
  {
    id: "ssl3",
    date: "1996",
    track: "proto",
    title: "SSL 3.0: the skeleton of modern TLS",
    problem: "A redesign. It separated the record layer from the handshake, made Finished cover the whole handshake, added close_notify against truncation, and added session resumption. The leftover problem was CBC padding that did not check its contents.",
    fix: "POODLE ended it in 2014. RFC 7568 deprecated it in 2015.",
    go: "The `VersionSSL30` constant is still there, marked Deprecated, only so old code still compiles. Go 1.14 dropped SSLv3 entirely.",
    code: [{ fn: T + "VersionSSL30", label: "VersionSSL30" }],
    rfcs: [[6101]],
    note: ["T04", "ssl-3.0-the-skeleton-of-modern-tls"],
  },
  {
    id: "tls10",
    date: "1999",
    track: "proto",
    title: "TLS 1.0 (RFC 2246)",
    problem: "The IETF took it over. On the wire the version is 3.1. HMAC replaced SSL 3.0's homemade MAC, and the PRF used both MD5 and SHA-1. The remaining hole was the CBC IV, which was the last ciphertext block of the previous record and could be predicted.",
    fix: "RFC 8996 deprecated it, together with TLS 1.1, in 2021.",
    go: "Since Go 1.22 the default minimum for both client and server is TLS 1.2. TLS 1.0 has to be turned on explicitly.",
    code: [{ fn: T + "Config.MinVersion", label: "Config.MinVersion" }],
    rfcs: [[2246], [8996]],
    note: ["T04", "tls-1.0-the-ietf-takes-over"],
  },
  {
    id: "tls11",
    date: "2006",
    track: "proto",
    title: "TLS 1.1 (RFC 4346): an explicit IV",
    problem: "Each CBC record carries an explicit random IV, which closes the predictable-IV hole BEAST used. Padding errors and MAC errors return the same alert.",
    go: "Go's record layer decides from the version whether to put an explicit IV in front of each CBC record. The comment names BEAST.",
    code: [{ fn: T + "halfConn.explicitNonceLen", find: "BEAST", label: "halfConn.explicitNonceLen" }],
    rfcs: [[4346]],
    note: ["T04", "tls-1.1-patching-cbc"],
  },
  {
    id: "tls12",
    date: "2008",
    track: "proto",
    title: "TLS 1.2 (RFC 5246): negotiable cryptography",
    problem: "The suite chooses the PRF, signature_algorithms negotiates the signature, and AEAD arrives. It also kept RSA key transport, CBC, RC4, compression, and renegotiation, each of which was later shown to be a problem. Security depended on the configuration.",
    go: "Go's default TLS 1.2 suites are ECDHE with AEAD, plus a few CBC suites. The extended master secret is on by default. The workbench has two real TLS 1.2 handshakes.",
    play: ["tls12-ecdhe", "ch"],
    rfcs: [[5246]],
    note: ["T04", "tls-1.2-negotiable-cryptography"],
  },
  {
    id: "tls13",
    date: "2018-08",
    track: "proto",
    title: "TLS 1.3 (RFC 8446)",
    problem: "It removed RSA key transport, static DH, CBC, RC4, compression, renegotiation, and custom DH groups. Everything after ServerHello is encrypted. The handshake finishes in one round trip. The key schedule is HKDF. There is a downgrade sentinel. It went through extensive formal analysis before publication.",
    fix: "To pass middleboxes that only know the old protocol, legacy_version is fixed at 0x0303, the real version goes in supported_versions, and a compatibility CCS is sent (Appendix D.4).",
    go: "The TLS 1.3 state machines are in handshake_client_tls13.go and handshake_server_tls13.go. The key schedule is in the FIPS module's tls13 package.",
    code: [
      { fn: T + "serverHandshakeStateTLS13.handshake", label: "serverHandshakeStateTLS13.handshake" },
      { fn: "crypto/internal/fips140/tls13.EarlySecret.HandshakeSecret", label: "tls13 key schedule" },
    ],
    play: ["tls13-full", "client-hello-build"],
    rfcs: [[8446], [8446, "D.4"]],
    note: ["T04", "tls-1.3-delete-everything-suspicious"],
  },
  {
    id: "rfc8996",
    date: "2021-03",
    track: "proto",
    title: "RFC 8996: TLS 1.0 and 1.1 are deprecated",
    problem: "It declared TLS 1.0 and 1.1 no longer safe to use, and required implementations to stop negotiating them.",
    rfcs: [[8996]],
  },
  {
    id: "ech",
    date: "2026-03",
    track: "proto",
    title: "ECH is published as RFC 9849",
    problem: "The last cleartext in the handshake was the SNI, so an observer could see the name you were visiting. ECH uses HPKE to encrypt the real ClientHello into an outer ClientHello.",
    go: "Since Go 1.23 the client supports ECH (`EncryptedClientHelloConfigList`). Since 1.24 the server does too (`EncryptedClientHelloKeys`).",
    code: [
      { fn: T + "Config.EncryptedClientHelloConfigList", label: "Config.EncryptedClientHelloConfigList" },
      { fn: T + "Config.EncryptedClientHelloKeys", label: "Config.EncryptedClientHelloKeys" },
    ],
    rfcs: [[9849], [9180]],
    note: ["T08", "ech-roles-and-the-outer-and-inner-clienthello"],
  },
  {
    id: "rfc9846",
    date: "2026-07",
    track: "proto",
    title: "RFC 9846: the TLS 1.3 revision",
    problem: "It folds in the errata and clarifications since RFC 8446, obsoletes RFC 8446, and also obsoletes RFC 5077, 5246, 6961, 7627, and 8422. The protocol version number does not change.",
    rfcs: [[9846]],
    note: ["T04", "version-timeline"],
  },
  {
    id: "rfc10024",
    date: "2026-08",
    track: "proto",
    title: "RFC 10024: hybrid post-quantum key exchange",
    problem: "A quantum computer threatens traffic recorded today and decrypted later. X25519MLKEM768 runs ML-KEM-768 and X25519 together. The exchange stays safe if either one holds.",
    go: "Go concatenates the two shared secrets as the RFC specifies. For X25519MLKEM768, ML-KEM comes first. For the other two hybrid groups, ECDH comes first.",
    code: [{ fn: T + "hybridKeyExchange.serverSharedSecret", find: "sharedKey = append(mlkemSharedSecret", label: "hybridKeyExchange.serverSharedSecret" }],
    play: ["tls13-full", "server-encap"],
    rfcs: [[10024]],
    note: ["T10", "hybrid-key-exchange-x25519mlkem768"],
  },

  {
    id: "bleichenbacher",
    date: "1998",
    track: "attack",
    title: "Bleichenbacher's million-message attack",
    problem: "In RSA key transport, any observable difference in how the server treats valid and invalid PKCS #1 v1.5 padding is an oracle. About a million queries recover a captured premaster secret.",
    fix: "The specification says a failed decryption should continue the handshake with a random premaster secret. Making that truly constant time is hard. In the end, TLS 1.3 removed RSA key transport.",
    go: "Go decrypts with `SessionKeyLen: 48`. Bad padding is not an error. It returns a random value, and the error path cannot be told from the success path.",
    code: [{ fn: T + "rsaKeyAgreement.processClientKeyExchange", find: "SessionKeyLen: 48", label: "rsaKeyAgreement.processClientKeyExchange" }],
    play: ["tls12-rsa", "server-decrypt"],
    rfcs: [[5246, "7.4.7.1"]],
    note: ["T04", "1998-bleichenbachers-million-message-attack"],
  },
  {
    id: "renego",
    date: "2009",
    track: "attack",
    title: "The renegotiation attack",
    problem: "A renegotiated handshake was not cryptographically bound to the old connection. A man in the middle could prepend its own data to the victim's request.",
    fix: "RFC 5746's renegotiation_info binds a renegotiation to the previous Finished. TLS 1.3 removes renegotiation.",
    go: "Go's server never renegotiates. The client defaults to `RenegotiateNever` and always sends renegotiation_info.",
    code: [{ fn: T + "Conn.handleRenegotiation", find: "RenegotiateNever", label: "Conn.handleRenegotiation" }],
    rfcs: [[5746]],
    note: ["T04", "2009-the-renegotiation-attack"],
  },
  {
    id: "beast",
    date: "2011",
    track: "attack",
    title: "BEAST",
    problem: "The TLS 1.0 CBC IV was predictable. Combined with script injected in the browser, a chosen-plaintext attack could guess a cookie one byte at a time.",
    fix: "TLS 1.1's explicit IV. Browsers mitigated TLS 1.0 with 1/n-1 record splitting. The real end of it was AEAD and TLS 1.3.",
    go: "Go still has the 1/n-1 split. On TLS 1.0 with CBC, each Write first sends a 1-byte record so the IV of the following record cannot be predicted.",
    code: [{ fn: T + "Conn.Write", find: "c.vers == VersionTLS10", label: "the 1/n-1 split in Conn.Write" }],
    note: ["T04", "2011-beast"],
  },
  {
    id: "crime",
    date: "2012",
    track: "attack",
    title: "CRIME and BREACH",
    problem: "Compression makes ciphertext length depend on the plaintext. An attacker-controlled string compressed next to a secret is shorter when the guess is right. BREACH targets gzip at the HTTP layer, which TLS itself cannot fix.",
    fix: "TLS compression was turned off almost everywhere, and TLS 1.3 removed it. HTTP/2 and HTTP/3 compress headers with HPACK and QPACK instead.",
    go: "Go has only ever supported null compression. The server rejects the handshake if the client does not offer it.",
    code: [{ fn: T + "serverHandshakeState.processClientHello", find: "compression == compressionNone", label: "serverHandshakeState.processClientHello" }],
    note: ["T04", "2012-crime-and-2013-breach"],
  },
  {
    id: "lucky13",
    date: "2013",
    track: "attack",
    title: "Lucky Thirteen",
    problem: "In a MAC-then-encrypt CBC record, a different padding length means a different amount of data for the MAC. The timing difference is a padding oracle.",
    fix: "Implementations were rewritten to decrypt CBC in constant time, which is very hard to get right. The real fix is AEAD.",
    go: "Go feeds the padding bytes that follow the MAC into HMAC as extra data, so the MAC is roughly constant time. The SHA-256 CBC suites have no such protection and are off by default.",
    code: [
      { fn: T + "halfConn.decrypt", find: "Lucky13", label: "halfConn.decrypt" },
      { fn: T + "extractPadding", label: "extractPadding" },
    ],
    note: ["T04", "2013-lucky-thirteen"],
  },
  {
    id: "rc4",
    date: "2013",
    track: "attack",
    title: "RC4 biases",
    problem: "The RC4 keystream is statistically uneven. A secret encrypted over many connections can be recovered from the bias.",
    fix: "RFC 7465 prohibited RC4 in TLS in 2015.",
    go: "RC4 suites appear only in `InsecureCipherSuites()`. They are not negotiated by default.",
    code: [{ fn: T + "InsecureCipherSuites", label: "InsecureCipherSuites" }],
    note: ["T04", "2013-to-2015-rc4-biases"],
  },
  {
    id: "heartbleed",
    date: "2014-04",
    track: "attack",
    title: "Heartbleed",
    problem: "An implementation bug in OpenSSL's heartbeat extension. It did not check the claimed payload length, and the reply could contain server memory: session keys, and sometimes the private key.",
    fix: "Patch, and replace the private key. It led to the LibreSSL and BoringSSL forks, and funding for critical open-source infrastructure.",
    go: "This was an implementation bug, not a protocol bug. Go never implemented the heartbeat extension, and a memory-safe language does not have this kind of over-read.",
    note: ["T04", "2014-heartbleed"],
  },
  {
    id: "triple",
    date: "2014",
    track: "attack",
    title: "The triple handshake attack",
    problem: "RSA key transport, session resumption, and renegotiation together let two different connections end with the same master secret and the same Finished, which bypasses the renegotiation protection.",
    fix: "RFC 7627's extended master secret makes the master secret depend on a hash of the whole handshake. TLS 1.3's key schedule binds the transcript by construction.",
    go: "Go negotiates the extended master secret by default. Without it, Go refuses to export keying material since 1.22 (`tlsunsafeekm`).",
    code: [{ fn: T + "extMasterFromPreMasterSecret", label: "extMasterFromPreMasterSecret" }],
    play: ["tls12-ecdhe", "cke"],
    rfcs: [[7627]],
    note: ["T04", "2014-the-triple-handshake-attack"],
  },
  {
    id: "poodle",
    date: "2014-10",
    track: "attack",
    title: "POODLE",
    problem: "SSL 3.0 CBC padding does not check its contents. Browsers that retry a failed handshake at a lower version let an attacker force the connection down to SSL 3.0 and then use that.",
    fix: "Disable SSL 3.0. RFC 7507's TLS_FALLBACK_SCSV lets a server detect a forced downgrade. TLS 1.3 puts a downgrade sentinel at the end of random.",
    go: "Go's server recognizes TLS_FALLBACK_SCSV and answers inappropriate_fallback when the client was forced down. A TLS 1.3 server that negotiates a lower version writes the sentinel into random.",
    code: [
      { fn: T + "serverHandshakeState.pickCipherSuite", find: "TLS_FALLBACK_SCSV", label: "pickCipherSuite and the SCSV" },
      { fn: T + "serverHandshakeState.processClientHello", find: "downgradeCanaryTLS12", label: "writing the downgrade sentinel" },
    ],
    play: ["tls12-ecdhe", "server-pick"],
    rfcs: [[7507], [8446, "4.1.3"]],
    note: ["T04", "2014-poodle"],
  },
  {
    id: "freak-logjam",
    date: "2015",
    track: "attack",
    title: "FREAK and Logjam",
    problem: "Export controls in the 1990s left 512-bit RSA and DH suites, which a man in the middle could force. Many servers also shared a few 1024-bit DH primes, which a state-level attacker could precompute.",
    fix: "Remove export suites. Use DH of at least 2048 bits, or the standard groups in RFC 7919, or ECDHE. TLS 1.3 does not allow custom DH groups.",
    go: "Go never implemented export suites and never implemented finite-field DHE. Forward secrecy in TLS 1.2 is ECDHE only.",
    code: [{ fn: T + "ecdheKeyAgreement.generateServerKeyExchange", label: "ecdheKeyAgreement" }],
    rfcs: [[7919]],
    note: ["T04", "2015-freak-and-logjam"],
  },
  {
    id: "2016",
    date: "2016",
    track: "attack",
    title: "DROWN, Sweet32, SLOTH",
    problem: "DROWN uses an SSLv2 server that shares a private key as a Bleichenbacher oracle. Sweet32 makes 3DES, with its 64-bit block, collide after about 32 GB. SLOTH showed that handshake signatures with MD5 or SHA-1 admit transcript collisions.",
    fix: "Turn off every SSLv2 service. Retire 3DES. Stop using MD5 and SHA-1 for signatures and for the transcript hash.",
    go: "Since Go 1.23, 3DES is not in the default suites (`tls3des`). Since Go 1.25, TLS 1.2 no longer accepts SHA-1 signatures (`tlssha1`, RFC 9155).",
    code: [{ fn: T + "isDisabledSignatureAlgorithm", label: "isDisabledSignatureAlgorithm" }],
    note: ["T04", "2016-drown-sweet32-sloth"],
  },
  {
    id: "robot",
    date: "2017",
    track: "attack",
    title: "ROBOT",
    problem: "An automated scan found that Bleichenbacher oracles had never gone away. Many vendor devices and large sites still responded differently to bad padding.",
    fix: "It was the last hard push for deleting RSA key transport.",
    go: "Since Go 1.22, RSA key-transport suites are not in the default list (`tlsrsakex`). The RSA scenario in the workbench is configured explicitly.",
    code: [{ fn: T + "rsaKeyAgreement.processClientKeyExchange", label: "rsaKeyAgreement.processClientKeyExchange" }],
    play: ["tls12-rsa", "cke"],
    note: ["T04", "2017-robot"],
  },
  {
    id: "alpaca",
    date: "2021",
    track: "attack",
    title: "Raccoon and ALPACA",
    problem: "Raccoon uses the timing of TLS 1.2 DH when leading zeros are stripped. ALPACA redirects an HTTPS request to FTP or mail on the same certificate, so the request is handled in the wrong protocol.",
    fix: "TLS 1.3 is not affected by Raccoon. Servers should check ALPN and SNI strictly and refuse a connection that does not match their protocol.",
    go: "Go has no finite-field DHE. The server rejects the handshake when the ALPN sets do not intersect (no_application_protocol), with a compatibility exception that still allows an HTTP/1.1 client against an h2 server.",
    code: [{ fn: T + "negotiateALPN", find: "client requested unsupported application protocols", label: "negotiateALPN" }],
    rfcs: [[7301]],
    note: ["T04", "2020-raccoon-and-2021-alpaca"],
  },
  {
    id: "diginotar",
    date: "2011-08",
    track: "attack",
    title: "DigiNotar and the CA incidents",
    problem: "DigiNotar was compromised and issued more than 500 forged certificates. *.google.com was used for a large man-in-the-middle attack. Any CA in a root store can sign a certificate for any name.",
    fix: "Removal from root stores, certificate transparency, CAA, root-program governance, and shorter certificate lifetimes.",
    go: "Go does path validation as RFC 5280 specifies. It asks whether the chain reaches a root in RootCAs, and whether the name matches. The trust boundary is the root store.",
    code: [{ fn: "crypto/x509.Certificate.Verify", label: "x509.Certificate.Verify" }],
    play: ["tls13-full", "client-cert"],
    note: ["T03", "any-certificate-this-root-signs-is-trusted"],
  },

  {
    id: "go112",
    date: "2019-02",
    track: "go",
    title: "Go 1.12: TLS 1.3, off by default",
    problem: "crypto/tls gained TLS 1.3, enabled with GODEBUG. The client and server TLS 1.3 state machines arrived as their own files.",
    code: [{ fn: T + "clientHandshakeStateTLS13.handshake", label: "clientHandshakeStateTLS13.handshake" }],
    diff: { file: "crypto/tls/handshake_client_tls13.go", from: "go1.12", to: "go1.26.0", hint: "Go 1.12's first TLS 1.3 client, next to today's: hybrid key exchange, ECH, and QUIC all came later." },
  },
  {
    id: "go113",
    date: "2019-09",
    track: "go",
    title: "Go 1.13: TLS 1.3 on by default",
    problem: "TLS 1.3 became the default, and Ed25519 certificates were supported.",
    diff: { file: "crypto/tls/common.go", from: "go1.12", to: "go1.13", hint: "isTLS13Supported changed from on only when GODEBUG tls13=1, to off only when tls13=0." },
  },
  {
    id: "go114",
    date: "2020-02",
    track: "go",
    title: "Go 1.14: SSLv3 removed",
    problem: "SSL 3.0 support was deleted. `VersionSSL30` remains only as a constant marked Deprecated.",
    code: [{ fn: T + "VersionSSL30", label: "VersionSSL30" }],
    diff: { file: "crypto/tls/common.go", from: "go1.13", to: "go1.14", hint: "VersionSSL30 left the supported version list. The Deprecated comment changed from \"will be removed\" to \"no longer supported\"." },
  },
  {
    id: "go118",
    date: "2022-03",
    track: "go",
    title: "Go 1.18: the client's default minimum is TLS 1.2",
    problem: "The client no longer offered TLS 1.0 and 1.1 by default. crypto/x509 rejected most SHA-1 certificate signatures.",
    diff: { file: "crypto/tls/common.go", from: "go1.17", to: "go1.18", hint: "supportedVersions gained a client check: when MinVersion is 0, TLS 1.0 and 1.1 are skipped." },
  },
  {
    id: "go121",
    date: "2023-08",
    track: "go",
    title: "Go 1.21: the QUIC API and the extended master secret",
    problem: "`QUICConn` arrived, so a QUIC implementation can use crypto/tls for the TLS 1.3 handshake without using its record layer. The extended master secret (RFC 7627) was implemented.",
    code: [{ fn: T + "QUICClient", label: "QUICClient" }],
    note: ["T09", "how-quic-uses-tls-1.3"],
    diff: { file: "crypto/tls/quic.go", from: "go1.21.0", to: "go1.26.0", hint: "quic.go first appeared in 1.21. The diff shows the 0-RTT and session events added later." },
  },
  {
    id: "go122",
    date: "2024-02",
    track: "go",
    title: "Go 1.22: RSA key transport leaves the default",
    problem: "RSA key transport left the default suites (`tlsrsakex`). The default minimum became TLS 1.2 for both client and server (`tls10server`). ExportKeyingMaterial is disabled when there is no extended master secret (`tlsunsafeekm`).",
    play: ["tls12-rsa", "ch"],
    diff: { file: "crypto/tls/cipher_suites.go", from: "go1.21.0", to: "go1.22.0", hint: "The insecure flag on TLS_RSA_* in the suite table changed from false to true, and they left the default list." },
  },
  {
    id: "go123",
    date: "2024-08",
    track: "go",
    title: "Go 1.23: Kyber by default, 3DES out, ECH on the client",
    problem: "The experimental X25519Kyber768Draft00 was enabled by default. 3DES left the default suites (`tls3des`). The client gained ECH.",
    diff: { file: "crypto/tls/key_schedule.go", from: "go1.22.0", to: "go1.23.0", hint: "The first hybrid key exchange: keyShares generates two shares." },
  },
  {
    id: "go124",
    date: "2025-02",
    track: "go",
    title: "Go 1.24: X25519MLKEM768 and FIPS 140-3",
    problem: "The standardized X25519MLKEM768 replaced the Kyber draft as the default (`tlsmlkem`). The server gained ECH. Cryptographic primitives moved into crypto/internal/fips140, and the TLS 1.3 key schedule moved with them.",
    code: [{ fn: T + "hybridKeyExchange.keyShares", label: "hybridKeyExchange.keyShares" }],
    play: ["tls13-full", "key-share"],
    diff: { file: "crypto/tls/key_schedule.go", from: "go1.23.0", to: "go1.24.0", hint: "The Kyber draft became ML-KEM, and the key schedule became fips140/tls13." },
  },
  {
    id: "go125",
    date: "2025-08",
    track: "go",
    title: "Go 1.25: TLS 1.2 rejects SHA-1 signatures",
    problem: "Following RFC 9155, a TLS 1.2 handshake no longer accepts SHA-1 signature algorithms (`tlssha1`).",
    code: [{ fn: T + "isDisabledSignatureAlgorithm", label: "isDisabledSignatureAlgorithm" }],
    diff: { file: "crypto/tls/auth.go", from: "go1.24.0", to: "go1.25.0", hint: "The check that rejects SHA-1 signatures in TLS 1.2." },
  },
  {
    id: "go126",
    date: "2026-02",
    track: "go",
    title: "Go 1.26: more post-quantum groups",
    problem: "SecP256r1MLKEM768 and SecP384r1MLKEM1024 joined the defaults (`tlssecpmlkem`). crypto/hpke became a public package. The rand parameter on cryptographic functions is ignored, and a secure source is always used.",
    code: [{ fn: T + "keyExchangeForCurveID", label: "keyExchangeForCurveID" }],
    diff: { file: "crypto/tls/key_schedule.go", from: "go1.25.0", to: "go1.26.0", hint: "Two NIST-curve hybrid groups were added. Their concatenation order differs from X25519MLKEM768." },
  },
];
