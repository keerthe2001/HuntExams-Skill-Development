// Admin for the /links link-in-bio page: analytics, links and sections, settings with a live
// phone preview, and campaign links. Everything here calls /api/admin/links/* (admin-only).
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router";

import { ErrorBox, Loading } from "@/components/Layout";
import { api, ApiError } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";
import { useTitle } from "@/lib/util";
import { AdminTabs } from "@/pages/Admin";

// ---------------------------------------------------------------- types

type Social = { platform: string; url: string };
type Creator = {
  handle: string; name: string; tagline: string; bio: string; avatar_url: string | null; logo_url: string | null;
  verified: boolean; socials: Social[]; theme: { accent: string; highlight: string };
  ad_settings: { enabled: boolean; top: string; middle: string; bottom: string }; published: boolean;
};
type Cat = { id: string; name: string; sort_order: number };
type Kind = "link" | "pdf" | "video" | "course";
type Item = {
  id: string; kind: Kind; title: string; description: string; url: string; backup_url: string | null;
  thumbnail_url: string | null; category_id: string | null; badge: string | null; featured: boolean;
  active: boolean; sort_order: number; open_mode: "preview" | "download";
};
type SettingsRes = { creator: Creator; page_url: string; adsense_ready: boolean };
type ItemsRes = { categories: Cat[]; items: Item[] };

const PLATFORMS = ["instagram", "youtube", "linkedin", "telegram", "whatsapp", "x", "website", "email"];
const KIND_LABEL: Record<Kind, string> = { link: "Link button", pdf: "PDF", video: "YouTube video", course: "Course" };
const DEFAULT_THEME = { accent: "#4ade80", highlight: "#f5c451" };
const DEFAULT_ADS = { enabled: false, top: "", middle: "", bottom: "" };

function settingsBody(c: Creator) {
  return {
    name: c.name, tagline: c.tagline, bio: c.bio, avatar_url: c.avatar_url || null, logo_url: c.logo_url || null,
    verified: c.verified, socials: c.socials, theme: { ...DEFAULT_THEME, ...c.theme },
    ad_settings: { ...DEFAULT_ADS, ...c.ad_settings }, published: c.published,
  };
}

function errText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

/** Sections in display order: categories as ordered, then links with no section. */
function groups(cats: Cat[], items: Item[]): { cat: Cat | null; items: Item[] }[] {
  const known = new Set(cats.map((c) => c.id));
  const out = cats.map((c) => ({ cat: c as Cat | null, items: items.filter((i) => i.category_id === c.id) }));
  out.push({ cat: null, items: items.filter((i) => !i.category_id || !known.has(i.category_id)) });
  return out;
}

function LinksTabs() {
  const tabs = [["/admin/links", "Analytics"], ["/admin/links/items", "Links"], ["/admin/links/settings", "Page settings"], ["/admin/links/campaigns", "Campaigns"]];
  return (
    <nav className="seg lk-tabs" aria-label="Links admin">
      {tabs.map(([to, l]) => <NavLink key={to} to={to!} end className={({ isActive }) => (isActive ? "on" : "")}>{l}</NavLink>)}
    </nav>
  );
}

