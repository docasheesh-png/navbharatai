import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps, withoutDeclinedSentences } from '../src/server/lib/RequirementGapAnalyzer';
import { isComplexAppPrompt, namesHeavyGame } from '../src/server/lib/appComplexitySignals';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';

/**
 * 🔴 THE REPORT (build 4d538ca3, 2026-10-01). A "continue" turn on a personal AI assistant said:
 *
 *   "Do not add any paid service, paid API, recharge, subscription, or unnecessary dependency."
 *
 * The word `subscription` made it a SaaS app. REQUIREMENT_GAPS told the builder the app likely needs
 * multi-tenant isolation, team roles, an audit log and API keys; the request analyser scored the turn
 * complex_app 63, which opened it on the always-reasoning rung and skipped the fast lane. The user had
 * named those things only to forbid them.
 */

const REPORT_PROMPT = `Continue the existing project from its current working state. Do not rebuild or redesign anything unnecessarily, and do not remove any existing working features.

First inspect the current project and verify the existing build. Then implement only the requested missing feature from the project requirements. Keep the app mobile-first and functional.

Do not add any paid service, paid API, recharge, subscription, or unnecessary dependency. Use free/local browser capabilities wherever possible.

Before finishing, run the available checks, fix any errors, and confirm the Preview works. Do not claim the feature is built unless it is actually implemented and working.

Do not make large unrelated changes.`;

describe('a sentence that declines things is not evidence of what the app is', () => {
  it('🔴 the report: no SaaS domain, and no SaaS features to "include"', () => {
    const g = analyzeRequirementGaps(REPORT_PROMPT);
    expect(g.domain).not.toBe('saas');
    expect(g.likelyMissing.join(' ')).not.toMatch(/multi-tenant|team roles|audit log/i);
  });

  it('🔴 the report is not scored as a complex app any more', () => {
    const r = analyzeRequest({ prompt: REPORT_PROMPT });
    expect(r.taskType).not.toBe('complex_app');
    expect(r.complexityScore).toBeLessThan(40);
  });

  it('a declined scope word does not make an app complex', () => {
    expect(isComplexAppPrompt('Build a simple notes app. Do not add a database or login.')).toBe(false);
    expect(isComplexAppPrompt('make a calculator, no backend, no auth')).toBe(false);
  });

  it('a declined heavy-game word does not make a game heavy', () => {
    expect(namesHeavyGame('build a racing game, no multiplayer')).toBe(false);
  });

  it('Hinglish refusals at the end of a sentence count too', () => {
    expect(withoutDeclinedSentences('ek notes app banao. subscription wala system mat lagao.')).not.toMatch(/subscription/);
  });

  // ── Precision locks: a request stays a request ─────────────────────────────────────────────────
  it('🔒 an affirmative scope word still counts', () => {
    expect(isComplexAppPrompt('Build a notes app with a database and a login system.')).toBe(true);
    expect(analyzeRequirementGaps('Build a SaaS subscription billing platform for teams').domain).toBe('saas');
    expect(namesHeavyGame('build a 3d multiplayer racing game')).toBe(true);
  });

  it('🔒 "don\'t forget to add …" is a request, not a refusal', () => {
    expect(isComplexAppPrompt("Build a notes app. Don't forget to add a database.")).toBe(true);
  });

  it('🔒 a clause that only mentions "no" mid-way is kept', () => {
    expect(withoutDeclinedSentences('users with no login can still read posts')).toContain('users with no login');
  });

  it('removal only deletes evidence — text without a refusal is returned unchanged', () => {
    const t = 'Build an e-commerce store with cart, checkout and payments.';
    expect(withoutDeclinedSentences(t)).toBe(t);
  });
});
