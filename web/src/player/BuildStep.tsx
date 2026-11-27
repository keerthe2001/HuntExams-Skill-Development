// The Build step, laid out to fit the stage with no scrolling:
//   Watch it run: the code on the left (the running line lights up; tap a line to explain it),
//                 the live run on the right (what this line did, variables, output).
//   Your turn:    the task and an editor on the left, the result on the right.
// Phones use tap-to-build blocks for the exercise.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { CodeEditor, type EditorHandle } from "@/code/CodeEditor";
import { reportRun } from "@/code/CodeSection";
import { STATUS_TEXT, useSandboxStatus } from "@/code/useSandbox";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Topic, TopicBody } from "@/lib/types";
import { highlight } from "@/lib/util";
import { buildFrames, explainError, type VisualFrame } from "@/sandbox/narrate";
import { sandbox, type RunResult } from "@/sandbox/runner";

import { BlockBuilder, canBlockBuild } from "./BlockBuilder";
import { Words } from "./glossary";

type Code = NonNullable<TopicBody["code"]>;
type Ex = NonNullable<TopicBody["exercise"]>;

/** Runs code in the sandbox and replays it line by line. */
function useRun() {
  const [ran, setRan] = useState<{ src: string; result: RunResult } | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frames: VisualFrame[] = useMemo(() => (ran ? buildFrames(ran.result.steps ?? [], ran.src, ran.result.error) : []), [ran]);
  useEffect(() => {
    if (!playing) return;
    if (i >= frames.length - 1) { setPlaying(false); return; }
    const t = window.setTimeout(() => setI((x) => x + 1), frames.length > 60 ? 350 : 1100);
    return () => window.clearTimeout(t);
  }, [playing, i, frames.length]);
  const start = (src: string, result: RunResult) => { setRan({ src, result }); setI(0); setPlaying(true); };
  const cur = frames.length ? frames[Math.min(i, frames.length - 1)]! : null;
  return { ran, frames, i, setI, playing, setPlaying, start, cur, reset: () => { setRan(null); setPlaying(false); } };
}

type Run = ReturnType<typeof useRun>;

