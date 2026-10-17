// Dissects handshake messages into a field tree with byte ranges, the way a
// protocol analyzer does. Every field can carry the Go struct field that holds
// it (so the UI can find the exact marshal and unmarshal lines through the
// reference index) and the RFC section that defines it.
import { dissectCertificate } from "./der";
import {
  alertDescriptions,
  cipherSuites,
  contentTypes,
  downgradeTLS11,
  downgradeTLS12,
  extensions,
  groups,
  handshakeTypes,
  hrrRandom,
  isGrease,
  nameOr,
  pskModes,
  sigSchemes,
  versions,
} from "./names";

export interface Field {
  name: string;
  start: number;
  end: number;
  value?: string;
  children?: Field[];
  /** Index key of the Go struct field holding this value. */
  go?: string;
  rfc?: [number, string];
  note?: string;
  /** For certificate entries: index into the capture's certs. */
  cert?: number;
  /** Marks a length prefix, which the hex view dims. */
  len?: boolean;
}

export interface DissectCtx {
  version: number;
  certs?: { der: string }[];
}

const S = "crypto/tls.";

class Reader {
  constructor(
    readonly b: Uint8Array,
    public p = 0,
  ) {}
  get left() {
    return this.b.length - this.p;
  }
  u8() {
    return this.b[this.p++];
  }
  u16() {
    const v = (this.b[this.p] << 8) | this.b[this.p + 1];
    this.p += 2;
    return v;
  }
  u24() {
    const v = (this.b[this.p] << 16) | (this.b[this.p + 1] << 8) | this.b[this.p + 2];
    this.p += 3;
    return v;
  }
  u32() {
    const v = ((this.b[this.p] << 24) >>> 0) + (this.b[this.p + 1] << 16) + (this.b[this.p + 2] << 8) + this.b[this.p + 3];
    this.p += 4;
    return v;
  }
  hex(start: number, end: number, max = 32) {
    const v = this.b.subarray(start, end);
    const s = [...v.subarray(0, max)].map((x) => x.toString(16).padStart(2, "0")).join("");
    return v.length > max ? `${s}…` : s;
  }
  text(start: number, end: number) {
    return new TextDecoder().decode(this.b.subarray(start, end));
  }
}

function hexOf(b: Uint8Array, start: number, end: number, max = 32) {
  return new Reader(b).hex(start, end, max);
}

const plural = (n: number, unit: string) => `${n} ${unit}`;

/** A length-prefixed vector: a field for the length, then the body. */
function vector(r: Reader, lenBytes: 1 | 2 | 3, name: string, body: (r: Reader, end: number) => Field[] | string, extra: Partial<Field> = {}): Field {
  const start = r.p;
  const n = lenBytes === 1 ? r.u8() : lenBytes === 2 ? r.u16() : r.u24();
  const lenField: Field = { name: "length", start, end: r.p, value: String(n), len: true };
  const bodyStart = r.p;
  const end = r.p + n;
  const out = body(r, end);
  r.p = end;
  const f: Field = { name, start, end, ...extra };
  if (typeof out === "string") {
    f.value = out;
    f.children = [lenField, { name: "data", start: bodyStart, end, value: hexOf(r.b, bodyStart, end) }];
  } else {
    f.children = [lenField, ...out];
    if (!f.value) f.value = plural(n, "字节");
  }
  return f;
}

function u16List(r: Reader, end: number, table: Record<number, string>, label: string, go?: string): Field[] {
  const out: Field[] = [];
  while (r.p < end) {
    const s = r.p;
    const v = r.u16();
    out.push({ name: label, start: s, end: r.p, value: `${nameOr(table, v)} (0x${v.toString(16).padStart(4, "0")})`, go });
  }
  return out;
}

function header(r: Reader): Field[] {
  const t = r.u8();
  const tf: Field = { name: "msg_type", start: 0, end: 1, value: `${handshakeTypes[t] ?? t} (${t})`, rfc: [8446, "4"] };
  const n = r.u24();
  return [tf, { name: "length", start: 1, end: 4, value: String(n), len: true }];
}

