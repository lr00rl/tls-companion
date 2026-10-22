// One-time migration, kept for the record: it pulled the Chinese scenario and
// history copy out of 5a513cd, the last commit before the English edition, into
// src/i18n/zhContent.ts. That file is maintained by hand since then, so running
// this again overwrites later fixes to the Chinese text.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const FROM = "5a513cd";

function readString(text, i) {
  while (text[i] === " " || text[i] === "\n" || text[i] === "\r") i++;
  const q = text[i];
  if (q !== '"' && q !== "`") return null;
  i++;
  let out = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      const n = text[++i];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
      i++;
      continue;
    }
    if (c === q) return { value: out, end: i + 1 };
    out += c;
    i++;
  }
  return null;
}

function field(text, from, to, key) {
  const re = new RegExp(`\\b${key}\\s*:`, "g");
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m || m.index >= to) return "";
  const s = readString(text, m.index + m[0].length);
  return s && s.end <= to + 5 ? s.value : "";
}

function objectsIn(text, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    if (text[i] === "{") {
      let depth = 0;
      const start = i;
      for (; i < to; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          depth--;
          if (depth === 0) {
            out.push([start, i + 1]);
            i++;
            break;
          }
        } else if (text[i] === '"' || text[i] === "`") {
          const s = readString(text, i);
          if (s) i = s.end - 1;
        }
      }
    } else i++;
  }
  return out;
}

function noteAnchors(text, from, to) {
  const out = [];
  const re = /\bnote\s*:/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) && m.index < to) {
    const note = readString(text, m.index + m[0].length);
    if (!note || note.end > to) break;
    const rest = text.slice(note.end, to);
    const h = rest.match(/^\s*,\s*h\s*:/);
    if (h) {
      const hs = readString(text, note.end + h.index + h[0].length);
      if (hs) out.push(hs.value);
    }
    re.lastIndex = note.end;
  }
  return out;
}

function scenariosOf(text) {
  const out = {};
  const re = /\bid\s*:\s*"(tls[^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const id = m[1];
    const objs = objectsIn(text, m.index, text.length);
    // The scenario object is the one that contains this id and a steps array.
    // Walk back to the '{' that opened it: the nearest '{' before id at the export.
    let open = text.lastIndexOf("{", m.index);
    // step objects also contain no tls id. Scenario id is unique at the top.
    // Find the matching close from that open, but only if `steps` follows soon and short is before steps.
    // The export object starts just before `id`. Confirm `short` exists before the next `steps`.
    const stepsAt = text.indexOf("steps:", m.index);
    if (stepsAt < 0 || text.slice(m.index, stepsAt).includes("short:") === false) continue;
    const span = objectsIn(text, open, text.length)[0];
    if (!span) continue;
    const [a, b] = span;
    const steps = {};
    const stepObjs = objectsIn(text, stepsAt, b);
    for (const [s, e] of stepObjs) {
      const sid = field(text, s, e, "id");
      if (!sid || sid.startsWith("tls")) continue;
      steps[sid] = { title: field(text, s, e, "title"), body: field(text, s, e, "body"), h: noteAnchors(text, s, e) };
    }
    out[id] = { short: field(text, a, stepsAt, "short"), intro: field(text, a, stepsAt, "intro"), steps };
    re.lastIndex = b;
  }
  return out;
}

function historyOf(text) {
  const tracks = {
    proto: field(text, 0, text.length, "proto"),
    attack: field(text, 0, text.length, "attack"),
    go: field(text, text.indexOf("go:"), text.length, "go"),
  };
  // tracks.go is the third field. field() finds the first `go:` which might be inside an entry.
  const tracksBlock = text.slice(text.indexOf("export const tracks"), text.indexOf("export const entries"));
  tracks.proto = field(tracksBlock, 0, tracksBlock.length, "proto");
  tracks.attack = field(tracksBlock, 0, tracksBlock.length, "attack");
  tracks.go = field(tracksBlock, 0, tracksBlock.length, "go");

  const entries = {};
  const body = text.slice(text.indexOf("export const entries"));
  for (const [s, e] of objectsIn(body, 0, body.length)) {
    const id = field(body, s, e, "id");
    if (!id || id.includes(" ")) continue;
    const noteAt = body.slice(s, e).search(/\bnote\s*:/);
    let noteH = "";
    if (noteAt >= 0) {
      const abs = s + noteAt;
      const after = body.slice(abs, e);
      const mm = after.match(/\bnote\s*:\s*\[\s*"[^"]+"\s*,\s*"/);
      if (mm) {
        const hs = readString(body, abs + mm[0].length - 1);
        if (hs) noteH = hs.value;
      }
    }
    const labels = [];
    const codeAt = body.slice(s, e).search(/\bcode\s*:/);
    if (codeAt >= 0) {
      const region = body.slice(s + codeAt, e);
      const lr = /\blabel\s*:/g;
      let lm;
      while ((lm = lr.exec(region))) {
        const lab = readString(region, lm.index + lm[0].length);
        if (lab) labels.push(lab.value);
      }
    }
    entries[id] = {
      title: field(body, s, e, "title"),
      problem: field(body, s, e, "problem"),
      fix: field(body, s, e, "fix"),
      go: field(body, s, e, "go"),
      labels,
      noteH,
      hint: field(body, s, e, "hint"),
    };
  }
  return { tracks, entries };
}

const files = ["src/scenarios/tls13-full.ts", "src/scenarios/tls13-hrr.ts", "src/scenarios/tls13-resume.ts", "src/scenarios/tls12.ts"];
const zh = {};
for (const f of files) Object.assign(zh, scenariosOf(execSync(`git show ${FROM}:${f}`, { encoding: "utf8" })));
const hist = historyOf(execSync(`git show ${FROM}:src/history/entries.ts`, { encoding: "utf8" }));

writeFileSync(
  new URL("../src/i18n/zhContent.ts", import.meta.url),
  `// Chinese copy of the scenarios and the history timeline. English lives in
// the scenario and history modules. Taken from the text before this branch
// was translated.
export const zhScenarios = ${JSON.stringify(zh, null, 2)} as const;

export const zhHistory = ${JSON.stringify(hist, null, 2)} as const;
`,
);
for (const [id, s] of Object.entries(zh)) console.log(id, "steps", Object.keys(s.steps).length, "short", s.short.slice(0, 24));
console.log("history", Object.keys(hist.entries).length, hist.tracks);
