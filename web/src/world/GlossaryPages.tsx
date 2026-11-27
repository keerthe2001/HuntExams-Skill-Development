// The glossary inside the world: every hard word in one plain sentence, and where to see it.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { Loading } from "@/components/Layout";
import { useTitle } from "@/lib/util";

import { useGlossary } from "./glossary";
import { useLang } from "./lang";
import { Hud, WorldFooter } from "./Shell";

export function GlossaryIndex() {
  useTitle("AI glossary");
  const { terms } = useGlossary();
  const { to } = useLang();
  const [q, setQ] = useState("");
  const shown = useMemo(() => terms.filter((t) => `${t.term} ${t.meaning}`.toLowerCase().includes(q.trim().toLowerCase())), [terms, q]);
  return (
    <>
      <Hud><Link className="w-back" to={to("/learn")}>← Roadmap</Link></Hud>
      <main className="w-page">
        <span className="w-kicker">Glossary</span>
        <h1>AI words, in plain English</h1>
        <input className="w-search" type="search" placeholder="Find a word" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a word" />
        {!terms.length ? <Loading /> : (
          <dl className="w-gloss">
            {shown.map((t) => (
              <div key={t.slug}><dt><Link to={to(`/glossary/${t.slug}`)}>{t.term}</Link></dt><dd>{t.meaning.replace(/[*`]/g, "")}</dd></div>
            ))}
          </dl>
        )}
        <WorldFooter />
      </main>
    </>
  );
}

export function GlossaryTerm() {
  const { term = "" } = useParams();
  const { bySlug, terms } = useGlossary();
  const { to } = useLang();
  const t = bySlug.get(term);
  useTitle(t ? `What is ${t.term}?` : "Glossary");
  return (
    <>
      <Hud><Link className="w-back" to={to("/glossary")}>← Glossary</Link></Hud>
      <main className="w-page">
        {!terms.length ? <Loading /> : !t ? (
          <><h1>We don't have that word yet</h1><Link className="w-go" to={to("/glossary")}>See all words</Link></>
        ) : (
          <>
            <span className="w-kicker">Glossary</span>
            <h1>What is {t.term}?</h1>
            <p className="w-lead">{t.meaning.replace(/[*`]/g, "")}</p>
            <h2 className="w-h">See it in action</h2>
            <div className="w-list">
              {t.topics.map((x) => <Link key={x.slug} className="w-card-link" to={to(`/learn/${x.slug}`)}><b>{x.title}</b><span>Step inside →</span></Link>)}
            </div>
          </>
        )}
        <WorldFooter />
      </main>
    </>
  );
}
