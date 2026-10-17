// Copies the TLS notes from the Obsidian vault into content/notes, which is the
// copy the site builds from. Set TLS_NOTES_DIR to sync from somewhere else.
import { cpSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const src =
  process.env.TLS_NOTES_DIR ??
  join(homedir(), "roobli/Nut/RooB/A000_Theoretical_Knowledge/A406_Network/tls");
const dst = new URL("../content/notes/", import.meta.url).pathname;

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith(".md")) {
    cpSync(join(src, f), join(dst, f));
    n++;
  }
}
console.log(`synced ${n} notes from ${src}`);