// Extensions by type. `who` is the message the extension appears in.
type Who = "ch" | "sh" | "hrr" | "ee" | "ct" | "nst" | "cr";

const extGo: Partial<Record<number, Partial<Record<Who, string>>>> = {
  0: { ch: "clientHelloMsg.serverName", ee: "encryptedExtensionsMsg.serverNameAck", sh: "serverHelloMsg.serverNameAck" },
  5: { ch: "clientHelloMsg.ocspStapling", sh: "serverHelloMsg.ocspStapling", ct: "certificateMsgTLS13.ocspStapling", cr: "certificateRequestMsgTLS13.ocspStapling" },
  10: { ch: "clientHelloMsg.supportedCurves" },
  11: { ch: "clientHelloMsg.supportedPoints", sh: "serverHelloMsg.supportedPoints" },
  13: { ch: "clientHelloMsg.supportedSignatureAlgorithms", cr: "certificateRequestMsgTLS13.supportedSignatureAlgorithms" },
  16: { ch: "clientHelloMsg.alpnProtocols", sh: "serverHelloMsg.alpnProtocol", ee: "encryptedExtensionsMsg.alpnProtocol" },
  18: { ch: "clientHelloMsg.scts", sh: "serverHelloMsg.scts", ct: "certificateMsgTLS13.scts", cr: "certificateRequestMsgTLS13.scts" },
  23: { ch: "clientHelloMsg.extendedMasterSecret", sh: "serverHelloMsg.extendedMasterSecret" },
  35: { ch: "clientHelloMsg.sessionTicket", sh: "serverHelloMsg.ticketSupported" },
  41: { ch: "clientHelloMsg.pskIdentities", sh: "serverHelloMsg.selectedIdentity" },
  42: { ch: "clientHelloMsg.earlyData", ee: "encryptedExtensionsMsg.earlyData", nst: "newSessionTicketMsgTLS13.maxEarlyData" },
  43: { ch: "clientHelloMsg.supportedVersions", sh: "serverHelloMsg.supportedVersion", hrr: "serverHelloMsg.supportedVersion" },
  44: { ch: "clientHelloMsg.cookie", hrr: "serverHelloMsg.cookie" },
  45: { ch: "clientHelloMsg.pskModes" },
  47: { cr: "certificateRequestMsgTLS13.certificateAuthorities" },
  50: { ch: "clientHelloMsg.supportedSignatureAlgorithmsCert", cr: "certificateRequestMsgTLS13.supportedSignatureAlgorithmsCert" },
  51: { ch: "clientHelloMsg.keyShares", sh: "serverHelloMsg.serverShare", hrr: "serverHelloMsg.selectedGroup" },
  57: { ch: "clientHelloMsg.quicTransportParameters", ee: "encryptedExtensionsMsg.quicTransportParameters" },
  0xfe0d: { ch: "clientHelloMsg.encryptedClientHello", ee: "encryptedExtensionsMsg.echRetryConfigs", hrr: "serverHelloMsg.encryptedClientHello" },
  0xff01: { ch: "clientHelloMsg.secureRenegotiationSupported", sh: "serverHelloMsg.secureRenegotiationSupported" },
};

const extRfc: Record<number, [number, string]> = {
  0: [6066, "3"],
  5: [8446, "4.4.2.1"],
  10: [8446, "4.2.7"],
  11: [8422, "5.1.2"],
  13: [8446, "4.2.3"],
  16: [7301, "3.1"],
  18: [6962, "3.3.1"],
  21: [7685, "3"],
  23: [7627, "5.1"],
  35: [5077, "3.2"],
  41: [8446, "4.2.11"],
  42: [8446, "4.2.10"],
  43: [8446, "4.2.1"],
  44: [8446, "4.2.2"],
  45: [8446, "4.2.9"],
  47: [8446, "4.2.4"],
  50: [8446, "4.2.3"],
  51: [8446, "4.2.8"],
  57: [9001, "8.2"],
  0xfe0d: [9849, "5"],
  0xff01: [5746, "3.2"],
};

