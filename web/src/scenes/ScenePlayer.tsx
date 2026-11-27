import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Scene, SceneStep } from "@/lib/types";

import { ENGINES } from "./engines";
import { FitBox } from "./FitBox";

export type SceneHandle = { go: (trackIndex: number) => void };

function visibleSteps(scene: Scene, sw: Record<string, boolean>): SceneStep[] {
  return scene.steps.filter((s) => {
    if (!s.when) return true;
    const neg = s.when.startsWith("!");
    const on = sw[s.when.replace(/^!/, "")] ?? true;
    return neg ? !on : on;
  });
}

const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

type Props = {
  scene: Scene;
  autoplay?: boolean;
  pace?: number;
  onStep?: (step: SceneStep, index: number) => void;
  onFinished?: () => void;
  jump?: { at: number; key: number } | null;
  tag?: string;
  /** Hide the "switch something off" controls (the world shows them in its Experiment step). */
  hideSwitches?: boolean;
  switchesLabel?: string;
  renderText?: (text: string) => ReactNode;
  /** "stage": the lesson player's layout. The visual fills the stage, steps and caption sit
   *  beside it, and the controls are large. "card": the compact layout used elsewhere. */
  variant?: "card" | "stage";
  /** Stage only: fit the visual to the stage height too (false on phones: width only). */
  fitHeight?: boolean;
};

type Actor = { id: string; label: string; x: number; y: number };

/** Lays a flow diagram out at the stage's size, choosing the largest box size at which no two
 *  components (box + name + note) overlap, with breathing room between them. */
