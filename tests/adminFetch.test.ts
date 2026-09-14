/**
 * THE LIVE METRICS SCREEN WAS NEVER REAL — admin screenshot, 2026-09-14:
 * *"setting ke andar ka live matrix farzi hai, real data nahi show ho raha."*
 *
 * It showed **0 total builds · 0% success · 0% preview · 0s average · "No AI calls recorded yet" ·
 * $0.0000** — on an account that had built apps that same day.
 *
 * Nothing was mocked. The screen had never been able to load anything:
 *   • `/api/admin/metrics` authenticates on the `x-admin-token` header (`verifyAdminToken`)
 *   • `SettingsPanel` sent `Authorization: Bearer …` — in BOTH of its call sites
 *   • so the route answered 401 `{ error: 'Admin token required.' }`, every time, for every admin
 *   • and the client did `.then(r => r.json()).then(setAdminLiveMetrics)` with **no `r.ok` check**,
 *     so that error object became the dashboard's data and every field fell through its `?? 0`
 *
 * A confident dashboard of zeros, assembled out of fallbacks over an auth failure. These tests pin
 * both halves: the header has ONE spelling, and a failure can never be returned as data.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { adminGet, adminHeaders, adminFailed, ADMIN_TOKEN_HEADER } from '../src/lib/adminFetch';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const bad = (status: number) => ({ ok: false, status, json: async () => ({ error: 'nope' }) }) as Response;

describe('the header has one spelling, and it is the one the server reads', () => {
  it('is x-admin-token — the header verifyAdminToken actually checks', () => {
    expect(ADMIN_TOKEN_HEADER).toBe('x-admin-token');
    expect(adminHeaders('tok-1')).toEqual({ 'x-admin-token': 'tok-1' });
  });

  it('🔴 and it is NEVER Authorization: Bearer — the exact bug', () => {
    expect(Object.keys(adminHeaders('t'))).not.toContain('Authorization');
  });

  it('a missing token is an empty string, not a crash', () => {
    expect(adminHeaders('')).toEqual({ 'x-admin-token': '' });
  });
});

describe('🔒 a failure is never returned as data', () => {
  it('a 401 is a failure with an actionable message, and carries NO data', async () => {
    const r = await adminGet<{ builds: unknown }>('/api/admin/metrics', { fetchImpl: (async () => bad(401)) as never });
    expect(adminFailed(r)).toBe(true);
    expect(r).not.toHaveProperty('data');
    if (adminFailed(r)) {
      expect(r.status).toBe(401);
      expect(r.message).toMatch(/sign-in required/i);
    }
  });

  it('🔴 the exact shape that produced the zeros: an error BODY never reaches the caller', async () => {
    // The old code turned this very body into `adminLiveMetrics`, where `builds` was undefined and
    // every `?? 0` fired. The result type makes that impossible — there is no `data` to read.
    const r = await adminGet<any>('/api/admin/metrics', { fetchImpl: (async () => bad(401)) as never });
    expect((r as { data?: unknown }).data).toBeUndefined();
  });

  it('a non-401 failure says what happened without pretending to know why', async () => {
    const r = await adminGet('/x', { fetchImpl: (async () => bad(500)) as never });
    if (adminFailed(r)) expect(r.message).toMatch(/HTTP 500/);
    else throw new Error('expected a failure');
  });

  it('a network throw is status 0 — "could not ask" is not "the server said no"', async () => {
    const r = await adminGet('/x', { fetchImpl: (async () => { throw new Error('offline'); }) as never });
    expect(adminFailed(r)).toBe(true);
    if (adminFailed(r)) { expect(r.status).toBe(0); expect(r.message).toMatch(/offline/); }
  });

  it('a 200 that is not JSON is also not data', async () => {
    const r = await adminGet('/x', {
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })) as never,
    });
    expect(adminFailed(r)).toBe(true);
  });

  it('a real 200 returns the body, and the token reaches the request', async () => {
    const spy = vi.fn(async () => ok({ builds: { total: 7 } }));
    const r = await adminGet<{ builds: { total: number } }>('/api/admin/metrics', { token: 'tok-9', fetchImpl: spy as never });
    expect(adminFailed(r)).toBe(false);
    if (!adminFailed(r)) expect(r.data.builds.total).toBe(7);
    expect(spy.mock.calls[0][1]).toEqual({ headers: { 'x-admin-token': 'tok-9' } });
  });
});

/**
 * 🔒 THE CLASS GUARD. `'x-admin-token'` was hand-written in FOUR client files; three were right and
 * one was not, and nothing could tell, because there was no single answer for the wrong one to
 * disagree with. This scan makes a fifth spelling impossible to add anywhere in the client.
 */
describe('no client file may authenticate an admin call any other way', () => {
  function clientFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'server') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) clientFiles(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  const files = clientFiles('src');

  it('the scan actually found files — an empty sweep proves nothing', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('🔴 nothing sends an Authorization header to an /api/admin/ route', () => {
    // ⚠️ PER CALL, NOT PER FILE. The first version of this test flagged any file that mentioned both
    // strings anywhere — and caught `App.tsx`, whose `Authorization: Bearer` headers are GitHub API
    // calls that have nothing to do with this, plus this module's own comment describing the bug. A
    // guard that cries wolf gets deleted, so it reads a window around each admin URL instead.
    const HELPER = 'src/lib/adminFetch.ts'; // the rule's definition; it names the old bug on purpose
    const offenders: string[] = [];
    for (const f of files) {
      if (f.replace(/\\/g, '/').endsWith(HELPER)) continue;
      const text = readFileSync(f, 'utf8');
      for (let i = text.indexOf('/api/admin/'); i >= 0; i = text.indexOf('/api/admin/', i + 1)) {
        const near = text.slice(Math.max(0, i - 200), i + 300);
        if (/Authorization/.test(near)) offenders.push(`${f} @ ${i}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('🔒 and the guard is not vacuous — it DOES see the admin call sites it is meant to police', () => {
    const withAdminCalls = files.filter((f) => readFileSync(f, 'utf8').includes('/api/admin/'));
    // A sweep that found no admin calls would pass the test above while proving nothing at all.
    expect(withAdminCalls.length).toBeGreaterThan(2);
  });
});
