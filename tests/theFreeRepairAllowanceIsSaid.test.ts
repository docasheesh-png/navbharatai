/**
 * Locked plan item 4 (admin 2026-11-24; weakness audit P1-5): when the free tier's daily allowance stops an automatic
 * button fix, the USER is told, in plain words, what to tap now and when it comes back. Before, the stop was an admin-only
 * line and a server log. The cap is a money rule and is unchanged; paid tiers are never refused.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { explorerRepairTierGate, sayRepairGateNote, FREE_REPAIR_ALLOWANCE_USED_NOTE } from '../src/server/AgentV3/explorerRepair';
import { FINDING_SUGGESTIONS } from '../src/server/AgentV3/buildFindingSuggestions';

describe('the gate', () => {
  it('🔴 allowance used up on Weak: refused, with a note for the user', () => {
    const g = explorerRepairTierGate({ tier: 'weak', freeListed: false, weakAllowed: false });
    expect(g.attempt).toBe(false);
    expect(g.attempt === false && g.userNote).toBe(FREE_REPAIR_ALLOWANCE_USED_NOTE);
  });
  it('unreadable allowance: refused (fails closed) and said as not checked', () => {
    const g = explorerRepairTierGate({ tier: 'weak', freeListed: false, weakAllowed: null });
    expect(g.attempt === false && g.userNote).toMatch(/could not be checked/);
  });
  it('neighbours: a paid tier and an allowed Weak build are attempted, with nothing to say', () => {
    for (const g of [explorerRepairTierGate({ tier: 'normal', freeListed: false, weakAllowed: false }), explorerRepairTierGate({ tier: 'weak', freeListed: false, weakAllowed: true })]) {
      expect(g.attempt).toBe(true);
      expect(sayRepairGateNote(g, vi.fn())).toBe(false);
    }
  });
});

describe('what is said', () => {
  it('names the one-tap fix that really exists, and when automatic fixing returns', () => {
    const title = FINDING_SUGGESTIONS.find((s) => s.code === 'EXPLORE_FAILED')!.title;
    expect(FREE_REPAIR_ALLOWANCE_USED_NOTE).toContain(`"${title}"`);
    expect(FREE_REPAIR_ALLOWANCE_USED_NOTE).toMatch(/comes back tomorrow/);
  });
  it('the route says it beside the admin line', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/if \(!gate\.attempt\) \{ skip\(gate\.reason\); sayRepairGateNote\(gate,/);
  });
  it('a say that throws never breaks the build', () => {
    expect(sayRepairGateNote(explorerRepairTierGate({ tier: 'weak', freeListed: false, weakAllowed: false }), () => { throw new Error('x'); })).toBe(false);
  });
});
