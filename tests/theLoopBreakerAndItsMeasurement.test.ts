// AUTOPSY c847b523 (2026-09-20) — nine reads, no writes, and nobody was told.
//
// The build read `src/App.tsx` NINE times, wrote nothing, and the user pressed Stop at 108 seconds.
// Two separate defects, one autopsy:
//
//   1. THE ADVICE NEVER ESCALATED. `repeatedReadNotice` fired on reads two through nine with
//      word-for-word identical text. Advice repeated unchanged is not a defence; it is wallpaper.
//   2. THE MEASUREMENT COULD NOT FIRE. `REPEATED_READS` — the one finding that names exactly this —
//      was nested inside the credential guard's `if (… && writtenFiles.size > 0 && !aborted)`, so in
//      a stopped, zero-write build it was structurally incapable of being recorded. It had been
//      reporting only on builds that wrote files and were never stopped: the ones least likely to
//      have looped. A biased sample reads as an absence of the problem, which is worse than silence.
//
// 🔒 The class, locked below so it is recognised again: AN INSTRUMENT ABOUT OUR OWN ENGINE MUST NOT
// LIVE INSIDE ANOTHER FEATURE'S CONDITIONAL. Its only precondition is that the build ran.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { repeatedReadNotice, repeatedReadSummary, READ_LOOP_LIMIT } from '../src/server/AgentV3/repeatedReads';

describe('the escalation is mechanical, not a louder nag', () => {
  it('says nothing on a first read, and nothing about a file that really changed', () => {
    expect(repeatedReadNotice('src/App.tsx', 1, true, 0)).toBe('');
    expect(repeatedReadNotice('src/App.tsx', 9, false, 9)).toBe('');
  });

  it('nudges below the limit and STOPS at it', () => {
    expect(repeatedReadNotice('src/App.tsx', 2, true, 1)).toContain('[NOTE');
    expect(repeatedReadNotice('src/App.tsx', 3, true, READ_LOOP_LIMIT - 1)).toContain('[NOTE');
    const stop = repeatedReadNotice('src/App.tsx', 4, true, READ_LOOP_LIMIT);
    expect(stop).toContain('[STOP');
    expect(stop).toContain('4th read of src/App.tsx');
  });

  it('🔒 the STOP names the three ways out, including the honest one', () => {
    // A stop that only forbids leaves a model with nowhere to go, and it will read again. Saying
    // "I am stuck because X" must be an allowed answer or the instruction is unfollowable.
    const stop = repeatedReadNotice('a.ts', 5, true, 4);
    expect(stop).toContain('write the change');
    expect(stop).toContain('stuck because');
  });

  it('🔒 NEVER withholds the content — the escalation changes what we say, not what we return', () => {
    // Refusing the read is the one intervention that can strand a model whose context was trimmed,
    // which is a worse failure than the loop. Both wordings promise the body follows.
    expect(repeatedReadNotice('a.ts', 2, true, 1)).toContain('content follows');
    expect(repeatedReadNotice('a.ts', 9, true, 8)).toContain('content follows');
  });

  it('⚠️ a streak the caller resets after a write can never reach a STOP', () => {
    // The dispatcher zeroes `stalls` whenever anything was written, so a model that reads, edits and
    // re-reads — correct behaviour — sees the gentle notice however many times it does it.
    for (const count of [2, 5, 20]) {
      expect(repeatedReadNotice('a.ts', count, true, 0)).toContain('[NOTE');
    }
  });
});

describe('the report says whether the breaker was needed', () => {
  it('stays silent about ordinary work and speaks about a real loop', () => {
    expect(repeatedReadSummary(new Map([['a.ts', 2], ['b.ts', 2]]))).toBe('');
    const line = repeatedReadSummary(new Map([['src/App.tsx', 9], ['b.ts', 1]]));
    expect(line).toContain('9× src/App.tsx');
    expect(line).toContain('80%');
  });
});

describe('🔒 the measurement fires on every build outcome', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  /** Comments stripped: the comment at each site quotes the code it explains. */
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const guardAt = code.indexOf('if (credentialGuardEnabled() && expectsArtifacts');
  const repeatedAt = code.indexOf("code: 'REPEATED_READS'");
  const typecheckAt = code.indexOf("code: 'WRITE_TIME_TYPECHECK'");

  it('the three landmarks all still exist (else the assertions below prove nothing)', () => {
    expect(guardAt).toBeGreaterThan(-1);
    expect(repeatedAt).toBeGreaterThan(-1);
    expect(typecheckAt).toBeGreaterThan(-1);
  });

  it('🔴 REPEATED_READS is recorded BEFORE the credential guard, not inside it', () => {
    // The whole autopsy. `tsc` and `vitest` cannot see a measurement that is merely unreachable, so
    // this is a source-level guard on purpose — it is the only thing that can fail if someone tucks
    // the line back inside a conditional for the convenience of a file map already in scope.
    expect(repeatedAt).toBeLessThan(guardAt);
  });

  it('and so is WRITE_TIME_TYPECHECK — the sibling that shared the same wrong home', () => {
    expect(typecheckAt).toBeLessThan(guardAt);
  });

  it('both sit beside READY_BEFORE_END, the block that already states this rule', () => {
    const readyAt = code.indexOf("code: 'READY_BEFORE_END'");
    expect(readyAt).toBeGreaterThan(-1);
    expect(repeatedAt).toBeGreaterThan(readyAt);
    expect(typecheckAt).toBeGreaterThan(readyAt);
  });
});
