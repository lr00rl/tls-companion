// Copies the TLS notes from the Obsidian vault into content/notes, which is the
// copy the site builds from. Set TLS_NOTES_DIR to sync from somewhere else.
import { cpSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const src =
  process.env.TLS_NOTES_DIR ??
  join(homedir(), "roobli/Nut/RooB/A000_Theoretical_Knowledge/A406_Network/tls");
const dst = new URL("../content/notes/", import.meta.url).pathname;
const filenames = {
  "00": "00_tls-series-overview.md",
  T01: "T01_http-to-https-request-lifecycle.md",
  T02: "T02_cryptography-foundations-for-tls.md",
  T03: "T03_certificates-and-pki.md",
  T04: "T04_ssl-to-tls13-evolution-and-attacks.md",
  T05: "T05_tcp-and-tls12-handshake.md",
  T06: "T06_tls13-handshake-and-key-schedule.md",
  T07: "T07_session-resumption-0-rtt-and-performance.md",
  T08: "T08_ech-and-https-record-privacy.md",
  T09: "T09_quic-and-http3.md",
  T10: "T10_post-quantum-tls.md",
  T11: "T11_tls-engineering-practices.md",
  T12: "T12_https-adoption-and-trust-governance.md",
  T13: "T13_observing-tls-with-openssl-and-curl.md",
  T99: "T99_glossary-and-standards-index.md",
};

const sources = new Map();
for (const f of readdirSync(src)) {
  if (f.endsWith(".md")) {
    const id = f.replace(/\.md$/, "").split("_")[0];
    if (!filenames[id]) throw new Error(`no canonical filename for ${f}`);
    if (sources.has(id)) throw new Error(`duplicate note id ${id} in ${src}`);
    sources.set(id, f);
  }
}
const missing = Object.keys(filenames).filter((id) => !sources.has(id));
if (missing.length) throw new Error(`missing notes in ${src}: ${missing.join(", ")}`);

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const [id, f] of sources) cpSync(join(src, f), join(dst, filenames[id]));
console.log(`synced ${sources.size} notes from ${src}`);
