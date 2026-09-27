// A provider API-key env that may hold a POOL of keys — one place that knows how to read it.
//
// 🔴 WHY THIS LIVES HERE (admin Diagnostics capture, 2026-09-27). `GLM_API_KEY` has held a comma
// separated pool of Z.ai keys since 2026-07-21 (51 of them at the time of that capture), so the
// build engine can rotate past a 429 on one key. The parser that understands that shape,
// `parseKeyPool`, lived inside the 20,000-line build route, and nothing else imported it. So the
// FREE CHAT leader (`GlmProvider`) and the free vision rung (`visionChain.tryGlm`) sent the whole
// comma string as ONE bearer token: every call was refused before it reached a model. The admin's
// Provider status card read `GLM 8 requests · 8 errors`, and Assistant spend read *"Just 0% of
// assistant turns were served by the free model"* — every free chat, Professional and Doctor AI
// turn was falling through to a PAID rung, and nothing looked broken, because the fallback worked.
// A third caller (`mobileBuildAiRepair`) had written its own `split(',')[0]`, which ignores the
// whitespace separator this parser accepts.
//
// One parser, one picker, imported by every reader of a pooled key. PURE apart from the rotation
// counter, which is per-process state and says so.

/**
 * Parse a key env into its pool. Accepts a comma- or whitespace-separated list (`k1,k2 k3`); a
 * single key is a pool of one. Blanks are dropped and duplicates de-duped, in first-seen order.
 */
export function parseKeyPool(env: string | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of String(env ?? '').split(/[\s,]+/)) {
    const key = k.trim();
    if (key && !seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/** The first key of the pool, or '' when there is none. For a caller that holds one client. */
export function firstPoolKey(env: string | undefined | null): string {
  return parseKeyPool(env)[0] ?? '';
}

// Per-process, per-pool rotation cursor. Keyed by the pool's own content so two different envs never
// share a cursor, and a changed env starts from its first key.
const cursors = new Map<string, number>();

/**
 * The next key of the pool, round-robin. Spreading calls across the pool is the whole point of
 * holding one: a free tier rate-limits PER KEY, so pinning every chat turn to key 1 would leave the
 * other fifty idle while key 1 is throttled. '' when the pool is empty.
 */
export function nextPoolKey(env: string | undefined | null): string {
  const pool = parseKeyPool(env);
  if (pool.length === 0) return '';
  const id = pool.join(',');
  const i = cursors.get(id) ?? 0;
  cursors.set(id, (i + 1) % pool.length);
  return pool[i % pool.length];
}

/** Test seam: forget every rotation cursor. */
export function _resetKeyPoolCursors(): void {
  cursors.clear();
}
