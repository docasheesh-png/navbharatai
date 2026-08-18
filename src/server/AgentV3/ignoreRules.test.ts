import { describe, it, expect } from 'vitest';
import {
  parseIgnorePattern,
  parseIgnoreFile,
  isPathProtected,
  matchingIgnoreRule,
  protectedWriteMessage,
  ignoreRulesBlock,
  IGNORE_FILE,
  MAX_IGNORE_PATTERNS,
} from './ignoreRules';

const rules = (text: string) => parseIgnoreFile(text);

describe('parseIgnorePattern', () => {
  it('skips comments and blank lines', () => {
    expect(parseIgnorePattern('# a note')).toBeNull();
    expect(parseIgnorePattern('   ')).toBeNull();
    expect(parseIgnorePattern('')).toBeNull();
  });

  it('reads a negation', () => {
    expect(parseIgnorePattern('!payments/README.md')?.negated).toBe(true);
  });

  it('keeps the pattern AS WRITTEN, so a refusal can quote it back', () => {
    expect(parseIgnorePattern('  payments/  ')?.source).toBe('payments/');
  });

  it('returns null for a pattern with nothing in it', () => {
    expect(parseIgnorePattern('!')).toBeNull();
    expect(parseIgnorePattern('/')).toBeNull();
  });
});

describe('isPathProtected — folders', () => {
  const r = rules('payments/');

  it('protects the folder and everything under it', () => {
    expect(isPathProtected('payments/api.ts', r)).toBe(true);
    expect(isPathProtected('payments/deep/nested/file.ts', r)).toBe(true);
  });

  it('protects it at any depth when the pattern has no slash prefix', () => {
    expect(isPathProtected('src/payments/api.ts', r)).toBe(true);
  });

  it('does NOT protect a different folder with a similar name', () => {
    expect(isPathProtected('payments-old/api.ts', r)).toBe(false);
    expect(isPathProtected('src/mypayments/api.ts', r)).toBe(false);
  });
});

describe('isPathProtected — globs and anchoring', () => {
  it('matches a suffix glob at any depth', () => {
    const r = rules('*.env');
    expect(isPathProtected('.env', r)).toBe(true);
    expect(isPathProtected('config/prod.env', r)).toBe(true);
    expect(isPathProtected('src/App.tsx', r)).toBe(false);
  });

  it('a single * does not cross a directory boundary', () => {
    const r = rules('src/*.ts');
    expect(isPathProtected('src/a.ts', r)).toBe(true);
    expect(isPathProtected('src/deep/a.ts', r)).toBe(false);
  });

  // ** must be handled before *, or the single-star rule eats it and the pattern stops crossing dirs.
  it('** DOES cross directory boundaries', () => {
    const r = rules('src/**/secret.ts');
    expect(isPathProtected('src/secret.ts', r)).toBe(true);
    expect(isPathProtected('src/a/b/secret.ts', r)).toBe(true);
  });

  it('a leading / anchors to the project root', () => {
    const r = rules('/config.ts');
    expect(isPathProtected('config.ts', r)).toBe(true);
    expect(isPathProtected('src/config.ts', r)).toBe(false);
  });

  it('normalises a ./ or / prefix on the path being checked', () => {
    const r = rules('payments/');
    expect(isPathProtected('./payments/a.ts', r)).toBe(true);
    expect(isPathProtected('/payments/a.ts', r)).toBe(true);
  });
});

// LAST MATCH WINS, like gitignore. Stopping at the first hit would make every negation useless.
describe('isPathProtected — negation, last match wins', () => {
  const r = rules('payments/\n!payments/README.md');

  it('protects the folder', () => {
    expect(isPathProtected('payments/api.ts', r)).toBe(true);
  });

  it('but re-allows the negated file', () => {
    expect(isPathProtected('payments/README.md', r)).toBe(false);
  });

  it('order matters — a negation BEFORE the rule does not survive it', () => {
    const flipped = rules('!payments/README.md\npayments/');
    expect(isPathProtected('payments/README.md', flipped)).toBe(true);
  });
});

describe('isPathProtected — nothing protected by default', () => {
  it('an empty or comment-only file protects nothing', () => {
    expect(isPathProtected('anything.ts', rules(''))).toBe(false);
    expect(isPathProtected('anything.ts', rules('# just a note\n\n'))).toBe(false);
  });

  it('junk input never protects and never throws', () => {
    expect(isPathProtected('a.ts', null)).toBe(false);
    expect(isPathProtected(null, rules('*'))).toBe(false);
    expect(isPathProtected('', rules('*'))).toBe(false);
  });

  // An unparseable pattern must protect NOTHING rather than protect the wrong thing.
  it('a broken pattern is dropped, not guessed at', () => {
    expect(parseIgnoreFile('[unclosed').every((r) => r.re instanceof RegExp)).toBe(true);
  });

  it(`caps at ${MAX_IGNORE_PATTERNS} patterns`, () => {
    const many = Array.from({ length: MAX_IGNORE_PATTERNS + 50 }, (_, i) => `f${i}/`).join('\n');
    expect(parseIgnoreFile(many)).toHaveLength(MAX_IGNORE_PATTERNS);
  });
});

describe('matchingIgnoreRule', () => {
  it('returns the rule that protected the path, for an honest message', () => {
    expect(matchingIgnoreRule('payments/api.ts', rules('payments/'))?.source).toBe('payments/');
  });

  it('returns null for an unprotected path, and for a negated one', () => {
    expect(matchingIgnoreRule('src/App.tsx', rules('payments/'))).toBeNull();
    expect(matchingIgnoreRule('payments/README.md', rules('payments/\n!payments/README.md'))).toBeNull();
  });
});

describe('protectedWriteMessage — a bare "denied" would send the model into a retry loop', () => {
  const msg = protectedWriteMessage('payments/api.ts', matchingIgnoreRule('payments/api.ts', rules('payments/')));

  it('names the path, the pattern and the file the pattern came from', () => {
    expect(msg).toContain('payments/api.ts');
    expect(msg).toContain('payments/');
    expect(msg).toContain(IGNORE_FILE);
  });

  it('tells the model what to do INSTEAD of retrying', () => {
    expect(msg).toMatch(/do not try again/i);
    expect(msg).toMatch(/tell the user/i);
  });

  it('still works when no rule is available', () => {
    expect(protectedWriteMessage('x.ts', null)).toContain('x.ts');
  });
});

describe('ignoreRulesBlock — the prompt half exists only to save wasted turns', () => {
  it('is empty when nothing is protected', () => {
    expect(ignoreRulesBlock([])).toBe('');
    expect(ignoreRulesBlock(rules('# nothing'))).toBe('');
  });

  it('lists the active patterns', () => {
    expect(ignoreRulesBlock(rules('payments/\nsecrets/'))).toContain('payments/');
  });

  it('does NOT list negations as if they were protections', () => {
    expect(ignoreRulesBlock(rules('!open/'))).toBe('');
  });

  it('says the platform enforces it, so attempting a write only wastes a step', () => {
    expect(ignoreRulesBlock(rules('payments/'))).toMatch(/refused by the platform/i);
  });

  it('summarises rather than pasting a huge list into the prompt', () => {
    const many = Array.from({ length: 30 }, (_, i) => `f${i}/`).join('\n');
    expect(ignoreRulesBlock(rules(many))).toContain('+10 more');
  });
});
