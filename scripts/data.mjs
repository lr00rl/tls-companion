// Regenerates the code index and the handshake captures from the Go toolchain
// on PATH. `node scripts/data.mjs [code|captures]` runs one half.
import { execFileSync } from "node:child_process";

const tools = new URL("../tools/", import.meta.url).pathname;
const what = process.argv[2] ?? "all";
const go = (...args) => execFileSync("go", args, { cwd: tools, stdio: "inherit" });

if (what === "all" || what === "code") {
  go("run", "./cmd/tlsindex", "-out", "../public/data/code");
}
if (what === "all" || what === "captures") {
  go("run", "./cmd/tlsinstrument", "-out", "../build/overlay");
  go("run", "-tags", "tlstrace", "-overlay", "../build/overlay/overlay.json", "./cmd/tlscapture", "-out", "../public/data/captures");
}
