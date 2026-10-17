// A small DER walker that labels the parts of an X.509 certificate, enough to
// line bytes in the hex view up with RFC 5280 field names.
import type { Field } from "./dissect";

const oids: Record<string, string> = {
  "1.2.840.10045.2.1": "ecPublicKey",
  "1.2.840.10045.3.1.7": "prime256v1 (P-256)",
  "1.3.132.0.34": "secp384r1 (P-384)",
  "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
  "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.113549.1.1.1": "rsaEncryption",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.3.101.112": "Ed25519",
  "2.5.4.3": "commonName",
  "2.5.4.6": "countryName",
  "2.5.4.7": "localityName",
  "2.5.4.8": "stateOrProvinceName",
  "2.5.4.10": "organizationName",
  "2.5.4.11": "organizationalUnitName",
  "2.5.29.14": "subjectKeyIdentifier",
  "2.5.29.15": "keyUsage",
  "2.5.29.17": "subjectAltName",
  "2.5.29.19": "basicConstraints",
  "2.5.29.31": "cRLDistributionPoints",
  "2.5.29.32": "certificatePolicies",
  "2.5.29.35": "authorityKeyIdentifier",
  "2.5.29.37": "extKeyUsage",
  "1.3.6.1.5.5.7.1.1": "authorityInfoAccess",
  "1.3.6.1.4.1.11129.2.4.2": "SCT list",
  "1.3.6.1.5.5.7.3.1": "serverAuth",
  "1.3.6.1.5.5.7.3.2": "clientAuth",
};

interface TLV {
  tag: number;
  start: number;
  hdr: number;
  len: number;
  end: number;
}

function tlv(b: Uint8Array, p: number): TLV {
  const tag = b[p];
  let len = b[p + 1];
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | b[p + 2 + i];
    hdr += n;
  }
  return { tag, start: p, hdr, len, end: p + hdr + len };
}

