// The space the whole learning world floats in: a light canvas starfield (three depth layers,
// slow drift, gentle parallax) over CSS nebula glows. Pauses when the tab is hidden and stays
// still for people who prefer reduced motion.
import { useEffect, useRef } from "react";

type Star = { x: number; y: number; z: number; r: number; tw: number };

export function Space() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, stars: Star[] = [];
    let px = 0, py = 0, tx = 0, ty = 0;
    // Warp: a short burst of speed (stars stretch into streaks) when flying between places.
    let warpV = 0, warpTarget = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(240, Math.round((w * h) / 6500));
      stars = Array.from({ length: n }, () => {
        const z = Math.random();
        return { x: Math.random() * w, y: Math.random() * h, z, r: 0.4 + z * 1.4, tw: Math.random() * Math.PI * 2 };
      });
    };
    const draw = (t: number) => {
      px += (tx - px) * 0.04; py += (ty - py) * 0.04;
      warpV += (warpTarget - warpV) * 0.18;
      warpTarget *= 0.9;
      const cx = w / 2, cy = h / 2;
      const streak = Math.abs(warpV) > 0.03;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        if (!reduce) {
          s.y += 0.02 + s.z * 0.08;
          if (streak) {
            const dx = s.x - cx, dy = s.y - cy, d = Math.hypot(dx, dy) || 1;
            const v = warpV * (2 + s.z * 16);
            s.x += (dx / d) * v; s.y += (dy / d) * v;
          }
          if (s.y > h + 2 || s.y < -40 || s.x < -40 || s.x > w + 40) {
            if (streak && warpV > 0) { s.x = cx + (Math.random() - 0.5) * w * 0.3; s.y = cy + (Math.random() - 0.5) * h * 0.3; }
            else { s.y = -2; s.x = Math.random() * w; }
          }
        }
        const a = 0.35 + 0.65 * s.z * (reduce ? 1 : 0.7 + 0.3 * Math.sin(t / 900 + s.tw));
        const x = s.x + px * s.z * 14, y = s.y + py * s.z * 14;
        ctx.globalAlpha = a;
        if (streak) {
          const dx = s.x - cx, dy = s.y - cy, d = Math.hypot(dx, dy) || 1;
          const len = Math.min(90, Math.abs(warpV) * (4 + s.z * 34) * (d / Math.max(w, h)) * 3);
          ctx.strokeStyle = s.z > 0.6 ? "#d6ecff" : "#ffffff";
          ctx.lineWidth = s.r;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (dx / d) * len * Math.sign(warpV), y - (dy / d) * len * Math.sign(warpV)); ctx.stroke();
        } else {
          ctx.fillStyle = s.z > 0.85 ? "#cfe9ff" : "#ffffff";
          ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    const onWarp = (e: Event) => { if (!reduce) warpTarget = Number((e as CustomEvent).detail ?? 1) * 1.6; };
    const onMove = (e: PointerEvent) => { tx = e.clientX / w - 0.5; ty = e.clientY / h - 0.5; };
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !reduce) raf = requestAnimationFrame(draw); };
    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("hx-warp", onWarp);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("hx-warp", onWarp);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return (
    <div className="w-space" aria-hidden="true">
      <div className="w-nebula" />
      <canvas ref={ref} />
    </div>
  );
}
