import { useSyncExternalStore } from "react";

export type Lang = "en" | "zh";

function stored(): Lang {
  try {
    return JSON.parse(localStorage.getItem("tlsc.lang") || '"en"') === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

let current: Lang = typeof localStorage === "undefined" ? "en" : stored();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  if (next !== "en" && next !== "zh") return;
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem("tlsc.lang", JSON.stringify(next));
  } catch {
    // Private windows keep the choice for this page load.
  }
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  listeners.forEach((fn) => fn());
}

if (typeof document !== "undefined") document.documentElement.lang = current === "zh" ? "zh-CN" : "en";

export function subscribeLang(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, () => "en" as Lang);
}

/** English is the default. Call from a component that renders the string. */
export function useTx() {
  const lang = useLang();
  return (en: string, zh: string) => (lang === "zh" ? zh : en);
}

/** For code that runs while a subscribed component is rendering. */
export function tx(en: string, zh: string): string {
  return current === "zh" ? zh : en;
}

/**
 * Text kept in state, such as the caption of an opened code location. A pair
 * is resolved where it renders, so it follows a later language switch; tx()
 * would freeze whichever language was active when the state was written.
 */
export type Bi = string | readonly [en: string, zh: string];

export function pick(text: Bi, lang: Lang): string {
  return typeof text === "string" ? text : lang === "zh" ? text[1] : text[0];
}
