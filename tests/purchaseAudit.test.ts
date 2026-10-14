// Purchase audit (2026-10-13): resell expiry, duplicate private database, server apps on lapse.
import { describe, it, expect, afterEach } from 'vitest';
import {
  decideResellRow, hasLapsedDedicatedDb, sweepResellAddons, RESELL_GRACE_DAYS, type ResellRow,
} from '../src/server/lib/resellLifecycle';
import { quoteDatabaseResell } from '../src/server/lib/resellQuote';
import { serverAppsToPauseOnLapse, appsToPauseOnLapse } from '../src/server/lib/hostingPlan';
import {
  resellExpirySweepEnabled, lapsePausesServerAppsEnabled, resellDuplicateGuardEnabled,
} from '../src/server/lib/purchaseAuditFlags';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T00:00:00.000Z');
const WS = 'workspace-abc123';
const row = (over: Partial<ResellRow> = {}): ResellRow => ({
  ref: 'srvabcdef12', addonId: 'server', purchasedAt: new Date(T0).toISOString(),
  expiresAt: new Date(T0 + 30 * DAY).toISOString(), agreedAt: new Date(T0).toISOString(),
  proof: `ws:${WS}:https://x.run.app`, ...over,
});

afterEach(() => {
  delete process.env.RESELL_EXPIRY_SWEEP;
  delete process.env.LAPSE_PAUSE_SERVER_APPS;
  delete process.env.RESELL_DUPLICATE_GUARD;
});

describe('flags default OFF', () => {
  it('all three are off unless set to on', () => {
    expect(resellExpirySweepEnabled()).toBe(false);
    expect(lapsePausesServerAppsEnabled()).toBe(false);
    expect(resellDuplicateGuardEnabled()).toBe(false);
    process.env.RESELL_EXPIRY_SWEEP = 'on';
    expect(resellExpirySweepEnabled()).toBe(true);
  });
});

describe('decideResellRow', () => {
  it('nothing early, 3-day then 1-day reminder, nothing in grace, lapse after grace', () => {
    expect(decideResellRow(row(), T0 + 10 * DAY)).toBeNull();
    expect(decideResellRow(row(), T0 + 27.5 * DAY)).toEqual({ kind: 'remind', days: 3 });
    expect(decideResellRow(row(), T0 + 29.5 * DAY)).toEqual({ kind: 'remind', days: 1 });
    expect(decideResellRow(row(), T0 + 31 * DAY)).toBeNull();
    expect(decideResellRow(row(), T0 + (30 + RESELL_GRACE_DAYS) * DAY)).toEqual({ kind: 'lapse' });
  });
  it('a reminder already sent for this expiry is not sent again; a lapsed row is finished', () => {
    const r = row({ remindedFor: { 3: new Date(T0 + 30 * DAY).toISOString() } });
    expect(decideResellRow(r, T0 + 27.5 * DAY)).toBeNull();
    expect(decideResellRow(row({ lapsedAt: 'x' }), T0 + 60 * DAY)).toBeNull();
  });
});

describe('sweepResellAddons', () => {
  function harness(rows: ResellRow[], teardownOk = true) {
    const patches: Array<[string, Partial<ResellRow>]> = [];
    const notes: string[] = [];
    const torn: string[] = [];
    return {
      patches, notes, torn,
      deps: {
        listWallets: async () => [{ id: 'u1', data: { userId: 'u1', hostingAddons: rows } }],
        patchRow: async (_w: string, ref: string, p: Partial<ResellRow>) => { patches.push([ref, p]); return true; },
        notify: async (_u: string, m: string) => { notes.push(m); },
        teardownServer: async (ws: string) => { torn.push(ws); return { ok: teardownOk }; },
        now: () => T0 + 40 * DAY,
      },
    };
  }
  it('takes an expired server down, marks it lapsed, tells the owner — never charges', async () => {
    const h = harness([row()]);
    const rep = await sweepResellAddons(h.deps);
    expect(h.torn).toEqual([WS]);
    expect(h.patches[0][1].lapsedAt).toBeTruthy();
    expect(h.notes[0]).toMatch(/taken down/);
    expect(rep.lapsed).toBe(1);
    // the deps carry no wallet-debit function at all; patches touch only markers
    expect(Object.keys(h.patches[0][1])).toEqual(['lapsedAt']);
  });
  it('a failed teardown is NOT marked, so the next pass retries', async () => {
    const h = harness([row()], false);
    const rep = await sweepResellAddons(h.deps);
    expect(h.patches).toEqual([]);
    expect(rep.serverTeardownFailed).toBe(1);
  });
  it('a private database is reported, never deleted', async () => {
    const h = harness([row({ ref: 'dbsabcdef12', addonId: 'dedicated_db', proof: `db:${WS}:projref1234` })]);
    const rep = await sweepResellAddons(h.deps);
    expect(h.torn).toEqual([]);
    expect(rep.dedicatedLapsed).toEqual(['u1:dbsabcdef12']);
  });
});

describe('duplicate private database guard', () => {
  const base = { plansOn: true, configured: true, workspaceId: WS, active: [], canPay: true, product: 'dedicated' as const };
  it('without a lapsed ref the quote is unchanged', () => {
    expect(quoteDatabaseResell(base).canStart).toBe(true);
  });
  it('with a lapsed ref it refuses and offers Remove', () => {
    const q = quoteDatabaseResell({ ...base, lapsedRef: 'dbsabcdef12' });
    expect(q.canStart).toBe(false);
    expect(q.stopRef).toBe('dbsabcdef12');
    expect(q.reason).toMatch(/Nothing was charged/);
  });
  it('hasLapsedDedicatedDb finds only this app\'s expired private db', () => {
    const r = row({ addonId: 'dedicated_db', proof: `db:${WS}:projref1234` });
    expect(hasLapsedDedicatedDb([r], WS, T0 + 31 * DAY)).toBe(true);
    expect(hasLapsedDedicatedDb([r], WS, T0 + 10 * DAY)).toBe(false);
    expect(hasLapsedDedicatedDb([r], 'other-workspace-1', T0 + 31 * DAY)).toBe(false);
  });
});

describe('server apps on plan lapse', () => {
  const apps = [
    { workspaceId: 'static-app-1', updatedAt: 3 },
    { workspaceId: 'server-app-1', updatedAt: 2, providerId: 'navbharat-cloud' },
    { workspaceId: 'server-app-2', updatedAt: 1, service: 'svc-2' },
  ];
  it('the old rule keeps all three (inside the free 3) — the leak', () => {
    expect(appsToPauseOnLapse(apps, 3)).toEqual([]);
  });
  it('the new rule pauses server apps, skipping paid extra servers and ones already pausing', () => {
    expect(serverAppsToPauseOnLapse(apps, [])).toEqual(['server-app-1', 'server-app-2']);
    expect(serverAppsToPauseOnLapse(apps, ['server-app-1'], ['server-app-2'])).toEqual([]);
  });
});
