// Tap-to-build for phones: the program's lines are shuffled into blocks; tap them in order to
// build it, then it runs for real in the Python sandbox and the checks confirm it works.
import { useMemo, useState } from "react";

import { useSandboxStatus, STATUS_TEXT } from "@/code/useSandbox";
import { Visualizer } from "@/code/Visualizer";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { TopicBody } from "@/lib/types";
import { highlight } from "@/lib/util";
import { sandbox, type RunResult } from "@/sandbox/runner";

import { Words } from "./glossary";

type Ex = NonNullable<TopicBody["exercise"]>;

function shuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const blockLines = (ex: Ex) => ex.solution.replace(/\s+$/, "").split("\n").filter((l) => l.trim());
export const canBlockBuild = (ex: Ex) => { const n = blockLines(ex).length; return n >= 2 && n <= 14; };

export function BlockBuilder({ topic, ex, onPassed }: { topic: string; ex: Ex; onPassed?: () => void }) {
  const { user, celebrate } = useSession();
  const status = useSandboxStatus();
  const lines = useMemo(() => blockLines(ex), [ex]);
  const pool0 = useMemo(() => {
    let s = shuffle(lines.map((text, id) => ({ id, text })), topic);
    if (s.every((b, i) => b.id === i)) s = [...s.slice(1), s[0]!];
    return s;
  }, [lines, topic]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [wrongAt, setWrongAt] = useState<number | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [err, setErr] = useState("");
  const [passed, setPassed] = useState(false);

  const program = placed.map((id) => lines[id]!).join("\n") + "\n";
  const complete = placed.length === lines.length;

  const place = (id: number) => { setWrongAt(null); setResult(null); setPlaced((p) => [...p, id]); };
  const unplace = (k: number) => { setWrongAt(null); setResult(null); setPlaced((p) => p.filter((_, i) => i !== k)); };
  const hint = () => {
    const k = placed.findIndex((id, i) => lines[id] !== lines[i]);
    const keep = k < 0 ? placed : placed.slice(0, k);
    const want = lines[keep.length];
    const id = pool0.find((b) => b.text === want && !keep.includes(b.id))?.id;
    if (id !== undefined) { setWrongAt(null); setPlaced([...keep, id]); }
  };

  const check = async () => {
    setErr("");
    const k = placed.findIndex((id, i) => lines[id] !== lines[i]);
    if (k >= 0) { setWrongAt(k); return; }
    try {
      const r = await sandbox.run({ src: program, trace: true, tests: ex.tests });
      setResult(r);
      if (r.test?.passed) {
        setPassed(true);
        onPassed?.();
        if (user) { try { celebrate(await api("/events", { body: { kind: "code_exercise_passed", topic } })); } catch { /* offline */ } }
      }
    } catch { setErr("Python couldn't run in this browser. Reload and try again."); }
  };

  return (
    <div className="w-blocks">
      <p className="w-task"><Words text={ex.prompt} /></p>
      <div className="w-prog" aria-label="Your program">
        {placed.length === 0 && <span className="w-prog-empty">Tap the lines below in the right order.</span>}
        {placed.map((id, k) => (
          <button key={`${id}-${k}`} type="button" className={`w-line ${wrongAt === k ? "wrong" : ""} ${wrongAt !== null && k < wrongAt ? "ok" : ""}`}
            onClick={() => unplace(k)} aria-label={`Remove line ${k + 1}`}>
            <span className="n">{k + 1}</span><code>{highlight(lines[id]!)}</code>
          </button>
        ))}
      </div>
      {wrongAt !== null && <p className="w-say bad">Line {wrongAt + 1} isn't the right one yet. Tap it to take it out, or use a hint.</p>}
      <div className="w-pool" aria-label="Lines to place">
        {pool0.filter((b) => !placed.includes(b.id)).map((b) => (
          <button key={b.id} type="button" className="w-line" onClick={() => place(b.id)}><code>{highlight(b.text)}</code></button>
        ))}
      </div>
      <div className="w-row">
        <button type="button" className="w-btn primary" disabled={!complete || status === "running" || status === "loading" || passed} onClick={() => void check()}>
          {passed ? "✓ It works" : "▶ Run my program"}
        </button>
        {!passed && <button type="button" className="w-btn" onClick={hint}>Hint</button>}
        {!passed && placed.length > 0 && <button type="button" className="w-btn ghost" onClick={() => { setPlaced([]); setWrongAt(null); setResult(null); }}>Reset</button>}
        <span className="w-status">{STATUS_TEXT[status]}</span>
      </div>
      {err && <p className="w-say bad" role="alert">{err}</p>}
      {result?.test && !result.test.passed && <p className="w-say bad">Not yet: {result.test.message}</p>}
      {result && (result.steps?.length ?? 0) > 0 && <Visualizer source={program} result={result} autoplay={false} />}
    </div>
  );
}
