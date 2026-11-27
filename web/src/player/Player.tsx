// The lesson player: the whole site's learning layout and the home page.
// One screen that never scrolls (only its panels do): topics on the left, the visual stage in
// the middle with its steps (See → Try → Build → Quiz), the explanation underneath, and a
// lesson companion on the right. Tablets fold the side columns away; phones stack it all.
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Icon } from "@/components/Icon";
import { ErrorBox, Loading } from "@/components/Layout";
import { api } from "@/lib/api";
import { useApi, useSession } from "@/lib/session";
import type { Curriculum, Question, SceneStep, Topic } from "@/lib/types";
import { useTitle } from "@/lib/util";
import { QuestionCard } from "@/practice/QuestionCard";
import { FitBox } from "@/scenes/FitBox";
import { ScenePlayer } from "@/scenes/ScenePlayer";

import { FlyLink, prefetchTopic, useFly, whenIdle } from "./fx";
import { Words } from "./glossary";
import { LangSwitch, SoonBanner, useLang } from "./lang";
import { markDone, useProgress } from "./progress";
import { term_slug } from "./slug";

// The code editor and Python sandbox are big; they load when Build opens (prefetched when idle).
const loadBuild = () => import("./BuildStep");
const BuildStep = lazy(() => loadBuild().then((m) => ({ default: m.BuildStep })));

type StepKey = "see" | "try" | "build" | "quiz" | "done";
const LABEL: Record<StepKey, string> = { see: "See", try: "Try", build: "Build", quiz: "Quiz", done: "Done" };
const WELCOME_KEY = "hx-welcomed";
const worldName = (n: number) => (n === 0 ? "Start here" : `World ${n}`);

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

function readFlag(key: string) { try { return localStorage.getItem(key) === "1"; } catch { return false; } }
function writeFlag(key: string) { try { localStorage.setItem(key, "1"); } catch { /* private mode */ } }

/** Questions one at a time, scaled to fit the stage: never a scrollbar. */
function QuestionStage({ topic, questions, passed, phone }: { topic: string; questions: Question[]; passed: string[]; phone: boolean }) {
  const [i, setI] = useState(0);
  const q = questions[Math.min(i, questions.length - 1)]!;
  return (
    <div className="p-qwrap">
      <div className="p-qfit">
        <FitBox design={620} widths={[480, 560, 620, 760]} enabled={!phone} max={1.6}>
          <QuestionCard key={`${topic}-${q.id}`} topic={topic} q={q} index={i} alreadyPassed={passed.includes(q.id)} />
        </FitBox>
      </div>
      {questions.length > 1 && (
        <div className="p-qnav">
          <button type="button" aria-label="Previous question" onClick={() => setI((k) => Math.max(0, k - 1))} disabled={i === 0}>‹</button>
          <div className="p-carddots">
            {questions.map((x, k) => <button key={x.id} type="button" aria-label={`Question ${k + 1}`} aria-current={k === i} onClick={() => setI(k)} />)}
          </div>
          <span>Question {i + 1} of {questions.length}</span>
          <span className="p-grow" />
          <button type="button" aria-label="Next question" onClick={() => setI((k) => Math.min(questions.length - 1, k + 1))} disabled={i === questions.length - 1}>›</button>
        </div>
      )}
    </div>
  );
}

type TextCard = { key: string; title: string; body: ReactNode; step?: number };

/** The explanation as cards that slide (arrows, dots, swipe, arrow keys), never scroll.
 *  All cards share one grid cell, so the panel is as tall as the tallest card. While the
 *  visual plays, the card for its current step slides in, unless the learner just swiped. */
/** Notes beside the visual: the text takes the largest size (22px down to 14px) until every card fits the column. */
function SideNotes({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let f = 22;
      el.style.setProperty("--nfs", `${f}px`);
      // Phones: the column has no fixed height, so keep the normal size.
      if (getComputedStyle(el).overflow === "visible") { el.style.setProperty("--nfs", "17px"); return; }
      while (f > 14 && el.scrollHeight > el.clientHeight + 1) { f -= 1; el.style.setProperty("--nfs", `${f}px`); }
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  });
  return <div ref={ref} className="p-sidenotes">{children}</div>;
}

