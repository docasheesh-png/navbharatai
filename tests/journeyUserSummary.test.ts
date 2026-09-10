import { describe, it, expect } from 'vitest';
import { journeyUserSummary } from '../src/server/AgentV3/journeyUserSummary';
import type { JourneyResult } from '../src/server/AgentV3/journeyDerivation';

const r = (over: Partial<JourneyResult>): JourneyResult => ({
  id: 'j1', kind: 'create-persists', route: '/items', verdict: 'passed', step: 'reload', note: '', errors: [], ...over,
});

describe('journeyUserSummary — the proof, in the user’s words', () => {
  it('says the reload out loud, because that is the part that proves saving works', () => {
    const s = journeyUserSummary([r({})]);
    expect(s.ok).toBe(true);
    expect(s.steps[0]).toContain('reloaded');
    expect(s.steps[0]).toContain('still there');
  });

  it('shows NOTHING when nothing ran — never an encouraging sentence about work that did not happen', () => {
    expect(journeyUserSummary([])).toEqual({ ok: false, headline: '', steps: [] });
    expect(journeyUserSummary(null).headline).toBe('');
    expect(journeyUserSummary(undefined).headline).toBe('');
  });

  it('never rounds "could not reach it" up into a pass', () => {
    const s = journeyUserSummary([r({ verdict: 'unreachable', note: 'the page needs a login' })]);
    expect(s.ok).toBe(false);
    expect(s.headline).toContain('could not reach it');
    expect(s.steps[0]).toContain('needs a login');
  });

  it('leads with the problem when something failed', () => {
    const s = journeyUserSummary([r({ verdict: 'failed', note: 'the entry vanished on reload' })]);
    expect(s.ok).toBe(false);
    expect(s.headline).toContain('did not pass');
    expect(s.steps[0]).toContain('vanished on reload');
  });

  it('does not hide a failure behind the passes beside it', () => {
    const s = journeyUserSummary([r({ id: 'a' }), r({ id: 'b', route: '/orders', verdict: 'failed', note: 'the form did nothing' })]);
    expect(s.ok).toBe(false);
    expect(s.headline).toContain('found a problem');
    expect(s.steps).toHaveLength(2);
  });

  it('names the home page in words rather than as "/"', () => {
    expect(journeyUserSummary([r({ route: '/' })]).steps[0]).toContain('the home page');
  });

  it('leaks no internal vocabulary — no codes, no tool names, no "journey"', () => {
    const s = journeyUserSummary([r({}), r({ id: 'b', route: '/x', verdict: 'failed', note: 'crashed' })]);
    const all = [s.headline, ...s.steps].join(' ').toLowerCase();
    for (const banned of ['journey', 'playwright', 'e2b', 'sandbox', 'verdict', 'create-persists', 'gate']) {
      expect(all).not.toContain(banned);
    }
  });

  it('counts only the passes in the headline', () => {
    const s = journeyUserSummary([r({ id: 'a' }), r({ id: 'b', route: '/o' }), r({ id: 'c', route: '/z', verdict: 'unreachable' })]);
    expect(s.headline).toContain('2 tests');
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the proof reaches the user, not just the admin report', () => {
  it('the reducer records it verbatim', () => {
    const s = agentV3Reducer(initialAgentV3State, {
      type: 'verified', ok: true, headline: 'NavBharatAI tested your app in a real browser',
      steps: ['Filled in the form on the /items page, saved it, reloaded — and it was still there.'], ts: 1,
    });
    expect(s.verification).toEqual({
      ok: true,
      headline: 'NavBharatAI tested your app in a real browser',
      steps: ['Filled in the form on the /items page, saved it, reloaded — and it was still there.'],
    });
  });

  it('a FAILURE is recorded exactly as faithfully as a pass', () => {
    // The whole value of showing the work is that it is shown when it went wrong too. A card that
    // only ever appears on success is marketing, not evidence.
    const s = agentV3Reducer(initialAgentV3State, {
      type: 'verified', ok: false, headline: 'NavBharatAI tested your app and it did not pass',
      steps: ['the /items page did not work: the entry vanished on reload.'], ts: 1,
    });
    expect(s.verification?.ok).toBe(false);
    expect(s.verification?.steps[0]).toContain('vanished on reload');
  });

  it('the route emits it beside the finding it already recorded for the admin', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("emit({ type: 'verified'");
    expect(route).toContain('journeyUserSummary(journeyResults)');
    // Nothing to say honestly ⇒ nothing emitted, rather than an empty card.
    expect(route).toContain('if (proof.headline)');
  });

  it('the panel shows a failure in the same place as a pass', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('state.verification');
    expect(panel).toContain('state.verification.ok');
    expect(panel).toContain('border-amber-500/40');
  });
});
