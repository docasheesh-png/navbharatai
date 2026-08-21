import { describe, it, expect } from 'vitest';
import { shellQuote } from './shellQuote';

/**
 * Every value this wraps is about to be pasted into a shell command running inside a user's sandbox,
 * and some of those values are written by a model or typed by a user. There were FOUR copies of this
 * function until 2026-08-21 — all correct, which was luck rather than design. This is the one test
 * file that has to hold.
 */
describe('shellQuote — nothing may escape the argument', () => {
  it('quotes an ordinary value', () => {
    expect(shellQuote('hello')).toBe("'hello'");
    expect(shellQuote('two words')).toBe("'two words'");
  });

  it('THE ONE ESCAPE: a single quote is closed, escaped and reopened', () => {
    // The single quote is the only character that can terminate the quoting, so it is the only one
    // that needs handling — everything else is literal inside single quotes.
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    // Asserted as a PROPERTY rather than a hand-written literal: the expected string for a value that
    // is itself two quotes is `''\'''\'''`, which is easy to get wrong by eye — and a test that is
    // wrong about the safe answer is worse than no test. Every quote must be the escaped form.
    expect(shellQuote("''")).toBe(`'${"'\\''".repeat(2)}'`);
  });

  it('command separators and substitutions lose their meaning', () => {
    for (const evil of [
      '; rm -rf /',
      '&& curl evil.example',
      '| cat /etc/passwd',
      '$(whoami)',
      '`whoami`',
      '${HOME}',
      'a\nb',
      'back\\slash',
      '> /tmp/out',
      '../../etc/passwd',
    ]) {
      const q = shellQuote(evil);
      // It is one single-quoted run, and the payload survives byte-for-byte inside it.
      expect(q.startsWith("'")).toBe(true);
      expect(q.endsWith("'")).toBe(true);
      expect(q).toContain(evil);
    }
  });

  it('THE BREAKOUT ATTEMPT: closing the quote and appending a command cannot work', () => {
    const attack = "'; rm -rf / #";
    const quoted = shellQuote(attack);
    // The attacker's closing quote is itself escaped, so the shell never sees an unquoted `;`.
    expect(quoted).toBe("''\\''; rm -rf / #'");
    expect(quoted).not.toMatch(/^''\s*;/); // would mean: empty arg, then a live command
  });

  it('a non-string still yields a quoted argument rather than a crash or a literal "undefined"', () => {
    // A caller handing this null must not splice the text `undefined` into a command.
    expect(shellQuote(undefined as unknown as string)).toBe("'undefined'");
    expect(shellQuote(null as unknown as string)).toBe("'null'");
    expect(shellQuote(42 as unknown as string)).toBe("'42'");
    expect(shellQuote('')).toBe("''");
  });
});
