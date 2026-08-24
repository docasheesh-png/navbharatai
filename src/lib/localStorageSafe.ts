// localStorage that survives a full quota.
//
// WHY THIS IS ITS OWN MODULE (2026-08-24). `safeLS` used to live in `App.tsx`, and five feature
// modules imported it from there. That is the wrong direction: `App.tsx` is the ROOT of the app and
// statically imports ~84 modules, so anything importing back from it pulled the entire app graph in
// and made the bundle impossible to split (see tests/appModuleGraph.test.ts for the rule this
// belongs to). A helper that only needs `localStorage` has no business living in the root component.
//
// Behaviour is unchanged from the App.tsx original: on QuotaExceededError, evict the large
// non-essential keys one at a time and retry after each, so the caller's write still lands instead
// of being silently dropped.

/**
 * Large, regenerable keys that may be thrown away to make room. Order is eviction order — cheapest
 * to lose first. Exported because App.tsx also clears the whole set on sign-out.
 */
export const LS_EVICTABLE = [
  'navbharat_versions',
  'navbharat_last_app',
  'navbharat_gh_context',
  'navbharat_pro_messages',
  'navbharat_sessions',
];

/** `localStorage.setItem` that auto-evicts large non-essential keys on QuotaExceededError. */
export function safeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e: unknown) {
    if (e instanceof DOMException && (e.code === 22 || e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      // Evict stale large keys one by one until it fits
      for (const evict of LS_EVICTABLE) {
        if (evict === key) continue;
        localStorage.removeItem(evict);
        try {
          localStorage.setItem(key, value);
          return;
        } catch {}
      }
    }
  }
}
