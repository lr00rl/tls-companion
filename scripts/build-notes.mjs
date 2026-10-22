// Renders the Markdown notes in content/notes-en and content/notes to JSON:
// HTML with heading anchors, Obsidian wikilinks resolved to site routes,
// mermaid blocks left for the browser to draw, and per-section plain text for
// search.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import MarkdownIt from "markdown-it";

const idOf = (name) => name.replace(/\.md$/, "").split("_")[0];

// slug turns a heading into the anchor Obsidian would link to: the text with
// spaces as hyphens and most punctuation dropped.
export function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/[^\p{L}\p{N}\-.]/gu, "")
    .replace(/-+/g, "-");
}

function resolveWiki(target, byStem, ids) {
  const [stem, heading] = target.split("#");
  if (!stem) return heading ? `#anchor:${slug(heading)}` : null;
  const base = stem.split("/").pop();
  const legacyId = base?.match(/^(?:00|T\d{2})(?=_|$)/)?.[0];
  const id = byStem.get(base) ?? byStem.get(stem) ?? (legacyId && ids.has(legacyId) ? legacyId : null);
  if (!id) return null;
  return `#/notes/${id}${heading ? "/" + encodeURIComponent(slug(heading)) : ""}`;
}

function makeMd(byStem, ids, lang) {
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true });

md.renderer.rules.fence = (tokens, i) => {
  const t = tokens[i];
  const lang = t.info.trim().split(/\s+/)[0];
  const code = md.utils.escapeHtml(t.content);
  if (lang === "mermaid") return `<pre class="mermaid">${code}</pre>\n`;
  return `<pre class="code"${lang ? ` data-lang="${md.utils.escapeHtml(lang)}"` : ""}><code>${code}</code></pre>\n`;
};

const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const t = tokens[i];
  const href = t.attrGet("href") ?? "";
  if (href.startsWith("wiki:")) {
    const route = resolveWiki(decodeURIComponent(href.slice(5)), byStem, ids);
    if (route) {
      t.attrSet("href", route.startsWith("#anchor:") ? `#/notes/${env.id}/${encodeURIComponent(route.slice(8))}` : route);
    } else {
      t.attrSet("href", "#");
      t.attrSet("class", "wiki-missing");
      t.attrSet("title", lang === "zh" ? "这篇笔记在原始笔记库的其它目录里，没有收录到本站" : "This note is in another folder of the original vault and is not included here");
    }
  } else if (/^https?:/.test(href)) {
    t.attrSet("target", "_blank");
    t.attrSet("rel", "noopener");
  }
  return defaultLink(tokens, i, opts, env, self);
};

// Turn "RFC 8446 §4.1.3" and "RFC 8446 Appendix D.4" in prose into links the
// reader opens in its RFC drawer.
const rfcMention = /RFC ?(\d{3,5})(?:\s*(?:§\s*|附录\s*|Appendix\s*|Section\s+)([A-Z](?:\.\d+)*|\d+(?:\.\d+)*))?/g;
md.core.ruler.push("rfc_links", (state) => {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out = [];
    let inLink = 0;
    for (const t of block.children) {
      if (t.type === "link_open") inLink++;
      if (t.type === "link_close") inLink--;
      if (t.type !== "text" || inLink || !rfcMention.test(t.content)) {
        out.push(t);
        continue;
      }
      rfcMention.lastIndex = 0;
      let last = 0;
      for (const m of t.content.matchAll(rfcMention)) {
        if (m.index > last) {
          const tt = new state.Token("text", "", 0);
          tt.content = t.content.slice(last, m.index);
          out.push(tt);
        }
        const h = new state.Token("html_inline", "", 0);
        const sec = m[2] ? `/${m[2]}` : "";
        h.content = `<a class="rfc-ref" href="#/rfc/${m[1]}${sec}" data-rfc="${m[1]}"${m[2] ? ` data-sec="${m[2]}"` : ""}>${md.utils.escapeHtml(m[0])}</a>`;
        out.push(h);
        last = m.index + m[0].length;
      }
      if (last < t.content.length) {
        const tt = new state.Token("text", "", 0);
        tt.content = t.content.slice(last);
        out.push(tt);
      }
    }
    block.children = out;
  }
});

