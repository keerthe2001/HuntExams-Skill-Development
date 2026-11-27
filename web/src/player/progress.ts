// Where the learner has been. Guests keep it in this browser; signed-in learners also have it
// on the server. After signing up, places visited as a guest are sent to the account once.
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { LearnerState } from "@/lib/types";

const KEY = "hx-world-v1";
type Local = { done: string[]; synced: string[] };

function read(): Local {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Local | null;
    if (v && Array.isArray(v.done)) return { done: v.done, synced: Array.isArray(v.synced) ? v.synced : [] };
  } catch { /* unavailable */ }
  return { done: [], synced: [] };
}
function write(v: Local) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: progress lives for this visit only */ }
  window.dispatchEvent(new Event("hx-world"));
}

export function markDone(slug: string) {
  const v = read();
  if (!v.done.includes(slug)) write({ ...v, done: [...v.done, slug] });
}

export function localDoneCount(): number { return read().done.length; }

/** Set of finished topic slugs, from this browser and (when signed in) the account. */
export function useProgress() {
  const { user } = useSession();
  const [local, setLocal] = useState<Local>(read);
  const [server, setServer] = useState<Set<string>>(new Set());

  useEffect(() => {
    const on = () => setLocal(read());
    window.addEventListener("hx-world", on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener("hx-world", on); window.removeEventListener("storage", on); };
  }, []);

  const refresh = useCallback(async () => {
    if (!user) { setServer(new Set()); return; }
    try {
      const s = await api<LearnerState>("/me/state");
      setServer(new Set(s.levels.flatMap((lv) => lv.topics.filter((t) => t.watched || t.status === "practised").map((t) => t.slug))));
    } catch { /* offline */ }
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);

  // Bring guest progress into a new account, once per place.
  useEffect(() => {
    if (!user) return;
    const v = read();
    const todo = v.done.filter((s) => !v.synced.includes(s));
    if (!todo.length) return;
    void (async () => {
      const ok: string[] = [];
      for (const slug of todo.slice(0, 30)) {
        try { await api(`/topics/${slug}/watched`, { method: "POST" }); ok.push(slug); } catch { /* try again later */ }
      }
      const cur = read();
      write({ ...cur, synced: [...new Set([...cur.synced, ...ok])] });
      void refresh();
    })();
  }, [user, refresh]);

  const done = new Set([...local.done, ...server]);
  return { done, refresh };
}
