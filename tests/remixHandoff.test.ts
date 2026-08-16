import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { writeRemixHandoff, takeRemixHandoff } from '../src/components/agentv3/v3SessionContinuity';

/**
 * "MAKE IT YOURS opens v5 but the code never arrives" (admin report 2026-08-16).
 *
 * THE ROOT CAUSE, and it is a race, not a lost file: the player wrote the sticky session under
 * `agentv3_session_<real-uid>` — correct, the store page had a resolved sign-in — and then reloaded.
 * Firebase restores a session ASYNCHRONOUSLY (0.3–2s, per this codebase's own auth comments), so the
 * v5 panel mounted inside that window with `userId === undefined`, read `agentv3_session_anon`, found
 * nothing, and minted a BRAND-NEW EMPTY session. Permanently — the session id is fixed on first
 * render. The copied files were never lost; they sat on a workspace nothing pointed at any more.
 *
 * Which also explains the shape of the report: signed OUT it would have worked, because 'anon' is
 * stable and there is no race. The bug only bites signed-in users — the ones who can buy.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// This suite runs in the `node` environment (vitest.config.ts), which has no sessionStorage — and the
// helpers swallow that by design, so without this the round-trip would silently test nothing.
if (typeof (globalThis as { sessionStorage?: unknown }).sessionStorage === 'undefined') {
  const mem = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
}

describe('the baton carries a RESOLVED workspace, so there is nothing to race', () => {
  beforeEach(() => { try { sessionStorage.clear(); } catch { /* jsdom always has it */ } });

  it('round-trips and is CONSUMED, so a later reload cannot re-announce an old remix', () => {
    writeRemixHandoff({ sessionId: 's1', workspaceId: 'agentv3-u1-s1', appName: 'coin collector' });
    const first = takeRemixHandoff();
    expect(first).toEqual({ sessionId: 's1', workspaceId: 'agentv3-u1-s1', appName: 'coin collector', owned: false });
    expect(takeRemixHandoff(), 'the baton is one-shot').toBeNull();
  });

  it('a malformed or half-written baton is ignored rather than half-applied', () => {
    try { sessionStorage.setItem('nbi_v3_remix_handoff', '{"sessionId":"s1"}'); } catch { /* */ }
    expect(takeRemixHandoff()).toBeNull();
    try { sessionStorage.setItem('nbi_v3_remix_handoff', 'not json'); } catch { /* */ }
    expect(takeRemixHandoff()).toBeNull();
  });

  it('the WORKSPACE is carried, not the ingredients to re-derive one', () => {
    // This is the whole fix: the client never recomputes an id from an identity it may not have yet.
    const src = read('src/components/agentv3/v3SessionContinuity.ts');
    expect(src).toContain('workspaceId: string');
    expect(src).toMatch(/RemixHandoff/);
  });
});

describe('the player hands it over, and the panel takes it FIRST', () => {
  it('the player writes the baton with the id the SERVER resolved', () => {
    const player = read('src/components/ide/WebAppPlayer.tsx');
    expect(player).toContain('writeRemixHandoff({ sessionId: sid, workspaceId: target');
    // …and still writes the sticky key, which is what every reload AFTER this one uses.
    expect(player).toContain('localStorage.setItem(key, sid)');
  });

  it('the panel reads the baton BEFORE the identity-dependent sticky keys', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    const takeAt = panel.indexOf('takeRemixHandoff()');
    const stickyAt = panel.indexOf('readStickySession(userId)');
    expect(takeAt).toBeGreaterThan(0);
    expect(takeAt, 'the baton must win — the sticky read is the one that races').toBeLessThan(stickyAt);
    expect(panel).toContain("handoff?.sessionId || readStickySession(userId)");
  });

  it('the file rehydrate targets the handed-over workspace', () => {
    expect(read('src/components/agentv3/AgentV3Panel.tsx'))
      .toContain('remixHandoffRef.current?.workspaceId || clientWorkspaceId(userId, sessionIdRef.current)');
  });
});

describe('a workspace with FILES BUT NO CONVERSATION is not a corner case', () => {
  it('openConversation re-arms the file rehydrate even when it finds nothing', () => {
    /**
     * It empties the file list first, then looks the conversation up. A store remix produces files
     * and NO conversation — so the not-found path used to return with the list empty and the
     * rehydrate still marked done for that workspace, and nothing ever refilled it.
     */
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    const start = panel.indexOf('const openConversation =');
    const fn = panel.slice(start, panel.indexOf('const restored = await loadConversation', start));
    expect(fn).toContain("rehydratedWsRef.current = ''");
  });
});

describe('the arrival is announced — an empty chat reads as "nothing happened"', () => {
  it('v5 shows a confirmation naming the app', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('remixArrived');
    expect(panel).toContain('is yours now');
    expect(panel).toContain('copied again');
  });
});

describe('BUY ONCE, COPY FOREVER — that app only (admin 2026-08-16)', () => {
  it('the entitlement can be listed, with a single-field query', () => {
    const mod = read('src/server/lib/navStoreRemixPurchase.ts');
    expect(mod).toContain('export async function listPurchases');
    // A .where(buyerUid).orderBy(at) would demand a composite index — the exact class of bug that
    // broke the store's first real publish. Sorted in memory instead.
    expect(mod).not.toMatch(/where\('buyerUid'[^)]*\)[\s\S]{0,80}orderBy/);
  });

  it('listing what you own GRANTS nothing — the remix route still re-checks that one app', () => {
    const routes = read('src/server/routes/navStore.ts');
    const remix = routes.slice(routes.indexOf('app/:id/remix'), routes.indexOf('app/:id/report'));
    expect(remix).toContain('hasPurchased(');
    expect(routes).toContain("app.get('/api/nav-store/web/purchases'");
  });

  it('a removed listing does not revoke a purchase', () => {
    // The creator can unpublish; what the buyer paid for stays theirs.
    expect(read('src/server/routes/navStore.ts')).toContain('available: !!found && found.status !== \'removed\'');
    expect(read('src/components/ide/NavAppStore.tsx')).toContain('your copy stays yours');
  });

  it('the owned section is hidden when you own nothing — no empty shelf', () => {
    expect(read('src/components/ide/NavAppStore.tsx')).toContain('{owned.length > 0 && (');
  });
});
