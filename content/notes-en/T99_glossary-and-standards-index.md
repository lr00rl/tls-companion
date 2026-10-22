---
tags: [tls, glossary, standards-index, rfc]
type: ref
status: done
---

# T99 · Glossary and standards index

> Series: [[00_tls-series-overview|TLS series overview]]
> How to use: when a term is unfamiliar, look it up in the first table. The See column points to the note that explains it most fully. To look up a standard, use the second part. Status was checked on 2026-10-17 against the RFC Editor and the IETF datatracker.
> Compiled: 2026-10-16

## Glossary

| Term | In one sentence | See |
| --- | --- | --- |
| Transport Layer Security (TLS) | A protocol that provides confidentiality, integrity, and authentication on top of a reliable byte stream | T01 |
| Secure Sockets Layer (SSL) | The predecessor of TLS, now entirely obsolete | T04 |
| round-trip time (RTT) | The time from sending a packet until the reply comes back, the basic unit of handshake performance | T01 |
| handshake | The process of negotiating parameters, exchanging key material, and authenticating identities | T05, T06 |
| record layer | The layer that splits data into records and encrypts and authenticates them | T05, T06 |
| cipher suite | In TLS 1.2 a bundle of four choices, reduced in TLS 1.3 to the AEAD and the hash | T05, T06 |
| extension | An optional type-length-value field in messages such as ClientHello, and the main way TLS evolves | T05, T06 |
| Server Name Indication (SNI) | The target domain name, carried in the clear inside ClientHello | T08 |
| Application-Layer Protocol Negotiation (ALPN) | Selects an application protocol such as h2 or h3 during the handshake | T01 |
| hash function | A one-way function that compresses arbitrary data into a fixed-length fingerprint | T02 |
| message authentication code (MAC), HMAC | A keyed fingerprint that checks where data came from and whether it is intact | T02 |
| authenticated encryption with associated data (AEAD) | An interface that encrypts and authenticates in one step, such as AES-GCM | T02 |
| block cipher | A symmetric algorithm that encrypts fixed-size blocks, such as AES | T02 |
| padding oracle attack | Recovers plaintext from a response that distinguishes a padding error during decryption | T02, T04 |
| public-key cryptography | A cryptosystem in which the public key is public and the private key stays secret | T02 |
| Diffie-Hellman (DH), ECDH | Agrees a shared secret over a public channel | T02 |
| ephemeral key exchange (DHE, ECDHE) | Uses a fresh ephemeral private key for every handshake | T02 |
| forward secrecy | A leaked long-term private key does not open past sessions | T02, T07 |
| digital signature | Signed with the private key and checked with the public key, which proves the origin | T02 |
| key derivation function (KDF), HKDF | Derives many independent keys from one secret | T02, T06 |
| pseudorandom function (PRF) | The key derivation function used in TLS 1.2 | T05 |
| premaster secret | In TLS 1.2, the secret produced directly by the key exchange | T05 |
| master secret | In TLS 1.2, the 48-byte secret derived from the premaster secret and the random values | T05 |
| extended master secret | A way of computing the master secret that binds it to the handshake hash, which blocks the triple-handshake attack | T04, T05 |
| key schedule | In TLS 1.3, the derivation tree built from three HKDF-Extract steps | T06 |
| transcript hash | The hash of every handshake message up to a given moment | T06 |
| traffic secret | The secret from which the AEAD keys for one direction and one stage are derived | T06 |
| key separation | Each key is used for only one purpose | T06 |
| downgrade attack | Forces both peers onto a weaker version or algorithm | T04, T06 |
| downgrade sentinel | The DOWNGRD marker at the end of ServerHello.random | T06, T13 |
| middlebox compatibility mode | A disguise that makes a TLS 1.3 handshake look like a TLS 1.2 resumption | T04, T06 |
| ossification | Middleboxes come to depend on old protocol behavior, which blocks the protocol from evolving | T04, T09 |
| GREASE | Inserts reserved values at random so that an implementation does not fail on an unknown value | T06, T08 |
| HelloRetryRequest (HRR) | The server asks the client to resend ClientHello with a different group | T06, T13 |
| session resumption | Reuses an earlier session secret and skips the certificates and the signatures | T07 |
| session ticket | Session state that the server encrypts and gives the client to store | T05, T07 |
| pre-shared key (PSK) | The secret TLS 1.3 uses for resumption | T07 |
| binder | An HMAC that proves possession of the PSK and binds it to one specific ClientHello | T07 |
| early data, 0-RTT | Application data sent together with the ClientHello | T07 |
| replay | An attacker sends previously recorded data again | T07 |
| certificate, X.509 | A document, signed by a CA, that binds a public key to a name | T03 |
| certificate authority (CA) | An organization that checks an identity and issues certificates | T03 |
| root certificate, trust anchor | A certificate preinstalled in the root store, the starting point of trust | T03 |
| intermediate certificate | A CA certificate issued by a root and used day to day to issue site certificates | T03 |
| root store, trust store | The set of root certificates a device or a browser trusts | T03 |
| root program | The policy and process that decide which roots enter a root store | T03, T12 |
| cross-signing | An old root issues a certificate for a new root, so old devices can still validate it | T03 |
| path building | Finds a certificate path from the leaf to a trusted root | T03 |
| subjectAltName (SAN) | The list of domain names a certificate covers, and the only field a hostname check looks at | T03 |
| nameConstraints | An extension that limits a CA to a stated set of domain names | T03 |
| revocation, CRL, OCSP | Mechanisms that invalidate a certificate before it expires | T03 |
| OCSP stapling | The server attaches an OCSP response to the handshake | T03 |
| Certificate Transparency (CT), SCT | Every public certificate must be submitted to a public log | T03 |
| Certification Authority Authorization (CAA) | A DNS record that states which CAs may issue for a domain | T03 |
| Automatic Certificate Management Environment (ACME) | The protocol for requesting and renewing certificates automatically | T03 |
| DV, OV, EV | The levels of checking done before a certificate is issued: domain, organization, and extended validation | T03 |
| certificate pinning | Accept only a public key that was chosen in advance | T12 |
| HTTP Strict Transport Security (HSTS), preload | Makes the browser reach a domain only over HTTPS | T12 |
| mixed content | An HTTP subresource loaded by an HTTPS page | T12 |
| Encrypted Client Hello (ECH) | Encrypts the whole real ClientHello under a public key | T08 |
| Hybrid Public Key Encryption (HPKE) | The general public-key encryption construction that ECH uses | T08 |
| Service Binding (SVCB) record, HTTPS record | DNS records that publish ALPN, address hints, and ECH configuration | T08 |
| encrypted DNS (DoH, DoT, DoQ) | Carries DNS queries inside HTTPS, TLS, or QUIC | T08 |
| anonymity set | How many names ECH can hide the real target among | T08 |
| QUIC | A transport protocol implemented on UDP, with the TLS 1.3 handshake built in | T09 |
| encryption level | QUIC's Initial, 0-RTT, Handshake, and 1-RTT levels | T09 |
| header protection | QUIC hides the packet number and the flag bits using a sample of the ciphertext | T09 |
| connection migration | A QUIC connection continues after the IP address changes | T09 |
| head-of-line blocking | The loss of one packet blocks later data that has nothing to do with it | T01, T09 |
| post-quantum cryptography (PQC) | Public-key algorithms that resist a quantum computer | T10 |
| Learning With Errors (LWE) | The hard lattice problem that ML-KEM relies on | T10 |
| key encapsulation mechanism (KEM) | Encapsulates a random secret with the peer's public key | T10 |
| hybrid key exchange | Runs a classical key exchange and a post-quantum key exchange, and concatenates the secrets | T10 |
| harvest now, decrypt later | Record traffic now and decrypt it later with a quantum computer | T10 |
| Merkle Tree Certificates (MTC) | Certificates that use a Merkle inclusion proof in place of a CA signature | T10 |
| kernel TLS (kTLS) | Moves record-layer encryption and decryption into the kernel | T07 |
| ShangMi (SM2, SM3, SM4), TLCP | China's commercial cipher algorithms, and its transport-layer cryptography protocol | T11 |
| key log, SSLKEYLOGFILE | Records traffic secrets so you can decrypt a capture of your own traffic | T06, T13 |

