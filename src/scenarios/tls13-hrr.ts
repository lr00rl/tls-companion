import type { ScenarioDef } from "./types";

const T = "crypto/tls.";

export const tls13Hrr: ScenarioDef = {
  id: "tls13-hrr",
  short: "TLS 1.3 HRR",
  title: "TLS 1.3 HelloRetryRequest",
  brief: "The server accepts only P-256, the guessed key_share misses, and a second ClientHello costs a round trip",
  tcp: true,
  intro:
    "The server's `CurvePreferences` is only P-256. The client, on its default config, prepared shares only for X25519MLKEM768 and X25519. P-256 is in supported_groups, so the handshake does not fail, but the server has to ask for a new ClientHello with a HelloRetryRequest. That costs one extra round trip.",
  steps: [
    {
      id: "server-wait",
      title: "Server waits for ClientHello",
      side: 1,
      at: { mark: "handshake", side: 1 },
      code: { fn: T + "Conn.serverHandshake", find: "readClientHello" },
      body: "As in the full handshake, the server blocks in `readClientHello`. The only difference is its config: `CurvePreferences: []tls.CurveID{tls.CurveP256}`.",
      refs: [{ sym: T + "Config.CurvePreferences" }],
    },
    {
      id: "ch1",
      title: "First ClientHello: the share missed",
      side: 0,
      at: { enter: T + "Conn.makeClientHello" },
      code: { fn: T + "Conn.makeClientHello", find: "curveID := hello.supportedCurves[0]" },
      msg: { dir: 0, type: 1 },
      body:
        "The client prepares a share only for the first group it prefers, X25519MLKEM768, plus an X25519 fallback. P-256 is listed in `supported_groups`, but there is no share for it.\n\nGenerating a share for every group would avoid the retry. It would also cost extra key generation and a larger ClientHello on every handshake. Go guesses only the most likely one.",
      refs: [{ rfc: 8446, sec: "4.2.8" }, { note: "T06", h: "keyshare-the-client-guesses-first" }],
    },
    {
      id: "hrr",
      title: "Server sends HelloRetryRequest",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.doHelloRetryRequest" },
      code: { fn: T + "serverHandshakeStateTLS13.doHelloRetryRequest", find: "selectedGroup:     selectedGroup" },
      msg: { dir: 1, type: 2, nth: 0 },
      body:
        "`processClientHello` selected P-256 and did not find a share for it, so it calls `doHelloRetryRequest`. On the wire a HelloRetryRequest is a ServerHello whose random is a fixed value, SHA-256(\"HelloRetryRequest\"), and whose `key_share` names only the required group.\n\nThe transcript is rewritten here. The first ClientHello is hashed, then replaced in the transcript by a synthetic `message_hash`. The RFC does this so a stateless server can put the transcript hash in a cookie and let the client hold it.",
      refs: [{ rfc: 8446, sec: "4.1.4" }, { rfc: 8446, sec: "4.4.1" }, { note: "T06", h: "helloretryrequest" }],
    },
    {
      id: "client-hrr",
      title: "Client handles HelloRetryRequest",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.processHelloRetryRequest" },
      code: { fn: T + "clientHandshakeStateTLS13.processHelloRetryRequest", find: "hs.transcript.Write([]byte{typeMessageHash" },
      msg: { dir: 1, type: 2, nth: 0 },
      body:
        "The client rewrites its own transcript the same way, then checks that the retry was actually needed. If the server asks for a group the client already sent a share for, or sends neither key_share nor a cookie, the client aborts. That stops a peer from forcing pointless retries.\n\nAfter the check, the client generates a fresh P-256 key and replaces the old share.",
      refs: [{ rfc: 8446, sec: "4.1.4" }],
    },
    {
      id: "ch2",
      title: "Second ClientHello",
      side: 0,
      at: { writeMsg: { dir: 0, type: 1, nth: 1 } },
      code: { fn: T + "clientHandshakeStateTLS13.processHelloRetryRequest", find: "ke.keyShares(c.config.rand())" },
      msg: { dir: 0, type: 1, nth: 1 },
      tab: "fields",
      body:
        "Apart from `key_share`, now a 65-byte P-256 public key, the second ClientHello must match the first. The server's `illegalClientHelloChange` compares them field by field. Without the 1216-byte hybrid share, the message is a little over 300 bytes.\n\nBetween the two ClientHellos the client also sends a compatibility CCS. TLS 1.3 allows it before the second ClientHello.",
      refs: [{ rfc: 8446, sec: "4.1.2" }, { sym: T + "illegalClientHelloChange" }],
    },
    {
      id: "server-continue",
      title: "Server continues with P-256",
      side: 1,
      at: { enter: T + "ecdhKeyExchange.serverSharedSecret" },
      code: { fn: T + "ecdhKeyExchange.serverSharedSecret" },
      tab: "keys",
      body:
        "From here it matches the full handshake. P-256 ECDH produces a 32-byte shared secret, the handshake keys are derived, and the ServerHello and the encrypted messages follow. The real ServerHello.random is fresh. It is no longer the fixed value.\n\nThis connection did not use a post-quantum key exchange. The HelloRetryRequest bought interoperability and gave up post-quantum protection.",
      refs: [{ note: "T10", h: "harvest-now-decrypt-later-why-key-exchange-moves-first" }],
    },
    {
      id: "server-flight",
      title: "The server's flight",
      side: 1,
      at: { writeMsg: { dir: 1, type: 2, nth: 1 } },
      code: { fn: T + "Conn.flush" },
      msg: { dir: 1, type: 2, nth: 1 },
      body: "ServerHello, {EncryptedExtensions}, {Certificate}, {CertificateVerify}, and {Finished} go out together, a full round trip later than in the full handshake.",
    },
    {
      id: "client-finish",
      title: "Client verifies and sends {Finished}",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.sendClientFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.sendClientFinished" },
      msg: { dir: 0, type: 20 },
      body: "The client finished verifying the certificate and the signature before this step. `Handshake()` returns after 2 round trips. With TCP, that is 3, as slow as TLS 1.2.",
      refs: [{ note: "T07", h: "round-trip-budget" }],
    },
    {
      id: "app",
      title: "[app data]",
      side: 0,
      at: { mark: "app:write", side: 0 },
      code: { fn: T + "Conn.Write" },
      tab: "record",
      body: "The request and the response after this are the same as in the full handshake.",
    },
  ],
};
