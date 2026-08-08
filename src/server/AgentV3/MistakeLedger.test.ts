import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  emptyLedger, mistakeKey, recordMistake, recordProvenFix, knownFixFor, matchedMistakes,
  formatKnownMistakes, repeatStats, worstRepeats, MAX_MISTAKES, MAX_GUARDS,
} from './MistakeLedger';

// ADMIN ASK 2026-08-06: "galtiyon se seekhne wala system — ek baar wali galti wapas repeat na ho."
//
// v5.0 already learned (Reflection → BuildLessons → UserLessonBrain → RecalledLessons). The broken link
// was the RECALL KEY: lessons were matched against the USER'S PROMPT, while a lesson is about a
// MISTAKE. "home page par green dot hatao" and "the dev server bound its port before wiring page
// routes" share no words, so the lesson could never surface at the moment it mattered.
//
// These tests lock the deterministic replacement: exact signature lookup, fixes proven only by a
// successful build, and a self-measured repeat rate that cannot be hidden.

const ERR_A = 'Error: listen EADDRINUSE: address already in use :::5173';
const ERR_A_AGAIN = 'Error: listen EADDRINUSE: address already in use :::3000'; // same failure, different port
const ERR_B = 'Could not resolve "./icons/router.js" from node_modules/lucide-react/dist/esm/lucide-react.js';

describe('mistakeKey — "the same failure" has ONE definition, shared with Reflection', () => {
  it('two occurrences that differ only in numbers/paths are the SAME mistake', () => {
    expect(mistakeKey(ERR_A)).toBe(mistakeKey(ERR_A_AGAIN));
  });

  it('genuinely different failures never collide', () => {
    expect(mistakeKey(ERR_A)).not.toBe(mistakeKey(ERR_B));
  });

  it('empty input has no identity (and is never recorded)', () => {
    expect(mistakeKey('')).toBe('');
    expect(recordMistake(emptyLedger(), '').mistakes).toEqual([]);
  });
});

describe('recording — a fix counts only when it was PROVEN', () => {
  it('a first sighting is stored as UNSOLVED, which is honest and useful', () => {
    const l = recordMistake(emptyLedger(), ERR_A);
    expect(l.mistakes).toHaveLength(1);
    expect(l.mistakes[0].seen).toBe(1);
    expect(l.mistakes[0].provenFix).toBeUndefined();
    expect(knownFixFor(l, ERR_A)).toBeNull(); // nothing proven yet → nothing to promise
  });

  it('seeing it again increments the count, not a second row', () => {
    let l = recordMistake(emptyLedger(), ERR_A);
    l = recordMistake(l, ERR_A_AGAIN);
    expect(l.mistakes).toHaveLength(1);
    expect(l.mistakes[0].seen).toBe(2);
  });

  it('a proven fix makes the mistake retrievable BY SIGNATURE, not by wording', () => {
    let l = recordMistake(emptyLedger(), ERR_A);
    l = recordProvenFix(l, ERR_A, 'Free the port before starting the dev server (kill the stale process).');
    // The lookup uses a DIFFERENT port number in the text — similarity search on the prompt would
    // never have connected these; an exact signature does.
    const hit = knownFixFor(l, ERR_A_AGAIN);
    expect(hit).not.toBeNull();
    expect(hit!.provenFix).toContain('Free the port');
  });
});

