// App Mart social — how numbers and times are written on the screen. Pure, so it is tested
// (tests/appMartSocialClient.test.ts) and every surface writes "1.2K" and "3h" the same way.

/** 999 → "999", 1234 → "1.2K", 1_500_000 → "1.5M". Negative or broken input reads as 0. */
export function compactCount(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (v < 1000) return String(v);
  const unit = v >= 1_000_000 ? { d: 1_000_000, s: 'M' } : { d: 1000, s: 'K' };
  const x = v / unit.d;
  const shown = x >= 100 ? Math.floor(x).toString() : (Math.floor(x * 10) / 10).toString();
  return `${shown}${unit.s}`;
}

/** "just now", "5m", "3h", "2d", then a date. `now` is passed in so it is testable. */
export function timeAgo(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

/** The letter drawn in place of a missing photo. */
export function initialOf(name: string): string {
  const c = (name || '').trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

/**
 * What a press does to the counts on the screen before the server answers — the same toggle the
 * server applies, so the optimistic number and the confirmed number agree.
 */
export function optimisticReact(
  counts: { likes: number; dislikes: number; comments: number },
  mine: 'like' | 'dislike' | null,
  pressed: 'like' | 'dislike',
): { counts: { likes: number; dislikes: number; comments: number }; mine: 'like' | 'dislike' | null } {
  const next = mine === pressed ? null : pressed;
  const c = { ...counts };
  if (mine === 'like') c.likes = Math.max(0, c.likes - 1);
  if (mine === 'dislike') c.dislikes = Math.max(0, c.dislikes - 1);
  if (next === 'like') c.likes += 1;
  if (next === 'dislike') c.dislikes += 1;
  return { counts: c, mine: next };
}
