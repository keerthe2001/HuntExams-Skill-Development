// Arrival and the universe: one line, "Enter", then every world of the AI roadmap as a planet
// on a glowing path. Tap a planet to land on it.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";

import { ErrorBox } from "@/components/Layout";
import { useApi } from "@/lib/session";
import type { Curriculum } from "@/lib/types";
import { useTitle } from "@/lib/util";

import { prefetchTopic, WarpLink, whenIdle } from "./fx";
import { useLang } from "./lang";
import { useProgress } from "./progress";
import { hue, Hud, PathLine, pathPoints, WorldFooter, worldName } from "./Shell";

const SEEN = "hx-arrived";

export function Planet({ n, size, done, total, pulse }: { n: number; size: number; done: number; total: number; pulse?: boolean }) {
  // Same name on the roadmap and on the world page, so the planet flies between them.
  const vt = { viewTransitionName: `planet-${n}` };
  const [a, b] = hue(n);
  const r = size / 2 + 7;
  const c = 2 * Math.PI * r;
  return (
    <span className={`w-planet ${pulse ? "pulse" : ""}`} style={{ ...vt, width: size, height: size, ["--pa" as string]: a, ["--pb" as string]: b }}>
      <svg viewBox={`0 0 ${size + 18} ${size + 18}`} className="w-ring" aria-hidden="true">
        <circle cx={size / 2 + 9} cy={size / 2 + 9} r={r} className="bg" />
        <circle cx={size / 2 + 9} cy={size / 2 + 9} r={r} className="fg" strokeDasharray={`${total ? (done / total) * c : 0} ${c}`} />
      </svg>
      <span className="w-planet-num">{n === 0 ? "✦" : n}</span>
    </span>
  );
}

export function WorldHome({ arrival = true }: { arrival?: boolean }) {
  useTitle("The AI roadmap");
  const { to } = useLang();
  const { hash } = useLocation();
  const { data, error, reload } = useApi<Curriculum>("/curriculum");
  const { done } = useProgress();
  const [entered, setEntered] = useState(() => {
    if (!arrival) return true;
    try { return sessionStorage.getItem(SEEN) === "1"; } catch { return false; }
  });
  const [leaving, setLeaving] = useState(false);
  const enterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (!entered) enterRef.current?.focus(); }, [entered]);

  const enter = () => {
    try { sessionStorage.setItem(SEEN, "1"); } catch { /* fine */ }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setLeaving(true);
    window.setTimeout(() => setEntered(true), reduce ? 0 : 900);
  };

  const worlds = data?.levels ?? [];
  const stats = useMemo(() => worlds.map((w) => ({ total: w.topics.length, done: w.topics.filter((t) => done.has(t.slug)).length })), [worlds, done]);
  const current = Math.max(0, stats.findIndex((s) => s.done < s.total));
  const ROW = 230;
  const pts = pathPoints(worlds.length, ROW, 24);
  const firstTopic = worlds[0]?.topics.find((t) => !done.has(t.slug)) ?? worlds[0]?.topics[0];
  // Have the first place ready before the learner taps it.
  useEffect(() => { if (firstTopic) whenIdle(() => prefetchTopic(firstTopic.slug)); }, [firstTopic]);

  useEffect(() => {
    if (!entered || !worlds.length || hash) return;
    if (current > 1) document.getElementById(`world-${current}`)?.scrollIntoView({ block: "center" });
  }, [entered, worlds.length, current, hash]);

  return (
    <>
      {!entered && (
        <div className={`w-arrive ${leaving ? "leaving" : ""}`}>
          <div className="w-arrive-in">
            <span className="w-kicker">HuntExams · the AI roadmap</span>
            <h1>Learn how AI agents think.</h1>
            <p>Not by reading. By stepping inside.</p>
            <button ref={enterRef} type="button" className="w-enter" onClick={enter}>Step inside <span aria-hidden="true">✦</span></button>
          </div>
        </div>
      )}
      <Hud />
      <main className={`w-universe ${entered ? "in" : ""}`} aria-label="The AI roadmap">
        <div className="w-uni-head">
          <span className="w-kicker">The AI roadmap</span>
          <h1>Your journey to agentic AI</h1>
          {firstTopic && <WarpLink className="w-go" to={to(`/learn/${firstTopic.slug}`)} preload={firstTopic.slug}>{done.size ? "Continue" : "Start here"} → {firstTopic.title}</WarpLink>}
        </div>
        {error && !data ? <ErrorBox error={error} retry={reload} /> : (
          <div className="w-map" style={{ height: worlds.length * ROW }}>
            <PathLine points={pts} height={worlds.length * ROW} doneUpTo={current} />
            {worlds.map((w, i) => {
              const s = stats[i]!;
              const p = pts[i]!;
              return (
                <WarpLink key={w.slug} id={`world-${i}`} to={to(`/world/${w.slug}`)} className={`w-node w-world ${p.x > 50 ? "right" : "left"}`}
                  style={{ left: `${p.x}%`, top: p.y, ["--i" as string]: i }} aria-label={`${worldName(w.number)}: ${w.title}. ${s.done} of ${s.total} places done.`}>
                  <Planet n={w.number} size={i === current ? 108 : 86} done={s.done} total={s.total} pulse={i === current} />
                  <span className="w-node-label">
                    <small>{worldName(w.number)}{w.optional ? " · optional" : ""}</small>
                    <b>{w.title}</b>
                    <em>{s.done ? `${s.done}/${s.total} places` : `${s.total} places`}</em>
                  </span>
                </WarpLink>
              );
            })}
          </div>
        )}
        <WorldFooter />
      </main>
    </>
  );
}
