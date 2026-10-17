import type { ReactNode } from "react";

export interface LinkHandlers {
  sym?: (key: string) => void;
  rfc?: (n: number, section?: string) => void;
  note?: (id: string, anchor?: string) => void;
  step?: (id: string) => void;
}

const inline = /(`[^`]+`)|(\*\*[^*]+\*\*)|\[([^\]]+)\]\(([a-z]+):([^)]+)\)/g;

/**
 * Renders the step narrative markup: paragraphs split on blank lines,
 * `code`, **bold**, and [label](sym:… | rfc:8446#4.1.2 | note:T06#anchor | step:id | http:…).
 */
export function RichText({ text, on }: { text: string; on: LinkHandlers }) {
  return (
    <>
      {text.split(/\n\n+/).map((p, i) => (
        <p key={i}>{renderInline(p, on)}</p>
      ))}
    </>
  );
}

function renderInline(p: string, on: LinkHandlers): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of p.matchAll(inline)) {
    if (m.index! > last) out.push(p.slice(last, m.index));
    const k = out.length;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    else {
      const [label, scheme, target] = [m[3], m[4], m[5]];
      out.push(
        <a
          key={k}
          href={scheme === "http" || scheme === "https" ? `${scheme}:${target}` : "#"}
          target={scheme.startsWith("http") ? "_blank" : undefined}
          rel="noopener"
          onClick={(e) => {
            if (scheme.startsWith("http")) return;
            e.preventDefault();
            const [a, b] = target.split("#");
            if (scheme === "sym") on.sym?.(target);
            else if (scheme === "rfc") on.rfc?.(Number(a), b);
            else if (scheme === "note") on.note?.(a, b);
            else if (scheme === "step") on.step?.(target);
          }}
        >
          {label}
        </a>,
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < p.length) out.push(p.slice(last));
  return out;
}
