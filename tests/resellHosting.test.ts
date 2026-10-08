/**
 * A server or a database is billed only after it exists, and torn down if the bill cannot be taken.
 * Owning it yourself is not this path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  quoteServerResell, quoteDatabaseResell, serverAddonProof, databaseAddonProof,
  workspaceIdFromServerProof, projectRefFromDatabaseProof, stableResellRef,
} from '../src/server/lib/resellQuote';
import { executeServerResell, executeDatabaseResell } from '../src/server/lib/resellExecute';
import { createPlatformDatabase } from '../src/server/lib/platformDatabase';
import { computeDeliveredAddonPurchase, computeAddonPurchase } from '../src/server/lib/hostingAddonLedger';
import { TOKENS_PER_RUPEE } from '../src/server/lib/payments';
import type { ServerPublishResult } from '../src/server/AgentV3/serverPublish';

const WS = 'agentv3-user1-sess';
const NOW = '2026-10-09T12:00:00.000Z';

function wallet(inr: number) {
  const tokens = inr * TOKENS_PER_RUPEE;
  return { tokenBalance: tokens, total_money_spent: inr, walletLedger: [], remaining_balance: inr };
}

const baseServer = {
  plansOn: true,
  cloudAvailable: true,
  cloudMessage: '',
  isAdmin: false,
  planBackendApps: 10,
  liveWorkspaceIds: [] as string[],
  workspaceId: WS,
  active: [] as Array<{ ref: string; proof?: string }>,
  canPay: true,
};

describe('quotes', () => {
  it('a plan server is not charged again', () => {
    const q = quoteServerResell({ ...baseServer, liveWorkspaceIds: ['other-app'] });
    expect(q.mode).toBe('included');
    expect(q.canStart).toBe(false);
    expect(q.priceInr).toBe(0);
    expect(q.reason).toContain('₹0');
  });

  it('an extra server is offered only when the plan cap is full and the wallet can pay', () => {
    const full = Array.from({ length: 10 }, (_, i) => `agentv3-user1-s${i}`);
    const q = quoteServerResell({ ...baseServer, liveWorkspaceIds: full });
    expect(q.mode).toBe('addon');
    expect(q.canStart).toBe(true);
    expect(q.priceInr).toBe(149);
    expect(q.reason).toContain('host it yourself');
  });

  it('does not start an extra server when the balance cannot pay', () => {
    const full = Array.from({ length: 10 }, (_, i) => `agentv3-user1-s${i}`);
    const q = quoteServerResell({ ...baseServer, liveWorkspaceIds: full, canPay: false });
    expect(q.canStart).toBe(false);
    expect(q.status).toBe(402);
  });

  it('an unreadable count does not start a paid server', () => {
    const q = quoteServerResell({ ...baseServer, liveWorkspaceIds: null });
    expect(q.canStart).toBe(false);
    expect(q.status).toBe(503);
  });

  it('cloud closed ⇒ nothing, and own hosting is still named', () => {
    const q = quoteServerResell({ ...baseServer, cloudAvailable: false, cloudMessage: 'Not open yet.' });
    expect(q.canStart).toBe(false);
    expect(q.reason).toContain('Not open yet');
    expect(q.reason).toContain('host it yourself');
  });

  it('a server already paid for this app is not bought again, and it can be stopped', () => {
    const proof = serverAddonProof(WS, 'https://app.example.run.app')!;
    const q = quoteServerResell({
      ...baseServer,
      liveWorkspaceIds: Array.from({ length: 10 }, (_, i) => `agentv3-user1-s${i}`),
      active: [{ ref: 'srvabc12345', proof }],
    });
    expect(q.mode).toBe('included');
    expect(q.canStart).toBe(false);
    expect(q.stopRef).toBe('srvabc12345');
  });

  it('a database is not offered when the platform org is unset, and own Supabase is named', () => {
    const q = quoteDatabaseResell({ plansOn: true, configured: false, workspaceId: WS, active: [], canPay: true });
    expect(q.canStart).toBe(false);
    expect(q.reason).toContain('Supabase');
    expect(q.reason).toContain('Nothing was charged');
  });

  it('a payable database may start', () => {
    const q = quoteDatabaseResell({ plansOn: true, configured: true, workspaceId: WS, active: [], canPay: true });
    expect(q.canStart).toBe(true);
    expect(q.priceInr).toBe(1499);
  });
});

describe('proofs', () => {
  it('round-trips a server url and a database id', () => {
    const server = serverAddonProof(WS, 'https://app.example.run.app');
    expect(workspaceIdFromServerProof(server)).toBe(WS);
    const db = databaseAddonProof(WS, 'abcdefghijklmnop');
    expect(projectRefFromDatabaseProof(db)).toBe('abcdefghijklmnop');
    expect(serverAddonProof('short', 'https://x')).toBeNull();
    expect(databaseAddonProof(WS, 'bad')).toBeNull();
  });

  it('the same app in the same 30 days gets one purchase id', () => {
    const a = stableResellRef('server', WS, Date.parse(NOW));
    const b = stableResellRef('server', WS, Date.parse(NOW) + 1000);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(stableResellRef('database', WS, Date.parse(NOW))).not.toBe(a);
  });
});

function live(ready: boolean, url = 'https://app.example.run.app'): ServerPublishResult {
  return { status: 200, live: true, ready, url, service: 'svc-1', body: { ok: true, url } };
}

describe('server execution order', () => {
  const full = Array.from({ length: 10 }, (_, i) => `agentv3-user1-s${i}`);

  it('does not deploy when the wallet cannot pay', async () => {
    let published = 0;
    const r = await executeServerResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput: { ...baseServer, liveWorkspaceIds: full, canPay: false },
      publish: async () => { published++; return live(true); },
      charge: async () => { throw new Error('charged'); },
      teardown: async () => ({ ok: true }),
    });
    expect(published).toBe(0);
    expect(r.status).toBe(402);
    expect(r.body.charged).toBe(false);
  });

  it('does not deploy a server the plan already includes', async () => {
    let published = 0;
    const r = await executeServerResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput: { ...baseServer, liveWorkspaceIds: ['only-one'] },
      publish: async () => { published++; return live(true); },
      charge: async () => ({ ok: true, charged: true, active: true }),
      teardown: async () => ({ ok: true }),
    });
    expect(published).toBe(0);
    expect(r.body.charged).toBe(false);
  });

  it('takes a not-ready server down and does not charge', async () => {
    let charged = 0;
    let torn = 0;
    const r = await executeServerResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput: { ...baseServer, liveWorkspaceIds: full },
      publish: async () => live(false),
      charge: async () => { charged++; return { ok: true, charged: true, active: true }; },
      teardown: async () => { torn++; return { ok: true }; },
    });
    expect(charged).toBe(0);
    expect(torn).toBe(1);
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toContain('Nothing was charged');
  });

  it('charges only after the server is ready', async () => {
    let proof = '';
    const r = await executeServerResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput: { ...baseServer, liveWorkspaceIds: full },
      publish: async () => live(true),
      charge: async (_ref, p) => { proof = p; return { ok: true, charged: true, active: true }; },
      teardown: async () => { throw new Error('should stay up'); },
    });
    expect(r.status).toBe(200);
    expect(r.body.charged).toBe(true);
    expect(proof.startsWith(`ws:${WS}:`)).toBe(true);
  });

  it('takes the server down when the charge fails', async () => {
    let torn = 0;
    const r = await executeServerResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput: { ...baseServer, liveWorkspaceIds: full },
      publish: async () => live(true),
      charge: async () => ({ ok: false, error: 'Wallet write failed.', active: false }),
      teardown: async () => { torn++; return { ok: true }; },
    });
    expect(torn).toBe(1);
    expect(r.status).toBe(402);
    expect(String(r.body.error)).toContain('Nothing was charged');
  });
});

describe('database execution order', () => {
  const quoteInput = { plansOn: true, configured: true, workspaceId: WS, active: [] as [], canPay: true };

  it('does not create a project when the org is not configured', async () => {
    let created = 0;
    const r = await executeDatabaseResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput: { ...quoteInput, configured: false },
      create: async () => { created++; return { ok: false, message: 'no', cleaned: true }; },
      save: async () => true,
      charge: async () => ({ ok: true, charged: true, active: true }),
      destroy: async () => ({ ok: true }),
      refund: async () => ({ ok: true }),
    });
    expect(created).toBe(0);
    expect(r.body.charged).toBe(false);
  });

  it('deletes the project and does not save keys when the charge fails', async () => {
    let saved = 0;
    let destroyed = 0;
    const r = await executeDatabaseResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput,
      create: async () => ({ ok: true, projectRef: 'abcdefghijklmnop', url: 'https://abcdefghijklmnop.supabase.co', env: { VITE_SUPABASE_URL: 'x' } }),
      save: async () => { saved++; return true; },
      charge: async () => ({ ok: false, error: 'Not enough.', active: false }),
      destroy: async () => { destroyed++; return { ok: true }; },
      refund: async () => ({ ok: true }),
    });
    expect(saved).toBe(0);
    expect(destroyed).toBe(1);
    expect(r.body.charged).toBe(false);
    expect(r.body.env).toBeUndefined();
  });

  it('refunds if the keys cannot be saved after a charge', async () => {
    let destroyed = 0;
    let refunded = 0;
    const r = await executeDatabaseResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput,
      create: async () => ({ ok: true, projectRef: 'abcdefghijklmnop', url: 'https://abcdefghijklmnop.supabase.co', env: { SECRET: 'nope' } }),
      save: async () => false,
      charge: async () => ({ ok: true, charged: true, active: true }),
      destroy: async () => { destroyed++; return { ok: true }; },
      refund: async () => { refunded++; return { ok: true }; },
    });
    expect(destroyed).toBe(1);
    expect(refunded).toBe(1);
    expect(r.status).toBe(500);
    expect(String(r.body.error)).toContain('returned');
  });

  it('saves the keys only after the charge lands', async () => {
    const order: string[] = [];
    const r = await executeDatabaseResell({ agreedToTerms: true, workspaceId: WS }, {
      quoteInput,
      create: async () => ({ ok: true, projectRef: 'abcdefghijklmnop', url: 'https://abcdefghijklmnop.supabase.co', env: { VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co' } }),
      save: async () => { order.push('save'); return true; },
      charge: async () => { order.push('charge'); return { ok: true, charged: true, active: true }; },
      destroy: async () => ({ ok: true }),
      refund: async () => ({ ok: true }),
    });
    expect(order).toEqual(['charge', 'save']);
    expect(r.status).toBe(200);
    expect(r.body.charged).toBe(true);
  });
});

describe('platform database cleanup', () => {
  it('deletes a project that never became ready and does not return keys', async () => {
    let deleted = 0;
    const r = await createPlatformDatabase({ token: 't', orgId: 'o', region: 'ap-south-1' }, {
      createProject: async () => ({ ok: true, project: { id: 'abcdefghijklmnop', name: 'n', region: 'ap-south-1' } }),
      waitUntilReady: async () => ({ ok: false, failure: 'timeout', message: 'slow' }),
      fetchProjectCredentials: async () => { throw new Error('should not read keys'); },
      fetchPoolerConnection: async () => null,
      deleteProject: async () => { deleted++; return { ok: true }; },
      password: () => 'secret-pass',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cleaned).toBe(true);
    expect(deleted).toBe(1);
  });

  it('returns keys only when the project is healthy', async () => {
    const r = await createPlatformDatabase({ token: 't', orgId: 'o', region: 'ap-south-1' }, {
      createProject: async () => ({ ok: true, project: { id: 'abcdefghijklmnop', name: 'n', region: 'ap-south-1' } }),
      waitUntilReady: async () => ({ ok: true }),
      fetchProjectCredentials: async () => ({ ok: true, credentials: { projectRef: 'abcdefghijklmnop', url: 'https://abcdefghijklmnop.supabase.co', anonKey: 'anon-key-value' } }),
      fetchPoolerConnection: async () => null,
      deleteProject: async () => { throw new Error('must not delete a healthy project'); },
      password: () => 'secret-pass',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.env.VITE_SUPABASE_URL).toContain('abcdefghijklmnop');
      expect(r.env.DATABASE_URL).toContain('secret-pass');
      expect(JSON.stringify(r)).not.toContain('dbPass');
    }
  });
});

describe('the bill itself', () => {
  it('a server purchase from the add-on list still charges nothing', () => {
    const start = wallet(5000);
    const r = computeAddonPurchase(start, NOW, 'server', { agreedToTerms: true, clientRef: 'addonref01' });
    expect(r.ok).toBe(false);
    expect(start.tokenBalance).toBe(5000 * TOKENS_PER_RUPEE);
  });

  it('charges a delivered server only when the proof is a real id', () => {
    const start = wallet(149);
    const missing = computeDeliveredAddonPurchase(start, NOW, 'server', { agreedToTerms: true, clientRef: 'addonref01', proof: 'short' });
    expect(missing.ok).toBe(false);
    expect(start.hostingAddons).toBeUndefined();
    const ok = computeDeliveredAddonPurchase(start, NOW, 'server', {
      agreedToTerms: true, clientRef: 'addonref01', proof: serverAddonProof(WS, 'https://app.example.run.app')!,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.charged).toBe(true);
      expect(ok.addon.proof).toContain(WS);
      expect(ok.wallet.tokenBalance).toBe(0);
    }
  });

  it('the billing Remove route refuses a server or a database before it can refund', () => {
    const walletSrc = readFileSync(join(__dirname, '../src/server/routes/wallet.ts'), 'utf8');
    const gate = walletSrc.indexOf("row.addonId === 'server' || row.addonId === 'dedicated_db'");
    const refund = walletSrc.indexOf('await removeHostingAddon(');
    expect(gate).toBeGreaterThan(-1);
    expect(refund).toBeGreaterThan(gate);
    const route = readFileSync(join(__dirname, '../src/server/routes/resellHosting.ts'), 'utf8');
    const lock = route.indexOf("'hosting-addon-purchase'");
    const publish = route.indexOf('deps.publishServer');
    expect(lock).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(lock);
  });
});
