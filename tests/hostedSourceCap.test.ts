/**
 * THE SIZE CEILING ON A CONTAINER PUBLISH — and the gap it closes, which is worth stating because
 * nobody would spot it by reading either file alone.
 *
 * `enforceHostingQuota` bounds a publish at `maxDeployMb()` (50 MB, ships ON) — but only for a
 * FIRST-PARTY provider, and `FIRST_PARTY_PROVIDERS` is `['firebase','cloudflare']`. NavBharat Cloud
 * publishes under `navbharat-cloud`, so that function returned ALLOW on its very first branch and
 * nothing downstream measured anything. A static app could not exceed 50 MB; a container app had no
 * ceiling at all — while the 2026-09-13 tiers grant 10 and 30 of them per plan.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { maxHostedSourceMb, hostedSourceWithinCap } from '../src/server/AgentV3/hostApp';
import { enforceHostingQuota, FIRST_PARTY_PROVIDERS } from '../src/server/lib/HostingQuota';
import { NAVBHARAT_CLOUD_PROVIDER } from '../src/server/AgentV3/hostedDeploymentRecord';

const MB = 1024 * 1024;

describe('THE GAP — proven, not asserted from memory', () => {
  it('navbharat-cloud is NOT a first-party provider, so the static quota never ran for it', () => {
    expect(FIRST_PARTY_PROVIDERS.has(NAVBHARAT_CLOUD_PROVIDER)).toBe(false);
  });

  it('…and enforceHostingQuota therefore allows ANY size on that path', async () => {
    // 500 MB, allowed, with no message. This is the behaviour the new cap backstops — and the reason
    // it could not simply be "add the provider to the set": that set also drives the monthly deploy
    // count and the total-storage accounting, so joining it changes two unrelated behaviours.
    const files = new Map([['big.bin', Buffer.alloc(500 * MB)]]);
    const verdict = await enforceHostingQuota({
      userId: 'u1', workspaceId: 'w1', providerId: NAVBHARAT_CLOUD_PROVIDER, files,
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe('the cap itself', () => {
  it('allows an ordinary app — source is a few MB, since node_modules are installed in the image', () => {
    expect(hostedSourceWithinCap(3 * MB, {} as NodeJS.ProcessEnv).ok).toBe(true);
  });

  it('refuses one over the line, and the message says what to do rather than only what failed', () => {
    const out = hostedSourceWithinCap(200 * MB, {} as NodeJS.ProcessEnv);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.message).toContain('served from storage');
    expect(out.message).toContain("nothing about your app's code needs to change");
    expect(out.capMb).toBe(40);
  });

  it('is exactly at the line, not one byte past it', () => {
    const cap = maxHostedSourceMb({} as NodeJS.ProcessEnv);
    expect(hostedSourceWithinCap(cap * MB, {} as NodeJS.ProcessEnv).ok).toBe(true);
    expect(hostedSourceWithinCap(cap * MB + 1, {} as NodeJS.ProcessEnv).ok).toBe(false);
  });
});

describe('⚠️ an EMPTY env value means unset, never zero', () => {
  /**
   * `Number('')` is 0 — finite and non-negative — so the obvious implementation turns a key set with
   * no value in Cloud Run into a silent, total removal of the ceiling, with nothing in the logs to
   * explain it. This is the trap `hostingStorageCapMb` documents; it is pinned here because the cost
   * of getting it wrong lands on a bill nobody is watching.
   */
  it('empty / whitespace / nonsense all fall back to the default, not to disabled', () => {
    for (const v of ['', '   ', 'forty', 'NaN']) {
      expect(maxHostedSourceMb({ NAVBHARAT_MAX_SOURCE_MB: v } as unknown as NodeJS.ProcessEnv), v).toBe(40);
    }
  });

  it('an explicit 0 DOES disable it — a deliberate act, and the only one', () => {
    const env = { NAVBHARAT_MAX_SOURCE_MB: '0' } as unknown as NodeJS.ProcessEnv;
    expect(maxHostedSourceMb(env)).toBe(0);
    expect(hostedSourceWithinCap(900 * MB, env).ok).toBe(true);
  });

  it('a real value is honoured', () => {
    const env = { NAVBHARAT_MAX_SOURCE_MB: '10' } as unknown as NodeJS.ProcessEnv;
    expect(hostedSourceWithinCap(9 * MB, env).ok).toBe(true);
    expect(hostedSourceWithinCap(11 * MB, env).ok).toBe(false);
  });
});

describe('🔒 an unmeasurable size is never a refusal', () => {
  /**
   * The size comes from a Buffer we already hold, so an unreadable one means OUR bug, not the user's
   * app — and a publish blocked by a number we could not compute is a refusal nobody can act on.
   */
  it('NaN, negative and garbage all pass', () => {
    for (const v of [NaN, -1, Infinity as unknown as number, 'big' as unknown as number]) {
      expect(hostedSourceWithinCap(v as number, {} as NodeJS.ProcessEnv).ok, String(v)).toBe(true);
    }
  });
});

describe('WIRING — it runs on the real publish path', () => {
  const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/hostApp.ts'), 'utf8');

  it('the host flow checks the PACKED archive, not the loose files', () => {
    // gzip is the difference between refusing a large app and refusing a large amount of repeated
    // text, and the packed bytes are what Cloud Build is actually handed.
    expect(src).toContain('hostedSourceWithinCap(archive.data.byteLength, env)');
  });

  it('it refuses with its own named reason, so a report can tell it from a build failure', () => {
    expect(src).toContain("reason: 'too-large'");
    expect(src).toContain("'unavailable' | 'no-source' | 'too-large'");
  });

  it('and it runs BEFORE the build — a refusal after paying for Cloud Build minutes is not a cap', () => {
    expect(src.indexOf('hostedSourceWithinCap(')).toBeLessThan(src.indexOf('buildAppContainer('));
  });
});