## Standards index

Status column: PS is Proposed Standard, Info is Informational, Exp is Experimental, BCP is Best Current Practice, Hist is Historic, and draft means an Internet-Draft that has not been published yet.

### The TLS protocol itself

| Standard | Title | Status | See |
| --- | --- | --- | --- |
| RFC 6101 | The SSL Protocol Version 3.0 | Hist | T04 |
| RFC 6176 | Prohibiting SSL Version 2.0 | PS | T04 |
| RFC 7568 | Deprecating SSL Version 3.0 | PS | T04 |
| RFC 2246 | The TLS Protocol Version 1.0 | Obsoleted | T04 |
| RFC 4346 | The TLS Protocol Version 1.1 | Obsoleted | T04 |
| RFC 5246 | The TLS Protocol Version 1.2 | Obsoleted by RFC 8446 and RFC 9846, but TLS 1.2 is still in use | T05 |
| RFC 8446 | The TLS Protocol Version 1.3 | Obsoleted by RFC 9846 | T06 |
| RFC 9846 | The TLS Protocol Version 1.3 (revision, 2026-07) | PS | T04, T06 |
| RFC 8996 | Deprecating TLS 1.0 and TLS 1.1 | BCP | T04, T12 |
| RFC 9325 | Recommendations for Secure Use of TLS and DTLS (BCP 195) | BCP | T12 |
| RFC 7457 | Summarizing Known Attacks on TLS and DTLS | Info | T04 |

