import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  verifyAfterFix, verifyAfterFixEnabled, verifyAfterFixNote,
} from './verifyAfterFix';

/**
 * A post-green change may only STAND if the app still works after it. This is the answer to the admin's
 * first question — a non-technical user can never be handed a broken app, because a change that breaks
 * it is reverted before the build ends, not merely offered.
 *
 * The ordering IS the safety property: snapshot → apply → re-render → keep or revert. Every test pins
 * one branch of that, using injected hooks so nothing is faked.
 */

type Snap = { files: string };
const hooks = (o: Partial<{
  snapshot: () => Promise<Snap>;
  apply: () => Promise<void>;
  reverify: () => Promise<boolean>;
  revert: (s: Snap) => Promise<void>;
}>, log: string[]) => ({
  snapshot: o.snapshot ?? (async () => { log.push('snapshot'); return { files: 'green' }; }),
  apply: o.apply ?? (async () => { log.push('apply'); }),
  reverify: o.reverify ?? (async () => { log.push('reverify'); return true; }),
  revert: o.revert ?? (async (s: Snap) => { log.push(`revert:${s.files}`); }),
});

describe('a change that KEEPS the app working stands', () => {
  it('snapshot → apply → reverify(true) → keep, no revert', async () => {
    const log: string[] = [];
    const r = await verifyAfterFix(hooks({ reverify: async () => { log.push('reverify'); return true; } }, log));
    expect(r).toEqual({ kept: true, reverted: false, unverified: false });
    expect(log).toEqual(['snapshot', 'apply', 'reverify']); // never reverted
  });

  it('the snapshot is taken BEFORE the change — that is the whole point', async () => {
    const log: string[] = [];
    await verifyAfterFix(hooks({}, log));
    expect(log.indexOf('snapshot')).toBeLessThan(log.indexOf('apply'));
  });
});

describe('a change that BREAKS the app is rolled back automatically', () => {
  it('reverify(false) → revert to the exact green snapshot', async () => {
    const log: string[] = [];
    const r = await verifyAfterFix(hooks({ reverify: async () => { log.push('reverify'); return false; } }, log));
    expect(r).toEqual({ kept: false, reverted: true, unverified: false });
    expect(log).toEqual(['snapshot', 'apply', 'reverify', 'revert:green']); // restored the captured state
  });

  it('this is the non-technical-user guarantee: the broken version never survives the turn', async () => {
    const r = await verifyAfterFix(hooks({ reverify: async () => false }, []));
    expect(r.reverted).toBe(true);
    expect(r.kept).toBe(false);
  });
});

describe('honest handling of what we cannot prove', () => {
  it('if re-render CANNOT run, the change is KEPT but reported UNVERIFIED — we do not revert on a guess', async () => {
    // The app was green before; a change we cannot re-render may well be fine. Reverting it blindly
    // would throw away a legitimate fix.
    const r = await verifyAfterFix(hooks({ reverify: async () => { throw new Error('no preview'); } }, []));
    expect(r).toEqual({ kept: true, reverted: false, unverified: true });
  });

  it('if the SNAPSHOT cannot be captured, the change runs without the net — no worse than today', async () => {
    const log: string[] = [];
    const r = await verifyAfterFix(hooks({ snapshot: async () => { throw new Error('cannot read'); } }, log));
    expect(r.unverified).toBe(true);
    expect(log).toContain('apply'); // the fix still ran
  });

  it('if the REVERT itself fails, that is reported — the end-of-turn restore is the backstop', async () => {
    const r = await verifyAfterFix(hooks({
      reverify: async () => false,
      revert: async () => { throw new Error('revert failed'); },
    }, []));
    expect(r).toEqual({ kept: false, reverted: false, unverified: false });
  });
});

describe('the report lines', () => {
  it('names each outcome honestly', () => {
    expect(verifyAfterFixNote('runtime-error fix', { kept: true, reverted: false, unverified: false }).code).toBe('FIX_VERIFIED');
    expect(verifyAfterFixNote('runtime-error fix', { kept: false, reverted: true, unverified: false }).code).toBe('FIX_REVERTED');
    expect(verifyAfterFixNote('runtime-error fix', { kept: true, reverted: false, unverified: true }).code).toBe('FIX_UNVERIFIED');
    expect(verifyAfterFixNote('runtime-error fix', { kept: false, reverted: false, unverified: false }).code).toBe('FIX_REVERT_FAILED');
  });

  it('a rollback is auto-resolved (the app is back to working); a failed rollback is not', () => {
    expect(verifyAfterFixNote('x', { kept: false, reverted: true, unverified: false }).autoResolved).toBe(true);
    expect(verifyAfterFixNote('x', { kept: false, reverted: false, unverified: false }).autoResolved).toBe(false);
  });

  it('never claims a fix "worked" when it was rolled back', () => {
    const msg = verifyAfterFixNote('runtime-error fix', { kept: false, reverted: true, unverified: false }).message;
    expect(msg).toContain('rolled back');
    expect(msg.toLowerCase()).not.toContain('works');
  });
});

describe('kill switch', () => {
  it('defaults ON; off restores today\'s behaviour', () => {
    expect(verifyAfterFixEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(verifyAfterFixEnabled({ AGENTV3_VERIFY_AFTER_FIX: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('it is wired around the allowed post-green passes', () => {
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('the runtime-error auto-fix is wrapped in verify-after-fix', () => {
    expect(routes).toMatch(/verifyAfterFix[<(]/);
    expect(routes).toContain('verifyAfterFixEnabled()');
  });

  it('a reverted fix is restored through the allowlisted green-guard-restore pass', () => {
    // The revert writes through actuator.writeFile, which is frozen — so it must run inside the
    // allowlisted restore pass or the restore would itself be refused.
    const at = routes.search(/verifyAfterFix[<(]/);
    expect(at).toBeGreaterThan(-1);
    expect(routes.slice(at, at + 1500)).toContain("runInPass('green-guard-restore'");
  });
});
