// IANA registry names for the values a capture contains. Only what the
// recorded scenarios and common real-world hellos use; unknown values render as
// hex with "未知".

export const contentTypes: Record<number, string> = {
  20: "ChangeCipherSpec",
  21: "Alert",
  22: "Handshake",
  23: "ApplicationData",
};

export const handshakeTypes: Record<number, string> = {
  0: "HelloRequest",
  1: "ClientHello",
  2: "ServerHello",
  4: "NewSessionTicket",
  5: "EndOfEarlyData",
  8: "EncryptedExtensions",
  11: "Certificate",
  12: "ServerKeyExchange",
  13: "CertificateRequest",
  14: "ServerHelloDone",
  15: "CertificateVerify",
  16: "ClientKeyExchange",
  20: "Finished",
  24: "KeyUpdate",
  254: "message_hash",
};

/** Short labels for the sequence diagram. */
export const handshakeShort: Record<number, string> = {
  1: "ClientHello",
  2: "ServerHello",
  4: "NewSessionTicket",
  8: "EncryptedExtensions",
  11: "Certificate",
  12: "ServerKeyExchange",
  13: "CertificateRequest",
  14: "ServerHelloDone",
  15: "CertificateVerify",
  16: "ClientKeyExchange",
  20: "Finished",
  24: "KeyUpdate",
};

export const versions: Record<number, string> = {
  0x0300: "SSL 3.0",
  0x0301: "TLS 1.0",
  0x0302: "TLS 1.1",
  0x0303: "TLS 1.2",
  0x0304: "TLS 1.3",
};

export const cipherSuites: Record<number, string> = {
  0x1301: "TLS_AES_128_GCM_SHA256",
  0x1302: "TLS_AES_256_GCM_SHA384",
  0x1303: "TLS_CHACHA20_POLY1305_SHA256",
  0xc02b: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
  0xc02c: "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
  0xc02f: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
  0xc030: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
  0xcca8: "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
  0xcca9: "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
  0xc009: "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
  0xc00a: "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA",
  0xc013: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
  0xc014: "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
  0xc023: "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256",
  0xc027: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
  0x009c: "TLS_RSA_WITH_AES_128_GCM_SHA256",
  0x009d: "TLS_RSA_WITH_AES_256_GCM_SHA384",
  0x002f: "TLS_RSA_WITH_AES_128_CBC_SHA",
  0x0035: "TLS_RSA_WITH_AES_256_CBC_SHA",
  0x003c: "TLS_RSA_WITH_AES_128_CBC_SHA256",
  0x000a: "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
  0xc012: "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA",
  0x0005: "TLS_RSA_WITH_RC4_128_SHA",
  0xc011: "TLS_ECDHE_RSA_WITH_RC4_128_SHA",
  0xc007: "TLS_ECDHE_ECDSA_WITH_RC4_128_SHA",
  0x00ff: "TLS_EMPTY_RENEGOTIATION_INFO_SCSV",
  0x5600: "TLS_FALLBACK_SCSV",
};

export const groups: Record<number, string> = {
  23: "secp256r1 (P-256)",
  24: "secp384r1 (P-384)",
  25: "secp521r1 (P-521)",
  29: "x25519",
  30: "x448",
  256: "ffdhe2048",
  257: "ffdhe3072",
  0x11eb: "SecP256r1MLKEM768",
  0x11ec: "X25519MLKEM768",
  0x11ed: "SecP384r1MLKEM1024",
  0x6399: "X25519Kyber768Draft00",
  512: "MLKEM512",
  513: "MLKEM768",
  514: "MLKEM1024",
};

export const sigSchemes: Record<number, string> = {
  0x0401: "rsa_pkcs1_sha256",
  0x0501: "rsa_pkcs1_sha384",
  0x0601: "rsa_pkcs1_sha512",
  0x0403: "ecdsa_secp256r1_sha256",
  0x0503: "ecdsa_secp384r1_sha384",
  0x0603: "ecdsa_secp521r1_sha512",
  0x0804: "rsa_pss_rsae_sha256",
  0x0805: "rsa_pss_rsae_sha384",
  0x0806: "rsa_pss_rsae_sha512",
  0x0807: "ed25519",
  0x0808: "ed448",
  0x0809: "rsa_pss_pss_sha256",
  0x080a: "rsa_pss_pss_sha384",
  0x080b: "rsa_pss_pss_sha512",
  0x0201: "rsa_pkcs1_sha1",
  0x0203: "ecdsa_sha1",
  0x0904: "mldsa44",
  0x0905: "mldsa65",
  0x0906: "mldsa87",
};

export const extensions: Record<number, string> = {
  0: "server_name",
  1: "max_fragment_length",
  5: "status_request",
  10: "supported_groups",
  11: "ec_point_formats",
  13: "signature_algorithms",
  14: "use_srtp",
  15: "heartbeat",
  16: "application_layer_protocol_negotiation",
  18: "signed_certificate_timestamp",
  21: "padding",
  22: "encrypt_then_mac",
  23: "extended_master_secret",
  27: "compress_certificate",
  28: "record_size_limit",
  35: "session_ticket",
  41: "pre_shared_key",
  42: "early_data",
  43: "supported_versions",
  44: "cookie",
  45: "psk_key_exchange_modes",
  47: "certificate_authorities",
  48: "oid_filters",
  49: "post_handshake_auth",
  50: "signature_algorithms_cert",
  51: "key_share",
  57: "quic_transport_parameters",
  17513: "application_settings",
  0xfe0d: "encrypted_client_hello",
  0xff01: "renegotiation_info",
};

export const alertDescriptions: Record<number, string> = {
  0: "close_notify",
  10: "unexpected_message",
  20: "bad_record_mac",
  40: "handshake_failure",
  42: "bad_certificate",
  43: "unsupported_certificate",
  44: "certificate_revoked",
  45: "certificate_expired",
  46: "certificate_unknown",
  47: "illegal_parameter",
  48: "unknown_ca",
  50: "decode_error",
  51: "decrypt_error",
  70: "protocol_version",
  71: "insufficient_security",
  80: "internal_error",
  86: "inappropriate_fallback",
  90: "user_canceled",
  109: "missing_extension",
  110: "unsupported_extension",
  112: "unrecognized_name",
  116: "certificate_required",
  120: "no_application_protocol",
  121: "ech_required",
};

export const pskModes: Record<number, string> = { 0: "psk_ke", 1: "psk_dhe_ke" };

/** GREASE values (RFC 8701) look like 0x?a?a. */
export function isGrease(v: number): boolean {
  return (v & 0x0f0f) === 0x0a0a && (v >> 8) === (v & 0xff);
}

export function nameOr(table: Record<number, string>, v: number, width = 4): string {
  if (isGrease(v)) return `GREASE 0x${v.toString(16).padStart(width, "0")}`;
  return table[v] ?? `未知 0x${v.toString(16).padStart(width, "0")}`;
}

export const hrrRandom = "cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c";
/** RFC 8446, Section 4.1.3: the last 8 bytes of ServerHello.random when downgrading. */
export const downgradeTLS12 = "444f574e47524401";
export const downgradeTLS11 = "444f574e47524400";
