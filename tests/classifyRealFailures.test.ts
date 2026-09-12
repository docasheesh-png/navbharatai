import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyFailure, buildRetrospective, OUTCOME_TO_CATEGORY } from '../src/server/lib/BuildRetrospectiveEngine';
import { outcomeCodeOf } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * THE CODE BEATS THE PROSE.
 *
 * The failure ledger ranks causes by what each costs us — and it is worth nothing if nearly every real
 * failure lands in `unknown`. That is exactly what would have happened: every pattern in the classifier
 * matches a COMPILER's words, and a v5 build fails with an OUTCOME_* diagnostic whose message is a
 * sentence we wrote ourselves.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const codeOf = (src: string) => src.split('\n')
  .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');

describe('what v5 actually fails with', () => {
  // The REAL messages, copied from the code that records them.
  const REAL = [
    ['OUTCOME_MISSING_FILES', 'After one creation pass, 3 local module(s) are STILL missing — the app will crash at runtime:\n  src/lib/db.ts'],
    ['OUTCOME_PREVIEW_COMPILE', 'The live in-browser preview does not compile (entry file: src/main.tsx) — the build is not fully working and was not charged.'],
    ['OUTCOME_MISSING_EXPORT', 'After one repair pass, 2 file(s) STILL miss an imported export — the build will fail:'],
  ] as const;

  it('🔒 would have been UNKNOWN on the text alone — which is why the code decides', () => {
    for (const [, message] of REAL) {
      expect(classifyFailure(message).category, message.slice(0, 40)).toBe('unknown');
    }
  });

  it('and IS classified once the build’s own verdict code is read', () => {
    for (const [code, message] of REAL) {
      const got = classifyFailure(message, code);
      expect(got.category, code).not.toBe('unknown');
      expect(got.hint.length).toBeGreaterThan(10);
    }
    expect(classifyFailure(REAL[1][1], 'OUTCOME_PREVIEW_COMPILE').category).toBe('preview');
    expect(classifyFailure(REAL[0][1], 'OUTCOME_MISSING_FILES').category).toBe('incomplete');
  });
});

describe('the code wins, and an unknown code is not a wrong answer', () => {
  it('🔒 the CODE beats the text even when the text would match something else', () => {
    // A timeout whose message happens to name a module must still be a timeout: the code is a fact the
    // build recorded, the text is prose about it.
    expect(classifyFailure('cannot find module "x"', 'OUTCOME_BUILD_TIMEOUT').category).toBe('timeout');
  });

  it('🔒 an UNRECOGNISED code falls through to the text — never silently mis-filed', () => {
    // So a code added later classifies exactly as it would have before that code existed, rather than
    // landing in whatever the map's first entry happens to be.
    expect(classifyFailure('SyntaxError: unexpected token', 'OUTCOME_SOMETHING_NEW').category).toBe('syntax');
    expect(classifyFailure('', 'OUTCOME_SOMETHING_NEW').category).toBe('unknown');
  });

  it('no code at all behaves exactly as before', () => {
    expect(classifyFailure('cannot find module "x"').category).toBe('dependency');
    expect(classifyFailure('ETIMEDOUT').category).toBe('timeout');
    expect(classifyFailure('').category).toBe('unknown');
  });

  it('every mapped code names a real category and a usable hint', () => {
    for (const [code, v] of Object.entries(OUTCOME_TO_CATEGORY)) {
      expect(code.startsWith('OUTCOME_'), code).toBe(true);
      expect(v.category, code).not.toBe('unknown');
      expect(v.hint.length, code).toBeGreaterThan(20);
    }
  });
});

describe('outcomeCodeOf', () => {
  it('returns the LAST outcome — the same "last one wins" rule deriveRootCause uses', () => {
    expect(outcomeCodeOf([
      { code: 'OUTCOME_BUILD_PARTIAL' }, { code: 'TOOL_ERROR' }, { code: 'OUTCOME_PREVIEW_FAILED' },
    ])).toBe('OUTCOME_PREVIEW_FAILED');
  });

  it('ignores everything that is not an outcome, and never throws', () => {
    expect(outcomeCodeOf([{ code: 'SANDBOX_UNAVAILABLE' }])).toBe('');
    expect(outcomeCodeOf([])).toBe('');
    expect(outcomeCodeOf(null)).toBe('');
    expect(outcomeCodeOf(undefined)).toBe('');
    expect(outcomeCodeOf([{ code: null as never }])).toBe('');
  });
});

describe('the retrospective carries it too', () => {
  it('classifies from the code when one is given', () => {
    const r = buildRetrospective({
      framework: 'react', intent: 'a shop',
      finalError: 'The live in-browser preview does not compile (entry file: src/main.tsx).',
      outcomeCode: 'OUTCOME_PREVIEW_COMPILE',
    });
    expect(r.category).toBe('preview');
    expect(r.warning).toContain('[preview]');
  });

  it('is unchanged for a caller that has no code', () => {
    expect(buildRetrospective({ finalError: 'cannot find module "x"' }).category).toBe('dependency');
  });
});

describe('the wiring', () => {
  const route = codeOf(read('src/server/routes/agentv3.ts'));

  it('🔒 the ledger classifies from the ROOT CAUSE and the verdict code, not the agent’s narrative', () => {
    expect(route).toContain('classifyFailure(failDiag.rootCause || result.summary || \'\', outcomeCodeOf(failDiag.issues))');
  });

  it('🔎 the per-workspace retrospective got the SAME fix — it had the same bug', () => {
    // An `unknown` warning recalled by the next build is a warning about nothing.
    expect(route).toContain('finalError: retroDiag.rootCause || result.summary,');
    expect(route).toContain('outcomeCode: outcomeCodeOf(retroDiag.issues),');
  });

  it('the stateless route accepts it, bounded', () => {
    const r = read('src/server/routes/retrospective.ts');
    expect(r).toContain("body.outcomeCode.slice(0, 60)");
  });
});
