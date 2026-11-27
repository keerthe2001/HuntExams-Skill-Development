// Speed and motion helpers for the lesson player:
// - prefetchTopic: a topic's data starts loading on hover/touch, so it's usually ready on tap.
// - useFly / FlyLink: navigation with a smooth View Transition where the browser supports it.
import { type MouseEvent, type ReactNode, useCallback } from "react";
import { flushSync } from "react-dom";
import { Link, type LinkProps, useNavigate } from "react-router";

import { api } from "@/lib/api";
import { prime } from "@/lib/boot";

const reduced = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Start fetching a topic's data (safe to call many times). */
export function prefetchTopic(slug: string) {
  void prime(`/topics/${slug}`, () => api(`/topics/${slug}`)).catch(() => undefined);
}

type VT = { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> } };

export function useFly() {
  const navigate = useNavigate();
  return useCallback((to: string, opts: { back?: boolean; replace?: boolean } = {}) => {
    const doc = document as Document & VT;
    if (reduced() || !doc.startViewTransition) { navigate(to, { replace: opts.replace }); return; }
    document.documentElement.dataset.nav = opts.back ? "back" : "forward";
    const t = doc.startViewTransition(() => { flushSync(() => navigate(to, { replace: opts.replace })); });
    // A transition can be skipped (tab hidden, viewport resized); the navigation still happens.
    t.ready.catch(() => undefined);
    t.updateCallbackDone.catch(() => undefined);
    void t.finished.catch(() => undefined).finally(() => { delete document.documentElement.dataset.nav; });
  }, [navigate]);
}

type FlyProps = Omit<LinkProps, "to"> & { to: string; back?: boolean; preload?: string; children: ReactNode };

/** A link that transitions smoothly and prefetches a topic when pointed at. */
export function FlyLink({ to, back, preload, onClick, onPointerEnter, onTouchStart, onFocus, ...rest }: FlyProps) {
  const fly = useFly();
  const pre = () => { if (preload) prefetchTopic(preload); };
  return (
    <Link
      {...rest}
      to={to}
      onPointerEnter={(e) => { pre(); onPointerEnter?.(e); }}
      onTouchStart={(e) => { pre(); onTouchStart?.(e); }}
      onFocus={(e) => { pre(); onFocus?.(e); }}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        fly(to, { back });
      }}
    />
  );
}

/** Run once the browser is idle (prefetching shouldn't compete with the first paint). */
export function whenIdle(f: () => void) {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(f, { timeout: 3000 }); else window.setTimeout(f, 1200);
}
