/**
 * After a build, the needs that are real are said in the user's language, and the ❓ row opens a
 * screen that actually exists. It never sells a price that is not in the catalogue.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { buildNeedsNotice, liveHostingPlanList } from '../src/server/AgentV3/buildNeeds';
import {
  connectActions, databaseConnectAction, serverConnectAction, SERVER_SUBJECT,
} from '../src/server/AgentV3/connectActions';
import { actionKey } from '../src/server/AgentV3/userActions';
import { normalizeUserAction } from '../src/server/AgentV3/UserActionStore';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';

const DB = { needsDatabase: true, connected: false, canProvision: false };
const SERVER = { needsServer: true, plan: 'buy' as const };

describe('the chat line only names a real need', () => {
  it('a plain app says nothing', () => {
    expect(buildNeedsNotice({
      database: { needsDatabase: false, connected: false, canProvision: false },
      server: { needsServer: false, plan: 'none' },
    }, 'hi')).toBe('');
  });

  it('English keeps the database sentence the tray already promised', () => {
    const row = databaseConnectAction(DB, 'b1', 1)!;
    expect(row.title).toBe('Connect a database');
    expect(row.cta).toEqual({ view: 'settings', settingsScreen: 'database', label: 'Open Database' });
    expect(row.why).toContain('nothing it saves will survive');
    expect(row.blocking).toBe(false);
  });

  it('Hindi is Hindi, and a Latin prompt stays English', () => {
    const hi = buildNeedsNotice({ database: DB, server: { needsServer: false, plan: 'none' } }, 'hi');
    expect(hi).toContain('Database जोड़ें');
    expect(hi).not.toContain('Connect a database');
    const en = buildNeedsNotice({ database: DB }, null);
    expect(en).toContain('Connect a database');
  });

  it('a server with no plan opens Plans, at the live catalogue price, and sells nothing else', () => {
    const row = serverConnectAction(SERVER, 'b1', 1)!;
    expect(row.id).toBe(actionKey('connect', SERVER_SUBJECT));
    expect(row.blocking).toBe(false);
    expect(row.cta).toEqual({ view: 'billing', label: 'Open Plans' });
    for (const tier of HOSTING_TIERS) expect(row.why).toContain(`₹${tier.priceInr}`);
    expect(row.why).toContain(liveHostingPlanList());
    expect(row.why).not.toMatch(/₹49|₹20/);
    const text = buildNeedsNotice({ server: SERVER }, 'en');
    expect(text).toContain('This app needs a server');
    expect(text).not.toMatch(/₹49|₹20/);
  });

  it('a plan they already hold, or a plan we could not read, has no purchase button', () => {
    expect(serverConnectAction({ needsServer: true, plan: 'included' }, 'b1', 1)!.cta).toBeUndefined();
    expect(serverConnectAction({ needsServer: true, plan: 'none' }, 'b1', 1)!.cta).toBeUndefined();
    expect(serverConnectAction({ needsServer: false, plan: 'buy' }, 'b1', 1)).toBeNull();
  });

  it('both needs are one tray each, and a stored connect row survives being read back', () => {
    const rows = connectActions({ database: DB, server: SERVER, lang: 'hi' }, 'b1', 1);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('Database जोड़ें');
    const back = normalizeUserAction(rows[1]);
    expect(back?.kind).toBe('connect');
    expect(back?.cta).toEqual({ view: 'billing', label: 'Plans खोलें' });
    // A view that is not a real screen is dropped, and the task itself is kept.
    const poisoned = normalizeUserAction({ ...rows[0], cta: { view: 'admin', label: 'Buy ₹49' } });
    expect(poisoned?.cta).toBeUndefined();
    expect(poisoned?.title).toBe('Database जोड़ें');
  });
});

describe('the route says it, and the tray button only navigates', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const tray = readFileSync('src/components/agentv3/UserActionTray.tsx', 'utf8');

  it('the build narration is built from the same facts as the tray', () => {
    expect(route).toContain('buildNeedsNotice({ database, server }, lang)');
    expect(route).toContain('planDeployment(appFiles)');
    expect(route).toContain("serverPlan = probe.active ? 'included' : 'buy'");
  });

  it('the button opens Billing or Database and never posts a purchase', () => {
    expect(tray).toContain("view: 'billing'");
    expect(tray).toContain("settingsScreen: 'database'");
    expect(tray).not.toMatch(/fetch\(|\/purchase|hosting-addons/);
  });
});
