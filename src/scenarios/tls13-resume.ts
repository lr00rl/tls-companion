import type { ScenarioDef } from "./types";

const T = "crypto/tls.";
const K = "crypto/internal/fips140/tls13.";

export const tls13Resume: ScenarioDef = {
  id: "tls13-resume",
  short: "TLS 1.3 resume",
  title: "TLS 1.3 PSK resumption",
  brief: "Resumes with the NewSessionTicket from the previous connection, psk_dhe_ke, and sends no certificate",
  tcp: true,
  intro:
    "The capture program first runs a full handshake, which is not recorded. The client stores the NewSessionTicket from it in `ClientSessionCache`. What is recorded is the second connection. The client resumes with the PSK in the ticket, in psk_dhe_ke mode: it still does a key exchange, so forward secrecy holds, but the server sends no certificate and no signature.",
  steps: [
    {
      id: "server-wait",
      title: "Server waits for ClientHello",
      side: 1,
      at: { mark: "handshake", side: 1 },
      code: { fn: T + "Conn.serverHandshake", find: "readClientHello" },
      body: "The server shares the previous connection's `tls.Config`, so it holds the same session-ticket key and can open a ticket it issued.",
      refs: [{ sym: T + "Config.SessionTicketKey" }],
    },
    {
      id: "load-session",
      title: "Client loads the ticket and computes the binder",
      side: 0,
      at: { enter: T + "Conn.loadSession" },
      code: { fn: T + "Conn.loadSession", find: "binderKey = earlySecret.ResumptionBinderKey()" },
      msg: { dir: 0, type: 1 },
      tab: "keys",
      body:
        "`loadSession` takes the session from the cache by server name, checks that the ticket has not expired and that the cipher suite is still usable, then puts the ticket in the `pre_shared_key` extension. Adding the server's `age_add` to the reported age (`obfuscated_ticket_age`) hides the numerical age, but reuse of the same ticket identity can still link connections.\n\nThe resumption PSK is extracted into a new Early Secret, and from that a binder_key. The binder is an HMAC over the ClientHello with the binder itself removed. It proves that the sender knows the PSK, rather than replaying a stolen ticket.",
      refs: [{ rfc: 8446, sec: "4.2.11" }, { rfc: 8446, sec: "4.2.11.2" }, { note: "T06", h: "the-resumption-psk" }],
    },
    {
      id: "ch-psk",
      title: "ClientHello with pre_shared_key",
      side: 0,
      at: { enter: T + "Conn.writeHandshakeRecord", side: 0 },
      code: { fn: T + "computeAndUpdatePSK" },
      msg: { dir: 0, type: 1 },
      tab: "fields",
      body:
        "`pre_shared_key` has to be the last extension, because the binder covers everything before it. `psk_key_exchange_modes` lists only psk_dhe_ke. Go's client never offers psk_ke, which would skip the key exchange.\n\nThis ClientHello still carries an X25519MLKEM768 share. It is larger than the full handshake's, because of the ticket.",
      refs: [{ rfc: 8446, sec: "4.2.9" }, { note: "T07", h: "psk-resumption-in-tls-1.3" }],
    },
    {
      id: "server-psk",
      title: "Server opens the ticket and checks the binder",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.checkForResumption" },
      code: { fn: T + "serverHandshakeStateTLS13.checkForResumption", find: "pskBinder := hs.suite.finishedHash(binderKey, transcript)" },
      tab: "keys",
      body:
        "The server decrypts the ticket with the ticket key (`decryptTicket`), recovers the previous session state and the resumption secret, and checks that the ticket is within its lifetime and that the suite hash matches. It then derives the same binder_key from the PSK, computes the binder, and compares it with the client's using constant-time `hmac.Equal`.\n\nIn the key panel, this connection's Early Secret is no longer an Extract over zeros. Its input is the PSK from the ticket.",
      refs: [{ rfc: 8446, sec: "4.2.11.2" }, { sym: K + "NewEarlySecret" }],
    },
    {
      id: "server-hello",
      title: "ServerHello selects the PSK and still exchanges keys",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerParameters" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerParameters", find: "earlySecret.HandshakeSecret(hs.sharedKey)" },
      msg: { dir: 1, type: 2 },
      body:
        "The ServerHello `pre_shared_key` extension is two bytes: selected identity 0. `key_share` is still there. The Handshake Secret depends on both the PSK and this new shared secret, so a later leak of the ticket key does not open this connection's traffic.",
      refs: [{ note: "T02", h: "forward-secrecy-todays-private-key-must-not-open-yesterdays-traffic" }, { rfc: 8446, sec: "2.2" }],
    },
    {
      id: "no-cert",
      title: "Certificate and CertificateVerify are skipped",
      side: 1,
      at: { enter: T + "serverHandshakeStateTLS13.sendServerCertificate" },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerCertificate", find: "if hs.usingPSK {" },
      body:
        "`sendServerCertificate` returns immediately. The selected PSK authenticates this resumption to the identity established by the earlier connection, which the client authenticated then. The server therefore omits Certificate and CertificateVerify; resumption does not revalidate the certificate. Its first flight shrinks from about 2.5 KB to about 1.5 KB, most of it the post-quantum share.",
      refs: [{ rfc: 8446, sec: "4.4.2" }],
    },
    {
      id: "server-flight",
      title: "The server's flight",
      side: 1,
      at: { writeMsg: { dir: 1, type: 2 } },
      code: { fn: T + "serverHandshakeStateTLS13.sendServerFinished" },
      msg: { dir: 1, type: 20 },
      body: "ServerHello, CCS, {EncryptedExtensions}, {Finished}, [NewSessionTicket]. The new ticket lets the client resume again. Using each ticket once is the recommended practice.",
      refs: [{ rfc: 8446, sec: "C.4" }],
    },
    {
      id: "client-psk",
      title: "Client sees that the server accepted the PSK",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.processServerHello" },
      code: { fn: T + "clientHandshakeStateTLS13.processServerHello", find: "hs.usingPSK = true" },
      msg: { dir: 1, type: 2 },
      body:
        "The client sees `selected_identity` pointing at the only identity it sent, checks that the suite hash matches, sets `usingPSK`, and `ConnectionState().DidResume` becomes true. `readServerCertificate` then skips certificate verification the same way.",
      refs: [{ sym: T + "ConnectionState.DidResume" }],
    },
    {
      id: "client-finish",
      title: "Client sends {Finished}",
      side: 0,
      at: { enter: T + "clientHandshakeStateTLS13.sendClientFinished" },
      code: { fn: T + "clientHandshakeStateTLS13.sendClientFinished" },
      msg: { dir: 0, type: 20 },
      body: "The round-trip count is still 1, the same as a full handshake. What was saved is sending the certificate and two public-key signature operations. Saving that round trip as well takes 0-RTT. Go supports client 0-RTT only on QUIC. crypto/tls on TCP does not send early data.",
      refs: [{ note: "T07", h: "0-rtt-the-request-leaves-with-the-handshake" }, { note: "T07", h: "the-two-costs-of-0-rtt" }],
    },
    {
      id: "new-ticket",
      title: "Client stores the new ticket",
      side: 0,
      at: { enter: T + "Conn.handleNewSessionTicket" },
      code: { fn: T + "Conn.handleNewSessionTicket" },
      msg: { dir: 1, type: 4 },
      body: "While reading the response the client sees [NewSessionTicket] first. `handleNewSessionTicket` derives a new PSK from resumption_master_secret and the ticket nonce, and stores it back in the cache.",
      refs: [{ rfc: 8446, sec: "4.6.1" }],
    },
  ],
};
