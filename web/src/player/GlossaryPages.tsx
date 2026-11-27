// The glossary: every hard word in one plain sentence, and the topics that use it.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { Loading } from "@/components/Layout";
import { useTitle } from "@/lib/util";

import { useGlossary } from "./glossary";
import { useLang } from "./lang";

export function GlossaryIndex() {
  useTitle("AI glossary");
  const { terms } = useGlossary();
  const { to } = useLang();
  const [q, setQ] = useState("");
  const shown = useMemo(() => terms.filter((t) => `${t.term} ${t.meaning}`.toLowerCase().includes(q.trim().toLowerCase())), [terms, q]);
  return (
    <div className="wrap-narrow page stack">
      <span className="label">Glossary</span>
      <h1 style={{ fontSize: 40 }}>AI words, in plain English</h1>
      <input className="input" type="search" placeholder="Find a word" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a word" style={{ maxWidth: 420 }} />
      {!terms.length ? <Loading /> : (
        <dl className="gloss">
          {shown.map((t) => (
            <div key={t.slug} className="card card-tight"><dt><Link to={to(`/glossary/${t.slug}`)}>{t.term}</Link></dt><dd>{t.meaning.replace(/[*`]/g, "")}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function GlossaryTerm() {
  const { term = "" } = useParams();
  const { bySlug, terms } = useGlossary();
  const { to } = useLang();
  const t = bySlug.get(term);
  useTitle(t ? `What is ${t.term}?` : "Glossary");
  if (!terms.length) return <Loading />;
  return (
    <div className="wrap-narrow page stack">
      <Link to={to("/glossary")} className="label">← Glossary</Link>
      {!t ? <h1>We don't have that word yet</h1> : (
        <>
          <h1 style={{ fontSize: 40 }}>What is {t.term}?</h1>
          <p style={{ fontSize: 20 }} className="muted">{t.meaning.replace(/[*`]/g, "")}</p>
          <h2 style={{ fontSize: 22, marginTop: 12 }}>See it in action</h2>
          <div className="stack" style={{ gap: 10 }}>
            {t.topics.map((x) => <Link key={x.slug} className="card card-tight" to={to(`/learn/${x.slug}`)} style={{ textDecoration: "none" }}><b>{x.title}</b> <span className="muted">→ watch it move</span></Link>)}
          </div>
        </>
      )}
    </div>
  );
}
