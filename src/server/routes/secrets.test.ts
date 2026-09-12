import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allowVerify, VERIFY_COOLDOWN_MS, VERIFY_COOLDOWN_MAX_ENTRIES } from './secrets';

describe('allowVerify — the throttle on /api/secrets/:userId/verify', () => {
  it('allows the first call and refuses an immediate second', () => {
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 1_000)).toBe(true);
    expect(allowVerify(state, 'u1', 1_000)).toBe(false);
    expect(allowVerify(state, 'u1', 1_000 + VERIFY_COOLDOWN_MS - 1)).toBe(false);
  });

  it('allows again once the cooldown has passed', () => {
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 1_000)).toBe(true);
    expect(allowVerify(state, 'u1', 1_000 + VERIFY_COOLDOWN_MS)).toBe(true);
  });

  it('throttles per user — one busy caller cannot block anybody else', () => {
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 1_000)).toBe(true);
    expect(allowVerify(state, 'u2', 1_000)).toBe(true);
    expect(allowVerify(state, 'u1', 1_000)).toBe(false);
    expect(allowVerify(state, 'u2', 1_000)).toBe(false);
  });

  it('a REFUSED call does not extend the cooldown', () => {
    // Otherwise a client that retries in a tight loop would lock itself out indefinitely.
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 0)).toBe(true);
    for (let t = 1; t < VERIFY_COOLDOWN_MS; t += 500) allowVerify(state, 'u1', t);
    expect(allowVerify(state, 'u1', VERIFY_COOLDOWN_MS)).toBe(true);
  });

  it('is bounded — the map cannot grow into a leak on a long-lived instance', () => {
    const state = new Map<string, number>();
    for (let i = 0; i < VERIFY_COOLDOWN_MAX_ENTRIES + 50; i++) allowVerify(state, `u${i}`, i);
    expect(state.size).toBeLessThanOrEqual(VERIFY_COOLDOWN_MAX_ENTRIES);
  });

  it('stays correct for the caller that triggered the flush', () => {
    const state = new Map<string, number>();
    for (let i = 0; i < VERIFY_COOLDOWN_MAX_ENTRIES; i++) allowVerify(state, `u${i}`, i);
    expect(allowVerify(state, 'flusher', 10_000_000)).toBe(true);
    expect(allowVerify(state, 'flusher', 10_000_000)).toBe(false); // its own entry survived the clear
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SAVING THE SAME NAME TWICE (2026-09-12).
//
// The POST route was an unconditional `addDoc`, so re-saving a key created a SECOND row and nothing
// decided which one a build would receive. The decision now lives in `planSecretWrite` (tested
// directly in secretScope.test.ts); what is tested here is that the route actually USES it, because a
// correct decision nobody calls is not a fix.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
describe('🔒 the wiring — the save path replaces instead of appending', () => {
  const src = readFileSync(resolve(__dirname, 'secrets.ts'), 'utf8');
  const post = src.slice(src.indexOf("app.post('/api/secrets/:userId'"));
  const body = post.slice(0, post.indexOf("app.post('/api/secrets/:userId/verify'"));

  it('reads what is already stored under that name before writing', () => {
    expect(body).toContain("where('secret_name', '==', secret_name)");
  });

  it('asks planSecretWrite rather than deciding in the route', () => {
    expect(body).toContain('planSecretWrite');
  });

  it('🔒 updates the existing row instead of always adding one', () => {
    expect(body).toContain('plan.replace');
    expect(body).toContain('updateDoc(doc(db,');
  });

  it('🔒 a replacement moves created_at forward, or "newest wins" would pick the row it replaced', () => {
    const replaceBranch = body.slice(body.indexOf('if (plan.replace)'), body.indexOf('} else {'));
    expect(replaceBranch).toContain('created_at: new Date()');
  });

  it('retires duplicates by SOFT delete, like every other path that retires a secret', () => {
    expect(body).toContain('plan.retire');
    expect(body).toContain('{ deleted: true }');
  });
});

describe('🔒 the provisioning path shares the same decision', () => {
  const flow = readFileSync(resolve(__dirname, '../lib/supabaseProvisionFlow.ts'), 'utf8');

  it('no longer deletes every row of that name — that wiped app-scoped keys', () => {
    // The old line was `dupes.docs.map((d) => d.ref.delete())`, which ignored scope entirely.
    expect(flow).not.toMatch(/ref\.delete\(\)/);
  });

  it('uses planSecretWrite, so it cannot drift from the Settings save', () => {
    expect(flow).toContain('planSecretWrite');
  });

  it('writes its scope explicitly rather than leaving the field absent', () => {
    expect(flow).toContain('workspace_id: null');
  });
});
