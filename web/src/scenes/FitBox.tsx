// Scales its content to fill the box, up or down, like a video, so the whole visual stays
// visible and uses the space it has. It tries a few layout widths and keeps the one that
// fills the most area for this box's shape. `fitHeight` false fits the width only.
import { type ReactNode, useEffect, useRef, useState } from "react";

export function FitBox({ design, widths, enabled = true, fitHeight = true, max = 2, children, className = "" }: {
  design: number; widths?: number[]; enabled?: boolean; fitHeight?: boolean; max?: number; children: ReactNode; className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; z: number }>({ w: design, z: 1 });
  const key = (widths ?? [design]).join(",");
  useEffect(() => {
    if (!enabled) { setFit({ w: design, z: 1 }); return; }
    const o = outer.current, i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return;
    const candidates = widths?.length ? widths : [design];
    let busy = false;
    const measure = () => {
      if (busy) return;
      const W = o.clientWidth, H = o.clientHeight;
      if (!W) return;
      busy = true;
      const prevW = i.style.width, prevZ = i.style.zoom;
      i.style.zoom = "1";
      let best = { w: candidates[0]!, z: 1, cover: -1 };
      for (const w of candidates) {
        i.style.width = `${w}px`;
        const h = i.offsetHeight;
        if (!h) continue;
        const z = Math.max(0.4, Math.min(max, W / w, fitHeight && H ? H / h : Infinity));
        // Coverage of the box, with a penalty for shrinking text below its natural size.
        const cover = ((w * z * h * z) / (W * (fitHeight && H ? H : h * z))) * (z < 0.95 ? z * z : 1);
        if (cover > best.cover + 0.02 || (Math.abs(cover - best.cover) <= 0.02 && z > best.z)) best = { w, z, cover };
      }
      i.style.width = prevW; i.style.zoom = prevZ;
      setFit((f) => (Math.abs(f.z - best.z) > 0.01 || f.w !== best.w ? { w: best.w, z: best.z } : f));
      requestAnimationFrame(() => { busy = false; });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o); ro.observe(i);
    measure();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, key, enabled, fitHeight, max]);
  return (
    <div ref={outer} className={`fitbox ${enabled ? "on" : ""} ${fitHeight ? "fit-h" : ""} ${className}`}>
      <div ref={inner} className="fitbox-in" style={enabled ? { width: fit.w, zoom: fit.z } : undefined}>{children}</div>
    </div>
  );
}
