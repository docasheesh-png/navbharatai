import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { noteHeal, healWouldOscillate, resetHealLedger, healRepeats } from '../src/server/AgentV3/HealLedger';
import { dedupeSameModuleImports } from '../src/server/AgentV3/FullStackGuards';

/**
 * ⚠️ src/main.tsx HEALED FOUR TIMES IN ONE BUILD (admin report 2026-08-25), and the ledger's own
 * verdict named the cause:
 *
 *     "1 file(s) still contained EXACTLY what the previous heal wrote — nothing was lost. The repair
 *      survived and the detector fired again on content it had already fixed, so the bug is in our
 *      analyzer or in a repair that is not idempotent. Look at the detector, not at the sandbox."
 *
 * Three deterministic import fixers run over the same file in one pass — one reconciles named↔default,
 * one adds a missing import, one removes a duplicate. If any two disagree about the same symbol the
 * file goes X → Y → X for as many passes as the build allows, costing a write, a narration and a step
 * of the budget each round, converging on nothing.
 *
 * 🔑 I DID NOT GUESS WHICH FIXER IS AT FAULT. `dedupeSameModuleImports` was the obvious suspect and I
 * tested it against every shape that would have made it guilty — it is idempotent and loses no
 * binding (asserted below). Without the user's actual file the guilty pair cannot be identified, so
 * the guard is at the LOOP, where it works whichever fixer is wrong.
 */
const WS = 'ws-oscillation';

beforeEach(() => resetHealLedger(WS));

describe('a heal that puts a file BACK is stopped', () => {
  it('lets an ordinary first heal through', () => {
    expect(healWouldOscillate(WS, 'src/main.tsx', 'X')).toBe(false);
  });

  it('lets a SECOND heal through when it genuinely moves the file forward', () => {
    // The case that must not be broken: two different fixers each improving the file in turn.
    noteHeal(WS, 'src/main.tsx', 'X');
    expect(healWouldOscillate(WS, 'src/main.tsx', 'Y')).toBe(false);
    noteHeal(WS, 'src/main.tsx', 'Y', 'X');
    expect(healWouldOscillate(WS, 'src/main.tsx', 'Z')).toBe(false);
  });

  it('🔑 stops the write that returns the file to a state we already left it in', () => {
    noteHeal(WS, 'src/main.tsx', 'X');
    noteHeal(WS, 'src/main.tsx', 'Y', 'X');
    expect(healWouldOscillate(WS, 'src/main.tsx', 'X')).toBe(true); // X → Y → X is the loop
  });

  it('does not fire on writing the SAME content that is already there', () => {
    // A harmless no-op other code already skips; refusing it would be the wrong reason to refuse.
    noteHeal(WS, 'src/main.tsx', 'X');
    expect(healWouldOscillate(WS, 'src/main.tsx', 'X')).toBe(false);
  });

  it('is per FILE and per WORKSPACE — one app\'s loop cannot mute another\'s repair', () => {
    noteHeal(WS, 'src/main.tsx', 'X');
    noteHeal(WS, 'src/main.tsx', 'Y', 'X');
    expect(healWouldOscillate(WS, 'src/App.tsx', 'X')).toBe(false);
    expect(healWouldOscillate('other-ws', 'src/main.tsx', 'X')).toBe(false);
  });

  it('an unknown workspace or junk never blocks a repair', () => {
    // Wrongly refusing a real fix is worse than one extra oscillation, so every doubt returns false.
    expect(healWouldOscillate('never-seen', 'a.ts', 'X')).toBe(false);
    expect(healWouldOscillate(WS, '', 'X')).toBe(false);
    expect(() => healWouldOscillate(WS, 'a.ts', undefined as unknown as string)).not.toThrow();
  });

  it('still records the repeat, so the report keeps telling the truth about it', () => {
    noteHeal(WS, 'src/main.tsx', 'X');
    noteHeal(WS, 'src/main.tsx', 'Y', 'X');
    const reps = healRepeats(WS);
    expect(reps.length).toBeGreaterThan(0);
    expect(reps[0].path).toBe('src/main.tsx');
  });
});

/**
 * The suspect I cleared, kept as a test so nobody re-suspects it — and so that if a future change DOES
 * make it drop a binding, this fails instead of the loop coming back.
 */
describe('dedupeSameModuleImports is idempotent and loses no binding', () => {
  it.each([
    ['default + named from one module', "import React from 'react';\nimport { useState } from 'react';\n"],
    ['two named sets',                  "import { a } from 'x';\nimport { b } from 'x';\n"],
    ['two defaults',                    "import A from 'x';\nimport B from 'x';\n"],
  ])('leaves %s alone', (_name, src) => {
    expect(dedupeSameModuleImports('src/main.tsx', src)).toBe(src);
  });

  it('removes only an EXACT duplicate, and is stable if run again', () => {
    const src = "import { a } from 'x';\nimport { a } from 'x';\nconsole.log(a);\n";
    const once = dedupeSameModuleImports('src/main.tsx', src);
    expect(once).not.toBe(src);
    expect(dedupeSameModuleImports('src/main.tsx', once)).toBe(once);
  });
});

describe('every heal write site is guarded — one left out and the loop survives', () => {
  it('all four consult the ledger before writing', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    // FOUR, not five: the import has no parenthesis, so this pattern counts call sites only. My first
    // expectation said five and the code was right — kept as a note because the number is the point of
    // the test and a wrong one here would eventually be "fixed" by loosening it.
    expect((src.match(/healWouldOscillate\(/g) ?? []).length).toBe(4);
    expect(src).toContain("import { healWouldOscillate } from './HealLedger';");
  });
});
