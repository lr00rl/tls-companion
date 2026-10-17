// Turns the plain-text RFCs in content/rfc into JSON the RFC viewer reads:
// page headers and footers removed, the title and date pulled out, and an index
// of numbered sections pointing at their line.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const src = new URL("../content/rfc/", import.meta.url).pathname;
const out = new URL("../public/data/rfc/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const months = "January|February|March|April|May|June|July|August|September|October|November|December";
const footer = /\[Page \d+\]\s*$/;
const header = new RegExp(`^RFC \\d+\\s.*\\b(${months}) \\d{4}\\s*$`);
const numbered = /^(\d+(?:\.\d+)*)\.?\s{1,4}([A-Za-z(].*?)\s*$/;
const appendix = /^Appendix ([A-Z])\.?\s+(.+?)\s*$/;
const appendixSub = /^([A-Z](?:\.\d+)+)\.?\s{1,4}([A-Za-z(].*?)\s*$/;

export function unpaginate(text) {
  const raw = text.replace(/\r/g, "").split("\n");
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    if (footer.test(line)) {
      // Drop the footer, the form feed, the next header, and the blank lines
      // around them, keeping one blank line only at paragraph ends.
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      let j = i + 1;
      const blank = () => {
        while (j < raw.length && raw[j].replace(/\f/g, "").trim() === "") j++;
      };
      blank();
      if (j < raw.length) raw[j] = raw[j].replace(/^\f/, "");
      if (j < raw.length && header.test(raw[j])) j++;
      blank();
      const prev = lines[lines.length - 1] ?? "";
      const next = raw[j] ?? "";
      const continues =
        prev.trim() !== "" &&
        !/[.:]$/.test(prev.trim()) &&
        indent(prev) === indent(next) &&
        !numbered.test(next) &&
        !appendix.test(next);
      if (!continues) lines.push("");
      i = j - 1;
      continue;
    }
    line = line.replace(/^\f/, "").replace(/\s+$/, "");
    lines.push(line);
  }
  // Collapse runs of blank lines.
  const outLines = [];
  for (const l of lines) {
    if (l === "" && outLines[outLines.length - 1] === "") continue;
    outLines.push(l);
  }
  while (outLines[0] === "") outLines.shift();
  return outLines;
}

function indent(s) {
  return s.length - s.trimStart().length;
}

function parse(n, text) {
  const lines = unpaginate(text);
  // The title is the block of lines right above "Status of This Memo" or
  // "Abstract", whichever comes first.
  const memoAt = lines.findIndex((l) => /^(Status of [Tt]his Memo|Abstract)$/.test(l));
  const titleLines = [];
  let i = memoAt - 1;
  while (i > 0 && lines[i] === "") i--;
  while (i > 0 && lines[i] !== "") titleLines.unshift(lines[i--].trim());
  const head = lines.slice(0, Math.max(memoAt, 0)).join("\n");
  const date = head.match(new RegExp(`\\b(${months}) (\\d{4})\\b`));
  const obsoletes = head.match(/Obsoletes: ([\d, ]+)/);
  const updates = head.match(/Updates: ([\d, ]+)/);
  const sections = [];
  let inToc = false;
  lines.forEach((l, i) => {
    if (l === "Table of Contents") inToc = true;
    if (inToc && /^1\.\s/.test(l)) inToc = false;
    if (inToc || l.startsWith(" ")) return;
    let m = l.match(appendix);
    if (m) return sections.push({ id: m[1], title: m[2], line: i, level: 1 });
    m = l.match(appendixSub) ?? l.match(numbered);
    if (m && m[2].length < 90) {
      sections.push({ id: m[1], title: m[2], line: i, level: m[1].split(".").length });
    }
  });
  return {
    n,
    title: titleLines.join(" "),
    date: date ? `${date[1]} ${date[2]}` : "",
    obsoletes: obsoletes ? obsoletes[1].split(",").map((s) => +s.trim()).filter(Boolean) : [],
    updates: updates ? updates[1].split(",").map((s) => +s.trim()).filter(Boolean) : [],
    sections,
    lines,
  };
}

const index = [];
for (const f of readdirSync(src).sort()) {
  const m = f.match(/^rfc(\d+)\.txt$/);
  if (!m) continue;
  const doc = parse(+m[1], readFileSync(src + f, "utf8"));
  writeFileSync(`${out}rfc${doc.n}.json`, JSON.stringify(doc));
  index.push({ n: doc.n, title: doc.title, date: doc.date, obsoletes: doc.obsoletes, updates: doc.updates, sections: doc.sections.map(({ id, title, level }) => ({ id, title, level })) });
}
index.sort((a, b) => a.n - b.n);
writeFileSync(`${out}index.json`, JSON.stringify(index));
console.log(`built ${index.length} RFCs`);