function keyShareEntry(r: Reader): Field {
  const s = r.p;
  const g = r.u16();
  const gf: Field = { name: "group", start: s, end: r.p, value: `${nameOr(groups, g)} (0x${g.toString(16).padStart(4, "0")})` };
  const key = vector(r, 2, "key_exchange", (rr, end) => {
    const n = end - rr.p;
    if (g === 0x11ec && n === 1216) {
      return [
        { name: "ML-KEM-768 封装密钥", start: rr.p, end: rr.p + 1184, value: hexOf(rr.b, rr.p, rr.p + 1184, 16) + "…（1184 字节）" },
        { name: "X25519 公钥", start: rr.p + 1184, end, value: hexOf(rr.b, rr.p + 1184, end) },
      ];
    }
    if (g === 0x11ec && n === 1120) {
      return [
        { name: "ML-KEM-768 密文", start: rr.p, end: rr.p + 1088, value: hexOf(rr.b, rr.p, rr.p + 1088, 16) + "…（1088 字节）" },
        { name: "X25519 公钥", start: rr.p + 1088, end, value: hexOf(rr.b, rr.p + 1088, end) },
      ];
    }
    return hexOf(rr.b, rr.p, end, 32) + (n > 32 ? `（${n} 字节）` : "");
  });
  return { name: "KeyShareEntry", start: s, end: r.p, value: `${nameOr(groups, g)}，${r.p - s - 4} 字节`, children: [gf, key] };
}

function extensionBody(r: Reader, type: number, who: Who, end: number, ctx: DissectCtx): Field[] | string {
  switch (type) {
    case 0:
      if (end === r.p) return "（空，表示服务器用了 SNI）";
      return [
        vector(r, 2, "server_name_list", (rr, e) => {
          const out: Field[] = [];
          while (rr.p < e) {
            const s = rr.p;
            rr.u8();
            const host = vector(rr, 2, "host_name", (r3, e3) => r3.text(r3.p, e3));
            out.push({ name: "ServerName", start: s, end: rr.p, value: host.value, children: [{ name: "name_type", start: s, end: s + 1, value: "host_name (0)" }, host] });
          }
          return out;
        }),
      ];
    case 10:
      return [vector(r, 2, "named_group_list", (rr, e) => u16List(rr, e, groups, "NamedGroup"))];
    case 11:
      return [vector(r, 1, "ec_point_format_list", (rr, e) => {
        const out: Field[] = [];
        while (rr.p < e) {
          const s = rr.p;
          const v = rr.u8();
          out.push({ name: "ECPointFormat", start: s, end: rr.p, value: v === 0 ? "uncompressed (0)" : String(v) });
        }
        return out;
      })];
    case 13:
    case 50:
      return [vector(r, 2, "supported_signature_algorithms", (rr, e) => u16List(rr, e, sigSchemes, "SignatureScheme"))];
    case 16:
      return [
        vector(r, 2, "protocol_name_list", (rr, e) => {
          const out: Field[] = [];
          while (rr.p < e) out.push(vector(rr, 1, "ProtocolName", (r3, e3) => r3.text(r3.p, e3)));
          return out;
        }),
      ];
    case 43:
      if (who === "ch") return [vector(r, 1, "versions", (rr, e) => u16List(rr, e, versions, "ProtocolVersion"))];
      {
        const s = r.p;
        const v = r.u16();
        return [{ name: "selected_version", start: s, end: r.p, value: `${nameOr(versions, v)} (0x${v.toString(16)})` }];
      }
    case 45:
      return [vector(r, 1, "ke_modes", (rr, e) => {
        const out: Field[] = [];
        while (rr.p < e) {
          const s = rr.p;
          const v = rr.u8();
          out.push({ name: "PskKeyExchangeMode", start: s, end: rr.p, value: `${pskModes[v] ?? v} (${v})` });
        }
        return out;
      })];
    case 51:
      if (who === "ch")
        return [vector(r, 2, "client_shares", (rr, e) => {
          const out: Field[] = [];
          while (rr.p < e) out.push(keyShareEntry(rr));
          return out;
        })];
      if (who === "hrr") {
        const s = r.p;
        const g = r.u16();
        return [{ name: "selected_group", start: s, end: r.p, value: nameOr(groups, g) }];
      }
      return [keyShareEntry(r)];
    case 41:
      if (who === "sh") {
        const s = r.p;
        const v = r.u16();
        return [{ name: "selected_identity", start: s, end: r.p, value: String(v) }];
      }
      return [
        vector(r, 2, "identities", (rr, e) => {
          const out: Field[] = [];
          while (rr.p < e) {
            const s = rr.p;
            const id = vector(rr, 2, "identity", (r3, e3) => `票据 ${e3 - r3.p} 字节`, { go: S + "pskIdentity.label" });
            const as = rr.p;
            const age = rr.u32();
            out.push({
              name: "PskIdentity",
              start: s,
              end: rr.p,
              children: [id, { name: "obfuscated_ticket_age", start: as, end: rr.p, value: String(age), go: S + "pskIdentity.obfuscatedTicketAge" }],
            });
          }
          return out;
        }),
        vector(r, 2, "binders", (rr, e) => {
          const out: Field[] = [];
          while (rr.p < e) out.push(vector(rr, 1, "PskBinderEntry", (r3, e3) => r3.hex(r3.p, e3), { go: S + "clientHelloMsg.pskBinders" }));
          return out;
        }),
      ];
    case 0xff01:
      return [vector(r, 1, "renegotiated_connection", (rr, e) => (e === rr.p ? "（空：首次握手）" : rr.hex(rr.p, e)))];
    case 23:
    case 18:
    case 22:
    case 49:
      return end === r.p ? "（空）" : r.hex(r.p, end);
    case 42:
      if (who === "nst" && end - r.p === 4) return `max_early_data_size = ${r.u32()}`;
      return end === r.p ? "（空）" : r.hex(r.p, end);
    case 35:
      return end === r.p ? "（空：支持票据，没有旧票据）" : `票据 ${end - r.p} 字节`;
    case 5:
      if (who === "ch") return r.hex(r.p, end);
      return end === r.p ? "（空）" : r.hex(r.p, end);
    default:
      void ctx;
      return end === r.p ? "（空）" : r.hex(r.p, end);
  }
}

