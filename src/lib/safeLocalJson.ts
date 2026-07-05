/**
 * Read + JSON.parse a localStorage value, NEVER throwing. Returns `fallback` when the key is absent,
 * empty, or holds a value that isn't valid JSON.
 *
 * Why this exists: an unguarded `JSON.parse(localStorage.getItem(k))` inside a top-level `useState`
 * initializer throws DURING RENDER if the stored value is corrupt (a truncated write, a value written
 * by an older build, cross-tab/extension tampering, a manual edit). For an always-mounted component
 * (App / useSettings) that throw escapes render, the root ErrorBoundary shows "Reload App", and reload
 * re-runs the same initializer → the same throw → an UNRECOVERABLE crash loop whose own recovery button
 * can't escape it (the poison value stays in localStorage). Routing every localStorage-JSON read through
 * this helper self-heals to the default instead, so that class of app-breaking bug cannot reappear.
 */
export function safeLocalJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
