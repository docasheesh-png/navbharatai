// THE CORRECTION IS READ BEFORE THE CLAIM (failedbr #2487, Q-3244). The summary opened "🎉 … Tayyar Hai! … Yeh game poore taur
// par functional hai" and only its LAST line said the game was never played. 🧬 Class: a correction placed where nobody reads
// it. The measured facts now also open the reply; the full correction (each claim named) stays at the end.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimHeadline, claimCorrection, auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

const NOT_PLAYED = 'NavBharatAI could not finish playing it in a real browser, so whether it is playable is NOT VERIFIED';

describe('the headline', () => {
  it('opens with the measured fact, once, and points to the full correction', () => {
    const c = [{ kind: 'game-claimed-playable', claimed: 'that the game is complete, working or playable', measured: NOT_PLAYED }] as Parameters<typeof claimHeadline>[0];
    const head = claimHeadline(c);
    expect(head.startsWith('⚠️ Not verified yet: ' + NOT_PLAYED)).toBe(true);
    expect(head).toMatch(/see the correction at the end\.\n\n$/);
    expect(claimHeadline([...c, ...c]).match(/NOT VERIFIED/g)).toHaveLength(1);
    expect(claimCorrection(c)).toContain('Correction from NavBharatAI itself');
  });
  it('nothing contradicted ⇒ nothing added', () => {
    expect(claimHeadline([])).toBe('');
  });
  it('the route puts it first and keeps the full correction last', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const auditedSummary = `${claimHeadline(contradictions)}${result.summary}${claimCorrection(contradictions)}`;');
  });
  it('the audit export used by the route still exists', () => {
    expect(typeof auditSummaryClaims).toBe('function');
  });
});
