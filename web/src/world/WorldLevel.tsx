// One world (level): its places (topics) as glowing stations along a path.
import { Link, useParams } from "react-router";

import { ErrorBox, Loading } from "@/components/Layout";
import { useApi, useSession } from "@/lib/session";
import type { Curriculum } from "@/lib/types";
import { useTitle } from "@/lib/util";

import { useLang } from "./lang";
import { useProgress } from "./progress";
import { hue, Hud, PathLine, pathPoints, WorldFooter, worldName } from "./Shell";
import { Planet } from "./WorldHome";

export function WorldLevel() {
  const { slug = "" } = useParams();
  const { to } = useLang();
  const { user } = useSession();
  const { data, error, loading, reload } = useApi<Curriculum>("/curriculum");
  const { done } = useProgress();
  const idx = data?.levels.findIndex((l) => l.slug === slug) ?? -1;
  const w = idx >= 0 ? data!.levels[idx] : undefined;
  useTitle(w ? `${worldName(w.number)}: ${w.title}` : "World");
  if (loading && !data) return <><Hud /><Loading label="Landing" /></>;
  if (error || !data) return <><Hud /><ErrorBox error={error} retry={reload} /></>;
  if (!w) return <><Hud /><main className="w-center"><h1>This world doesn't exist</h1><Link className="w-go" to={to("/learn")}>Back to the roadmap</Link></main></>;

  const next = data.levels[idx + 1];
  const nextTopic = w.topics.findIndex((t) => !done.has(t.slug));
  const ROW = 150;
  const pts = pathPoints(w.topics.length, ROW, 22);
  const doneCount = w.topics.filter((t) => done.has(t.slug)).length;
  const [a] = hue(w.number);

  return (
    <>
      <Hud><Link className="w-back" to={to("/learn")}>← Roadmap</Link></Hud>
      <main className="w-level" style={{ ["--wc" as string]: a }}>
        <div className="w-level-head">
          <Planet n={w.number} size={132} done={doneCount} total={w.topics.length} />
          <span className="w-kicker">{worldName(w.number)}</span>
          <h1>{w.title}</h1>
          <p>{w.summary}</p>
        </div>
        <div className="w-map" style={{ height: w.topics.length * ROW }}>
          <PathLine points={pts} height={w.topics.length * ROW} doneUpTo={nextTopic < 0 ? w.topics.length - 1 : nextTopic} />
          {w.topics.map((t, i) => {
            const p = pts[i]!;
            const isDone = done.has(t.slug);
            const isNext = i === nextTopic;
            return (
              <Link key={t.slug} to={to(`/learn/${t.slug}`)} className={`w-node w-station ${isDone ? "done" : ""} ${isNext ? "next" : ""} ${p.x > 50 ? "right" : "left"}`}
                style={{ left: `${p.x}%`, top: p.y }} aria-label={`${t.title}${isDone ? ", done" : isNext ? ", next" : ""}`}>
                <span className="w-orb">{isDone ? "✓" : i + 1}</span>
                <span className="w-node-label"><b>{t.title}</b>{t.lab && <em>+ guided lab</em>}</span>
              </Link>
            );
          })}
        </div>
        <div className="w-level-end">
          {w.mission && <Link className="w-card-link" to={user ? `/missions/${w.mission.slug}` : "/signup"}><small>World mission</small><b>{w.mission.title}</b><span>Build it for real, get it reviewed →</span></Link>}
          {next && <Link className="w-go" to={to(`/world/${next.slug}`)}>Fly to {worldName(next.number)}: {next.title} →</Link>}
        </div>
        <WorldFooter />
      </main>
    </>
  );
}
