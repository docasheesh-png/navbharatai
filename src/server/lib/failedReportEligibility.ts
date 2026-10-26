/** One retained-failure cohort for read exports, chronological ranks, and writer allocation. */
export function settledFailure(raw: unknown): raw is Record<string, unknown> & { startedAt: number; endedAt: number } {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return r.ok === false && typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) && r.startedAt > 0 &&
    typeof r.endedAt === 'number' && Number.isFinite(r.endedAt) && r.endedAt >= r.startedAt;
}