describe('the counter that cannot be hidden — repeats AFTER a fix was known', () => {
  it('a repeat after a proven fix is counted at the moment it happens', () => {
    let l = recordMistake(emptyLedger(), ERR_A);
    l = recordProvenFix(l, ERR_A, 'kill the stale process first');
    expect(l.mistakes[0].repeatsAfterFix).toBe(0);
    l = recordMistake(l, ERR_A_AGAIN);            // it came back anyway
    expect(l.mistakes[0].repeatsAfterFix).toBe(1);
    l = recordMistake(l, ERR_A);
    expect(l.mistakes[0].repeatsAfterFix).toBe(2);
  });

  it('repeats BEFORE a fix exists are not counted as failures of the system', () => {
    let l = recordMistake(emptyLedger(), ERR_A);
    l = recordMistake(l, ERR_A_AGAIN);
    expect(l.mistakes[0].seen).toBe(2);
    expect(l.mistakes[0].repeatsAfterFix).toBe(0); // nothing was known yet — nothing was ignored
  });

  it('repeatStats reports the real rate, and a perfect record reads as 0', () => {
    let l = recordProvenFix(recordMistake(emptyLedger(), ERR_A), ERR_A, 'fix A');
    l = recordProvenFix(recordMistake(l, ERR_B), ERR_B, 'fix B');
    expect(repeatStats(l)).toMatchObject({ total: 2, solved: 2, unsolved: 0, repeatedAfterFix: 0, repeatRate: 0 });
    l = recordMistake(l, ERR_A); // one of the two came back
    expect(repeatStats(l)).toMatchObject({ solved: 2, repeatedAfterFix: 1, repeatRate: 0.5 });
  });

  it('an empty ledger reports zeros, never NaN', () => {
    expect(repeatStats(emptyLedger())).toEqual({ total: 0, solved: 0, unsolved: 0, repeatedAfterFix: 0, repeatRate: 0 });
  });

  it('worstRepeats ranks what to harden next', () => {
    let l = recordProvenFix(recordMistake(emptyLedger(), ERR_A), ERR_A, 'fix A');
    l = recordProvenFix(recordMistake(l, ERR_B), ERR_B, 'fix B');
    l = recordMistake(l, ERR_B); l = recordMistake(l, ERR_B); l = recordMistake(l, ERR_A);
    const worst = worstRepeats(l);
    expect(worst[0].signature).toBe(mistakeKey(ERR_B)); // 2 repeats beats 1
    expect(worst[0].repeatsAfterFix).toBe(2);
  });
});

describe('matchedMistakes — ONE selection rule shared by the guard text and its measurement', () => {
  it('returns exactly the solved, deduped, bounded set the formatter renders', () => {
    let l = recordProvenFix(recordMistake(emptyLedger(), ERR_A), ERR_A, 'free the port');
    l = recordMistake(l, ERR_B); // unsolved — must not be selected
    const hits = matchedMistakes(l, [ERR_A, ERR_A_AGAIN, ERR_B]);
    expect(hits).toHaveLength(1);
    expect(hits[0].signature).toBe(mistakeKey(ERR_A));
    expect(formatKnownMistakes(l, [ERR_A, ERR_A_AGAIN, ERR_B])).toContain('free the port');
  });

  it('stays bounded by MAX_GUARDS', () => {
    let l = emptyLedger();
    const errors: string[] = [];
    for (let i = 0; i < MAX_GUARDS + 5; i++) {
      const e = `Error: distinct failure ${i} in module beta${i}`;
      errors.push(e);
      l = recordProvenFix(recordMistake(l, e), e, `fix ${i}`);
    }
    expect(matchedMistakes(l, errors)).toHaveLength(MAX_GUARDS);
  });
});

describe('formatKnownMistakes — the guidance that actually stops the repeat', () => {
  it('names the failure and gives the PROVEN fix as an instruction, not trivia', () => {
    let l = recordMistake(emptyLedger(), ERR_B);
    l = recordProvenFix(l, ERR_B, 'The package installed partially — delete node_modules/lucide-react and reinstall.');
    const out = formatKnownMistakes(l, [ERR_B]);
    expect(out).toContain('KNOWN MISTAKE');
    expect(out).toContain('PROVEN FIX');
    expect(out).toContain('delete node_modules/lucide-react');
  });

  it('says so when the same thing has already come back — pressure where it is deserved', () => {
    let l = recordProvenFix(recordMistake(emptyLedger(), ERR_A), ERR_A, 'free the port');
    l = recordMistake(l, ERR_A);
    expect(formatKnownMistakes(l, [ERR_A])).toMatch(/already come back 1×/);
  });

  it('is EMPTY when nothing matches — a build with no relevant history is untouched', () => {
    const l = recordProvenFix(recordMistake(emptyLedger(), ERR_A), ERR_A, 'free the port');
    expect(formatKnownMistakes(l, [ERR_B])).toBe('');
    expect(formatKnownMistakes(emptyLedger(), [ERR_A])).toBe('');
    expect(formatKnownMistakes(l, [])).toBe('');
  });

  it('never repeats one mistake twice, and stays bounded', () => {
    let l = emptyLedger();
    const errors: string[] = [];
    for (let i = 0; i < 10; i++) {
      const e = `Error: thing number ${i} failed in module alpha${i}`;
      errors.push(e);
      l = recordProvenFix(recordMistake(l, e), e, `fix ${i}`);
    }
    const out = formatKnownMistakes(l, [...errors, ...errors]);
    expect(out.split('PROVEN FIX').length - 1).toBeLessThanOrEqual(MAX_GUARDS);
  });
});

