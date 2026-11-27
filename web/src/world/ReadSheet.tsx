// The Read panel: the same text search engines see, in simple words first, technical on tap.
// It stays in the page while closed (slid away and inert), so it is part of the page content.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import type { Topic } from "@/lib/types";

import { term_slug } from "./slug";
import { Words } from "./glossary";
import { useLang } from "./lang";

export function ReadSheet({ t, open, onClose }: { t: Topic; open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"simple" | "tech">("simple");
  const { to } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const b = t.body;
  const techPoints = b.points.filter((p) => p.eng);
  const hasTech = Boolean(b.intro_eng || techPoints.length);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) { el.removeAttribute("inert"); el.querySelector<HTMLElement>(".w-sheet-close")?.focus(); } else el.setAttribute("inert", "");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="w-scrim" onClick={onClose} aria-hidden="true" />}
      <aside ref={ref} className={`w-sheet ${open ? "open" : ""}`} aria-label={`Read: ${t.title}`} aria-hidden={!open}>
        <div className="w-sheet-head">
          <div className="w-tabs" role="tablist" aria-label="Explanation">
            <button type="button" role="tab" aria-selected={mode === "simple"} onClick={() => setMode("simple")}>In simple words</button>
            <button type="button" role="tab" aria-selected={mode === "tech"} onClick={() => setMode("tech")}>Technical</button>
          </div>
          <button type="button" className="w-sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <article className="w-read">
          <h2>{t.title}</h2>
          {mode === "simple" ? (
            <>
              <p className="lead"><Words text={b.intro} /></p>
              {b.points.map((p, k) => (<section key={k}><h3>{p.title}</h3><p><Words text={p.text} /></p></section>))}
            </>
          ) : (
            <>
              {hasTech ? (
                <>
                  {b.intro_eng && <p className="lead"><Words text={b.intro_eng} /></p>}
                  {techPoints.map((p, k) => (<section key={k}><h3>{p.title}</h3><p><Words text={p.eng!} /></p></section>))}
                </>
              ) : <p className="lead">This topic is mostly about the idea, so the simple explanation is the full story.</p>}
              {b.code && (<section><h3>The code</h3><pre className="w-pre"><code>{b.code.source}</code></pre></section>)}
            </>
          )}
          {b.words && b.words.length > 0 && (
            <section>
              <h3>Words to know</h3>
              <dl className="w-dl">
                {b.words.map(([w, d]) => (
                  <div key={w}><dt><Link to={to(`/glossary/${term_slug(w)}`)}>{w}</Link></dt><dd><Words text={d} seen={new Set([term_slug(w)])} /></dd></div>
                ))}
              </dl>
            </section>
          )}
          <section>
            <h3>After this you can</h3>
            <ul>{b.objectives.map((o) => <li key={o}><Words text={o} /></li>)}</ul>
          </section>
        </article>
      </aside>
    </>
  );
}
