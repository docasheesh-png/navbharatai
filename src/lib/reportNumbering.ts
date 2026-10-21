// REPORT NUMBERS: oldest = 1, the next = 2, the newest has the highest number (admin 2026-10-21).
//
// The number belongs to the REPORT, not to its place on screen: filtering, searching or re-sorting a list must
// never renumber a report, or "report 41" would mean a different thing every time the admin touched a filter.
// So the numbers are computed over the WHOLE set a list has loaded, by time, and looked up by key afterwards.
// A tie in time is broken by key, so two reports with the same second still get the same two numbers every time.
// PURE — no state, no clock.

export function numberOldestFirst<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  timeOf: (item: T) => number,
): Map<string, number> {
  const seen = new Map<string, { key: string; at: number }>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue; // a report listed twice is still one report
    const at = timeOf(item);
    seen.set(key, { key, at: Number.isFinite(at) ? at : 0 });
  }
  const ordered = [...seen.values()].sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = new Map<string, number>();
  ordered.forEach((r, i) => out.set(r.key, i + 1));
  return out;
}