function extensionsBlock(r: Reader, who: Who, ctx: DissectCtx): Field {
  return vector(r, 2, "extensions", (rr, end) => {
    const out: Field[] = [];
    while (rr.p < end) {
      const s = rr.p;
      const type = rr.u16();
      const tf: Field = { name: "extension_type", start: s, end: rr.p, value: `${nameOr(extensions, type)} (${type})` };
      const body = vector(rr, 2, "extension_data", (r3, e3) => extensionBody(r3, type, who, e3, ctx));
      const go = extGo[type]?.[who];
      const f: Field = {
        name: isGrease(type) ? `GREASE 0x${type.toString(16)}` : nameOr(extensions, type),
        start: s,
        end: rr.p,
        children: [tf, ...(body.children ?? [])],
        go: go ? S + go : undefined,
        rfc: isGrease(type) ? [8701, "2"] : extRfc[type],
      };
      if (typeof body.value === "string" && !body.value.endsWith("字节")) f.value = body.value;
      else f.value = summarize(f);
      out.push(f);
    }
    return out;
  }, { rfc: [8446, "4.2"] });
}

function summarize(f: Field): string {
  const leaves = (f.children ?? []).slice(1).flatMap((c) => (c.len ? [] : c.children ? c.children.filter((x) => !x.len) : [c]));
  const vals = leaves.map((c) => c.value?.replace(/ \(0x[0-9a-f]+\)$/, "") ?? c.name).filter(Boolean);
  const s = vals.slice(0, 4).join("，");
  return vals.length > 4 ? `${s} 等 ${vals.length} 项` : s;
}

