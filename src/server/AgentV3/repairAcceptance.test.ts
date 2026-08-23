import { describe, it, expect } from 'vitest';
import { judgeRepair, judgeRuntimeRepair } from './repairAcceptance';
import { countTscErrors, hasTscErrors } from './TscGate';

const err = (n: number, code = 2339) =>
  Array.from({ length: n }, (_, i) => `src/File${i}.tsx(${i + 1},5): error TS${code}: Property 'x' does not exist.`).join('\n')
  + `\n\nFound ${n} error${n === 1 ? '' : 's'} in ${n} file${n === 1 ? '' : 's'}.\n`;

describe('countTscErrors', () => {
  it('counts diagnostics, not lines', () => {
    expect(countTscErrors(err(4))).toBe(4);
    expect(countTscErrors(err(41))).toBe(41);
  });

  it("tsc's own trailer cannot inflate the count", () => {
    // "Found 41 errors in 7 files." carries no `error TS`, which is what makes the count trustworthy.
    expect(countTscErrors('Found 41 errors in 7 files.')).toBe(0);
  });

  it('is 0 for clean, empty and absent output', () => {
    expect(countTscErrors('')).toBe(0);
    expect(countTscErrors(null)).toBe(0);
    expect(countTscErrors(undefined)).toBe(0);
    expect(countTscErrors('warning: something')).toBe(0);
  });

  it('agrees with hasTscErrors — one parser, two questions', () => {
    for (const out of ['', 'clean', err(1), err(9)]) {
      expect(countTscErrors(out) > 0).toBe(hasTscErrors(out));
    }
  });
});

describe('judgeRepair — the reported regression', () => {
  it('REVERTS the repair that took the app from 4 errors to 41', () => {
    // This is the admin's exact case, encoded. Before this gate existed the loop kept it, because its
    // only brake was byte-identical errors and 41 is not identical to 4.
    const j = judgeRepair({ beforeErrors: err(4), afterErrors: err(41), afterOk: false, createdPaths: [] });
    expect(j.action).toBe('revert');
    expect(j.beforeCount).toBe(4);
    expect(j.afterCount).toBe(41);
    expect(j.reason).toContain('4 to 41');
  });

  it('names no provider or model in anything it says out loud', () => {
    const j = judgeRepair({ beforeErrors: err(4), afterErrors: err(41), afterOk: false });
    expect(j.reason).not.toMatch(/glm|kimi|claude|sonnet|opus|gemini|grok|anthropic|moonshot|z\.ai/i);
  });
});

describe('judgeRepair — what it must NOT refuse', () => {
  it('keeps a repair that fixed everything', () => {
    expect(judgeRepair({ beforeErrors: err(4), afterErrors: '', afterOk: true }).action).toBe('keep');
  });

  it('keeps a repair that reduced the errors', () => {
    const j = judgeRepair({ beforeErrors: err(9), afterErrors: err(3), afterOk: false });
    expect(j.action).toBe('keep');
    expect(j.reason).toContain('9 to 3');
  });

  it('keeps an equal count — different errors can still be real progress', () => {
    // Deliberate: trading four errors for four others may mean one fixed and one revealed. Refusing
    // that would stall the ladder on builds it is designed to rescue.
    const j = judgeRepair({ beforeErrors: err(4, 2339), afterErrors: err(4, 2551), afterOk: false });
    expect(j.action).toBe('keep');
  });

  it('keeps a repair whose type-check never ran — no evidence is not evidence against', () => {
    const j = judgeRepair({ beforeErrors: err(4), afterErrors: '', afterOk: false, afterRan: false });
    expect(j.action).toBe('keep');
    expect(j.reason).toContain('could not run');
  });

  it('keeps when there was no countable baseline to compare against', () => {
    expect(judgeRepair({ beforeErrors: '', afterErrors: err(3), afterOk: false }).action).toBe('keep');
  });
});

