// One place in the world (a topic), full screen, one step at a time:
// See → Experiment → Build → Guided lab → Practice (optional) → done.
// Steps without content for this topic are skipped. The Read panel is always one tap away.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { ErrorBox, Loading } from "@/components/Layout";
import { api } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";
import type { Question, Topic } from "@/lib/types";
import { useTitle } from "@/lib/util";
import { QuestionCard } from "@/practice/QuestionCard";
import { ScenePlayer } from "@/scenes/ScenePlayer";

import { prefetchTopic, useFly, WarpLink, warp, whenIdle } from "./fx";
import { Words } from "./glossary";
import { useLang } from "./lang";
import { localDoneCount, markDone, useProgress } from "./progress";
import { ReadSheet } from "./ReadSheet";
import { hue, Hud, WorldLoading, worldName } from "./Shell";

// The code editor and Python sandbox are big; they download only when Build opens
// (and are prefetched quietly in the background once the page is idle).
const loadBuild = () => import("./BuildStep");
const BuildStep = lazy(() => loadBuild().then((m) => ({ default: m.BuildStep })));

type StepKey = "see" | "experiment" | "build" | "lab" | "practice" | "done";
const LABEL: Record<StepKey, string> = { see: "See", experiment: "Experiment", build: "Build", lab: "Guided lab", practice: "Practice", done: "Done" };