function RunPanel({ run, empty, note }: { run: Run; empty: string; note?: ReactNode }) {
  const { cur, frames, i, setI, playing, setPlaying, ran } = run;
  if (!ran) return <div className="b-run b-empty">{note ? <div className="b-note">{note}</div> : <><span className="b-play" aria-hidden="true">▶</span><p>{empty}</p></>}</div>;
  if (!cur) {
    return (
      <div className="b-run">
        {ran.result.error ? <div className="b-says bad"><b>{ran.result.error.type}</b> {explainError(ran.result.error)}</div>
          : <div className="b-says">Nothing ran. Write some code and press Run.</div>}
        {ran.result.stdout && <pre className="b-out">{ran.result.stdout}</pre>}
      </div>
    );
  }
  const top = cur.stack[cur.stack.length - 1];
  return (
    <div className="b-run" aria-label="Line by line run">
      {note && <div className="b-note">{note}</div>}
      <div className={`b-says ${cur.error ? "bad" : ""}`} aria-live="polite">
        <span className="b-k">Line {cur.line} · step {Math.min(i, frames.length - 1) + 1} of {frames.length}</span>
        <p>{cur.error ? explainError(cur.error) : cur.says}</p>
      </div>
      <div className="b-ctl">
        <button type="button" onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }} disabled={i === 0} aria-label="Previous line">‹</button>
        <button type="button" className="play" onClick={() => { if (i >= frames.length - 1) setI(0); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <button type="button" onClick={() => { setPlaying(false); setI((x) => Math.min(frames.length - 1, x + 1)); }} disabled={i >= frames.length - 1} aria-label="Next line">›</button>
        <input type="range" min={0} max={frames.length - 1} value={Math.min(i, frames.length - 1)} aria-label="Replay position" onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} />
      </div>
      <div className="b-outbox">
        <span className="b-label">Output</span>
        <pre className={`b-out ${cur.error ? "err" : ""}`}>{!cur.out && !cur.error ? <span className="waiting">Nothing printed yet.</span> : null}{cur.out.slice(0, cur.out.length - cur.newOut.length)}<span className="new">{cur.newOut}</span>{cur.error && `\n${cur.error.type}: ${cur.error.message}`}</pre>
      </div>
      <div className="b-vars">
        <span className="b-label">Variables{cur.stack.length > 1 && top ? ` · inside ${top.name}()` : ""}</span>
        <div className="b-varlist">
          {!top || Object.keys(top.vars).length === 0 ? <span className="b-none">none yet</span> : Object.entries(top.vars).map(([k, v]) => (
            <div key={`${k}-${cur.changed.includes(k) ? i : "s"}`} className={`b-var ${cur.changed.includes(k) ? "changed" : ""}`}><span className="k">{k}</span><span className="v">{v.v}</span><span className="t">{v.t}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExampleRun({ code, tabs }: { code: Code; tabs?: ReactNode }) {
  const { user, celebrate } = useSession();
  const status = useSandboxStatus();
  const run = useRun();
  const [sel, setSel] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const lines = code.source.replace(/\n$/, "").split("\n");
  const note = (n: number) => code.notes?.[String(n)]?.[0];
  const live = run.cur?.line ?? null;
  const go = async () => {
    setErr(""); setSel(null);
    try { run.start(code.source, await sandbox.run({ src: code.source, trace: true })); void reportRun(Boolean(user), celebrate); }
    catch { setErr("Python couldn't run in this browser. Reload the page and try again."); }
  };
  return (
    <div className="b-grid">
      <div className="b-code">
        <div className="b-head">{tabs ?? <span>{code.file}</span>}
          <button type="button" className="b-runbtn" onClick={() => void go()} disabled={status === "loading" || status === "running"}>▶ Run and watch</button>
        </div>
        <div className="b-lines" style={{ ["--n" as string]: lines.length, ["--lh" as string]: lines.length > 14 ? 1.42 : 1.7 }}>
          {lines.map((l, k) => (
            <button key={k} type="button" className={`b-line ${live === k + 1 ? "live" : ""} ${sel === k + 1 ? "sel" : ""}`} onClick={() => setSel(sel === k + 1 ? null : k + 1)}>
              <span className="n">{k + 1}</span><span className="src">{highlight(l)}</span>
            </button>
          ))}
        </div>
      </div>
      <RunPanel run={run} note={err ? <span>{err}</span> : sel ? <><b>Line {sel}:</b> {note(sel) ?? (lines[sel - 1]?.trim() ? "This line supports the ones around it." : "A blank line, just for readability.")}</> : null}
        empty={`Press “Run and watch” to see each line run, one at a time, with its variables and output. Tap any line to see what it does. ${STATUS_TEXT[status]}`} />
    </div>
  );
}

function ExerciseRun({ topic, ex, tabs }: { topic: string; ex: Ex; tabs?: ReactNode }) {
  const { user, celebrate } = useSession();
  const status = useSandboxStatus();
  const editor = useRef<EditorHandle>(null);
  const [code, setCode] = useState(ex.starter);
  const [test, setTest] = useState<RunResult["test"]>(null);
  const [fails, setFails] = useState(0);
  const [err, setErr] = useState("");
  const run = useRun();
  const busy = status === "loading" || status === "running";
  const go = async (check: boolean) => {
    setErr("");
    try {
      const r = await sandbox.run({ src: code, trace: true, tests: check ? ex.tests : null });
      run.start(code, r);
      void reportRun(Boolean(user), celebrate);
      setTest(check ? r.test : null);
      if (check && r.test) {
        if (r.test.passed && user) { try { celebrate(await api("/events", { body: { kind: "code_exercise_passed", topic } })); } catch { /* offline */ } }
        if (!r.test.passed) setFails((f) => f + 1);
      }
    } catch { setErr("Python couldn't run in this browser. Reload the page and try again."); }
  };
  return (
    <div className="b-grid">
      <div className="b-code">
        <div className="b-task">{tabs && <div className="b-taskhead">{tabs}</div>}<p><Words text={ex.prompt} /></p></div>
        <div className="b-editor"><CodeEditor ref={editor} value={ex.starter} onChange={setCode} onRun={() => void go(false)} label="Exercise code editor" minHeight={80} /></div>
        <div className="b-actions">
          <button type="button" className="b-runbtn ghost" onClick={() => void go(false)} disabled={busy}>▶ Run</button>
          <button type="button" className="b-runbtn" onClick={() => void go(true)} disabled={busy}>Check my code</button>
          <button type="button" className="b-link" onClick={() => { editor.current?.setValue(ex.starter); run.reset(); setTest(null); }}>Reset</button>
          {fails >= 2 && !test?.passed && <button type="button" className="b-link" onClick={() => editor.current?.setValue(ex.solution)}>Show a solution</button>}
          <span className="b-status">{err || STATUS_TEXT[status]}</span>
        </div>
      </div>
      <div className="b-result">
        {test && (
          <div className={`b-verdict ${test.passed ? "good" : "bad"}`} role="status">
            {test.passed ? <><b>✓ All checks passed.</b> {user ? "Saved to your progress." : "Sign in to save it."}</> : <><b>Not yet:</b> {test.message}</>}
          </div>
        )}
        <RunPanel run={run} empty="Write your code, then press Run to watch it, or Check to test it." />
      </div>
    </div>
  );
}

export function BuildStep({ t, phone }: { t: Topic; phone: boolean }) {
  const b = t.body;
  const parts = [b.code ? "example" : null, b.exercise ? "exercise" : null].filter(Boolean) as ("example" | "exercise")[];
  const [part, setPart] = useState(parts[0] ?? "example");
  const [useEditor, setUseEditor] = useState(false);
  const blocks = phone && !useEditor && b.exercise && canBlockBuild(b.exercise);
  // The two parts sit in the code panel's own header, so the step needs no title row.
  const tabs = parts.length > 1 ? (
    <div className="p-toggle b-tabs" role="tablist" aria-label="Build parts">
      <button type="button" role="tab" aria-pressed={part === "example"} aria-selected={part === "example"} onClick={() => setPart("example")}>1 · Watch it run</button>
      <button type="button" role="tab" aria-pressed={part === "exercise"} aria-selected={part === "exercise"} onClick={() => setPart("exercise")}>2 · Your turn</button>
    </div>
  ) : undefined;
  return (
    <div className="b-wrap">
      {part === "example" && b.code && <ExampleRun key={t.slug} code={b.code} tabs={tabs} />}
      {part === "exercise" && b.exercise && (
        blocks ? (
          <div className="b-blocks">{tabs}<BlockBuilder topic={t.slug} ex={b.exercise} /><button type="button" className="w-link" onClick={() => setUseEditor(true)}>Type it in the editor instead</button></div>
        ) : <ExerciseRun key={t.slug} topic={t.slug} ex={b.exercise} tabs={tabs} />
      )}
    </div>
  );
}