### TLS extensions and mechanisms

| Standard | Title | Status | See |
| --- | --- | --- | --- |
| RFC 6066 | TLS Extensions: Extension Definitions (SNI, status_request) | PS | T01, T03, T08 |
| RFC 7301 | ALPN | PS | T01 |
| RFC 5746 | Renegotiation Indication Extension | PS | T04 |
| RFC 7627 | Session Hash and Extended Master Secret | Obsoleted by RFC 9846 | T04, T05 |
| RFC 7507 | Fallback Signaling Cipher Suite Value (SCSV) | PS, obsoleted by RFC 8996 | T04 |
| RFC 7366 | Encrypt-then-MAC | PS | T02, T05 |
| RFC 5077 | Session Resumption without Server-Side State | Obsoleted | T07 |
| RFC 7918 | TLS False Start | Info | T07 |
| RFC 8879 | TLS Certificate Compression | PS | T07 |
| RFC 8701 | Applying GREASE to TLS Extensibility | Info | T06, T08 |
| RFC 8470 | Using Early Data in HTTP | PS | T07 |
| RFC 5705 | Keying Material Exporters for TLS | PS | T06 |
| RFC 9266 | Channel Bindings for TLS 1.3 | PS | T06 |
| RFC 6520 | TLS and DTLS Heartbeat Extension | PS | T04 |
| RFC 7465 | Prohibiting RC4 Cipher Suites | PS | T04 |
| RFC 9849 | TLS Encrypted Client Hello (2026-03) | PS | T08 |
| RFC 9848 | Bootstrapping TLS ECH with DNS Service Bindings (2026-03) | Published, status not checked | T08 |
| RFC 9934 | PEM File Format for ECH (2026-03) | PS | T08 |
| RFC 8998 | ShangMi (SM) Cipher Suites for TLS 1.3 | Info | T11 |

### Cryptography

| Standard | Title | Status | See |
| --- | --- | --- | --- |
| FIPS 180-4 | Secure Hash Standard (SHA-2) | NIST standard | T02 |
| FIPS 197 | Advanced Encryption Standard | NIST standard | T02 |
| NIST SP 800-38D | GCM and GMAC | NIST recommendation | T02 |
| FIPS 186-5 | Digital Signature Standard | NIST standard | T02 |
| RFC 2104 | HMAC | Info | T02 |
| RFC 5116 | An Interface and Algorithms for Authenticated Encryption | PS | T02 |
| RFC 5288 | AES-GCM Cipher Suites for TLS | PS | T05 |
| RFC 7905 | ChaCha20-Poly1305 Cipher Suites for TLS | PS | T05 |
| RFC 8439 | ChaCha20 and Poly1305 for IETF Protocols | Info | T02 |
| RFC 8017 | PKCS #1 v2.2 (RSA) | Info | T02 |
| RFC 7748 | Elliptic Curves for Security (X25519, X448) | Info | T02 |
| RFC 8032 | EdDSA | Info | T02 |
| RFC 6979 | Deterministic DSA and ECDSA | Info | T02 |
| RFC 7919 | FFDHE Parameters for TLS | PS | T02, T04 |
| RFC 8422 | ECC Cipher Suites for TLS 1.2 and Earlier | Obsoleted by RFC 9846 | T05 |
| RFC 5869 | HKDF | Info | T02 |
| RFC 9180 | Hybrid Public Key Encryption | Info | T08 |

### Post-quantum

| Standard | Title | Status | See |
| --- | --- | --- | --- |
| FIPS 203 | ML-KEM | NIST standard (2024-08) | T10 |
| FIPS 204 | ML-DSA | NIST standard (2024-08) | T10 |
| FIPS 205 | SLH-DSA | NIST standard (2024-08) | T10 |
| RFC 10024 | Post-Quantum Traditional (PQ/T) Hybrid Key Agreement Mechanisms for TLS 1.3 (2026) | PS | T06, T10 |
| draft-ietf-tls-mlkem | ML-KEM Post-Quantum Key Agreement for TLS 1.3 | Draft, in the RFC Editor queue, target Info | T10 |
| draft-ietf-tls-mldsa | Use of ML-DSA in TLS 1.3 | Draft, in the RFC Editor queue, target Info | T10 |
| PLANTS working group draft | Merkle Tree Certificates | Draft | T10 |

