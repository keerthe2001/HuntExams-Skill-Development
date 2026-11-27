// The frame around every place in the world: space behind, a small HUD on top, and nothing else.
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { useSession } from "@/lib/session";

import { loadTopicWorld, useRipples, whenIdle, WarpLink } from "./fx";
import { GlossaryProvider } from "./glossary";
import { LangSwitch, SoonBanner, useLang } from "./lang";
import { Space } from "./Space";

/** Planet colours per world (level number). */
export const WORLD_HUES: [string, string][] = [
  ["#9fb4c8", "#3d4f63"], ["#ffb27a", "#b3471d"], ["#ffd86b", "#b37b0c"], ["#6ef2a5", "#137a48"],
  ["#7cc4ff", "#1c5bb8"], ["#b8a2ff", "#5534c4"], ["#ff8cc6", "#a3266a"], ["#5ff0dd", "#0d7f74"], ["#ffffff", "#7a8aa8"],
];
export const hue = (n: number) => WORLD_HUES[Math.max(0, Math.min(8, n))]!;
export const worldName = (n: number) => (n === 0 ? "Starter world" : `World ${n}`);

function Profile() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!user) return <Link className="w-chip" to="/login">Sign in</Link>;
  return (
    <div className="w-profile" ref={ref}>
      <button type="button" className="w-avatar" aria-label="Your account" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {user.name.trim()[0]?.toUpperCase() ?? "?"}
      </button>
      {open && (
        <div className="w-menu" role="menu">
          <b>{user.name}</b>
          <Link role="menuitem" to="/dashboard">My progress</Link>
          <Link role="menuitem" to="/missions">Missions</Link>
          <Link role="menuitem" to="/certificate">Certificate</Link>
          <Link role="menuitem" to="/profile">Settings</Link>
          {user.role === "admin" && <Link role="menuitem" to="/admin">Admin</Link>}
          <button type="button" role="menuitem" onClick={() => void logout().then(() => nav("/"))}>Log out</button>
        </div>
      )}
    </div>
  );
}

export function Hud({ children }: { children?: ReactNode }) {
  const { to } = useLang();
  return (
    <header className="w-hud">
      <WarpLink back to={to("/learn")} className="w-logo" aria-label="HuntExams: the AI roadmap"><span className="mark" aria-hidden="true" /><span>HuntExams</span></WarpLink>
      <div className="w-hud-mid">{children}</div>
      <div className="w-hud-right"><LangSwitch /><Profile /></div>
    </header>
  );
}

/** Shown while a place's code loads: the space stays, a soft glow pulses. */
export function WorldLoading() {
  return <div className="w-loading" role="status" aria-label="Loading"><span /></div>;
}

/** Layout route for the world: space background, word help and the language note. */
export function WorldShell() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  useRipples();
  useEffect(() => { whenIdle(() => { void loadTopicWorld(); }); }, []);
  useEffect(() => {
    document.documentElement.classList.add("in-world");
    return () => document.documentElement.classList.remove("in-world");
  }, []);
  return (
    <GlossaryProvider>
      <div className="world">
        <Space />
        <SoonBanner />
        <Suspense fallback={<WorldLoading />}><Outlet /></Suspense>
      </div>
    </GlossaryProvider>
  );
}

/** A winding glowing path through N places, top to bottom. */
export function pathPoints(n: number, row: number, amp = 26): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: 50 + amp * Math.sin(i * 1.15 + 0.4), y: i * row + row / 2 }));
}

export function PathLine({ points, height, doneUpTo }: { points: { x: number; y: number }[]; height: number; doneUpTo: number }) {
  if (points.length < 2) return null;
  const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const my = (a.y + b.y) / 2;
    return `C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
  };
  const d = points.slice(1).reduce((acc, p, i) => `${acc} ${seg(points[i]!, p)}`, `M ${points[0]!.x} ${points[0]!.y}`);
  const lit = doneUpTo > 0 ? points.slice(1, doneUpTo + 1).reduce((acc, p, i) => `${acc} ${seg(points[i]!, p)}`, `M ${points[0]!.x} ${points[0]!.y}`) : "";
  return (
    <svg className="w-path" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <path d={d} className="w-path-base" vectorEffect="non-scaling-stroke" />
      {lit && <path d={lit} className="w-path-lit" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function WorldFooter() {
  const { to } = useLang();
  return (
    <footer className="w-foot">
      <Link to={to("/glossary")}>Glossary</Link><Link to="/guides">Guides</Link><Link to="/pricing">Pricing</Link>
      <Link to="/about">About</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/verify">Verify a certificate</Link>
    </footer>
  );
}
