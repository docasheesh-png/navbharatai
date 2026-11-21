// A REFUSED REQUEST IS NOT AN "INVALID COMPLETION" (failedbr #2485, Q-3234).
//
// Six attempts in a row answered HTTP 404 and the report called each one "response_validation: invalid_completion" — the
// catch-all for "an answer we could not use". The one fact that told them apart (the status) reached only the last line.
// 🧬 THE CLASS: a catch-all reason that hides the one measured fact about a failure. The status (an integer, never
// upstream text) now rides every attempt's line; the engine's own machine code reaches the server log as a code-shaped
// token only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeSurplusAttemptFailure } from '../src/server/AI/SurplusRegistry/buildSession';
import { surplusErrorCodeToken } from '../src/server/AI/SurplusRegistry/productionAdapter';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the report names what the engine answered', () => {
  it('the #2485 line: a 404 is said as a refusal with its status, never as an invalid completion', () => {
    const line = describeSurplusAttemptFailure({ model: 'm-1', stage: 'response_validation', reason: 'invalid_completion', attempt: 1, httpStatus: 404, sameModelRetry: true });
    expect(line).toContain('the engine refused the request, HTTP 404');
    expect(line).not.toContain('invalid_completion');
    expect(line).toContain('retried on the same model');
  });
  it('a 2xx answer that could not be used keeps its own reason; no status keeps the old words', () => {
    expect(describeSurplusAttemptFailure({ model: 'm', stage: 'response_validation', reason: 'empty_completion', attempt: 2, httpStatus: 200 })).toContain('(response_validation: empty_completion)');
    expect(describeSurplusAttemptFailure({ model: 'm', stage: 'dispatch', reason: 'dispatch_failed', attempt: 1 })).toContain('(dispatch: dispatch_failed)');
    for (const status of [429, 500, 503]) expect(describeSurplusAttemptFailure({ model: 'm', stage: 'response_validation', reason: 'invalid_completion', attempt: 1, httpStatus: status })).toContain(`HTTP ${status}`);
  });
  it('the status travels from the attempt to the report line', () => {
    const runner = read('src/server/AgentV3/providers/SurplusTurnRunner.ts');
    expect(runner).toMatch(/const status = httpStatusOf\(raw\);\s*const failure: SurplusTurnFailure = Object\.freeze\(\{ stage: 'response_validation'[^}]*httpStatus: status/);
    expect(read('src/server/AI/SurplusRegistry/buildSession.ts')).toMatch(/notifyAttemptFailed\(callbacks, \{[^}]*\n?[^}]*httpStatus: failure\.httpStatus/);
  });
});

describe('the server log gets the engine\'s machine code, and only a code', () => {
  it('a code-shaped token is kept', () => {
    expect(surplusErrorCodeToken({ error: { code: 'model_not_found', message: 'secret prose' } })).toBe(' (code model_not_found)');
    expect(surplusErrorCodeToken({ error: { type: 'no_route.available' } })).toBe(' (code no_route.available)');
    expect(surplusErrorCodeToken({ error: { code: 404 } })).toBe(' (code 404)');
  });
  it('prose, a URL, anything long, or nothing at all is never logged', () => {
    for (const body of [{}, { error: 'plain string' }, { error: { code: 'two words' } }, { error: { code: 'https://x.example/a?b' } }, { error: { code: 'x'.repeat(49) } }, { error: { message: 'only prose' } }, { error: null }]) {
      expect(surplusErrorCodeToken(body as Record<string, unknown>)).toBe('');
    }
    expect(read('src/server/AI/SurplusRegistry/productionAdapter.ts')).toContain('response identity rejected: ${why}${surplusErrorCodeToken(body)}');
  });
});
