import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";

import { AdSlot, ErrorBox, Loading } from "@/components/Layout";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/session";
import type { Certificate } from "@/lib/types";
import { useTitle } from "@/lib/util";


export function PricingPage() {
  useTitle("Pricing");
  return (
    <div className="wrap page">
      <div className="page-head"><div><span className="label">Pricing</span><h1>Learn free. Upgrade when it helps.</h1></div></div>
      <Pricing />
    </div>
  );
}

type GuideMeta = { slug: string; title: string; summary: string; category: string; minutes: number };
type GuideFull = GuideMeta & { body: { sections: { heading?: string; text?: string; bullets?: string[] }[] }; updated_at: string };

export function Guides() {
  useTitle("Guides");
  const { data, error, loading, reload } = useApi<GuideMeta[]>("/guides");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="wrap page">
      <div className="page-head"><div><span className="label">Guides</span><h1>Career guides and explainers</h1></div></div>
      {data.length === 0 ? <div className="empty">No guides published yet.</div> : (
        <div className="postlist">
          {data.map((g) => (
            <Link key={g.slug} to={`/guides/${g.slug}`}>
              <span className="label">{g.category} · {g.minutes} min</span>
              <span><b>{g.title}</b><span style={{ display: "block" }}>{g.summary}</span></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function GuidePage() {
  const { slug = "" } = useParams();
  const { data: g, error, loading, reload } = useApi<GuideFull>(`/guides/${slug}`);
  useTitle(g?.title ?? "Guide");
  if (loading) return <Loading />;
  if (error || !g) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="wrap page">
      <article className="prose">
        <span className="label">{g.category} · {g.minutes} min read</span>
        <h1>{g.title}</h1>
        <p style={{ fontSize: 19 }}>{g.summary}</p>
        {g.body.sections.map((s, k) => (
          <section key={k} className="stack" style={{ gap: 10 }}>
            {s.heading && <h2>{s.heading}</h2>}
            {s.text && s.text.split("\n\n").map((para, j) => <p key={j}>{para}</p>)}
            {s.bullets && <ul>{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
            {k === 1 && <AdSlot placement="article_inline" />}
          </section>
        ))}
        <Link className="btn btn-primary" to="/signup" style={{ justifySelf: "start" }}>Start the route free</Link>
      </article>
    </div>
  );
}

export function CertificateCard({ c }: { c: Certificate }) {
  const issued = new Date(c.issued_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="cert" aria-label={`Certificate for ${c.name}`}>
      <div className="top"><span>HUNTEXAMS</span><span>{c.code}</span></div>
      <div className="mid">
        <span className="k">Certificate of completion</span>
        <div className="nm">{c.name}</div>
        <p className="path">completed the <b>{c.path}</b> route on HuntExams</p>
        <div className="proof">
          <span>{c.summary.levels ?? 8} levels passed</span><span>{c.summary.missions ?? 8} missions reviewed</span><span>{c.summary.topics ?? ""} topics practised</span>
        </div>
      </div>
      <div className="bot">
        <div className="lv" aria-hidden="true">{["#c2410c", "#a16207", "#15803d", "#1d4ed8", "#6d28d9", "#be185d", "#0f766e", "#14201a"].map((x) => <i key={x} style={{ background: x }} />)}</div>
        <span>Issued {issued} · verify at {window.location.host}/verify/{c.code}</span>
      </div>
    </div>
  );
}

export function Verify() {
  const { code: initial = "" } = useParams();
  useTitle("Verify a certificate");
  const [code, setCode] = useState(initial);
  const [cert, setCert] = useState<Certificate | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async (e?: FormEvent) => {
    e?.preventDefault();
    const v = code.trim().toUpperCase();
    setCert(null);
    if (!/^HX-[A-Z]{3}-\d{4}-\d{5}$/.test(v)) { setMsg("Certificate IDs look like HX-AAE-2026-04821."); return; }
    setBusy(true);
    try { setCert(await api<Certificate>(`/certificates/${v}`)); setMsg(""); }
    catch (err) { setMsg(err instanceof ApiError && err.status === 404 ? "No certificate has this ID." : "Couldn't check right now. Try again."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (initial) void check();
    // Run once for a code that arrived in the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  return (
    <div className="wrap page stack" style={{ gap: 24 }}>
      <div className="page-head"><div><span className="label">Verify</span><h1>Check a HuntExams certificate</h1></div></div>
      <form className="card stack" onSubmit={(e) => void check(e)} style={{ maxWidth: 520 }} noValidate>
        <div className="field"><label htmlFor="v-code">Certificate ID</label>
          <input id="v-code" className="input mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="HX-AAE-2026-04821" aria-invalid={Boolean(msg)} /></div>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
        {msg && <p className="err" role="alert">{msg}</p>}
      </form>
      {cert && <><div className="alert good"><b>Valid.</b> Issued to {cert.name} for {cert.path}.</div><CertificateCard c={cert} /></>}
    </div>
  );
}

export function Legal({ kind }: { kind: "about" | "privacy" | "terms" }) {
  useTitle(kind === "about" ? "About" : kind === "privacy" ? "Privacy" : "Terms");
  const content = {
    about: { h: "About HuntExams", p: [
      "HuntExams teaches technical skills with short motion scenes, hands-on labs and real projects. Release 1 covers one route: Agentic AI Engineer.",
      "We measure learning by evidence: questions answered, labs completed and missions reviewed against a rubric. Not by videos watched.",
      "HuntExams is built in Chennai, Tamil Nadu, India." ] },
    privacy: { h: "Privacy", p: [
      "We store your name, email, a hash of your password, your onboarding answers and your learning progress so the product works. We don't sell your data.",
      "Python you run in labs executes in your own browser. Code you save in labs is stored with your progress so you can resume.",
      "Project links you submit are visible to reviewers. Certificates show your name and are publicly verifiable by their ID, because that's their purpose.",
      "Our links page (huntexams.com/links) counts page views and link taps so we know which resources help. We don't store your IP address or browser details: each visit gets an anonymous ID that is a one-way hash and changes every day, so you can't be followed across days. We also keep the campaign tag in the link (like ?src=insta), the referring website's name, your country, your device type (phone, tablet or desktop) and your browser family. Raw visit records are deleted after 13 months; only daily totals are kept.",
      "If ads are enabled in future, Google may use cookies to show them. Learning screens never show ads. Ask us to delete your account at any time." ] },
    terms: { h: "Terms", p: [
      "Use HuntExams to learn. Don't submit work that isn't yours, and don't try to break or overload the service.",
      "Certificates are issued when the configured requirements are met and may be revoked if a submission is found to be copied.",
      "HuntExams certificates are not an external accreditation. Pricing shown for Pro is a plan, not an offer, until payments launch." ] },
  }[kind];
  return (
    <div className="wrap page"><article className="prose"><h1>{content.h}</h1>{content.p.map((x) => <p key={x}>{x}</p>)}</article></div>
  );
}

export function NotFound() {
  useTitle("Not found");
  return (
    <div className="wrap page stack" style={{ justifyItems: "start" }}>
      <span className="label">404</span><h1 style={{ fontSize: 36 }}>This page doesn't exist</h1>
      <p className="muted">The link may be old, or the page moved.</p>
      <Link className="btn btn-primary" to="/">Go home</Link>
    </div>
  );
}

export function Pricing({ compact = false }: { compact?: boolean }) {
  return (
    <div className="stack">
      <div className="price-grid">
        <div className="card price"><span className="label">Free</span><div className="amt">₹0</div>
          <ul><li>Every motion scene and lesson</li><li>Guided labs and the Python sandbox</li><li>Practice questions and XP</li><li>Mission reviews and your certificate</li></ul>
          <Link className="btn btn-ghost" to="/signup">Start free</Link></div>
        <div className="card price pro"><span className="label" style={{ color: "var(--brand)" }}>Pro monthly</span><div className="amt">₹299<small> / month</small></div>
          <ul><li>Everything in Free</li><li>No ads anywhere</li><li>Support the people building the scenes</li></ul>
          <button className="btn btn-primary" type="button" disabled>Coming soon</button></div>
        <div className="card price"><span className="label">Pro yearly</span><div className="amt">₹1,999<small> / year</small></div>
          <ul><li>Everything in Pro</li><li>About 44% less than monthly</li></ul>
          <button className="btn btn-ghost" type="button" disabled>Coming soon</button></div>
      </div>
      {!compact && <p className="note">Pro isn't on sale yet and these prices may change before launch. Everything you need to learn and earn the certificate is free today.</p>}
    </div>
  );
}
