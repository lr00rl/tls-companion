import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const noteData = join(root, "public/data/notes");
const origin = "https://lr00rl.github.io";
const basePath = "/tls-companion/";
const siteUrl = origin + basePath;
const socialImage = siteUrl + "og-card.png";
const repositoryUrl = "https://github.com/lr00rl/tls-companion";

const notesLicenseUrl = "https://creativecommons.org/licenses/by-nc-sa/4.0/";

const languages = [
  {
    key: "en",
    code: "en",
    htmlLang: "en",
    locale: "en_US",
    label: "English",
    directory: noteData,
    collectionTitle: "TLS Companion Notes",
    collectionDescription: "A packet-by-packet guide to TLS, HTTPS, PKI, QUIC, ECH, post-quantum key exchange, and the Go crypto/tls implementation.",
    openApp: "Open this note in the interactive workbench",
    openWorkbench: "Open the interactive workbench",
    allNotes: "All notes",
    previous: "Previous",
    next: "Next",
    diagramSource: "Mermaid diagram source",
    skipContent: "Skip to content",
    notesLicense: "Notes licensed CC BY-NC-SA 4.0",
  },
  {
    key: "zh",
    code: "zh-Hans",
    htmlLang: "zh-CN",
    locale: "zh_CN",
    label: "简体中文",
    directory: join(noteData, "zh"),
    collectionTitle: "TLS Companion 中文笔记",
    collectionDescription: "逐包理解 TLS、HTTPS、PKI、QUIC、ECH、后量子密钥交换与 Go crypto/tls 实现。",
    openApp: "在交互式工作台中打开这篇笔记",
    openWorkbench: "打开交互式工作台",
    allNotes: "全部笔记",
    previous: "上一篇",
    next: "下一篇",
    diagramSource: "Mermaid 图表源码",
    skipContent: "跳到主要内容",
    notesLicense: "笔记采用 CC BY-NC-SA 4.0 许可",
  },
];

function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function footerHTML(language) {
  return `<footer><a href="${repositoryUrl}">Source on GitHub</a> · <a href="${notesLicenseUrl}" rel="license">${escapeHTML(language.notesLicense)}</a></footer>`;
}

function escapeXML(value) {
  return escapeHTML(value);
}

function escapeJSON(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function truncate(text, max = 158) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1).replace(/\s+\S*$/, "");
  return `${cut || clean.slice(0, max - 1)}…`;
}