function children(b: Uint8Array, t: TLV): TLV[] {
  const out: TLV[] = [];
  for (let p = t.start + t.hdr; p < t.end; ) {
    const c = tlv(b, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

function oid(b: Uint8Array, t: TLV): string {
  const v = b.subarray(t.start + t.hdr, t.end);
  const parts = [Math.floor(v[0] / 40), v[0] % 40];
  let n = 0;
  for (let i = 1; i < v.length; i++) {
    n = n * 128 + (v[i] & 0x7f);
    if (!(v[i] & 0x80)) {
      parts.push(n);
      n = 0;
    }
  }
  return parts.join(".");
}

function text(b: Uint8Array, t: TLV): string {
  return new TextDecoder().decode(b.subarray(t.start + t.hdr, t.end));
}

function hex(b: Uint8Array, t: TLV, max = 24): string {
  const v = b.subarray(t.start + t.hdr, t.end);
  const s = [...v.subarray(0, max)].map((x) => x.toString(16).padStart(2, "0")).join("");
  return v.length > max ? `${s}… (${v.length} 字节)` : s;
}

function time(b: Uint8Array, t: TLV): string {
  const s = text(b, t);
  const m = s.match(/^(\d{2,4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return s;
  const y = m[1].length === 2 ? (+m[1] < 50 ? "20" : "19") + m[1] : m[1];
  return `${y}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]} UTC`;
}

function name(b: Uint8Array, t: TLV, base: number): Field {
  const f = node("Name", b, t, base);
  const parts: string[] = [];
  f.children = children(b, t).map((set) => {
    const atv = children(b, set)[0];
    const [o, v] = children(b, atv);
    const label = oids[oid(b, o)] ?? oid(b, o);
    parts.push(`${label === "commonName" ? "CN" : label === "organizationName" ? "O" : label}=${text(b, v)}`);
    return { ...node(label, b, set, base), value: text(b, v) };
  });
  f.value = parts.join(", ");
  return f;
}

function node(nameStr: string, _b: Uint8Array, t: TLV, base: number): Field {
  return { name: nameStr, start: base + t.start, end: base + t.end };
}

function algorithm(b: Uint8Array, t: TLV, base: number, label: string): Field {
  const [o, param] = children(b, t);
  const f = node(label, b, t, base);
  f.value = oids[oid(b, o)] ?? oid(b, o);
  if (param && param.tag === 0x06) f.value += ` · ${oids[oid(b, param)] ?? oid(b, param)}`;
  return f;
}

function extension(b: Uint8Array, t: TLV, base: number): Field {
  const parts = children(b, t);
  const id = oid(b, parts[0]);
  const critical = parts.length === 3 && parts[1].tag === 0x01 && b[parts[1].start + parts[1].hdr] !== 0;
  const f = node(oids[id] ?? id, b, t, base);
  const value = parts[parts.length - 1];
  const inner = value.start + value.hdr;
  if (id === "2.5.29.17") {
    const seq = tlv(b, inner);
    f.value = children(b, seq)
      .filter((c) => c.tag === 0x82)
      .map((c) => text(b, c))
      .join(", ");
  } else if (id === "2.5.29.19") {
    const seq = tlv(b, inner);
    const cs = children(b, seq);
    f.value = cs.length && cs[0].tag === 0x01 && b[cs[0].start + cs[0].hdr] ? "CA: true" : "CA: false";
  } else if (id === "2.5.29.37") {
    f.value = children(b, tlv(b, inner))
      .map((c) => oids[oid(b, c)] ?? oid(b, c))
      .join(", ");
  } else {
    f.value = hex(b, value, 12);
  }
  if (critical) f.value = `critical · ${f.value}`;
  return f;
}

/** Labels an X.509 certificate's DER, with offsets shifted by base. */
export function dissectCertificate(b: Uint8Array, base: number): Field[] {
  try {
    const cert = tlv(b, 0);
    const [tbs, sigAlg, sig] = children(b, cert);
    const parts = children(b, tbs);
    let i = 0;
    const tbsChildren: Field[] = [];
    if (parts[0].tag === 0xa0) {
      const v = children(b, parts[0])[0];
      tbsChildren.push({ ...node("version", b, parts[0], base), value: `v${b[v.start + v.hdr] + 1}`, go: "crypto/x509.Certificate.Version" });
      i++;
    }
    tbsChildren.push({ ...node("serialNumber", b, parts[i], base), value: hex(b, parts[i]), go: "crypto/x509.Certificate.SerialNumber" });
    tbsChildren.push({ ...algorithm(b, parts[i + 1], base, "signature"), go: "crypto/x509.Certificate.SignatureAlgorithm" });
    tbsChildren.push({ ...name(b, parts[i + 2], base), name: "issuer", go: "crypto/x509.Certificate.Issuer" });
    const [nb, na] = children(b, parts[i + 3]);
    tbsChildren.push({
      ...node("validity", b, parts[i + 3], base),
      value: `${time(b, nb)} → ${time(b, na)}`,
      children: [
        { ...node("notBefore", b, nb, base), value: time(b, nb), go: "crypto/x509.Certificate.NotBefore" },
        { ...node("notAfter", b, na, base), value: time(b, na), go: "crypto/x509.Certificate.NotAfter" },
      ],
    });
    tbsChildren.push({ ...name(b, parts[i + 4], base), name: "subject", go: "crypto/x509.Certificate.Subject" });
    const [alg, key] = children(b, parts[i + 5]);
    tbsChildren.push({
      ...node("subjectPublicKeyInfo", b, parts[i + 5], base),
      go: "crypto/x509.Certificate.PublicKey",
      children: [algorithm(b, alg, base, "algorithm"), { ...node("subjectPublicKey", b, key, base), value: hex(b, key, 16) }],
    });
    for (const rest of parts.slice(i + 6)) {
      if (rest.tag === 0xa3) {
        const seq = children(b, rest)[0];
        tbsChildren.push({
          ...node("extensions", b, rest, base),
          go: "crypto/x509.Certificate.Extensions",
          rfc: [5280, "4.2"],
          children: children(b, seq).map((e) => extension(b, e, base)),
        });
      }
    }
    return [
      { ...node("tbsCertificate", b, tbs, base), rfc: [5280, "4.1"], children: tbsChildren },
      { ...algorithm(b, sigAlg, base, "signatureAlgorithm"), rfc: [5280, "4.1.1.2"] },
      { ...node("signatureValue", b, sig, base), value: hex(b, sig, 16), rfc: [5280, "4.1.1.3"] },
    ];
  } catch {
    return [];
  }
}