function TextCards({ cards, follow, head }: { cards: TextCard[]; follow: number | null; head?: ReactNode }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const manualUntil = useRef(0);
  const startX = useRef<number | null>(null);
  const n = cards.length;
  const show = useCallback((k: number, manual: boolean) => {
    if (k < 0 || k >= n) return;
    if (manual) manualUntil.current = Date.now() + 12000;
    setI((cur) => { setDir(k < cur ? "back" : "fwd"); return k; });
  }, [n]);
  useEffect(() => {
    if (follow === null || Date.now() < manualUntil.current) return;
    const k = cards.findIndex((c) => c.step === follow);
    if (k >= 0) show(k, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);
  return (
    <div className="p-cardset"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.stopPropagation(); show(i + 1, true); }
        if (e.key === "ArrowLeft") { e.stopPropagation(); show(i - 1, true); }
      }}
      onPointerDown={(e) => { startX.current = e.clientX; }}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1), true);
      }}>
      <div className="p-cardhead">
        {head}
        {n > 1 && (
          <div className="p-cardnav">
            <button type="button" aria-label="Previous card" onClick={() => show(i - 1, true)} disabled={i === 0}>‹</button>
            <div className="p-carddots">
              {cards.map((c, k) => <button key={c.key} type="button" aria-label={`Card ${k + 1}: ${c.title}`} aria-current={k === i} onClick={() => show(k, true)} />)}
            </div>
            <span className="p-cardcount">{i + 1} / {n}</span>
            <button type="button" aria-label="Next card" onClick={() => show(i + 1, true)} disabled={i === n - 1}>›</button>
          </div>
        )}
      </div>
      <div className="p-cards" aria-live="polite">
        {cards.map((c, k) => (
          <div key={c.key} className={`p-tcard ${k === i ? "on" : ""}`} data-dir={dir} aria-hidden={k !== i} role="group" aria-label={`${k + 1} of ${n}: ${c.title}`}>
            <b className="p-tcard-title">{c.title}</b>
            <div className="p-tcard-body">{c.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- top bar

function ThemeButton() {
  const { theme, setTheme } = useSession();
  return (
    <button type="button" className="p-icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

function Account() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!user) return <Link className="p-signin" to="/login">Sign in</Link>;
  return (
    <div className="p-account" ref={ref}>
      <button type="button" className="p-avatar" aria-label="Your account" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {user.name.trim()[0]?.toUpperCase() ?? "?"}
      </button>
      {open && (
        <div className="p-menu" role="menu">
          <b>{user.name}</b>
          <Link role="menuitem" to="/dashboard">My progress</Link>
          <Link role="menuitem" to="/missions">Missions</Link>
          <Link role="menuitem" to="/certificate">Certificate</Link>
          <Link role="menuitem" to="/profile">Settings</Link>
          {user.role === "admin" && <Link role="menuitem" to="/admin">Admin</Link>}
          <button type="button" role="menuitem" onClick={() => void logout()}>Log out</button>
        </div>
      )}
    </div>
  );
}

function Search({ cur, open, onClose }: { cur: Curriculum | null; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const fly = useFly();
  const { to } = useLang();
  const all = useMemo(() => (cur?.levels ?? []).flatMap((lv) => lv.topics.map((t) => ({ ...t, world: worldName(lv.number) }))), [cur]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return all.filter((t) => `${t.title} ${t.summary}`.toLowerCase().includes(s)).slice(0, 8);
  }, [all, q]);
  const go = (slug: string) => { setQ(""); onClose(); fly(to(`/learn/${slug}`)); };
  return (
    <div className={`p-search ${open ? "open" : ""}`}>
      <label className="p-search-box">
        <Icon name="search" />
        <input type="search" value={q} placeholder="Search any topic: RAG, tokens, agents…" aria-label="Search topics"
          onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => window.setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go(hits[0].slug); if (e.key === "Escape") { setQ(""); onClose(); } }} />
      </label>
      {focus && q.trim() && (
        <div className="p-results" role="listbox" aria-label="Matching topics">
          {hits.length ? hits.map((h) => (
            <button key={h.slug} type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h.slug)}>
              <b>{h.title}</b><span>{h.world} · {h.summary}</span>
            </button>
          )) : <p>No topic matches “{q.trim()}”.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sidebar

function Sidebar({ cur, current, done, open, onClose }: { cur: Curriculum; current: string; done: Set<string>; open: boolean; onClose: () => void }) {
  const { to } = useLang();
  const here = cur.levels.find((lv) => lv.topics.some((t) => t.slug === current));
  const [expanded, setExpanded] = useState<string | null>(here?.slug ?? cur.levels[0]?.slug ?? null);
  useEffect(() => { if (here) setExpanded(here.slug); }, [here]);
  const total = cur.levels.reduce((n, lv) => n + lv.topics.length, 0);
  const finished = cur.levels.reduce((n, lv) => n + lv.topics.filter((t) => done.has(t.slug)).length, 0);
  return (
    <>
      {open && <div className="p-scrim" onClick={onClose} aria-hidden="true" />}
      <nav className={`p-side ${open ? "open" : ""}`} aria-label="Topics">
        <div className="p-course">
          <b>{cur.path.title}</b>
          <div className="p-progress-row"><span>Your progress</span><span>{finished} / {total}</span></div>
          <div className="p-bar"><span style={{ width: `${total ? (finished / total) * 100 : 0}%` }} /></div>
        </div>
        {cur.levels.map((lv) => {
          const isOpen = expanded === lv.slug;
          const n = lv.topics.filter((t) => done.has(t.slug)).length;
          // A world with a single topic (Start here) is one link, with no sub-topics.
          if (lv.topics.length === 1) {
            const t = lv.topics[0]!;
            const isCur = t.slug === current, isDone = done.has(t.slug);
            return (
              <section key={lv.slug} className="p-world">
                <FlyLink to={to(`/learn/${t.slug}`)} preload={t.slug} className={`p-topic p-single ${isCur ? "cur" : ""} ${isDone ? "done" : ""}`} aria-current={isCur ? "page" : undefined} onClick={onClose}>
                  <span className="p-dot" aria-hidden="true">{isDone ? "✓" : ""}</span>
                  <span><small>{lv.title}</small>{t.title}</span>
                </FlyLink>
              </section>
            );
          }
          return (
            <section key={lv.slug} className="p-world">
              <button type="button" className="p-world-btn" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : lv.slug)}>
                <span><small>{worldName(lv.number)}</small>{lv.title}</span>
                <em>{n}/{lv.topics.length}</em>
              </button>
              {isOpen && (
                <ol>
                  {lv.topics.map((t) => {
                    const isCur = t.slug === current, isDone = done.has(t.slug);
                    return (
                      <li key={t.slug}>
                        <FlyLink to={to(`/learn/${t.slug}`)} preload={t.slug} className={`p-topic ${isCur ? "cur" : ""} ${isDone ? "done" : ""}`}
                          aria-current={isCur ? "page" : undefined} onClick={onClose}>
                          <span className="p-dot" aria-hidden="true">{isDone ? "✓" : ""}</span>
                          <span>{t.title}</span>
                          {t.lab && <i title="Has a guided lab">lab</i>}
                        </FlyLink>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
        <div className="p-side-foot">
          <Link to={to("/glossary")}>Glossary</Link><Link to="/guides">Guides</Link><Link to="/about">About</Link>
          <Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link>
        </div>
      </nav>
    </>
  );
}

// ---------------------------------------------------------------- the player

export function Player({ home = false }: { home?: boolean }) {
  const params = useParams();
  const { user, celebrate } = useSession();
  const { to } = useLang();
  const fly = useFly();
  const [search, setSearch] = useSearchParams();
  const { data: cur, error: curErr, reload: reloadCur } = useApi<Curriculum>("/curriculum");
  const { done, refresh } = useProgress();
  const firstSlug = cur?.levels.find((lv) => lv.topics.length)?.topics[0]?.slug;
  const slug = params.slug ?? (home ? firstSlug : undefined);
  const { data: t, error, loading, reload } = useApi<Topic>(slug ? `/topics/${slug}` : null, [user?.id]);
  const [mode, setMode] = useState<"simple" | "eng">(user?.profile.explain_mode ?? "simple");
  const [sceneIdx, setSceneIdx] = useState(0);

  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [welcomed, setWelcomed] = useState(() => readFlag(WELCOME_KEY));
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [readOpen, setReadOpen] = useState(false);
  const [sceneAt, setSceneAt] = useState<number | null>(null);
  const phone = useMedia("(max-width: 700px)");
  const sentWatched = useRef(false);
  useTitle(home ? "Learn agentic AI with visuals" : (t?.title ?? "Learn"));

  // The player owns the whole screen: the page itself never scrolls.
  useEffect(() => {
    document.documentElement.classList.add("in-player");
    return () => document.documentElement.classList.remove("in-player");
  }, []);
  useEffect(() => { setSceneIdx(0); setSceneAt(null); sentWatched.current = false; setDrawer(false); }, [slug]);
  useEffect(() => { if (user) setMode(user.profile.explain_mode); }, [user]);
  useEffect(() => { whenIdle(() => { void loadBuild(); }); }, []);
  useEffect(() => { if (t?.next) { const n = t.next; whenIdle(() => prefetchTopic(n)); } }, [t?.next]);

  const plan = useMemo(() => {
    if (!t) return null;
    const b = t.body;
    const switchScene = b.scenes.findIndex((s) => (s.switches ?? []).length > 0);
    // Try is hands-on only (switch parts off and compare). Questions belong in the quiz.
    const tryQ: Question | undefined = undefined;
    const quiz = b.checks;
    const steps: StepKey[] = ["see"];
    if (switchScene >= 0 || tryQ) steps.push("try");
    if (b.code || b.exercise) steps.push("build");
    if (quiz.length) steps.push("quiz");
    return { steps, switchScene, tryQ, quiz };
  }, [t]);

  const raw = search.get("step") as StepKey | null;
  const step: StepKey = plan && raw && (plan.steps.includes(raw) || raw === "done") ? raw : "see";
  const at = plan ? (step === "done" ? plan.steps.length : plan.steps.indexOf(step)) : 0;

  const sendWatched = useCallback(async () => {
    if (!user || !t || sentWatched.current || t.progress?.watched) return;
    sentWatched.current = true;
    try { celebrate(await api(`/topics/${t.slug}/watched`, { method: "POST" })); void refresh(); } catch { sentWatched.current = false; }
  }, [user, t, celebrate, refresh]);

  const go = useCallback((k: StepKey) => {
    if (!plan) return;
    const target = k === "done" ? plan.steps.length : plan.steps.indexOf(k);
    setDir(target < at ? "back" : "fwd");
    const next = new URLSearchParams(search);
    if (k === "see") next.delete("step"); else next.set("step", k);
    setSearch(next);
  }, [plan, at, search, setSearch]);

  useEffect(() => {
    if (step === "done" && t) { markDone(t.slug); void sendWatched(); }
  }, [step, t, sendWatched]);

  // Arrow keys move between steps (not while typing).
  useEffect(() => {
    if (!plan) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, .cm-editor, [contenteditable], .p-cardset")) return;
      const order: StepKey[] = [...plan.steps, "done"];
      if (e.key === "ArrowRight" && at < order.length - 1) go(order[at + 1]!);
      if (e.key === "ArrowLeft" && at > 0) go(order[at - 1]!);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [plan, at, go]);

  const nextTopicTitle = useMemo(() => {
    if (!t?.next || !cur) return null;
    for (const lv of cur.levels) for (const x of lv.topics) if (x.slug === t.next) return x.title;
    return null;
  }, [cur, t?.next]);

  const resume = useMemo(() => {
    if (!home || !cur || !done.size) return null;
    for (const lv of cur.levels) for (const x of lv.topics) if (!done.has(x.slug)) return x;
    return null;
  }, [home, cur, done]);

  const closeWelcome = () => { writeFlag(WELCOME_KEY); setWelcomed(true); };

  // ------------------------------------------------------------ frame
  const frame = (main: ReactNode, side?: ReactNode) => (
    <div className="p-root">
      <header className="p-top">
        <button type="button" className="p-icon p-menu-btn" aria-label="All topics" aria-expanded={drawer} onClick={() => setDrawer((d) => !d)}>
          <Icon name="menu" />
        </button>
        <Link to={to("/")} className="p-logo" aria-label="HuntExams home"><span className="mark" aria-hidden="true" /><span>HuntExams</span></Link>
        <Search cur={cur} open={searchOpen} onClose={() => setSearchOpen(false)} />
        <span className="p-grow" />
        <button type="button" className="p-icon p-search-btn" aria-label="Search topics" onClick={() => setSearchOpen((s) => !s)}><Icon name="search" /></button>
        <span className="p-lang"><LangSwitch /></span>
        <ThemeButton />
        <Account />
      </header>
      <SoonBanner />
      <div className="p-body">
        {cur && <Sidebar cur={cur} current={slug ?? ""} done={done} open={drawer} onClose={() => setDrawer(false)} />}
        {main}
        {side}
      </div>
    </div>
  );

  if (!cur && curErr) return frame(<main className="p-mid"><ErrorBox error={curErr} retry={reloadCur} /></main>);
  if ((loading || !slug) && !t) return frame(<main className="p-mid"><Loading label="Opening the lesson" /></main>);
  if (error || !t || !plan) {
    return frame(
      <main className="p-mid">
        <div className="p-missing"><h1>This topic doesn't exist</h1><p>It may have moved. Pick one from the list, or start at the beginning.</p>
          <Link className="p-btn primary" to={to("/")}>Start learning</Link></div>
        {error && error.status !== 404 && <ErrorBox error={error} retry={reload} />}
      </main>,
    );
  }

  const b = t.body;
  const order: StepKey[] = [...plan.steps, "done"];
  const nextStep = order[at + 1];
  const scene = b.scenes[sceneIdx];
  const lastScene = sceneIdx >= b.scenes.length - 1;
  const words = (s: string) => <Words text={s} />;
  const onStep = (s: SceneStep) => { if (step === "see" && sceneIdx === 0) setSceneAt(s.at); };
  const techPoints = b.points.filter((p) => p.eng);
  const nextLabel = nextStep === "done" ? "Finish topic" : nextStep ? `Next: ${LABEL[nextStep]}` : "";

  // The Simple English / Technical notes. On See and Try they sit in the column beside the visual;
  // on Build and Quiz (no column) "Read notes" opens them as a panel.
  const notes = (closable: boolean) => (
    <TextCards key={`${t.slug}-${mode}`} follow={step === "see" && sceneIdx === 0 ? sceneAt : null}
      head={<>
        <div className="p-toggle" role="group" aria-label="Explanation style">
          <button type="button" aria-pressed={mode === "simple"} onClick={() => setMode("simple")}>Simple English</button>
          <button type="button" aria-pressed={mode === "eng"} onClick={() => setMode("eng")}>Technical</button>
        </div>
        {closable && <button type="button" className="p-read-close" onClick={() => setReadOpen(false)} aria-label="Close the notes">✕</button>}
      </>}
      cards={[
      ...(mode === "simple"
        ? [{ key: "intro", title: "In short", body: <p className="lead"><Words text={b.intro} /></p> },
          ...b.points.map((p, k) => ({ key: `p${k}`, title: p.title, step: p.step, body: <p><Words text={p.text} /></p> }))]
        : [{ key: "intro", title: "How it works", body: <p className="lead"><Words text={b.intro_eng ?? "This topic is mostly about the idea, so the simple explanation is the full story."} /></p> },
          ...techPoints.map((p, k) => ({ key: `e${k}`, title: p.title, step: p.step, body: <p><Words text={p.eng!} /></p> }))]),
      ...(b.words && b.words.length ? [{ key: "words", title: "Words to know", body: (
        <div className="p-chips">{b.words.map(([w]) => <Link key={w} to={to(`/glossary/${term_slug(w)}`)} className="p-chip">{w}</Link>)}</div>
      ) }] : []),
    ]} />
  );
  const sideNotes = <SideNotes>{notes(false)}</SideNotes>;
  const notesInSide = step === "see" || (step === "try" && plan.switchScene >= 0);

  const stage = (
    <div className="p-stage" data-dir={dir} data-step={step}>
      {step === "see" && scene && (
        <div className="p-panel p-see" key={`see-${sceneIdx}`}>
          <ScenePlayer key={`${t.slug}-${sceneIdx}`} scene={scene} hideSwitches renderText={words} onStep={onStep} variant="stage" fitHeight={!phone} side={sideNotes}
            autoplay={false} onFinished={() => { if (lastScene) void sendWatched(); }} />
        </div>
      )}
      {step === "try" && (
        <div className={`p-panel ${plan.switchScene >= 0 ? "p-try-scene" : "p-try-q"}`} key="try">
          <ol className="p-guide" aria-label="How to try it">
            <li><b>1</b>Press Next and watch it work normally</li>
            <li><b>2</b>Switch a part off below the picture</li>
            <li><b>3</b>Press Replay and see what breaks</li>
          </ol>
          {plan.switchScene >= 0 ? (
            <ScenePlayer key={`${t.slug}-try`} scene={b.scenes[plan.switchScene]!} renderText={words} onStep={onStep} autoplay={false} variant="stage" fitHeight={!phone} side={sideNotes} switchesLabel="Switch something off and watch what breaks" />
          ) : plan.tryQ && <QuestionStage topic={t.slug} questions={[plan.tryQ]} passed={t.progress?.passed_ids ?? []} phone={phone} />}
        </div>
      )}
      {step === "build" && (
        <div className="p-panel p-build" key="build">
          <Suspense fallback={<Loading label="Loading Python" />}><BuildStep t={t} phone={phone} /></Suspense>
        </div>
      )}
      {step === "quiz" && (
        <div className="p-panel p-quiz" key="quiz">
          <QuestionStage topic={t.slug} questions={plan.quiz} passed={t.progress?.passed_ids ?? []} phone={phone} />
        </div>
      )}
      {step === "done" && (
        <div className="p-panel p-done" key="done">
          <div className="p-check" aria-hidden="true">✓</div>
          <span className="p-kicker">Topic complete</span>
          <h2>{t.title}</h2>
          <div className="p-row center">
            {t.lab && <Link className="p-btn primary" to={`/lab/${t.lab.slug}`}>Start the guided lab: {t.lab.title}</Link>}
            {t.next && <FlyLink className={`p-btn ${t.lab ? "" : "primary"}`} to={to(`/learn/${t.next}`)} preload={t.next}>Next topic: {nextTopicTitle ?? "continue"} →</FlyLink>}
          </div>
          {!user && <p className="p-note">Your progress is saved in this browser. <Link to="/signup">Create a free account</Link> to keep it everywhere and earn your certificate.</p>}
        </div>
      )}
    </div>
  );

  // The one "move on" button: next scene, next step, or next topic. Lives in the header (and in
  // the bottom bar on phones).
  const stepNext = step === "see" && !lastScene ? (
    <button type="button" className="p-btn primary" onClick={() => setSceneIdx((k) => k + 1)}>Next scene ({sceneIdx + 2}/{b.scenes.length}) →</button>
  ) : step === "done" ? (
    t.next ? <button type="button" className="p-btn primary" onClick={() => fly(to(`/learn/${t.next}`))}>Next topic →</button>
      : <Link className="p-btn primary" to={to("/")}>Back to the start</Link>
  ) : (
    <button type="button" className="p-btn primary" onClick={() => go(nextStep!)}>{nextLabel} →</button>
  );

  const main = (
    <main className="p-mid">
      <div className="p-head">
        <button type="button" className="p-back" onClick={() => at > 0 && go(order[at - 1]!)} disabled={at === 0} aria-label="Back to the previous step" title="Back">←</button>
        <div className="p-title">
          <span className="p-crumb">{t.count > 1 ? `${worldName(t.level.number)} · ${t.level.title} · Topic ${t.number} of ${t.count}` : t.level.title}</span>
          <h1>{t.title}</h1>
        </div>
        <div className="p-nav">
          {!notesInSide && <button type="button" className="p-readtop" aria-expanded={readOpen} onClick={() => setReadOpen((o) => !o)} title="The full explanation, in Simple English or Technical">Read notes</button>}
          {t.lab && <Link className="p-lab" to={`/lab/${t.lab.slug}`} title="A hands-on project, step by step"><span aria-hidden="true">⚗</span> Guided lab</Link>}
        <ol className="p-steps" aria-label="Steps">
          {plan.steps.map((s, k) => (
            <li key={s}>
              <button type="button" className={`p-step ${s === step ? "cur" : ""} ${k < at ? "past" : ""}`} aria-current={s === step ? "step" : undefined} onClick={() => go(s)}>
                <i>{k < at ? "✓" : k + 1}</i><span>{LABEL[s]}</span>
              </button>
            </li>
          ))}
        </ol>
        </div>
        <div className="p-go">{stepNext}</div>
      </div>

      {home && !welcomed && (
        <div className="p-welcome" role="status">
          {resume
            ? <span>Welcome back. Continue where you left off: <FlyLink to={to(`/learn/${resume.slug}`)} preload={resume.slug}>{resume.title} →</FlyLink></span>
            : <span>Learn agentic AI by watching it move. Follow the steps.</span>}
          <button type="button" onClick={closeWelcome} aria-label="Close">✕</button>
        </div>
      )}

      {stage}

      <div className="p-ctl">
        {at > 0
          ? <button type="button" className="p-btn" onClick={() => go(order[at - 1]!)}>← Back</button>
          : <span />}
        {stepNext}
      </div>

      {readOpen && !notesInSide && <button type="button" className="p-text-scrim" aria-label="Close the notes" onClick={() => setReadOpen(false)} />}
      <section className={`p-text ${readOpen && !notesInSide ? "open" : ""}`} aria-label="Explanation" aria-hidden={!readOpen || notesInSide} onKeyDown={(e) => { if (e.key === "Escape") setReadOpen(false); }}>
        {notes(true)}
      </section>
    </main>
  );

  return frame(main);
}
