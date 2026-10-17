// The dissector must account for every byte of every recorded message and must
// not hit its error path on anything crypto/tls actually sends.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dissect, type Field } from "../src/capture/dissect";
import { buildModel, hexBytes, messageName } from "../src/capture/model";
import type { Capture } from "../src/data/types";
import { scenarioDefs } from "../src/scenarios";

const data = new URL("../public/data/captures/", import.meta.url).pathname;

function walk(fs: Field[], fn: (f: Field) => void) {
  for (const f of fs) {
    fn(f);
    if (f.children) walk(f.children, fn);
  }
}

for (const def of scenarioDefs) {
  const cap = JSON.parse(readFileSync(`${data}${def.id}.json`, "utf8")) as Capture;
  const model = buildModel(cap);
  describe(def.id, () => {
    cap.messages.forEach((m, i) => {
      it(`message ${i} ${messageName(m)} dissects cleanly`, () => {
        const bytes = hexBytes(m.data);
        const fields = dissect(bytes, { version: model.version, certs: cap.certs });
        let failed = false;
        walk(fields, (f) => {
          if (f.name === "解析失败") failed = true;
          expect(f.start).toBeLessThanOrEqual(f.end);
          expect(f.end).toBeLessThanOrEqual(bytes.length);
        });
        expect(failed).toBe(false);
        expect(fields[fields.length - 1].end).toBe(bytes.length);
      });
    });
  });
}

it("labels the TLS 1.2 downgrade sentinel and the hybrid key share", () => {
  const cap = JSON.parse(readFileSync(`${data}tls12-ecdhe.json`, "utf8")) as Capture;
  const sh = dissect(hexBytes(cap.messages[1].data), { version: 0x0303 });
  const random = sh.find((f) => f.name === "random")!;
  expect(random.children?.[1].name).toBe("降级哨兵");
  const full = JSON.parse(readFileSync(`${data}tls13-full.json`, "utf8")) as Capture;
  const ch = dissect(hexBytes(full.messages[0].data), { version: 0x0304 });
  const names: string[] = [];
  walk(ch, (f) => names.push(f.name));
  expect(names).toContain("ML-KEM-768 封装密钥");
  const cert = dissect(hexBytes(full.messages.find((m) => m.type === 11)!.data), { version: 0x0304, certs: full.certs });
  const entries: Field[] = [];
  walk(cert, (f) => f.cert !== undefined && f.name === "cert_data" && entries.push(f));
  expect(entries.map((e) => e.cert)).toEqual([0, 1]);
});
