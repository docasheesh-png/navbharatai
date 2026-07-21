import { describe, it, expect, afterEach } from 'vitest';
import { consumeEngineerQuota } from './engineerQuota';

// The safety-critical guarantee: the quota must NEVER block a build when it is explicitly disabled,
// and must fail OPEN when there's no identified user / no DB. (The counting path needs Firestore and
// is exercised in integration; here we lock the never-block invariants that protect real users.)

const ORIG = process.env.ENGINEER_DAILY_LIMIT;
afterEach(() => {
  if (ORIG === undefined) delete process.env.ENGINEER_DAILY_LIMIT;
  else process.env.ENGINEER_DAILY_LIMIT = ORIG;
});

describe('consumeEngineerQuota — never-block invariants', () => {
  it('ENGINEER_DAILY_LIMIT=off → always allowed, limit 0, no counting', async () => {
    process.env.ENGINEER_DAILY_LIMIT = 'off';
    const r = await consumeEngineerQuota('user-1');
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(0);
  });

  it('ENGINEER_DAILY_LIMIT=0 is also a disable (not a zero-cap that blocks everyone)', async () => {
    process.env.ENGINEER_DAILY_LIMIT = '0';
    const r = await consumeEngineerQuota('user-1');
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(0);
  });

  it('an empty / missing userId is never blocked (IP limiter governs anon)', async () => {
    delete process.env.ENGINEER_DAILY_LIMIT; // default 50
    const r = await consumeEngineerQuota('');
    expect(r.allowed).toBe(true);
  });
});