function Shell({ title, intro, children, pageUrl }: { title: string; intro?: string; children: ReactNode; pageUrl?: string }) {
  useTitle(`Admin · ${title}`);
  return (
    <div className="wrap page">
      <div className="page-head">
        <div><span className="label">Admin · Links page</span><h1>{title}</h1>
          {intro && <p className="muted" style={{ marginTop: 6, maxWidth: "70ch" }}>{intro}</p>}</div>
        <a className="btn btn-ghost btn-sm" href={pageUrl ?? "/links"} target="_blank" rel="noreferrer">Open /links ↗</a>
      </div>
      <AdminTabs />
      <LinksTabs />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- live preview

function Preview({ creator, cats, items }: { creator: Creator; cats: Cat[]; items: Item[] }) {
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");
  const payload = useMemo(() => JSON.stringify({ settings: settingsBody(creator), categories: cats.map(({ id, name }) => ({ id, name })), items }), [creator, cats, items]);
  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        const r = await api<{ html: string }>("/admin/links/preview", { method: "POST", body: JSON.parse(payload) });
        setHtml(r.html); setErr("");
      } catch (e) { setErr(errText(e, "Preview unavailable")); }
    }, 350);
    return () => window.clearTimeout(t);
  }, [payload]);
  return (
    <aside className="lk-preview" aria-label="Phone preview">
      <div className="label" style={{ marginBottom: 8 }}>Live preview · unsaved changes included</div>
      <div className="lk-phone">
        {/* No scripts run in the preview: sandbox without allow-scripts. */}
        <iframe title="Links page preview" sandbox="" srcDoc={html} />
      </div>
      {err && <p className="small" style={{ color: "var(--bad)", marginTop: 8 }}>{err}</p>}
    </aside>
  );
}

function useLinksData() {
  const settings = useApi<SettingsRes>("/admin/links/settings");
  const items = useApi<ItemsRes>("/admin/links/items");
  return { settings, items };
}

// ---------------------------------------------------------------- analytics

type Breakdown = { name: string; views: number }[];
type Analytics = {
  from: string; to: string; rolled_up_to: string | null;
  totals: { views: number; unique_visitors: number; clicks: number; unique_clickers: number; downloads: number; unique_downloaders: number; ctr: number };
  daily: { day: string; views: number; clicks: number; downloads: number }[];
  items: { id: string; title: string; kind: string | null; clicks: number; uniques: number; last_clicked: string | null }[];
  campaigns: { campaign: string | null; label: string | null; views: number; clicks: number; downloads: number }[];
  referrers: Breakdown; countries: Breakdown; devices: Breakdown; browsers: Breakdown;
};

