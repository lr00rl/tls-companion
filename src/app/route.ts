import { useSyncExternalStore } from "react";

// Every view is a hash route, so GitHub Pages needs no rewrites and refresh,
// share, and back all land in the same place.
//
//   #/                         home
//   #/play/<scenario>/<step>   workbench, step counted from 1
//   #/code/<path>?l=<line>     code browser
//   #/notes/<id>/<anchor>      notes
//   #/history/<entry>          evolution
//   #/rfc/<n>/<section>        RFC reader

export type Route =
  | { page: "home" }
  | { page: "play"; scenario?: string; step?: number }
  | { page: "code"; path?: string; line?: number }
  | { page: "notes"; id?: string; anchor?: string }
  | { page: "history"; entry?: string }
  | { page: "rfc"; n?: number; section?: string };

// A truncated or hand-edited link can carry a broken percent escape. parse runs
// inside React's route snapshot, so it keeps the raw segment instead of throwing.
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parse(hash: string): Route {
  const [pathPart, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decode);
  const q = new URLSearchParams(query);
  switch (parts[0]) {
    case "play": {
      // The URL counts steps from 1, as the transport bar does; Route.step is
      // the zero-based index everything else uses.
      const n = Math.trunc(Number(parts[2]));
      return { page: "play", scenario: parts[1], step: Number.isFinite(n) ? Math.max(0, n - 1) : undefined };
    }
    case "code": {
      const line = q.get("l");
      return { page: "code", path: parts.slice(1).join("/") || undefined, line: line ? Number(line) : undefined };
    }
    case "notes":
      return { page: "notes", id: parts[1], anchor: parts[2] };
    case "history":
      return { page: "history", entry: parts[1] };
    case "rfc":
      return { page: "rfc", n: parts[1] ? Number(parts[1]) : undefined, section: parts[2] };
    default:
      return { page: "home" };
  }
}

export function href(r: Route): string {
  const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
  switch (r.page) {
    case "home":
      return "#/";
    case "play":
      return `#/play${r.scenario ? "/" + r.scenario : ""}${r.scenario && r.step !== undefined ? "/" + (r.step + 1) : ""}`;
    case "code":
      return `#/code${r.path ? "/" + enc(r.path) : ""}${r.line ? "?l=" + r.line : ""}`;
    case "notes":
      return `#/notes${r.id ? "/" + r.id : ""}${r.id && r.anchor ? "/" + encodeURIComponent(r.anchor) : ""}`;
    case "history":
      return `#/history${r.entry ? "/" + r.entry : ""}`;
    case "rfc":
      return `#/rfc${r.n ? "/" + r.n : ""}${r.n && r.section ? "/" + r.section : ""}`;
  }
}

export function navigate(r: Route | string, opts: { replace?: boolean } = {}) {
  const h = typeof r === "string" ? r : href(r);
  if (h === location.hash) return;
  if (opts.replace) {
    history.replaceState(null, "", h);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = h;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

let lastHash = "";
let lastRoute: Route = { page: "home" };
function snapshot(): Route {
  if (location.hash !== lastHash) {
    lastHash = location.hash;
    lastRoute = parse(lastHash);
  }
  return lastRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}
