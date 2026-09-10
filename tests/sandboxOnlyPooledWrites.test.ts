import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from '../src/server/AgentV3/WorkspaceFiles';

/**
 * THE FIFTH INSTANCE OF ONE BUG CLASS — serial awaits over a network.
 *
 * `materializeAssets` closed this class on 2026-08-04, and its comment lists the four found by then:
 * the sandbox landing (a 648s incident), the Firestore merge, `collectWorkspaceFiles` (a 13-minute
 * per-turn stall), and the asset writes — "same fix, same shared helper, so the class is closed here
 * rather than patched again".
 *
 * An import's `sandboxOnly` writes were a sibling that was missed, ten lines above one of them. Small
 * today — usually one lockfile — but a repo carrying several (package-lock + yarn.lock + pnpm-lock, or
 * a monorepo's per-package locks) pays one full sandbox round-trip each, in series, before the build
 * can start. Nothing in the loop bounded that, which is exactly how the other four grew.
 */
describe('the shared pool preserves the semantics this path depends on', () => {
  it('writes concurrently rather than one-at-a-time', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 8 }, (_, i) => `lock-${i}.json`);
    await pool(items, 4, async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeGreaterThan(1);   // the whole point — serial would peak at exactly 1
    expect(peak).toBeLessThanOrEqual(4); // …and never past the cap
  });

  it('ONE unwritable file never blocks the rest — npm just resolves fresh for that lockfile', async () => {
    // The semantic the old per-file try/catch guaranteed, asserted so the rewrite cannot have lost it.
    const written: string[] = [];
    const write = vi.fn(async (p: string) => {
      if (p === 'yarn.lock') throw new Error('sandbox refused');
      written.push(p);
    });
    await pool(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'], 16, async (p) => {
      try { await write(p); } catch { /* per-file, exactly as before */ }
    });
    expect(written.sort()).toEqual(['package-lock.json', 'pnpm-lock.yaml']);
  });

  it('an empty set is a no-op, not a hang', async () => {
    await expect(pool([], 16, async () => { throw new Error('never called'); })).resolves.toBeUndefined();
  });
});

/**
 * The wiring half — source-level for the same reason as the other route guards: this lives in a
 * ~16,000-line closure that cannot be imported. If it silently reverts to a serial `for … await`,
 * nothing fails; imports just get slower again, one round-trip at a time.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the import writes its sandbox-only files through the shared pool', () => {
  it('uses pool(), not a serial awaited loop', () => {
    expect(route).toContain('await pool(Object.entries(opts.sandboxOnly ?? {}), SANDBOX_ONLY_WRITE_CONCURRENCY');
    expect(route).not.toMatch(/for \(const \[p, c\] of Object\.entries\(opts\.sandboxOnly[\s\S]{0,120}await this\.actuator\.writeFile/);
  });

  it('keeps the per-file catch — a rewrite must not turn one bad lockfile into a failed import', () => {
    const i = route.indexOf('await pool(Object.entries(opts.sandboxOnly');
    expect(i).toBeGreaterThan(0);
    expect(route.slice(i, i + 300)).toMatch(/try \{[\s\S]{0,120}catch \{/);
  });

  it('shares the asset path\'s concurrency shape rather than inventing a second number', () => {
    expect(route).toMatch(/SANDBOX_ONLY_WRITE_CONCURRENCY = Math\.max\(1, Math\.min\(32, Number\(process\.env\.AGENTV3_ASSET_WRITE_CONCURRENCY\) \|\| 16\)\)/);
  });
});