function useMedia(q: string) {
  const get = () => typeof window !== "undefined" && Boolean(window.matchMedia?.(q).matches);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

export function TopicWorld() {
  const { slug = "" } = useParams();
  const { to } = useLang();
  const { user, celebrate } = useSession();
  const fly = useFly();
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [params, setParams] = useSearchParams();
  const { data: t, error, loading, reload } = useApi<Topic>(`/topics/${slug}`, [user?.id]);
  const { refresh } = useProgress();
  const [readOpen, setReadOpen] = useState(false);
  const [sceneIdx, setSceneIdx] = useState(0);
  const phone = useMedia("(max-width: 700px)");
  const sentWatched = useRef(false);
  useTitle(t?.title ?? "Learning");
  useEffect(() => {
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    idle(() => { void loadBuild(); });
  }, []);

  useEffect(() => { setSceneIdx(0); setReadOpen(false); sentWatched.current = false; }, [slug]);

  const plan = useMemo(() => {
    if (!t) return null;
    const b = t.body;
    const switchScene = b.scenes.findIndex((s) => (s.switches ?? []).length > 0);
    const expQ: Question | undefined = switchScene >= 0 ? undefined : (b.checks.find((q) => q.type === "tune") ?? b.checks.find((q) => q.type === "predict"));
    const practice = b.checks.filter((q) => q !== expQ);
    const steps: StepKey[] = ["see"];
    if (switchScene >= 0 || expQ) steps.push("experiment");
    if (b.code || b.exercise) steps.push("build");
    if (t.lab) steps.push("lab");
    if (practice.length) steps.push("practice");
    steps.push("done");
    return { steps, switchScene, expQ, practice };
  }, [t]);

  const stepParam = params.get("step") as StepKey | null;
  const step: StepKey = plan && stepParam && plan.steps.includes(stepParam) ? stepParam : "see";
  const at = plan ? plan.steps.indexOf(step) : 0;

  const sendWatched = useCallback(async () => {
    if (!user || !t || sentWatched.current || t.progress?.watched) return;
    sentWatched.current = true;
    try { celebrate(await api(`/topics/${t.slug}/watched`, { method: "POST" })); void refresh(); } catch { sentWatched.current = false; }
  }, [user, t, celebrate, refresh]);

  const go = useCallback((k: StepKey) => {
    if (plan) setDir(plan.steps.indexOf(k) < plan.steps.indexOf(step) ? "back" : "fwd");
    warp(0.35);
    const next = new URLSearchParams(params);
    if (k === "see") next.delete("step"); else next.set("step", k);
    setParams(next, { replace: false });
    window.scrollTo({ top: 0 });
  }, [params, setParams, plan, step]);

  useEffect(() => {
    if (step === "done" && t) { markDone(t.slug); void sendWatched(); }
  }, [step, t, sendWatched]);
  // The next place's code and data load quietly while this one is being explored.
  useEffect(() => { if (t?.next) { const n = t.next; whenIdle(() => prefetchTopic(n)); } }, [t?.next]);

  // Arrow keys move between steps (not while typing in the editor or a field).
  useEffect(() => {
    if (!plan) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (readOpen || el.closest("input, textarea, select, .cm-editor, [contenteditable]")) return;
      if (e.key === "ArrowRight" && at < plan.steps.length - 1) go(plan.steps[at + 1]!);
      if (e.key === "ArrowLeft" && at > 0) go(plan.steps[at - 1]!);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [plan, at, go, readOpen]);

  if (loading && !t) return <><Hud /><Loading label="Travelling" /></>;
  if (error || !t || !plan) return <><Hud /><ErrorBox error={error ?? { message: "This place doesn't exist." }} retry={reload} /></>;

  const b = t.body;
  const [wc] = hue(t.level.number);
  const words = (s: string) => <Words text={s} />;
  const scene = b.scenes[sceneIdx];
  const lastScene = sceneIdx >= b.scenes.length - 1;
  const nextStep = plan.steps[at + 1];

  return (
    <div className="w-topic" style={{ ["--wc" as string]: wc }} data-step={step}>
      <Hud>
        <WarpLink back className="w-back" to={to(`/world/${t.level.slug}`)} aria-label={`Back to ${worldName(t.level.number)}`}>←</WarpLink>
        <span className="w-where"><small>{worldName(t.level.number)} · {t.number}/{t.count}</small><b>{t.title}</b></span>
      </Hud>

      <nav className="w-steps" aria-label="Steps in this place">
        {plan.steps.filter((s) => s !== "done").map((s, k) => (
          <button key={s} type="button" className={`${s === step ? "cur" : ""} ${k < at ? "past" : ""}`} aria-current={s === step ? "step" : undefined} onClick={() => go(s)}>
            <i>{k + 1}</i><span>{LABEL[s]}{s === "practice" ? " · optional" : ""}</span>
          </button>
        ))}
      </nav>

      <main className="w-stage" data-dir={dir}>
        {step === "see" && scene && (
          <section className="w-panel" aria-label="See it">
            <ScenePlayer key={`${t.slug}-${sceneIdx}`} scene={scene} hideSwitches renderText={words}
              autoplay={user?.profile.autoplay ?? true} onFinished={() => { if (lastScene) void sendWatched(); }} />
            {b.scenes.length > 1 && (
              <div className="w-dots" role="tablist" aria-label="Scenes">
                {b.scenes.map((s, k) => <button key={k} type="button" role="tab" aria-selected={k === sceneIdx} aria-label={s.title} onClick={() => setSceneIdx(k)} />)}
              </div>
            )}
          </section>
        )}

        {step === "experiment" && (
          <section className="w-panel" aria-label="Experiment">
            <h2 className="w-h">Now you control it.</h2>
            {plan.switchScene >= 0 ? (
              <ScenePlayer key={`${t.slug}-x`} scene={b.scenes[plan.switchScene]!} renderText={words} autoplay
                switchesLabel="Switch something off and watch what breaks" />
            ) : plan.expQ && (
              <QuestionCard key={`${t.slug}-${plan.expQ.id}`} topic={t.slug} q={plan.expQ} index={0} alreadyPassed={false} />
            )}
          </section>
        )}

        {step === "build" && (
          <section className="w-panel" aria-label="Build it">
            <h2 className="w-h">Build it in real Python.</h2>
            <Suspense fallback={<WorldLoading />}><BuildStep t={t} phone={phone} /></Suspense>
          </section>
        )}

        {step === "lab" && t.lab && (
          <section className="w-panel w-portal" aria-label="Guided lab">
            <div className="w-portal-ring" aria-hidden="true" />
            <span className="w-kicker">Guided lab</span>
            <h2>{t.lab.title}</h2>
            <p>A full-screen mission. You build it step by step; a guide checks every step and can show you how.</p>
            <Link className="w-enter" to={`/lab/${t.lab.slug}`}>Enter the lab ✦</Link>
          </section>
        )}

        {step === "practice" && (
          <section className="w-panel" aria-label="Practice">
            <h2 className="w-h">Practice, if you want to.</h2>
            <div className="w-qs">
              {plan.practice.map((q, k) => (
                <QuestionCard key={`${t.slug}-${q.id}`} topic={t.slug} q={q} index={k} alreadyPassed={Boolean(t.progress?.passed_ids.includes(q.id))} />
              ))}
            </div>
          </section>
        )}

        {step === "done" && (
          <section className="w-panel w-done" aria-label="Place complete">
            <div className="w-burst" aria-hidden="true">✦</div>
            <span className="w-kicker">Place explored</span>
            <h2>{t.title}</h2>
            <div className="w-row center">
              {t.next ? <WarpLink className="w-enter" to={to(`/learn/${t.next}`)} preload={t.next}>Next place →</WarpLink>
                : <WarpLink className="w-enter" to={to(`/world/${t.level.slug}`)}>Back to {worldName(t.level.number)} →</WarpLink>}
              <WarpLink back className="w-btn ghost" to={to(`/world/${t.level.slug}`)}>See the world map</WarpLink>
            </div>
            {!user && localDoneCount() >= 1 && (
              <Link className="w-card-link" to="/signup"><small>Your journey is saved in this browser only</small><b>Create a free account to keep it</b><span>Earn XP, unlock missions and get a certificate →</span></Link>
            )}
          </section>
        )}
      </main>

      <div className="w-bar">
        <button type="button" className="w-btn read" onClick={() => setReadOpen(true)} aria-haspopup="dialog">≡ Read</button>
        <span className="w-grow" />
        {at > 0 && step !== "done" && <button type="button" className="w-btn ghost" onClick={() => go(plan.steps[at - 1]!)}>← Back</button>}
        {step === "see" && !lastScene ? (
          <button type="button" className="w-btn primary" onClick={() => setSceneIdx((k) => k + 1)}>Next scene →</button>
        ) : nextStep ? (
          <button type="button" className="w-btn primary" onClick={() => go(nextStep)}>
            {nextStep === "done" ? (step === "practice" ? "Finish" : "Finish this place") : step === "lab" ? "Skip the lab for now" : `${LABEL[nextStep]} →`}
          </button>
        ) : (
          <button type="button" className="w-btn primary" onClick={() => fly(to(t.next ? `/learn/${t.next}` : `/world/${t.level.slug}`))}>Continue →</button>
        )}
      </div>

      <ReadSheet t={t} open={readOpen} onClose={() => setReadOpen(false)} />
    </div>
  );
}
