import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSiteUptimeSweep } from './siteUptimeSweep';
import { emptyRecord, type UptimeRecord, type ProbeOutcome } from './siteUptime';

const link = (domain: string, userId = 'u1') => ({ domain, workspaceId: 'ws-' + domain, userId });

function harness(outcomes: Record<string, ProbeOutcome[]>, seed: Record<string, UptimeRecord> = {}) {
  const store = new Map<string, UptimeRecord>(Object.entries(seed));
  const bell: string[] = []; const mail: string[] = [];
  let t = 1_000_000;
  const deps = {
    links: async () => Object.keys(outcomes).map((d) => link(d)),
    probe: async (d: string) => outcomes[d].shift() ?? ('unknown' as ProbeOutcome),
    load: async (d: string, ws: string, u: string) => store.get(d) ?? emptyRecord(d, ws, u),
    save: async (r: UptimeRecord) => { store.set(r.domain, r); },
    notify: async (_u: string, m: string) => { bell.push(m); },
    email: async (_u: string, m: string) => { mail.push(m); return true; },
    now: () => (t += 60_000),
    env: {} as NodeJS.ProcessEnv,
  };
  return { deps, store, bell, mail };
}

describe('runSiteUptimeSweep — the orchestration, without a network', () => {
  it('🔒 alerts the owner once after TWO consecutive failures, on both channels', async () => {
    const h = harness({ 'mitrify.com': ['down'] });
    expect((await runSiteUptimeSweep(h.deps)).alertedDown).toBe(0);
    h.deps.probe = async () => 'down';
    const r = await runSiteUptimeSweep(h.deps);
    expect(r).toMatchObject({ probed: 1, alertedDown: 1, alertedUp: 0 });
    expect(h.bell).toHaveLength(1);
    expect(h.mail).toHaveLength(1);
    expect(h.bell[0]).toContain('mitrify.com');
    // Still down on the next sweep, inside the cooldown ⇒ silence.
    await runSiteUptimeSweep(h.deps);
    expect(h.bell).toHaveLength(1);
  });

  it('announces the recovery once', async () => {
    const h = harness({ 'a.com': ['down', 'down', 'up', 'up'] });
    await runSiteUptimeSweep(h.deps); await runSiteUptimeSweep(h.deps);
    const up = await runSiteUptimeSweep(h.deps);
    expect(up.alertedUp).toBe(1);
    expect(h.bell[1]).toMatch(/answering again/);
    expect((await runSiteUptimeSweep(h.deps)).alertedUp).toBe(0);
  });

  it('🔒 "unknown" never becomes an alert, however many times', async () => {
    const h = harness({ 'a.com': ['unknown', 'unknown', 'unknown'] });
    for (let i = 0; i < 3; i++) await runSiteUptimeSweep(h.deps);
    expect(h.bell).toHaveLength(0);
    expect(h.store.get('a.com')!.failures).toBe(0);
  });

  it('one bad domain does not stop the rest, and a failing mailer does not stop the bell', async () => {
    const h = harness({ 'bad.com': ['down', 'down'], 'good.com': ['down', 'down'] });
    const probe = h.deps.probe;
    h.deps.probe = async (d) => { if (d === 'bad.com') throw new Error('boom'); return probe(d); };
    h.deps.email = async () => { throw new Error('mailer down'); };
    await runSiteUptimeSweep(h.deps);
    const r = await runSiteUptimeSweep(h.deps);
    expect(r.alertedDown).toBe(1);
    expect(h.bell).toHaveLength(1);
  });

  it('honours the kill switch without touching the store', async () => {
    const h = harness({ 'a.com': ['down'] });
    h.deps.env = { SITE_UPTIME_SWEEP: 'off' } as NodeJS.ProcessEnv;
    expect((await runSiteUptimeSweep(h.deps)).skipped).toBe('disabled');
    expect(h.store.size).toBe(0);
  });
});

describe('🔒 wiring', () => {
  const server = readFileSync(resolve(__dirname, '../../../server.ts'), 'utf8');
  const sweep = readFileSync(resolve(__dirname, 'siteUptimeSweep.ts'), 'utf8');

  it('is registered on the shared scheduler, EXCLUSIVE, every 15 minutes', () => {
    const at = server.indexOf("id: 'site-uptime',");
    expect(at).toBeGreaterThan(-1);
    const block = server.slice(at, at + 600);
    expect(block).toContain('exclusive: true');
    expect(block).toContain("schedule: { kind: 'everyMs', ms: 15 * 60_000 }");
    expect(block).toContain('runSiteUptimeSweep()');
  });

  it("emails the OWNER's verified address, never the admin list", () => {
    expect(sweep).toContain('to: [to]');
    expect(sweep).toContain("u.emailVerified !== false ? u.email : null");
  });

  it('probes through the SSRF-guarded serving check, not a raw fetch', () => {
    expect(sweep).toContain('checkDomainServing(domain)');
    expect(sweep).not.toMatch(/\bfetch\(/);
  });
});