describe('bounded storage — the ledger cannot grow forever, and keeps what matters', () => {
  it('caps the stored set', () => {
    let l = emptyLedger();
    for (let i = 0; i < MAX_MISTAKES + 40; i++) l = recordMistake(l, `Error: unique failure ${i} in module m${i}`);
    expect(l.mistakes.length).toBeLessThanOrEqual(MAX_MISTAKES);
  });

  it('a SOLVED mistake survives the trim over an unsolved one — the fix is the valuable part', () => {
    let l = recordProvenFix(recordMistake(emptyLedger(), ERR_A), ERR_A, 'the proven fix');
    for (let i = 0; i < MAX_MISTAKES + 40; i++) l = recordMistake(l, `Error: filler failure ${i} in module f${i}`);
    expect(knownFixFor(l, ERR_A)).not.toBeNull();
  });
});

// A module nobody calls is dead code — the exact trap find_ui_element had to avoid. Source contract:
// the ledger is READ at build start (keyed by this project's real error history, not the prompt) and
// WRITTEN at build end, next to the existing cross-project brain promotion.
describe('wiring — the ledger is actually consulted and actually updated', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../routes/agentv3.ts', import.meta.url)), 'utf8');

  it('is READ at build start, keyed by past ERRORS (not by the prompt)', () => {
    expect(SRC).toContain('mistakeLedgerStore.guardDetailFor(userId, pastErrors)');
    expect(SRC).toContain("filter((e) => e.kind === 'error')");
  });

  it('the guard is prepended to the build prompt when it matches', () => {
    expect(SRC).toContain('buildPrompt = `${detail.text}\\n\\n---\\n\\n${buildPrompt}`');
  });

  it('the guard is VISIBLE in the admin report, with the live repeat rate', () => {
    expect(SRC).toContain("code: 'MISTAKE_GUARD'");
    expect(SRC).toContain('repeat rate');
  });

  it('guard EFFECTIVENESS is measured at build end — held or broke, never silent', () => {
    expect(SRC).toContain("code: 'GUARD_REPEAT'");
    expect(SRC).toContain("code: 'GUARD_HELD'");
    // Measured against ALL unresolved errors, not the bounded slice fed to the ledger.
    expect(SRC).toContain('new Set(unresolvedErrors.map((e) => mistakeKey(e)))');
  });

  it('is WRITTEN at build end from the report\'s REAL unresolved errors', () => {
    expect(SRC).toContain('mistakeLedgerStore.recordBuild(userId,');
    expect(SRC).toContain("p.severity === 'error' && p.autoResolved !== true");
  });

  it('a fix is only offered to the store on a SUCCEEDED build', () => {
    expect(SRC).toContain('fix: result.ok ? d.rootCause ?? null : null');
  });

  it('both call sites are best-effort — the ledger can never break a build', () => {
    // The window spans the fleet-fallback + report-visibility block sharing the same try/catch.
    const at = SRC.indexOf('mistakeLedgerStore.guardDetailFor');
    expect(SRC.slice(at, at + 1800)).toContain('catch');
    const at2 = SRC.indexOf('mistakeLedgerStore.recordBuild');
    expect(SRC.slice(at2, at2 + 3000)).toContain('catch');
  });
});
