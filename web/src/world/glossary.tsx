// Word help: hard words in any text are softly underlined; tapping one shows its one-line
// meaning in place, with a link to its own glossary page.
import { createContext, Fragment, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import { api } from "@/lib/api";

import { useLang } from "./lang";

export type Term = { slug: string; term: string; meaning: string; topics: { slug: string; title: string }[] };
type Ctx = { terms: Term[]; matcher: RegExp | null; bySlug: Map<string, Term>; byWord: Map<string, Term> };
const GlossaryCtx = createContext<Ctx>({ terms: [], matcher: null, bySlug: new Map(), byWord: new Map() });

let cache: Promise<Term[]> | null = null;
export function loadGlossary(): Promise<Term[]> {
  cache ??= api<Term[]>("/glossary").catch(() => { cache = null; return []; });
  return cache;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [terms, setTerms] = useState<Term[]>([]);
  useEffect(() => {
    // Word help isn't needed for the first paint; fetch it once the page is idle.
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const run = () => { void loadGlossary().then(setTerms); };
    if (ric) ric(run, { timeout: 2500 }); else window.setTimeout(run, 800);
  }, []);
  const value = useMemo<Ctx>(() => {
    const usable = terms.filter((t) => t.term.length >= 2 && t.term.length <= 40);
    const sorted = [...usable].sort((a, b) => b.term.length - a.term.length);
    const matcher = sorted.length ? new RegExp(`(?<![\\w-])(${sorted.map((t) => esc(t.term)).join("|")})(?![\\w-])`, "gi") : null;
    return {
      terms, matcher,
      bySlug: new Map(terms.map((t) => [t.slug, t])),
      byWord: new Map(usable.map((t) => [t.term.toLowerCase(), t])),
    };
  }, [terms]);
  return <GlossaryCtx.Provider value={value}>{children}</GlossaryCtx.Provider>;
}

export const useGlossary = () => useContext(GlossaryCtx);

function WordTip({ term, children }: { term: Term; children: ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const { to } = useLang();
  const open = pos !== null;
  const toggle = () => {
    if (open || !btn.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth * 0.86);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    setPos(r.top > 190 ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!btn.current?.contains(e.target as Node) && !tip.current?.contains(e.target as Node)) setPos(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    const gone = () => setPos(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("resize", gone);
    return () => {
      document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", gone, true); window.removeEventListener("resize", gone);
    };
  }, [open]);
  // Rendered into the world root (not inside scrolling panels) so it is never clipped.
  const host = typeof document !== "undefined" ? document.querySelector(".world") ?? document.body : null;
  return (
    <>
      <button ref={btn} type="button" className="w-word-btn" aria-expanded={open} onClick={toggle}>{children}</button>
      {open && host && createPortal(
        <span ref={tip} className="w-word-tip" role="tooltip" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}>
          <b>{term.term}</b>
          <span>{term.meaning.replace(/[*`]/g, "")}</span>
          <Link to={to(`/glossary/${term.slug}`)} onClick={() => setPos(null)}>More about this word →</Link>
        </span>, host)}
    </>
  );
}

/** Text with **bold**, `code`, and tappable hard words (each word underlined once per block). */
export function Words({ text, seen }: { text: string; seen?: Set<string> }) {
  const { matcher, byWord } = useGlossary();
  const used = seen ?? new Set<string>();
  const out: ReactNode[] = [];
  let k = 0;
  const plain = (s: string) => {
    if (!matcher) { out.push(<Fragment key={k++}>{s}</Fragment>); return; }
    let last = 0;
    for (const m of s.matchAll(matcher)) {
      const term = byWord.get(m[0].toLowerCase());
      if (!term || used.has(term.slug)) continue;
      used.add(term.slug);
      if (m.index! > last) out.push(<Fragment key={k++}>{s.slice(last, m.index)}</Fragment>);
      out.push(<WordTip key={k++} term={term}>{m[0]}</WordTip>);
      last = m.index! + m[0].length;
    }
    if (last < s.length) out.push(<Fragment key={k++}>{s.slice(last)}</Fragment>);
  };
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) plain(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={k++}>{tok.slice(2, -2)}</strong> : <code key={k++} className="inline">{tok.slice(1, -1)}</code>);
    last = m.index! + tok.length;
  }
  if (last < text.length) plain(text.slice(last));
  return <>{out}</>;
}
