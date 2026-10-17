// Downloads the plain-text RFCs the workbench links to into content/rfc. RFC
// text never changes once published, so the files are committed and this only
// needs to run when the list grows.
import { existsSync, writeFileSync } from "node:fs";

export const RFCS = [
  6101, 2246, 4346, 5246, 8446, 9846, 8996, 7457, // versions and their history
  4492, 8422, 7627, 5746, 5077, 6066, 7301, 8701, 7685, 8879, 8470, 5705, 7919, 7918, 7507, // TLS extensions and fixes
  5869, 2104, 5116, 8439, 7748, 8032, 9180, // primitives
  5280, 6962, 9525, // PKI
  9000, 9001, // QUIC
  9849, 9460, // ECH and HTTPS records
  10024, // hybrid post-quantum key exchange
  9325, 6797, // deployment
];

const dir = new URL("../content/rfc/", import.meta.url).pathname;
for (const n of RFCS) {
  const path = `${dir}rfc${n}.txt`;
  if (existsSync(path)) continue;
  const res = await fetch(`https://www.rfc-editor.org/rfc/rfc${n}.txt`);
  if (!res.ok) {
    console.warn(`rfc${n}: HTTP ${res.status}, skipped`);
    continue;
  }
  writeFileSync(path, await res.text());
  console.log(`rfc${n}: fetched`);
}
