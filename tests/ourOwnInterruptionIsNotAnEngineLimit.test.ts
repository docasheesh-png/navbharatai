/**
 * OUR OWN INTERRUPTION IS NOT AN ENGINE LIMIT (2026-09-26 — the `stopped` half of the `turnKind` open
 * root cause).
 *
 * The free-tier upsell may ask for money only when an engine was really asked to build and could not.
 * It read "was this build stopped?" from `USER_STOPPED_BUILD`, which only a user or model stop writes.
 * A deploy draining the build, a newer build reclaiming its lock, the zombie reaper and an unexplained
 * abort write nothing there, so each reached the upsell as though an engine had tried and failed.
 *
 * The retry and the run proof read the abort SIGNAL instead, and that is not a disagreement: they ask
 * a different question ("did the run end early at all?"). Every stop path — the Stop button, Unsend
 * and the model's own `stop_build` — goes through `abortBuild(…, 'user-stop')`, so the signal is the
 * complete source. What was missing was a reader that asks the upsell's question of it.
 *
 * Every wiring guard below was proven by reversion.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { interruptedBeforeAnyVerdict, abortBuild, abortCauseOf, type AbortCause } from '../src/server/AgentV3/buildAbortCause';

const code = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('which endings left nothing to judge', () => {
  it.each<[AbortCause, boolean]>([
    ['user-stop', true],
    ['deploy-drain', true],
    ['lock-reclaimed', true],
    ['reaper', true],
    ['unknown', true],
    ['watchdog', false],
    ['futile', false],
    ['cost-cap', false],
    ['advisory-cap', false],
  ])('%s → %s', (cause, expected) => {
    expect(interruptedBeforeAnyVerdict(cause)).toBe(expected);
  });

  it('the cause survives the signal, so the reader sees what the aborter meant', () => {
    const c = new AbortController();
    abortBuild(c, 'deploy-drain');
    expect(c.signal.aborted).toBe(true);
    expect(interruptedBeforeAnyVerdict(abortCauseOf(c.signal))).toBe(true);
  });

  it('an abort that carries no cause reads as unknown — and is never sold as an engine limit', () => {
    const c = new AbortController();
    c.abort();
    expect(abortCauseOf(c.signal)).toBe('unknown');
    expect(interruptedBeforeAnyVerdict(abortCauseOf(c.signal))).toBe(true);
  });
});

describe('🔒 WIRING — the upsell asks its question of the complete source', () => {
  const route = code('src/server/routes/agentv3.ts');

  it('`interrupted` is read from the abort cause, and only when a user stop did not already explain it', () => {
    expect(route).toContain(
      'const interrupted = !stopped && abort.signal.aborted && interruptedBeforeAnyVerdict(abortCauseOf(abort.signal));',
    );
  });

  it('it suppresses the upsell', () => {
    expect(route).toContain('if (!refused && !stopped && !interrupted) {');
  });

  it('…and the suppression is recorded, in its own words', () => {
    expect(route).toContain('if (refused || degraded || misconfigured || starved || stopped || interrupted) {');
    expect(route).toMatch(/: interrupted\s*\?\s*`Did not ask this user to add credits: our own platform interrupted this build/);
  });

  it('the predicate is exhaustive over every abort cause, so a new cause must be placed deliberately', () => {
    expect(code('src/server/AgentV3/buildAbortCause.ts')).toContain('const unreachable: never = cause;');
  });
});
