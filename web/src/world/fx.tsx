// Motion and speed helpers for the world:
// - WarpLink: navigation as a flight (View Transition zoom + star warp), with prefetching on
//   hover/touch so the next place is usually ready before the tap ends.
// - Ripples: a soft glow ring wherever a world control is pressed.
import { type MouseEvent, type ReactNode, useCallback, useEffect } from "react";
import { flushSync } from "react-dom";
import { Link, type LinkProps, useNavigate } from "react-router";

import { api } from "@/lib/api";
import { prime } from "@/lib/boot";

export const loadTopicWorld = () => import("./TopicWorld");

const reduced = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Start fetching a place's code and data (safe to call many times). */
export function prefetchTopic(slug: string) {
  void loadTopicWorld();
  void prime(`/topics/${slug}`, () => api(`/topics/${slug}`)).catch(() => undefined);
}

export function warp(strength = 1) {
  window.dispatchEvent(new CustomEvent("hx-warp", { detail: strength }));
}

type VT = { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> } };

export function useFly() {
  const navigate = useNavigate();
  return useCallback((to: string, opts: { back?: boolean; replace?: boolean } = {}) => {
    const doc = document as Document & VT;
    if (reduced() || !doc.startViewTransition) { navigate(to, { replace: opts.replace }); return; }
    warp(opts.back ? -0.7 : 1);
    document.documentElement.dataset.nav = opts.back ? "back" : "forward";
    const t = doc.startViewTransition(() => { flushSync(() => navigate(to, { replace: opts.replace })); });
    // A transition can be skipped (tab hidden, viewport resized); the navigation still happens.
    t.ready.catch(() => undefined);
    t.updateCallbackDone.catch(() => undefined);
    void t.finished.catch(() => undefined).finally(() => { delete document.documentElement.dataset.nav; });
  }, [navigate]);
}

type WarpProps = Omit<LinkProps, "to"> & { to: string; back?: boolean; preload?: string; children: ReactNode };

/** A link that flies to its target and prefetches a topic when pointed at. */
export function WarpLink({ to, back, preload, onClick, onPointerEnter, onTouchStart, onFocus, ...rest }: WarpProps) {
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

const PRESSABLE = ".w-node, .w-btn, .w-enter, .w-go, .w-card-link, .w-steps button, .w-back, .w-dots button, .w-line, .w-tabs button";

/** Glow ripples on press, installed once by the world shell. */
export function useRipples() {
  useEffect(() => {
    if (reduced()) return;
    const on = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(PRESSABLE);
      if (!el) return;
      const r = document.createElement("span");
      r.className = "w-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.querySelector(".world")?.appendChild(r);
      window.setTimeout(() => r.remove(), 650);
    };
    document.addEventListener("pointerdown", on, { passive: true });
    return () => document.removeEventListener("pointerdown", on);
  }, []);
}

/** Run once the browser is idle (prefetching shouldn't compete with the first paint). */
export function whenIdle(f: () => void) {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(f, { timeout: 3000 }); else window.setTimeout(f, 1200);
}