function clientHello(r: Reader, ctx: DissectCtx): Field[] {
  const out: Field[] = [];
  let s = r.p;
  const v = r.u16();
  out.push({ name: "legacy_version", start: s, end: r.p, value: `${nameOr(versions, v)} (0x${v.toString(16)})`, go: S + "clientHelloMsg.vers", rfc: [8446, "4.1.2"] });
  s = r.p;
  r.p += 32;
  out.push({ name: "random", start: s, end: r.p, value: r.hex(s, r.p), go: S + "clientHelloMsg.random", rfc: [8446, "4.1.2"] });
  out.push(vector(r, 1, "legacy_session_id", (rr, e) => (e === rr.p ? "（空）" : rr.hex(rr.p, e)), { go: S + "clientHelloMsg.sessionId", rfc: [8446, "4.1.2"] }));
  const suites = vector(r, 2, "cipher_suites", (rr, e) => u16List(rr, e, cipherSuites, "CipherSuite"), { go: S + "clientHelloMsg.cipherSuites", rfc: [8446, "4.1.2"] });
  suites.value = `${(suites.children?.length ?? 1) - 1} 个套件`;
  out.push(suites);
  out.push(vector(r, 1, "legacy_compression_methods", (rr, e) => [...rr.b.subarray(rr.p, e)].map((m) => (m === 0 ? "null (0)" : String(m))).join(", "), { go: S + "clientHelloMsg.compressionMethods" }));
  if (r.left > 0) out.push(extensionsBlock(r, "ch", ctx));
  return out;
}

function serverHello(r: Reader, ctx: DissectCtx): Field[] {
  const out: Field[] = [];
  let s = r.p;
  const v = r.u16();
  out.push({ name: "legacy_version", start: s, end: r.p, value: `${nameOr(versions, v)} (0x${v.toString(16)})`, go: S + "serverHelloMsg.vers", rfc: [8446, "4.1.3"] });
  s = r.p;
  r.p += 32;
  const random = r.hex(s, r.p);
  const hrr = random === hrrRandom;
  const tail = random.slice(48);
  const rf: Field = { name: "random", start: s, end: r.p, value: random, go: S + "serverHelloMsg.random", rfc: [8446, "4.1.3"] };
  if (hrr) rf.note = "固定值 SHA-256(\"HelloRetryRequest\")：这条 ServerHello 其实是 HelloRetryRequest。";
  else if (tail === downgradeTLS12 || tail === downgradeTLS11) {
    rf.note = `末尾 8 字节是降级哨兵 "DOWNGRD\\x0${tail === downgradeTLS12 ? 1 : 0}"：服务器支持 TLS 1.3，却协商了更低的版本。`;
    rf.children = [
      { name: "随机部分", start: s, end: s + 24, value: random.slice(0, 48) },
      { name: "降级哨兵", start: s + 24, end: s + 32, value: `${tail} "DOWNGRD\\x0${tail === downgradeTLS12 ? 1 : 0}"`, go: S + "downgradeCanaryTLS12", rfc: [8446, "4.1.3"] },
    ];
  }
  out.push(rf);
  out.push(vector(r, 1, "legacy_session_id_echo", (rr, e) => (e === rr.p ? "（空）" : rr.hex(rr.p, e)), { go: S + "serverHelloMsg.sessionId" }));
  s = r.p;
  const cs = r.u16();
  out.push({ name: "cipher_suite", start: s, end: r.p, value: `${nameOr(cipherSuites, cs)} (0x${cs.toString(16).padStart(4, "0")})`, go: S + "serverHelloMsg.cipherSuite", rfc: [8446, "B.4"] });
  s = r.p;
  r.u8();
  out.push({ name: "legacy_compression_method", start: s, end: r.p, value: "null (0)", go: S + "serverHelloMsg.compressionMethod" });
  if (r.left > 0) out.push(extensionsBlock(r, hrr ? "hrr" : "sh", ctx));
  return out;
}

function certificate13(r: Reader, ctx: DissectCtx): Field[] {
  const out: Field[] = [];
  out.push(vector(r, 1, "certificate_request_context", (rr, e) => (e === rr.p ? "（空：不是对 CertificateRequest 的回应）" : rr.hex(rr.p, e))));
  out.push(
    vector(r, 3, "certificate_list", (rr, e) => {
      const list: Field[] = [];
      let i = 0;
      while (rr.p < e) {
        const s = rr.p;
        const data = certData(rr, ctx, i);
        const ext = extensionsBlock(rr, "ct", ctx);
        list.push({ name: `CertificateEntry ${i}`, start: s, end: rr.p, value: data.value, cert: data.cert, children: [data, ext] });
        i++;
      }
      return list;
    }, { go: S + "certificateMsgTLS13.certificate", rfc: [8446, "4.4.2"] }),
  );
  return out;
}

