// Data the server already put into the page (window.__HX__), keyed by API path, plus GET
// requests started early (prefetch on hover/tap). Both let a page show without waiting.
const boot: Record<string, unknown> =
  (typeof window !== "undefined" && (window as unknown as { __HX__?: Record<string, unknown> }).__HX__) || {};
const primed = new Map<string, Promise<unknown>>();

export function takeBoot<T>(path: string): T | undefined {
  if (!(path in boot)) return undefined;
  // Kept briefly (the page can mount twice while the session loads), then dropped so later
  // visits get fresh data.
  window.setTimeout(() => { delete boot[path]; }, 8000);
  return boot[path] as T;
}

export function prime<T>(path: string, load: () => Promise<T>): Promise<T> {
  let p = primed.get(path) as Promise<T> | undefined;
  if (!p) {
    p = load();
    primed.set(path, p);
    p.catch(() => primed.delete(path));
    window.setTimeout(() => primed.delete(path), 30_000);
  }
  return p;
}

export function takePrimed<T>(path: string): Promise<T> | undefined {
  const p = primed.get(path) as Promise<T> | undefined;
  primed.delete(path);
  return p;
}
