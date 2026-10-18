import { lazy, Suspense, useEffect, useState } from "react";
import { RfcPeek } from "../rfc/RfcPeek";
import { Palette } from "../search/Palette";
import { readPref } from "../ui/hooks";
import { Workbench } from "../workbench/Workbench";
import { ErrorBoundary } from "./ErrorBoundary";
import { href, useRoute, type Route } from "./route";
import "./app.css";

const Home = lazy(() => import("../pages/Home"));
const CodePage = lazy(() => import("../pages/CodePage"));
const NotesPage = lazy(() => import("../pages/NotesPage"));
const HistoryPage = lazy(() => import("../pages/HistoryPage"));
const RfcPage = lazy(() => import("../pages/RfcPage"));

const nav: [Route["page"], string, string][] = [
  ["play", "握手", "#/play"],
  ["code", "源码", "#/code"],
  ["notes", "笔记", "#/notes"],
  ["history", "演进", "#/history"],
  ["rfc", "规范", "#/rfc"],
];

type Theme = "system" | "light" | "dark";

function applyTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = t;
}

export function App() {
  const route = useRoute();
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readPref<Theme>("theme", "system"));

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem("tlsc.theme", JSON.stringify(theme));
    } catch {
      // Storage unavailable: the choice lasts for this page load.
    }
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const titles: Record<Route["page"], string> = {
      home: "TLS Companion",
      play: "握手工作台 · TLS Companion",
      code: "crypto/tls 源码 · TLS Companion",
      notes: "笔记 · TLS Companion",
      history: "演进 · TLS Companion",
      rfc: "规范 · TLS Companion",
    };
    document.title = titles[route.page];
  }, [route.page]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={href({ page: "home" })} aria-label="TLS Companion 首页">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="brand-name mono">tls companion</span>
        </a>
        <nav className="topnav" aria-label="主导航">
          {nav.map(([page, label, h]) => (
            <a key={page} href={h} aria-current={route.page === page ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <span className="spacer" />
        <button className="search-btn" onClick={() => setPalette(true)} aria-label="搜索">
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="hide-sm">搜索符号、笔记、RFC</span>
          <kbd className="hide-sm">/</kbd>
        </button>
        <button
          className="btn"
          onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}
          title={`主题：${theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}`}
          aria-label="切换主题"
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            {theme === "dark" ? (
              <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" fill="currentColor" />
            ) : theme === "light" ? (
              <>
                <circle cx="8" cy="8" r="3" fill="currentColor" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.3" />
              </>
            ) : (
              <>
                <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
              </>
            )}
          </svg>
        </button>
        <a className="btn hide-sm" href="https://github.com/lr00rl/tls-companion" target="_blank" rel="noopener" aria-label="GitHub 仓库">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path fill="currentColor" d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.4 7.4 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.7 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0Z" />
          </svg>
        </a>
      </header>
      <main className="main">
        <ErrorBoundary resetKey={location.hash}>
          <Suspense fallback={<div className="loading-bar" />}>
            {route.page === "home" && <Home />}
            {route.page === "play" && <Workbench scenario={route.scenario} step={route.step} />}
            {route.page === "code" && <CodePage path={route.path} line={route.line} />}
            {route.page === "notes" && <NotesPage id={route.id} anchor={route.anchor} />}
            {route.page === "history" && <HistoryPage entry={route.entry} />}
            {route.page === "rfc" && <RfcPage n={route.n} section={route.section} />}
          </Suspense>
        </ErrorBoundary>
      </main>
      <RfcPeek />
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}