function textContent(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function leadOf(note) {
  const paragraphs = [...note.html.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((match) => textContent(match[1]))
    .filter((text) => text.length >= 80 && !/^(?:Series:|系列：)/.test(text));
  return paragraphs[0] ?? textContent(note.html) ?? note.title;
}

function descriptionOf(note) {
  return truncate(leadOf(note));
}

function displayLeadOf(note) {
  const lead = leadOf(note);
  const sentences = lead.match(/[^.!?。！？]+[.!?。！？]+/g) ?? [];
  let result = "";
  for (const sentence of sentences) {
    if (result && result.length + sentence.length > 320) break;
    result += sentence;
    if (result.length >= 120) break;
  }
  return result.trim() || truncate(lead, 300);
}

function noteUrl(language, id) {
  return `${siteUrl}learn/${language.key}/${id}/`;
}

function collectionUrl(language) {
  return `${siteUrl}learn/${language.key}/`;
}

function alternateLinks(id) {
  const en = noteUrl(languages[0], id);
  const zh = noteUrl(languages[1], id);
  return [
    `<link rel="alternate" hreflang="en" href="${en}" />`,
    `<link rel="alternate" hreflang="zh-Hans" href="${zh}" />`,
    `<link rel="alternate" hreflang="x-default" href="${en}" />`,
  ].join("\n    ");
}

function collectionAlternates() {
  const en = collectionUrl(languages[0]);
  const zh = collectionUrl(languages[1]);
  return [
    `<link rel="alternate" hreflang="en" href="${en}" />`,
    `<link rel="alternate" hreflang="zh-Hans" href="${zh}" />`,
    `<link rel="alternate" hreflang="x-default" href="${en}" />`,
  ].join("\n    ");
}

function head({ title, description, canonical, language, type = "website", alternates = "", structuredData }) {
  return `<!doctype html>
<html lang="${language.htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHTML(title)}</title>
    <meta name="description" content="${escapeHTML(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <meta name="theme-color" content="#f8f9fb" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#16181d" media="(prefers-color-scheme: dark)" />
    <link rel="canonical" href="${canonical}" />
    ${alternates}
    <link rel="icon" type="image/svg+xml" href="${basePath}favicon.svg" />
    <link rel="stylesheet" href="${basePath}learn/seo.css" />
    <meta property="og:title" content="${escapeHTML(title)}" />
    <meta property="og:description" content="${escapeHTML(description)}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="TLS Companion" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="TLS Companion protocol workbench" />
    <meta property="og:locale" content="${language.locale}" />
    <meta property="og:locale:alternate" content="${language === languages[0] ? languages[1].locale : languages[0].locale}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHTML(title)}" />
    <meta name="twitter:description" content="${escapeHTML(description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <meta name="twitter:image:alt" content="TLS Companion protocol workbench" />
    <script type="application/ld+json">${escapeJSON(structuredData)}</script>
  </head>`;
}

function rewriteNoteLinks(html, language) {
  return html
    .replace(/href="#\/notes\/([^/"?#]+)(?:\/([^"?#]+))?"/g, (_match, id, anchor) => `href="${basePath}learn/${language.key}/${id}/${anchor ? `#${anchor}` : ""}"`)
    .replace(/href="#\//g, `href="${basePath}#/`);
}

function write(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function articlePage(language, note, index, position) {
  const canonical = noteUrl(language, note.id);
  const description = descriptionOf(note);
  const lead = displayLeadOf(note);
  const otherLanguage = language === languages[0] ? languages[1] : languages[0];
  const previous = index[position - 1];
  const next = index[position + 1];
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: note.title,
    description,
    inLanguage: language.code,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    isPartOf: { "@type": "CreativeWorkSeries", name: "TLS Companion", url: siteUrl },
    image: socialImage,
    keywords: note.tags,
  };
  const body = rewriteNoteLinks(note.html, language).replace(/<pre class="mermaid">([\s\S]*?)<\/pre>/g, `<details class="diagram"><summary>${language.diagramSource}</summary><pre class="mermaid">$1</pre></details>`);
  const navLink = (entry, label) => entry ? `<a href="${basePath}learn/${language.key}/${entry.id}/"><small>${label}</small>${escapeHTML(entry.title)}</a>` : "<span></span>";
  return `${head({ title: `${note.title} · TLS Companion`, description, canonical, language, type: "article", alternates: alternateLinks(note.id), structuredData })}
  <body>
    <a class="skip-link" href="#content">${language.skipContent}</a>
    <header class="site-head">
      <a class="brand" href="${basePath}" translate="no"><span class="mark"><i></i><i></i><i></i></span>TLS Companion</a>
      <nav aria-label="Language"><a href="${noteUrl(otherLanguage, note.id)}" hreflang="${otherLanguage.code}">${otherLanguage.label}</a></nav>
    </header>
    <main id="content" tabindex="-1">
      <article>
        <p class="eyebrow">${escapeHTML(note.id)} · ${escapeHTML(language.label)}</p>
        <h1>${escapeHTML(note.title)}</h1>
        <p class="lede">${escapeHTML(lead)}</p>
        <p class="actions"><a class="primary" href="${basePath}#/notes/${note.id}">${escapeHTML(language.openApp)}</a><a href="${collectionUrl(language)}">${escapeHTML(language.allNotes)}</a></p>
        <div class="tags">${note.tags.map((tag) => `<span>#${escapeHTML(tag)}</span>`).join("")}</div>
        <div class="prose">${body}</div>
        <nav class="note-nav" aria-label="Adjacent notes">${navLink(previous, language.previous)}${navLink(next, language.next)}</nav>
      </article>
    </main>
    ${footerHTML(language)}
  </body>
</html>`;
}

function collectionPage(language, index, documents) {
  const canonical = collectionUrl(language);
  const otherLanguage = language === languages[0] ? languages[1] : languages[0];
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: language.collectionTitle,
    description: language.collectionDescription,
    inLanguage: language.code,
    url: canonical,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: index.map((note, position) => ({ "@type": "ListItem", position: position + 1, name: note.title, url: noteUrl(language, note.id) })),
    },
  };
  const cards = index.map((entry) => {
    const note = documents.get(entry.id);
    return `<li><a href="${basePath}learn/${language.key}/${entry.id}/"><span>${escapeHTML(entry.id)}</span><strong>${escapeHTML(entry.title)}</strong><p>${escapeHTML(descriptionOf(note))}</p></a></li>`;
  }).join("\n");
  return `${head({ title: language.collectionTitle, description: language.collectionDescription, canonical, language, alternates: collectionAlternates(), structuredData })}
  <body>
    <a class="skip-link" href="#content">${language.skipContent}</a>
    <header class="site-head"><a class="brand" href="${basePath}" translate="no"><span class="mark"><i></i><i></i><i></i></span>TLS Companion</a><nav aria-label="Language"><a href="${collectionUrl(otherLanguage)}" hreflang="${otherLanguage.code}">${otherLanguage.label}</a></nav></header>
    <main id="content" class="collection" tabindex="-1"><p class="eyebrow">${escapeHTML(language.label)}</p><h1>${escapeHTML(language.collectionTitle)}</h1><p class="lede">${escapeHTML(language.collectionDescription)}</p><p class="actions"><a class="primary" href="${basePath}">${escapeHTML(language.openWorkbench)}</a></p><ol>${cards}</ol></main>
    ${footerHTML(language)}
  </body>
</html>`;
}

function hubPage() {
  const canonical = `${siteUrl}learn/`;
  const language = languages[0];
  const structuredData = { "@context": "https://schema.org", "@type": "CollectionPage", name: "TLS Companion Notes", url: canonical, inLanguage: ["en", "zh-Hans"] };
  return `${head({ title: "TLS Companion Notes", description: "Bilingual notes about TLS, HTTPS, PKI, QUIC, ECH, and post-quantum cryptography.", canonical, language, structuredData })}
  <body><a class="skip-link" href="#content">${language.skipContent}</a><header class="site-head"><a class="brand" href="${basePath}" translate="no"><span class="mark"><i></i><i></i><i></i></span>TLS Companion</a></header><main id="content" class="language-hub" tabindex="-1"><p class="eyebrow">Static reading edition</p><h1>TLS Companion Notes</h1><p class="lede">Choose a language. The interactive workbench remains available from every article.</p><div class="language-choices"><a href="${collectionUrl(languages[0])}"><strong>English</strong><span>${escapeHTML(languages[0].collectionDescription)}</span></a><a href="${collectionUrl(languages[1])}"><strong>简体中文</strong><span>${escapeHTML(languages[1].collectionDescription)}</span></a></div></main>${footerHTML(languages[0])}</body></html>`;
}

const css = readFileSync(join(root, "scripts/seo.css"), "utf8");

if (!existsSync(join(dist, "index.html"))) throw new Error("vite build must run before build-seo.mjs");
if (!existsSync(join(dist, "og-card.png"))) throw new Error("public/og-card.png was not copied into dist");

const editions = new Map();
for (const language of languages) {
  const index = readJSON(join(language.directory, "index.json"));
  const documents = new Map(index.map((entry) => [entry.id, readJSON(join(language.directory, `${entry.id}.json`))]));
  editions.set(language.key, { index, documents });
}

const enIds = editions.get("en").index.map((note) => note.id);
const zhIds = editions.get("zh").index.map((note) => note.id);
if (JSON.stringify(enIds) !== JSON.stringify(zhIds)) throw new Error("English and Chinese note IDs differ");

write(join(dist, "learn/seo.css"), css);
write(join(dist, "learn/index.html"), hubPage());

const generatedPages = [];
for (const language of languages) {
  const { index, documents } = editions.get(language.key);
  const collectionPath = join(dist, `learn/${language.key}/index.html`);
  write(collectionPath, collectionPage(language, index, documents));
  generatedPages.push(collectionPath);
  for (const [position, entry] of index.entries()) {
    const path = join(dist, `learn/${language.key}/${entry.id}/index.html`);
    const page = articlePage(language, documents.get(entry.id), index, position);
    if (page.includes('href="#/notes/')) throw new Error(`${entry.id}/${language.key} kept a hash-only note link`);
    write(path, page);
    generatedPages.push(path);
  }
}

const sitemapEntries = [
  `<url><loc>${siteUrl}</loc></url>`,
  `<url><loc>${siteUrl}learn/</loc></url>`,
  ...languages.map((language) => `<url><loc>${collectionUrl(language)}</loc>${languages.map((alternate) => `<xhtml:link rel="alternate" hreflang="${alternate.code}" href="${collectionUrl(alternate)}" />`).join("")}<xhtml:link rel="alternate" hreflang="x-default" href="${collectionUrl(languages[0])}" /></url>`),
  ...enIds.flatMap((id) => languages.map((language) => `<url><loc>${noteUrl(language, id)}</loc>${languages.map((alternate) => `<xhtml:link rel="alternate" hreflang="${alternate.code}" href="${noteUrl(alternate, id)}" />`).join("")}<xhtml:link rel="alternate" hreflang="x-default" href="${noteUrl(languages[0], id)}" /></url>`)),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${sitemapEntries.map(escapeXML).join("")}</urlset>\n`
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
write(join(dist, "sitemap.xml"), sitemap);
write(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);

for (const path of generatedPages) {
  const page = readFileSync(path, "utf8");
  if (!page.includes('<link rel="canonical"')) throw new Error(`${path} has no canonical URL`);
  if (!page.includes('type="application/ld+json"')) throw new Error(`${path} has no structured data`);
}
if ((sitemap.match(/<loc>/g) ?? []).length !== sitemapEntries.length) throw new Error("sitemap URL count is wrong");

console.log(`built ${generatedPages.length + 1} static SEO pages and ${sitemapEntries.length} sitemap URLs`);