### Certificates and PKI

| Standard | Title | Status | See |
| --- | --- | --- | --- |
| RFC 5280 | X.509 PKI Certificate and CRL Profile | PS | T03 |
| RFC 9525 | Service Identity in TLS | PS | T03 |
| RFC 6960 | Online Certificate Status Protocol | PS | T03 |
| RFC 7633 | X.509v3 TLS Feature Extension (Must-Staple) | PS | T03 |
| RFC 6962 | Certificate Transparency | Exp, obsoleted by RFC 9162 | T03 |
| RFC 9162 | Certificate Transparency Version 2.0 | Exp | T03 |
| RFC 8659 | CAA Resource Record | PS | T03 |
| RFC 8657 | CAA Extensions for Account URI and ACME Method Binding | PS | T03 |
| RFC 8555 | ACME | PS | T03 |
| RFC 8737 | ACME TLS-ALPN-01 Challenge | PS | T03 |
| CA/B Forum Baseline Requirements | Baseline requirements for publicly trusted TLS certificates (including SC-063 and SC-081) | Industry specification | T03, T12 |

### HTTP, QUIC, and transport

| Standard | Title | Status | See |
| --- | --- | --- | --- |
| RFC 9110 | HTTP Semantics | Internet Standard | T01 |
| RFC 9112 | HTTP/1.1 | Internet Standard | T01 |
| RFC 9113 | HTTP/2 | PS | T01, T07 |
| RFC 9114 | HTTP/3 | PS | T09 |
| RFC 9204 | QPACK | PS | T09 |
| RFC 2818 | HTTP Over TLS | Info, obsoleted by RFC 9110 | T01 |
| RFC 8999 | Version-Independent Properties of QUIC | PS | T09 |
| RFC 9000 | QUIC Transport | PS | T09 |
| RFC 9001 | Using TLS to Secure QUIC | PS | T09 |
| RFC 9002 | QUIC Loss Detection and Congestion Control | PS | T09 |
| RFC 9368 | Compatible Version Negotiation for QUIC | PS | T09 |
| RFC 9369 | QUIC Version 2 | PS | T09 |
| RFC 7838 | HTTP Alternative Services | PS | T09 |
| RFC 8336 | The ORIGIN HTTP/2 Frame | PS | T07 |
| RFC 8297 | 103 Early Hints | Exp | T07 |
| RFC 9293 | Transmission Control Protocol | Internet Standard | T05 |
| RFC 7323 | TCP Extensions for High Performance | PS | T05 |
| RFC 7413 | TCP Fast Open | Exp | T05, T07 |
| RFC 6928 | Increasing TCP's Initial Window | Exp | T07 |

### DNS, web security, and governance

| Standard | Title | Status | See |
| --- | --- | --- | --- |
| RFC 9460 | SVCB and HTTPS Resource Records | PS | T08, T12 |
| RFC 8484 | DNS Queries over HTTPS (DoH) | PS | T08 |
| RFC 7858 | DNS over TLS | PS | T08 |
| RFC 9250 | DNS over Dedicated QUIC Connections | PS | T08 |
| RFC 6797 | HTTP Strict Transport Security | PS | T01, T12 |
| RFC 7258 | Pervasive Monitoring Is an Attack | BCP | T12 |
| RFC 7469 | Public Key Pinning Extension for HTTP | PS (deprecated by browsers) | T12 |
| RFC 9163 | Expect-CT Extension for HTTP | Exp | T12 |
| RFC 6698 | DANE TLSA | PS | T12 |
| RFC 7672 | SMTP Security via Opportunistic DANE TLS | PS | T12 |
| RFC 8461 | SMTP MTA Strict Transport Security | PS | T12 |
| RFC 9102 | TLS DNSSEC Chain Extension | Exp | T12 |
| RFC 8404 | Effects of Pervasive Encryption on Operators | Info | T08 |
| GB/T 38636-2020 | Transport layer cryptography protocol (TLCP) | Chinese national standard | T11 |

Every RFC can be read in full at `https://www.rfc-editor.org/rfc/rfcNNNN`. `https://www.rfc-editor.org/info/rfcNNNN` gives the status, what the RFC obsoletes or is obsoleted by, and the errata.