describe('judgeRepair — the half-applied state is refused, not risked', () => {
  it('a WORSE repair that also created files is kept and the loop stops', () => {
    // Reverting only the overwrites would leave some files from before the repair and some from after,
    // agreeing with neither. Green-freeze's full-deny already settled that a half-landed coordinated
    // change is worse than none of it — so this keeps the coherent (if worse) state and refuses to
    // build another attempt on top of it.
    const j = judgeRepair({ beforeErrors: err(4), afterErrors: err(41), afterOk: false, createdPaths: ['src/New.tsx'] });
    expect(j.action).toBe('keep-and-stop');
    expect(j.reason).toContain('added 1 new file');
    expect(j.reason).toContain('stopping here');
  });

  it('pluralises honestly', () => {
    const j = judgeRepair({ beforeErrors: err(4), afterErrors: err(41), afterOk: false, createdPaths: ['a.ts', 'b.ts'] });
    expect(j.reason).toContain('added 2 new files');
  });

  it('a created file on a repair that IMPROVED things is simply kept', () => {
    // Creating a file is normal and often required (a missing module the errors demand). It only
    // matters when the repair also regressed.
    const j = judgeRepair({ beforeErrors: err(9), afterErrors: err(2), afterOk: false, createdPaths: ['src/New.tsx'] });
    expect(j.action).toBe('keep');
  });

  it('ignores empty and non-string entries in createdPaths', () => {
    const j = judgeRepair({ beforeErrors: err(4), afterErrors: err(41), afterOk: false, createdPaths: ['', undefined as never] });
    expect(j.action).toBe('revert');
  });
});

describe('judgeRuntimeRepair — rendering is not working', () => {
  /**
   * The runtime auto-fix loop already had a net: verifyAfterFix snapshots the green app, applies the
   * repair, re-renders and rolls back if it broke. But "still renders" is a weaker test than "actually
   * better" — a repair that fixed one error while introducing two more passed it, and with the default
   * of a single attempt it then shipped.
   */
  it('REVERTS a repair that renders but left MORE runtime errors than it found', () => {
    const j = judgeRuntimeRepair({ stillRenders: true, beforeCount: 1, afterCount: 3 });
    expect(j.action).toBe('revert');
    expect(j.reason).toContain('1 → 3');
  });

  it('keeps a repair that reduced them', () => {
    const j = judgeRuntimeRepair({ stillRenders: true, beforeCount: 4, afterCount: 1 });
    expect(j.action).toBe('keep');
    expect(j.reason).toContain('4 to 1');
  });

  it('keeps an equal count — different errors can still be progress', () => {
    // Same judgement the compile-side gate makes, deliberately: trading two errors for two others may
    // mean one fixed and one revealed.
    expect(judgeRuntimeRepair({ stillRenders: true, beforeCount: 2, afterCount: 2 }).action).toBe('keep');
  });

  it('keeps a clean result', () => {
    expect(judgeRuntimeRepair({ stillRenders: true, beforeCount: 3, afterCount: 0 }).action).toBe('keep');
  });

  it('reverts when the app stopped rendering — the guarantee that already existed', () => {
    const j = judgeRuntimeRepair({ stillRenders: false, beforeCount: 1, afterCount: 0 });
    expect(j.action).toBe('revert');
    expect(j.reason).toContain('no longer rendered');
  });

  it('an unreadable console is UNPROVEN, never proof against the repair', () => {
    // Reverting on no evidence throws away a fix that may well have been correct — the same mistake in
    // the opposite direction, and the reason the existing net keeps an inconclusive render too.
    const j = judgeRuntimeRepair({ stillRenders: true, beforeCount: 5, afterCount: null });
    expect(j.action).toBe('keep');
    expect(j.reason).toContain('could not be read');
  });

  it('agrees with the compile-side gate on what "worse" means', () => {
    // ONE definition, two units. If these ever diverge, a repair judged good by one path is judged bad
    // by the other on identical evidence.
    for (const [before, after] of [[1, 3], [4, 1], [2, 2], [0, 0]] as const) {
      const runtime = judgeRuntimeRepair({ stillRenders: true, beforeCount: before, afterCount: after });
      const compile = judgeRepair({
        beforeErrors: Array.from({ length: before }, (_, i) => `a.ts(${i + 1},1): error TS1000: x`).join('\n'),
        afterErrors: Array.from({ length: after }, (_, i) => `a.ts(${i + 1},1): error TS1000: x`).join('\n'),
        afterOk: after === 0,
      });
      const compileWorse = compile.action === 'revert' || compile.action === 'keep-and-stop';
      expect(runtime.action === 'revert', `${before}→${after}`).toBe(compileWorse);
    }
  });

  it('names no vendor', () => {
    const j = judgeRuntimeRepair({ stillRenders: true, beforeCount: 1, afterCount: 9 });
    expect(j.reason).not.toMatch(/e2b|glm|kimi|claude|sonnet|opus|gemini|grok|anthropic|moonshot/i);
  });
});