function certData(r: Reader, ctx: DissectCtx, i: number): Field {
  const start = r.p;
  const f = vector(r, 3, "cert_data", (rr, e) => {
    const der = rr.b.subarray(rr.p, e);
    return dissectCertificate(der, rr.p);
  }, { rfc: [5280, "4.1"], go: "crypto/x509.ParseCertificate" });
  const der = hexOf(r.b, start + 3, r.p, 1 << 20);
  const ci = ctx.certs?.findIndex((c) => c.der === der) ?? -1;
  const subj = f.children?.[1]?.children?.find((c) => c.name === "subject")?.value;
  f.value = subj ? subj.replace(/^.*CN=/, "CN=") : `证书 ${i}`;
  if (ci >= 0) f.cert = ci;
  return f;
}

function certificate12(r: Reader, ctx: DissectCtx): Field[] {
  return [
    vector(r, 3, "certificate_list", (rr, e) => {
      const list: Field[] = [];
      let i = 0;
      while (rr.p < e) list.push(certData(rr, ctx, i++));
      return list;
    }, { go: S + "certificateMsg.certificates", rfc: [5246, "7.4.2"] }),
  ];
}

function certificateVerify(r: Reader): Field[] {
  const s = r.p;
  const a = r.u16();
  return [
    { name: "algorithm", start: s, end: r.p, value: `${nameOr(sigSchemes, a)} (0x${a.toString(16).padStart(4, "0")})`, go: S + "certificateVerifyMsg.signatureAlgorithm", rfc: [8446, "4.2.3"] },
    vector(r, 2, "signature", (rr, e) => rr.hex(rr.p, e), { go: S + "certificateVerifyMsg.signature", rfc: [8446, "4.4.3"] }),
  ];
}

function newSessionTicket(r: Reader, ctx: DissectCtx): Field[] {
  const out: Field[] = [];
  let s = r.p;
  const life = r.u32();
  out.push({ name: "ticket_lifetime", start: s, end: r.p, value: `${life} 秒（${(life / 86400).toFixed(1)} 天）`, go: S + "newSessionTicketMsgTLS13.lifetime", rfc: [8446, "4.6.1"] });
  if (ctx.version === 0x0304) {
    s = r.p;
    const add = r.u32();
    out.push({ name: "ticket_age_add", start: s, end: r.p, value: `0x${add.toString(16)}`, go: S + "newSessionTicketMsgTLS13.ageAdd" });
    out.push(vector(r, 1, "ticket_nonce", (rr, e) => rr.hex(rr.p, e), { go: S + "newSessionTicketMsgTLS13.nonce" }));
    out.push(vector(r, 2, "ticket", (rr, e) => `${e - rr.p} 字节，服务器用票据密钥加密的会话状态`, { go: S + "newSessionTicketMsgTLS13.label" }));
    out.push(extensionsBlock(r, "nst", ctx));
  } else {
    out.push(vector(r, 2, "ticket", (rr, e) => `${e - rr.p} 字节`, { go: S + "newSessionTicketMsg.ticket", rfc: [5077, "3.3"] }));
  }
  return out;
}

function serverKeyExchange(r: Reader): Field[] {
  const s = r.p;
  const curveType = r.u8();
  const out: Field[] = [{ name: "curve_type", start: s, end: r.p, value: curveType === 3 ? "named_curve (3)" : String(curveType), rfc: [8422, "5.4"] }];
  let p = r.p;
  const g = r.u16();
  out.push({ name: "named_curve", start: p, end: r.p, value: nameOr(groups, g) });
  out.push(vector(r, 1, "public", (rr, e) => rr.hex(rr.p, e), { note: "服务器的临时 ECDHE 公钥" }));
  p = r.p;
  const a = r.u16();
  out.push({ name: "signature_algorithm", start: p, end: r.p, value: nameOr(sigSchemes, a) });
  out.push(vector(r, 2, "signature", (rr, e) => rr.hex(rr.p, e), { note: "签名覆盖 client_random ‖ server_random ‖ 上面的参数" }));
  return [{ name: "ServerECDHParams + 签名", start: s, end: r.p, go: S + "serverKeyExchangeMsg.key", children: out }];
}