md.renderer.rules.heading_open = (tokens, i, opts, env, self) => {
  const inline = tokens[i + 1];
  const text = inline.children.filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("");
  let id = slug(text);
  let n = 2;
  while (env.ids.has(id)) id = `${slug(text)}-${n++}`;
  env.ids.add(id);
  tokens[i].attrSet("id", id);
  env.headings.push({ level: +tokens[i].tag.slice(1), text, anchor: id });
  return self.renderToken(tokens, i, opts);
};

  return md;
}

function preprocess(text, lang) {
  return (
    text
      // Front matter.
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      // Generated index markers.
      .replace(/<!--[\s\S]*?-->/g, "")
      // [[target|text]] (with the pipe escaped inside tables) and [[target]].
      .replace(/\[\[([^\]|\\]+)(?:\\?\|([^\]]+))?\]\]/g, (_, target, label) => {
        const text = label ?? target.split("#").pop();
        return `[${text.replace(/([[\]])/g, "\\$1")}](wiki:${encodeURIComponent(target.trim())})`;
      })
      // The old standalone companion page is this site now.
      .replace(/`html\/index\.html`/g, lang === "zh" ? "[本站工作台](#/play)" : "[the workbench](#/play)")
  );
}

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    fm[kv[1]] = kv[2].startsWith("[") ? kv[2].slice(1, -1).split(",").map((s) => s.trim()) : kv[2];
  }
  return fm;
}

// sections splits rendered tokens into heading-delimited plain text for search.
function sections(tokens, headings) {
  const out = [];
  let cur = { anchor: "", heading: "", text: "" };
  let h = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "heading_open") {
      if (cur.text.trim()) out.push(cur);
      const hd = headings[h++];
      cur = { anchor: hd.anchor, heading: hd.text, text: "" };
      i++;
      continue;
    }
    if (t.type === "inline") cur.text += t.children.map((c) => c.content).join("") + " ";
    if (t.type === "fence" && !t.info.startsWith("mermaid")) cur.text += t.content.slice(0, 400) + " ";
  }
  if (cur.text.trim()) out.push(cur);
  return out.map((s) => ({ ...s, text: s.text.replace(/\s+/g, " ").trim() }));
}

function build(srcDir, outDir, lang) {
  const src = new URL(srcDir, import.meta.url).pathname;
  const out = new URL(outDir, import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  const files = readdirSync(src).filter((f) => f.endsWith(".md")).sort();
  const byStem = new Map(files.map((f) => [f.replace(/\.md$/, ""), idOf(f)]));
  const ids = new Set(byStem.values());
  const md = makeMd(byStem, ids, lang);
  const index = [];
  for (const f of files) {
    const raw = readFileSync(src + f, "utf8");
    const id = idOf(f);
    const fm = frontMatter(raw);
    const env = { id, ids: new Set(), headings: [] };
    const tokens = md.parse(preprocess(raw, lang), env);
    let html = md.renderer.render(tokens, md.options, env);
    const h1 = env.headings.find((h) => h.level === 1);
    html = html.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n/, "");
    const headings = env.headings.filter((h) => h.level > 1);
    const doc = {
      id,
      file: f,
      title: h1 ? h1.text : f,
      tags: fm.tags ?? [],
      type: fm.type ?? "",
      headings,
      html,
      search: sections(tokens, env.headings),
      mermaid: (html.match(/<pre class="mermaid">/g) ?? []).length,
    };
    writeFileSync(`${out}${id}.json`, JSON.stringify(doc));
    index.push({ id, file: f, title: doc.title, tags: doc.tags, headings, chars: raw.length });
  }
  writeFileSync(`${out}index.json`, JSON.stringify(index));
  console.log(`built ${index.length} ${lang} notes`);
}

// English is the default the site loads. Chinese is the other edition.
build("../content/notes-en/", "../public/data/notes/", "en");
build("../content/notes/", "../public/data/notes/zh/", "zh");
