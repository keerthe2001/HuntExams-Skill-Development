// Scales its content (laid out at `design` px wide) to fill the box, up or down, like a video:
// the whole visual stays visible and uses the space it has. `fitHeight` false fits width only.
import { type ReactNode, useEffect, useRef, useState } from "react";

export function FitBox({ design, enabled = true, fitHeight = true, max = 2, children, className = "" }: {
  design: number; enabled?: boolean; fitHeight?: boolean; max?: number; children: ReactNode; className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!enabled) { setZoom(1); return; }
    const o = outer.current, i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return;
    let cur = 1;
    const fit = () => {
      const natural = i.getBoundingClientRect().height / cur;
      if (!natural || !o.clientWidth) return;
      const byW = o.clientWidth / design;
      const byH = fitHeight && o.clientHeight ? o.clientHeight / natural : Infinity;
      const next = Math.max(0.4, Math.min(max, byW, byH));
      if (Math.abs(next - cur) > 0.01) { cur = next; setZoom(next); }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(o); ro.observe(i);
    fit();
    return () => ro.disconnect();
  }, [design, enabled, fitHeight, max]);
  return (
    <div ref={outer} className={`fitbox ${enabled ? "on" : ""} ${fitHeight ? "fit-h" : ""} ${className}`}>
      <div ref={inner} className="fitbox-in" style={enabled ? { width: design, zoom } : undefined}>{children}</div>
    </div>
  );
}