function istToday() {
  const d = new Date(Date.now() + 330 * 60_000);
  return d.toISOString().slice(0, 10);
}
function shift(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const fmt = (n: number) => n.toLocaleString("en-IN");
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const SERIES = [
  { key: "views", label: "Page views", cls: "s1" },
  { key: "clicks", label: "Link clicks", cls: "s2" },
  { key: "downloads", label: "PDF downloads", cls: "s3" },
] as const;

function DailyChart({ daily }: { daily: Analytics["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 720, H = 240, L = 40, R = 12, T = 12, B = 28;
  const max = Math.max(4, ...daily.flatMap((d) => [d.views, d.clicks, d.downloads]));
  const nice = Math.ceil(max / 4) * 4;
  const x = (i: number) => L + (daily.length <= 1 ? 0 : (i * (W - L - R)) / (daily.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const ticks = [0, nice / 4, nice / 2, (3 * nice) / 4, nice];
  const every = Math.max(1, Math.ceil(daily.length / 6));
  const svgRef = useRef<SVGSVGElement>(null);
  const onMove = (e: { clientX: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (daily.length - 1));
    setHover(Math.min(daily.length - 1, Math.max(0, i)));
  };
  const h = hover !== null ? daily[hover] : null;
  return (
    <div className="card card-tight">
      <div className="row between" style={{ marginBottom: 8 }}>
        <b>Daily activity</b>
        <div className="row" style={{ gap: 14 }}>
          {SERIES.map((s) => <span key={s.key} className="lk-key small"><i className={s.cls} />{s.label}</span>)}
          <button className="btn btn-text btn-sm" onClick={() => setTable(!table)} aria-pressed={table}>{table ? "Show chart" : "Show table"}</button>
        </div>
      </div>
      {table ? (
        <div className="tscroll"><table className="t"><thead><tr><th>Day</th>{SERIES.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
          <tbody>{daily.map((d) => <tr key={d.day}><td>{fmtDay(d.day)}</td><td>{d.views}</td><td>{d.clicks}</td><td>{d.downloads}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="lk-chart">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily page views, link clicks and PDF downloads"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
                <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ax">{t}</text></g>
            ))}
            {daily.map((d, i) => (i % every === 0 ? <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" className="ax">{fmtDay(d.day)}</text> : null))}
            {SERIES.map((s) => (
              <polyline key={s.key} className={`ln ${s.cls}`} fill="none"
                points={daily.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ")} />
            ))}
            {h && hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />
                {SERIES.map((s) => <circle key={s.key} cx={x(hover)} cy={y(h[s.key])} r={4.5} className={`dot ${s.cls}`} />)}
              </g>
            )}
          </svg>
          {h && hover !== null && (
            <div className="lk-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
              <b>{fmtDay(h.day)}</b>
              {SERIES.map((s) => <div key={s.key}><i className={s.cls} />{s.label}<span>{h[s.key]}</span></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ title, rows, col = "Page views" }: { title: string; rows: Breakdown; col?: string }) {
  return (
    <div className="card card-tight">
      <b>{title}</b>
      {rows.length === 0 ? <p className="small faint" style={{ marginTop: 8 }}>No visits yet.</p> : (
        <table className="t" style={{ marginTop: 8 }}><thead><tr><th>Name</th><th style={{ textAlign: "right" }}>{col}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td style={{ textAlign: "right" }}>{fmt(r.views)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}

export function AdminLinksAnalytics() {
  const [to, setTo] = useState(istToday());
  const [from, setFrom] = useState(shift(istToday(), -29));
  const { data, error, loading, reload } = useApi<Analytics>(`/admin/links/analytics?from=${from}&to=${to}`, [from, to]);
  const preset = (days: number) => { const t = istToday(); setTo(t); setFrom(shift(t, -(days - 1))); };
  const t = data?.totals;
  return (
    <Shell title="Links analytics" intro="Views and taps on huntexams.com/links. Days are India time; visitors are anonymous and counted once per day.">
      <div className="row lk-filter">
        <div className="seg">{[7, 30, 90].map((d) => <button key={d} onClick={() => preset(d)} aria-pressed={from === shift(to, -(d - 1)) && to === istToday()}>Last {d} days</button>)}</div>
        <label className="row small">From <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="row small">To <input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <a className="btn btn-ghost btn-sm" href={`/api/admin/links/export.csv?from=${from}&to=${to}`} download>Export CSV</a>
      </div>
      {loading && !data ? <Loading /> : error || !data || !t ? <ErrorBox error={error} retry={reload} /> : (
        <div className="stack" style={{ gap: 20 }}>
          <div className="lk-stats">
            <div className="stat"><b>{fmt(t.views)}</b><span>page views</span></div>
            <div className="stat"><b>{fmt(t.unique_visitors)}</b><span>unique visitors</span></div>
            <div className="stat"><b>{fmt(t.clicks)}</b><span>link clicks</span></div>
            <div className="stat"><b>{fmt(t.unique_clickers)}</b><span>unique clickers</span></div>
            <div className="stat"><b>{fmt(t.downloads)}</b><span>PDF downloads</span></div>
            <div className="stat"><b>{fmt(t.unique_downloaders)}</b><span>unique downloaders</span></div>
            <div className="stat" title="(clicks + downloads) ÷ page views"><b>{(t.ctr * 100).toFixed(1)}%</b><span>click-through rate</span></div>
          </div>
          <p className="note">Unique counts are per day, per link and per campaign, because visitor IDs reset every day for privacy. The CSV export has the same numbers.</p>
          <DailyChart daily={data.daily} />
          <div className="card card-tight">
            <b>Top links</b>
            {data.items.length === 0 ? <p className="small faint" style={{ marginTop: 8 }}>No taps in this range yet.</p> : (
              <div className="tscroll"><table className="t" style={{ marginTop: 8 }}>
                <thead><tr><th>Link</th><th>Type</th><th style={{ textAlign: "right" }}>Clicks</th><th style={{ textAlign: "right" }}>Unique</th><th>Last clicked</th></tr></thead>
                <tbody>{data.items.map((i) => (
                  <tr key={i.id}><td>{i.title}</td><td className="small faint">{i.kind ?? "—"}</td><td style={{ textAlign: "right" }}>{fmt(i.clicks)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(i.uniques)}</td><td className="small faint">{i.last_clicked ? new Date(i.last_clicked).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—"}</td></tr>
                ))}</tbody></table></div>
            )}
          </div>
          <div className="card card-tight">
            <b>Campaigns</b>
            {data.campaigns.length === 0 ? <p className="small faint" style={{ marginTop: 8 }}>No visits yet. Add <span className="mono">?src=your-reel</span> to the link in each reel or story.</p> : (
              <div className="tscroll"><table className="t" style={{ marginTop: 8 }}>
                <thead><tr><th>Campaign</th><th style={{ textAlign: "right" }}>Views</th><th style={{ textAlign: "right" }}>Clicks</th><th style={{ textAlign: "right" }}>Downloads</th><th style={{ textAlign: "right" }}>CTR</th></tr></thead>
                <tbody>{data.campaigns.map((c) => (
                  <tr key={c.campaign ?? "-"}><td>{c.label ?? c.campaign}{c.campaign && <span className="mono small faint"> · {c.campaign}</span>}</td>
                    <td style={{ textAlign: "right" }}>{fmt(c.views)}</td><td style={{ textAlign: "right" }}>{fmt(c.clicks)}</td><td style={{ textAlign: "right" }}>{fmt(c.downloads)}</td>
                    <td style={{ textAlign: "right" }}>{c.views ? `${(((c.clicks + c.downloads) / c.views) * 100).toFixed(1)}%` : "—"}</td></tr>
                ))}</tbody></table></div>
            )}
          </div>
          <div className="grid2 lk-break">
            <BreakdownTable title="Referrers" rows={data.referrers} />
            <BreakdownTable title="Countries" rows={data.countries} />
            <BreakdownTable title="Devices" rows={data.devices} />
            <BreakdownTable title="Browsers" rows={data.browsers} />
          </div>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- links and sections

const EMPTY: Omit<Item, "id" | "sort_order"> = {
  kind: "link", title: "", description: "", url: "", backup_url: null, thumbnail_url: null, category_id: null,
  badge: null, featured: false, active: true, open_mode: "preview",
};

function ItemForm({ draft, setDraft, cats, onSave, onCancel, saving }: {
  draft: Item; setDraft: (i: Item) => void; cats: Cat[]; onSave: () => void; onCancel: () => void; saving: boolean;
}) {
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setDraft({ ...draft, [k]: v });
  return (
    <form className="card card-tight stack" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <b>{draft.id.startsWith("draft") ? "Add a link" : "Edit link"}</b>
      <div className="lk-form">
        <div className="field"><label htmlFor="lk-kind">Type</label>
          <select id="lk-kind" className="input" value={draft.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="lk-cat">Section</label>
          <select id="lk-cat" className="input" value={draft.category_id ?? ""} onChange={(e) => set("category_id", e.target.value || null)}>
            <option value="">No section (shown last)</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="field lk-wide"><label htmlFor="lk-title">Title</label>
          <input id="lk-title" className="input" required maxLength={120} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Free SQL interview cheat sheet" /></div>
        <div className="field lk-wide"><label htmlFor="lk-desc">Description <span className="faint">(optional)</span></label>
          <input id="lk-desc" className="input" maxLength={500} value={draft.description} onChange={(e) => set("description", e.target.value)} /></div>
        <div className="field lk-wide"><label htmlFor="lk-url">URL</label>
          <input id="lk-url" className="input mono" required type="url" maxLength={1000} value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
          <span className="tiny faint">Google Drive share links become direct preview/download links. YouTube links get their thumbnail automatically.</span></div>
        <div className="field"><label htmlFor="lk-backup">Backup URL <span className="faint">(optional)</span></label>
          <input id="lk-backup" className="input mono" type="url" value={draft.backup_url ?? ""} onChange={(e) => set("backup_url", e.target.value || null)} /></div>
        <div className="field"><label htmlFor="lk-thumb">Thumbnail URL <span className="faint">(auto for Drive/YouTube)</span></label>
          <input id="lk-thumb" className="input mono" type="url" value={draft.thumbnail_url ?? ""} onChange={(e) => set("thumbnail_url", e.target.value || null)} /></div>
        <div className="field"><label htmlFor="lk-badge">Badge</label>
          <select id="lk-badge" className="input" value={draft.badge ?? ""} onChange={(e) => set("badge", e.target.value || null)}>
            <option value="">None</option>{["NEW", "FREE", "HOT", "LIVE"].map((b) => <option key={b}>{b}</option>)}
          </select></div>
        {draft.kind === "pdf" && (
          <div className="field"><span className="lbl">PDF opens as</span>
            <div className="seg">{(["preview", "download"] as const).map((m) => <button type="button" key={m} aria-pressed={draft.open_mode === m} onClick={() => set("open_mode", m)}>{m === "preview" ? "Preview" : "Download"}</button>)}</div></div>
        )}
      </div>
      <div className="row">
        <label className="switch"><input type="checkbox" checked={draft.featured} onChange={(e) => set("featured", e.target.checked)} />Featured (highlighted)</label>
        <label className="switch"><input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} />Visible on the page</label>
      </div>
      <div className="row">
        <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? "Saving…" : "Save link"}</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function AdminLinksItems() {
  const { toast } = useSession();
  const { settings, items: res } = useLinksData();
  const [draft, setDraft] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState("");
  const cats = res.data?.categories ?? [];
  const items = res.data?.items ?? [];

  const previewItems = useMemo(() => {
    if (!draft) return items;
    return draft.id.startsWith("draft") ? [...items, draft] : items.map((i) => (i.id === draft.id ? draft : i));
  }, [items, draft]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, "✓"); await res.reload(); } catch (e) { toast(errText(e, "Couldn't save")); }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const { id, sort_order: _s, ...body } = draft;
    try {
      if (id.startsWith("draft")) await api("/admin/links/items", { method: "POST", body });
      else await api(`/admin/links/items/${id}`, { method: "PUT", body });
      toast("Link saved", "✓"); setDraft(null); await res.reload();
    } catch (e) { toast(errText(e, "Couldn't save the link")); } finally { setSaving(false); }
  };

  const moveItem = (item: Item, dir: -1 | 1) => {
    const g = groups(cats, items);
    const group = g.find((x) => x.items.some((i) => i.id === item.id))!;
    const idx = group.items.findIndex((i) => i.id === item.id);
    const j = idx + dir;
    if (j < 0 || j >= group.items.length) return;
    const swapped = [...group.items];
    [swapped[idx], swapped[j]] = [swapped[j]!, swapped[idx]!];
    const ids = g.flatMap((x) => (x === group ? swapped : x.items)).map((i) => i.id);
    void run(() => api("/admin/links/items/reorder", { method: "PUT", body: { ids } }), "Order saved");
  };
  const moveCat = (cat: Cat, dir: -1 | 1) => {
    const idx = cats.findIndex((c) => c.id === cat.id);
    const j = idx + dir;
    if (j < 0 || j >= cats.length) return;
    const ids = cats.map((c) => c.id);
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    void run(() => api("/admin/links/categories/reorder", { method: "PUT", body: { ids } }), "Order saved");
  };

  if ((res.loading && !res.data) || (settings.loading && !settings.data)) return <Shell title="Links"><Loading /></Shell>;
  if (res.error || settings.error || !res.data || !settings.data) return <Shell title="Links"><ErrorBox error={res.error ?? settings.error} retry={() => { void res.reload(); void settings.reload(); }} /></Shell>;

  return (
    <Shell title="Links" intro="Add resources, group them into sections and set the order. Changes show in the preview before you save." pageUrl={settings.data.page_url}>
      <div className="lk-split">
        <div className="stack">
          {draft ? (
            <ItemForm draft={draft} setDraft={setDraft} cats={cats} onSave={() => void save()} onCancel={() => setDraft(null)} saving={saving} />
          ) : (
            <div className="row"><button className="btn btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY, id: `draft-${Date.now()}`, sort_order: 0 })}>+ Add link</button></div>
          )}

          {groups(cats, items).map(({ cat, items: members }) => (cat || members.length > 0) && (
            <div key={cat?.id ?? "none"} className="card card-tight">
              <div className="row between">
                <b>{cat ? cat.name : "No section"}</b>
                {cat && (
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn btn-text btn-sm" aria-label={`Move section ${cat.name} up`} onClick={() => moveCat(cat, -1)}>↑</button>
                    <button className="btn btn-text btn-sm" aria-label={`Move section ${cat.name} down`} onClick={() => moveCat(cat, 1)}>↓</button>
                    <button className="btn btn-text btn-sm" onClick={() => { const n = window.prompt("Rename section", cat.name); if (n?.trim()) void run(() => api(`/admin/links/categories/${cat.id}`, { method: "PUT", body: { name: n.trim() } }), "Section renamed"); }}>Rename</button>
                    <button className="btn btn-text btn-sm" style={{ color: "var(--bad)" }} onClick={() => { if (window.confirm(`Delete the section "${cat.name}"? Its links stay, without a section.`)) void run(() => api(`/admin/links/categories/${cat.id}`, { method: "DELETE" }), "Section deleted"); }}>Delete</button>
                  </div>
                )}
              </div>
              {members.length === 0 ? <p className="small faint" style={{ marginTop: 8 }}>No links in this section yet.</p> : (
                <ul className="lk-items">{members.map((i) => (
                  <li key={i.id} className={i.active ? "" : "off"}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="lk-title">{i.title} {i.badge && <span className="pill cur">{i.badge}</span>} {i.featured && <span className="pill good">featured</span>} {!i.active && <span className="pill">hidden</span>}</div>
                      <div className="tiny faint mono lk-url">{KIND_LABEL[i.kind]} · {i.url}</div>
                    </div>
                    <div className="row" style={{ gap: 2 }}>
                      <button className="btn btn-text btn-sm" aria-label={`Move ${i.title} up`} onClick={() => moveItem(i, -1)}>↑</button>
                      <button className="btn btn-text btn-sm" aria-label={`Move ${i.title} down`} onClick={() => moveItem(i, 1)}>↓</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDraft(i)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => { if (window.confirm(`Delete "${i.title}"? Its past clicks stay in analytics.`)) void run(() => api(`/admin/links/items/${i.id}`, { method: "DELETE" }), "Link deleted"); }}>Delete</button>
                    </div>
                  </li>
                ))}</ul>
              )}
            </div>
          ))}

          <form className="card card-tight row" onSubmit={(e) => { e.preventDefault(); if (newCat.trim()) void run(async () => { await api("/admin/links/categories", { method: "POST", body: { name: newCat.trim() } }); setNewCat(""); }, "Section added"); }}>
            <input className="input grow" style={{ width: "auto" }} maxLength={80} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New section, e.g. Free PDFs" aria-label="New section name" />
            <button className="btn btn-ghost btn-sm" type="submit">Add section</button>
          </form>
        </div>
        <Preview creator={settings.data.creator} cats={cats} items={previewItems} />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- settings

export function AdminLinksSettings() {
  const { toast } = useSession();
  const { settings, items } = useLinksData();
  const [c, setC] = useState<Creator | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (settings.data) setC(settings.data.creator); }, [settings.data]);

  if (!c || !items.data || !settings.data) {
    const err = settings.error ?? items.error;
    return <Shell title="Page settings">{err ? <ErrorBox error={err} retry={() => { void settings.reload(); void items.reload(); }} /> : <Loading />}</Shell>;
  }
  const set = <K extends keyof Creator>(k: K, v: Creator[K]) => setC({ ...c, [k]: v });
  const ads = { ...DEFAULT_ADS, ...c.ad_settings };
  const theme = { ...DEFAULT_THEME, ...c.theme };
  const dirty = JSON.stringify(settingsBody(c)) !== JSON.stringify(settingsBody(settings.data.creator));

  const save = async () => {
    setSaving(true);
    try { await api("/admin/links/settings", { method: "PUT", body: settingsBody(c) }); toast("Page settings saved", "✓"); await settings.reload(); }
    catch (e) { toast(errText(e, "Couldn't save")); } finally { setSaving(false); }
  };

  return (
    <Shell title="Page settings" intro="Your profile, social icons, colours and ads on huntexams.com/links." pageUrl={settings.data.page_url}>
      <div className="lk-split">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="card card-tight lk-form">
            <div className="field"><label htmlFor="s-name">Name</label><input id="s-name" className="input" required maxLength={80} value={c.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="field"><label htmlFor="s-tag">Tagline</label><input id="s-tag" className="input" maxLength={160} value={c.tagline} onChange={(e) => set("tagline", e.target.value)} /></div>
            <div className="field lk-wide"><label htmlFor="s-bio">Short bio <span className="faint">(also the search description)</span></label><textarea id="s-bio" className="input" maxLength={600} value={c.bio} onChange={(e) => set("bio", e.target.value)} /></div>
            <div className="field"><label htmlFor="s-av">Avatar image URL</label><input id="s-av" className="input mono" type="url" value={c.avatar_url ?? ""} onChange={(e) => set("avatar_url", e.target.value || null)} placeholder="https://… (initials if empty)" /></div>
            <div className="field"><label htmlFor="s-logo">Logo image URL</label><input id="s-logo" className="input mono" type="url" value={c.logo_url ?? ""} onChange={(e) => set("logo_url", e.target.value || null)} /></div>
            <div className="field"><label htmlFor="s-acc">Accent colour</label><div className="row"><input id="s-acc" type="color" value={theme.accent} onChange={(e) => set("theme", { ...theme, accent: e.target.value })} /><span className="mono small">{theme.accent}</span></div></div>
            <div className="field"><label htmlFor="s-hi">Highlight colour <span className="faint">(featured, badges)</span></label><div className="row"><input id="s-hi" type="color" value={theme.highlight} onChange={(e) => set("theme", { ...theme, highlight: e.target.value })} /><span className="mono small">{theme.highlight}</span></div></div>
            <div className="row lk-wide">
              <label className="switch"><input type="checkbox" checked={c.verified} onChange={(e) => set("verified", e.target.checked)} />Verified tick</label>
              <label className="switch"><input type="checkbox" checked={c.published} onChange={(e) => set("published", e.target.checked)} />Published (off = page shows 404)</label>
            </div>
          </div>

          <div className="card card-tight stack">
            <b>Social icons</b>
            {c.socials.map((s, n) => (
              <div key={n} className="row">
                <select className="input" style={{ width: 140 }} aria-label="Platform" value={s.platform} onChange={(e) => set("socials", c.socials.map((x, k) => (k === n ? { ...x, platform: e.target.value } : x)))}>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input className="input grow mono" style={{ width: "auto" }} aria-label={`${s.platform} link`} value={s.url} placeholder={s.platform === "email" ? "you@example.com" : "https://…"}
                  onChange={(e) => set("socials", c.socials.map((x, k) => (k === n ? { ...x, url: e.target.value } : x)))} />
                <button type="button" className="btn btn-text btn-sm" onClick={() => set("socials", c.socials.filter((_, k) => k !== n))}>Remove</button>
              </div>
            ))}
            {c.socials.length < 12 && <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => set("socials", [...c.socials, { platform: "youtube", url: "" }])}>+ Add social link</button></div>}
          </div>

          <div className="card card-tight stack">
            <label className="switch"><input type="checkbox" checked={ads.enabled} onChange={(e) => set("ad_settings", { ...ads, enabled: e.target.checked })} />Show ads (Google AdSense)</label>
            <p className="small faint">{settings.data.adsense_ready ? "Up to three slots, each labelled “Advertisement”. Leave a slot ID empty to skip it." : "The server has no AdSense publisher ID (HX_ADSENSE_PUBLISHER_ID) yet, so no ads load even when this is on."}</p>
            <div className="lk-form">
              {(["top", "middle", "bottom"] as const).map((k) => (
                <div key={k} className="field"><label htmlFor={`ad-${k}`}>{k[0]!.toUpperCase() + k.slice(1)} slot ID</label>
                  <input id={`ad-${k}`} className="input mono" inputMode="numeric" value={ads[k]} onChange={(e) => set("ad_settings", { ...ads, [k]: e.target.value.replace(/\D/g, "").slice(0, 20) })} /></div>
              ))}
            </div>
          </div>

          <div className="row lk-savebar">
            <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
            {dirty && <button className="btn btn-ghost" type="button" onClick={() => setC(settings.data!.creator)}>Discard</button>}
          </div>
        </form>
        <Preview creator={c} cats={items.data.categories} items={items.data.items} />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- campaigns

type Campaign = { id: string; slug: string; label: string; created_at: string; url: string };

export function AdminLinksCampaigns() {
  const { toast } = useSession();
  const { data, error, loading, reload } = useApi<Campaign[]>("/admin/links/campaigns");
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const auto = (l: string) => l.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  const add = async () => {
    try { await api("/admin/links/campaigns", { method: "POST", body: { label: label.trim(), slug: slug.trim() } }); toast("Campaign added", "✓"); setLabel(""); setSlug(""); setTouched(false); await reload(); }
    catch (e) { toast(errText(e, "Couldn't add the campaign")); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast("Link copied", "✓"); } catch { window.prompt("Copy this link", url); }
  };

  return (
    <Shell title="Campaign links" intro="Make one link per reel, story or bio placement. Visits through it are counted under that campaign in analytics.">
      <form className="card card-tight lk-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="field"><label htmlFor="c-label">Label</label>
          <input id="c-label" className="input" required maxLength={80} value={label} placeholder="Instagram bio"
            onChange={(e) => { setLabel(e.target.value); if (!touched) setSlug(auto(e.target.value)); }} /></div>
        <div className="field"><label htmlFor="c-slug">Slug <span className="faint">(a–z, 0–9, dashes)</span></label>
          <input id="c-slug" className="input mono" required maxLength={60} pattern="[a-z0-9-]{1,60}" value={slug} placeholder="insta-bio"
            onChange={(e) => { setTouched(true); setSlug(e.target.value.toLowerCase()); }} /></div>
        <div className="lk-wide row"><span className="small faint mono">huntexams.com/links?src={slug || "…"}</span><span className="grow" /><button className="btn btn-primary btn-sm" type="submit">Create campaign</button></div>
      </form>
      <div style={{ marginTop: 20 }}>
        {loading && !data ? <Loading /> : error || !data ? <ErrorBox error={error} retry={reload} /> : data.length === 0 ? <p className="muted">No campaigns yet.</p> : (
          <div className="tscroll"><table className="t"><thead><tr><th>Label</th><th>Link</th><th /></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}><td>{c.label}</td><td className="mono small">{c.url.replace(/^https?:\/\//, "")}</td>
                <td><div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => void copy(c.url)}>Copy link</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { if (window.confirm(`Delete the campaign "${c.label}"? Its past visits stay in analytics.`)) void api(`/admin/links/campaigns/${c.id}`, { method: "DELETE" }).then(() => { toast("Campaign deleted", "✓"); void reload(); }, (e) => toast(errText(e, "Couldn't delete"))); }}>Delete</button>
                </div></td></tr>
            ))}</tbody></table></div>
        )}
      </div>
    </Shell>
  );
}
