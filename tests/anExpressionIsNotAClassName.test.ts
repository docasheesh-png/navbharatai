/**
 * AUTOPSY e3b0ce25 (2026-10-04): `.null` WAS REPORTED AS A CLASS NOBODY STYLED.
 *
 * `className={`nb-game-cell${cell !== null ? ' filled' : ''}`}` — the className reader stopped at the
 * first quote of ANY kind, so it read `nb-game-cell${cell !== null ? ` and called `!==` and `null`
 * classes. The model was told `.null` had no rule, spent three calls proving it was a false positive,
 * then rewrote a working line to silence it. Each literal now closes on its own quote kind, and an
 * interpolation's words are never class text. The design check and the dialog check read through the
 * same function, so the copy that drifted cannot drift again.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classAttributeValues, collectUsedClasses, findUndefinedClasses, withoutInterpolations } from '../src/server/AgentV3/CssConsistency';

const REPORT_LINE = "<div className={`nb-game-cell${cell !== null ? ' filled' : ''}`} />";

describe('the report\'s own line', () => {
  it('yields the class and nothing from the expression', () => {
    expect([...collectUsedClasses({ 'src/components/BlockGame.tsx': REPORT_LINE })]).toEqual(['nb-game-cell']);
  });

  it('is not an undefined-class finding when the class is styled', () => {
    const files = {
      'src/components/BlockGame.tsx': REPORT_LINE + REPORT_LINE.replace('nb-game-cell', 'nb-row') + REPORT_LINE.replace('nb-game-cell', 'nb-col'),
      'src/index.css': '.nb-game-cell{} .nb-row{} .nb-col{} .filled{}',
    };
    expect(JSON.stringify(findUndefinedClasses(files))).not.toMatch(/null|!==/);
  });
});

describe('every literal form', () => {
  it('double, single, braced and template literals', () => {
    expect(classAttributeValues('<a className="a b"/><b className=\'c\'/><i className={"d"}/><p className={`e ${x} f`}/>')
      .map((v) => v.trim().replace(/\s+/g, ' '))).toEqual(['a b', 'c', 'd', 'e f']);
  });

  it('nested braces and quotes inside an interpolation stay out', () => {
    expect(withoutInterpolations('row ${fn({ a: "}" }) ? "on" : `off`} col').replace(/\s+/g, ' ')).toBe('row col');
    // An unclosed interpolation drops the rest rather than reading it.
    expect(withoutInterpolations('row ${broken').trim()).toBe('row');
  });
});

describe('no second className reader in the server', () => {
  it('no file other than CssConsistency.ts reads a className literal with its own regex', () => {
    const root = join(__dirname, '../src/server');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name) || name === 'CssConsistency.ts') continue;
        const src = readFileSync(p, 'utf8');
        // The shape that drifted: className= followed by one quote class shared by all three quotes.
        if (/className\\s\*=[^\n]*\["'`\]\(\[\^"'`\]/.test(src)) offenders.push(p.slice(root.length + 1));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