function clientKeyExchange(r: Reader, end: number): Field[] {
  const n = end - r.p;
  if (n > 0 && r.b[r.p] === n - 1) {
    return [vector(r, 1, "ecdh_Yc", (rr, e) => rr.hex(rr.p, e), { go: S + "clientKeyExchangeMsg.ciphertext", rfc: [8422, "5.7"], note: "客户端的临时 ECDHE 公钥" })];
  }
  return [vector(r, 2, "EncryptedPreMasterSecret", (rr, e) => rr.hex(rr.p, e), { go: S + "clientKeyExchangeMsg.ciphertext", rfc: [5246, "7.4.7.1"], note: "用服务器 RSA 公钥加密的 48 字节预主密钥" })];
}

/** Dissects one handshake message, header included. */
export function dissect(data: Uint8Array, ctx: DissectCtx): Field[] {
  const r = new Reader(data);
  const out = header(r);
  const type = data[0];
  try {
    let body: Field[];
    switch (type) {
      case 1:
        body = clientHello(r, ctx);
        break;
      case 2:
        body = serverHello(r, ctx);
        break;
      case 4:
        body = newSessionTicket(r, ctx);
        break;
      case 8:
        body = [extensionsBlock(r, "ee", ctx)];
        break;
      case 11:
        body = ctx.version === 0x0304 ? certificate13(r, ctx) : certificate12(r, ctx);
        break;
      case 12:
        body = serverKeyExchange(r);
        break;
      case 14:
        body = [];
        break;
      case 15:
        body = certificateVerify(r);
        break;
      case 16:
        body = clientKeyExchange(r, data.length);
        break;
      case 20: {
        const s = r.p;
        r.p = data.length;
        body = [{ name: "verify_data", start: s, end: r.p, value: r.hex(s, r.p), go: S + "finishedMsg.verifyData", rfc: ctx.version === 0x0304 ? [8446, "4.4.4"] : [5246, "7.4.9"] }];
        break;
      }
      case 24: {
        const s = r.p;
        const v = r.u8();
        body = [{ name: "request_update", start: s, end: r.p, value: v ? "update_requested" : "update_not_requested", go: S + "keyUpdateMsg.updateRequested" }];
        break;
      }
      default:
        body = [{ name: "body", start: 4, end: data.length, value: hexOf(data, 4, data.length) }];
    }
    return [...out, ...body];
  } catch (e) {
    return [...out, { name: "解析失败", start: r.p, end: data.length, value: String(e) }];
  }
}

/** Fields of a record that is not a handshake message. */
export function dissectRecordPlain(inner: number, plain: Uint8Array): Field[] {
  if (inner === 21) {
    return [
      { name: "level", start: 0, end: 1, value: plain[0] === 1 ? "warning (1)" : "fatal (2)", rfc: [8446, "6"] },
      { name: "description", start: 1, end: 2, value: `${alertDescriptions[plain[1]] ?? plain[1]} (${plain[1]})` },
    ];
  }
  if (inner === 20) return [{ name: "change_cipher_spec", start: 0, end: plain.length, value: hexOf(plain, 0, plain.length) }];
  if (inner === 23) {
    const text = new TextDecoder().decode(plain);
    return [{ name: "application_data", start: 0, end: plain.length, value: text.length > 120 ? text.slice(0, 120) + "…" : text }];
  }
  return [{ name: contentTypes[inner] ?? "data", start: 0, end: plain.length }];
}

/** Flattens a tree into the deepest field covering each byte, for hex hover. */
export function leafAt(fields: Field[], offset: number): Field[] {
  for (const f of fields) {
    if (offset >= f.start && offset < f.end) {
      const deeper = f.children ? leafAt(f.children, offset) : [];
      return [f, ...deeper];
    }
  }
  return [];
}

export function fieldPath(path: Field[]): string {
  return path.map((f) => f.name).join(" › ");
}