function FlowArea({ scene, children }: { scene: Scene; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(64);
  // Vertical layout: an actor at y (0-100) sits at fy0 + y * fys pixels, so the diagram can use the
  // full height of the stage instead of its fixed percentages.
  const [fy, setFy] = useState<{ y0: number; s: number } | null>(null);
  const isCode = scene.engine === "code";
  useEffect(() => {
    const el = ref.current;
    if (!el || isCode || typeof ResizeObserver === "undefined") return;
    const actors = (scene.actors as Actor[] | undefined) ?? [];
    const fit = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      let best = 40;
      let bestFy: { y0: number; s: number } | null = null;
      const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const ys = actors.map((a) => a.y);
      // What each component really needs: its longest note, and whether a packet ever lands on it.
      const stepsAll = (scene.steps ?? []) as Record<string, unknown>[];
      const noteLen: Record<string, number> = {};
      const gets = new Set<string>();
      for (const st of stepsAll) {
        for (const [k, v] of Object.entries((st.notes as Record<string, string>) ?? {})) noteLen[k] = Math.max(noteLen[k] ?? 0, String(v).length);
        if (st.to && st.packet) gets.add(String(st.to));
      }
      const ymin = Math.min(...ys), ymax = Math.max(...ys), range = ymax - ymin;
      for (let b = 200; b >= 40; b -= 4) {
        // Each component is anchored at its box centre. Above the box: room for the packet that
        // lands on it. Below: its name and up to three lines of note. Sizes match player.css.
        const fNt = cl(b * 0.16, 12, 16), fNm = cl(b * 0.2, 13, 21);
        const lines = (id: string) => {
          const len = noteLen[id] ?? 0;
          if (!len) return 0;
          const wide = Math.min(22, Math.max(b * 2.1, 120) / (0.6 * fNt));
          return Math.min(3, Math.ceil(len / wide));
        };
        const aboveOf = (id: string) => b / 2 + (gets.has(id) ? 2.05 * cl(b * 0.18, 12, 17) + 12 : 4);
        const belowOf = (id: string) => b / 2 + b * 0.14 + 1.2 * fNm + lines(id) * 1.25 * fNt + 6;
        const above = Math.max(...actors.map((a) => aboveOf(a.id)));
        const below = Math.max(...actors.map((a) => belowOf(a.id)));
        if (H - above - below < 0) continue;
        // Spread the rows over the free height (never more than the original spacing).
        const sc = range > 0 ? Math.min(H / 100, (H - above - below) / range) : H / 100;
        const y0 = range > 0 ? (H - range * sc) / 2 + (above - below) / 2 - ymin * sc : above + (H - above - below) / 2 - ymin * sc;
        const bw = Math.min(Math.max(b * 2.1, 120), W * 0.3) + 16;
        const ok = actors.every((a, i) => actors.every((c, j) => j <= i
          || Math.abs(a.x - c.x) / 100 * W >= bw
          || (a.y < c.y ? belowOf(a.id) + aboveOf(c.id) : belowOf(c.id) + aboveOf(a.id)) <= Math.abs(a.y - c.y) * sc))
          && actors.every((a) => y0 + a.y * sc >= aboveOf(a.id) - 1 && H - (y0 + a.y * sc) >= belowOf(a.id) - 1);
        if (ok) { best = b; bestFy = { y0, s: sc }; break; }
      }
      setFy(bestFy);
      setBox(best);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [scene, isCode]);
  const n = String(scene.source ?? "").replace(/\n$/, "").split("\n").length;
  return (
    <div ref={ref} className={`ss-native ${scene.engine}`} style={{ ["--n" as string]: n, ["--box" as string]: `${box}px`, ...(fy ? { ["--fy0" as string]: `${fy.y0}px`, ["--fys" as string]: `${fy.s}px` } : {}) }}>
      {children}
    </div>
  );
}

export function ScenePlayer({ scene, autoplay = true, pace = 3800, onStep, onFinished, jump, tag, hideSwitches, switchesLabel, renderText, variant = "card", fitHeight = true }: Props) {
  const [sw, setSw] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((scene.switches ?? []).map((s) => [s.id, true])));
  const steps = useMemo(() => visibleSteps(scene, sw), [scene, sw]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  // Stage: the visual starts empty; the first Next shows the first component.
  const [started, setStarted] = useState(variant !== "stage");
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const reduce = useMemo(prefersReduced, []);
  const idx = Math.min(i, steps.length - 1);
  const step = steps[idx]!;
  const Engine = ENGINES[scene.engine];

  useEffect(() => { setI(0); finishedRef.current = false; setStarted(variant !== "stage"); }, [scene, variant]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    onStep?.(step, idx);
    if (idx === steps.length - 1 && !finishedRef.current) {
      finishedRef.current = true;
      onFinished?.();
    }
    // onStep/onFinished are callbacks from the parent; re-running on their identity isn't wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, step, started]);

  useEffect(() => {
    if (!playing || !visible || hover || !started) return;
    const last = idx >= steps.length - 1;
    const t = window.setTimeout(() => setI(last ? 0 : idx + 1), last ? 6500 : pace);
    return () => window.clearTimeout(t);
  }, [playing, visible, hover, idx, steps.length, pace]);

  const go = useCallback((n: number, pause = true) => {
    setI(Math.max(0, Math.min(steps.length - 1, n)));
    if (pause) setPlaying(false);
  }, [steps.length]);

  useEffect(() => {
    if (!jump) return;
    const n = steps.findIndex((s) => s.at === jump.at);
    go(n < 0 ? 0 : n);
    rootRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.key]);

  // The caption shrinks (down to 14px) until it fits its box: it never scrolls.
  const capRef = useRef<HTMLDivElement>(null);
  const [capSize, setCapSize] = useState(20);
  useLayoutEffect(() => {
    if (variant !== "stage") return;
    const box = capRef.current;
    if (!box) return;
    const fitText = () => {
      const p = box.querySelector("p");
      if (!p) return;
      let size = 21;
      p.style.fontSize = `${size}px`;
      while (size > 14 && box.scrollHeight > box.clientHeight + 1) { size -= 1; p.style.fontSize = `${size}px`; }
      setCapSize(size);
    };
    fitText();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fitText) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, [variant, step]);

  const toggleSwitch = (id: string, on: boolean, track: number) => {
    const next = { ...sw, [id]: on };
    setSw(next);
    const ns = visibleSteps(scene, next);
    const n = ns.findIndex((s) => s.at === track);
    setI(n < 0 ? 0 : n);
    setPlaying(true);
  };

  const offTracks = (scene.switches ?? []).filter((s) => !sw[s.id]).map((s) => s.track);
  const seen = new Set(steps.slice(0, idx).map((s) => s.at));
  const tone = step.tone;

  if (!Engine) return <div className="alert bad">Unknown scene engine: {scene.engine}</div>;

  const switchesUi = !hideSwitches && (scene.switches ?? []).length > 0 && (
    <div className="switches">
      <span className="label">{switchesLabel ?? "Try it: switch something off"}</span>
      {scene.switches!.map((s) => (
        <label key={s.id} className="switch">
          <input type="checkbox" checked={sw[s.id] ?? true} onChange={(e) => toggleSwitch(s.id, e.target.checked, s.track)} />
          {s.label} <small>{sw[s.id] ? s.label_on : s.label_off}</small>
        </label>
      ))}
    </div>
  );

  if (variant === "stage") {
    return (
      <div className="ss" ref={rootRef} aria-roledescription="motion scene">
        {/* Controls on top: Back in the top-left corner, Next in the top-right corner. */}
        <div className="ss-ctl">
          <button className="ss-btn" type="button" onClick={() => { if (idx === 0) setStarted(false); else go(idx - 1); }} disabled={!started} aria-label="Previous step">‹ Back</button>
          <button className="ss-btn play" type="button" onClick={() => { if (!started) { setStarted(true); setI(0); setPlaying(true); } else setPlaying((p) => !p); }} aria-pressed={playing}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
          <ol className="ss-steps" aria-label="Scene steps">
            {scene.track.map((t, k) => {
              const cls = started ? [k === step.at ? "cur" : "", seen.has(k) && k !== step.at ? "done" : "", offTracks.includes(k) ? "off" : ""].join(" ") : "";
              return (
                <li key={k}>
                  <button type="button" className={cls} aria-current={started && k === step.at ? "step" : undefined} title={t}
                    onClick={() => { setStarted(true); const n = steps.findIndex((s) => s.at === k); go(n < 0 ? idx : n); }}>
                    <i>{seen.has(k) && k !== step.at ? "✓" : k + 1}</i><span>{t}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <span className="ss-count">{started ? idx + 1 : 0} / {steps.length}</span>
          <button className="ss-btn ghost" type="button" onClick={() => { setStarted(true); setI(0); setPlaying(true); }} aria-label="Replay">↺<span className="ss-rl"> Replay</span></button>
          <button className="ss-btn ss-next" type="button" onClick={() => { if (!started) { setStarted(true); setI(0); } else go(idx + 1); }} disabled={started && idx >= steps.length - 1} aria-label="Next step">Next ›</button>
        </div>
        <div className="ss-vis" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          {!started ? (
            <div className="ss-start">
              <button type="button" className="ss-startbtn" onClick={() => { setStarted(true); setI(0); }} aria-label="Start the visual">▶</button>
              <p>It builds up one piece at a time. Tap <b>Next</b> to see the first piece.</p>
            </div>
          ) : scene.engine === "flow" || scene.engine === "code" ? (
            // Flow diagrams and code walk-throughs lay out natively at the stage's size (crisp text,
            // no scaling); the code font is sized from the number of lines.
            <FlowArea scene={scene}>
              <Engine scene={scene} step={step} index={idx} steps={steps} sw={sw} reduce={reduce} reveal />
            </FlowArea>
          ) : (
            <FitBox design={520} widths={[320, 380, 440, 520, 680, 860]} fitHeight={fitHeight} max={2.2}>
              <Engine scene={scene} step={step} index={idx} steps={steps} sw={sw} reduce={reduce} reveal />
            </FitBox>
          )}
          {switchesUi}
        </div>
        <div className="ss-side">
          <span className="ss-title">{scene.title}</span>
          <div ref={capRef} className={`ss-cap ${tone === "bad" ? "bad" : tone === "good" ? "good" : ""}`} aria-live="polite">
            <p style={{ fontSize: capSize }}>{!started ? "Tap Next to begin." : renderText ? renderText(step.caption) : step.caption}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scene" ref={rootRef} aria-roledescription="motion scene">
      <div className="scene-top">
        <span className="t">{scene.title}</span>
        {tag && <span className="pill">{tag}</span>}
      </div>
      <div className="track">
        <div className="rail" />
        <div className="fill" style={{ width: `${(step.at / Math.max(1, scene.track.length - 1)) * 84}%` }} />
        <div className="stops" style={{ gridTemplateColumns: `repeat(${scene.track.length}, minmax(0, 1fr))` }}>
          {scene.track.map((t, k) => {
            const cls = [k === step.at ? "cur" : "", seen.has(k) && k !== step.at ? "done" : "", offTracks.includes(k) ? "off" : ""].join(" ");
            return (
              <button key={k} type="button" className={cls} aria-label={`Step: ${t}`} aria-current={k === step.at ? "step" : undefined}
                onClick={() => { const n = steps.findIndex((s) => s.at === k); go(n < 0 ? idx : n); }}>
                <i>{k + 1}</i><span>{t}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <Engine scene={scene} step={step} index={idx} steps={steps} sw={sw} reduce={reduce} />
      </div>
      <div className="caption" aria-live="polite">
        <span className={`k ${tone === "bad" ? "badk" : tone === "good" ? "goodk" : ""}`}>
          Step {idx + 1} of {steps.length} · {scene.track[step.at]}
        </span>
        <p>{renderText ? renderText(step.caption) : step.caption}</p>
      </div>
      <div className="scene-ctl">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => go(idx - 1)} disabled={idx === 0}>‹ Back</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => go(idx + 1)} disabled={idx >= steps.length - 1}>Next ›</button>
        <span className="sp" />
        <button className="btn btn-text btn-sm" type="button" onClick={() => { setI(0); setPlaying(true); }}>↺ Replay</button>
      </div>
      {switchesUi}
    </div>
  );
}
