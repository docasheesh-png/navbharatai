import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  writeTypecheckSummary, writeTypecheckCommand, type WriteTypecheckStats,
} from '../src/server/AgentV3/writeTimeTypecheck';

/**
 * 🧬 "9 WRITES SKIPPED" IS NOT "9 FILES NEVER COMPILED" — Q-910, autopsy `50378049` (BlockWorld,
 * 2026-10-12).
 *
 * The report said, verbatim:
 *
 *   > 9 TypeScript write(s) skipped before the compiler was ready — 9 because package.json had changed
 *   > since the last install (a dependency may be missing until one runs)
 *
 * which reads as nine files that went unchecked. **It may mean nothing of the kind.**
 * `writeTypecheckCommand` runs `tsc --noEmit` over the WHOLE PROJECT, not over the file just written —
 * so ONE clean run after the last skip has already compiled every skipped file. The two readings are
 * opposite facts about the build:
 *
 * | | what it cost |
 * |---|---|
 * | a later run succeeded | the skips cost a few seconds of lateness and nothing else |
 * | no later run succeeded | the end-of-build typecheck was those files' FIRST compile — the most expensive moment to find anything |
 *
 * **Nothing recorded which**, so nobody could tell from the report. That is the same gap
 * `notReadyReasons` was added to close one level up (build 46e2d74b: fourteen writes reported as
 * *"still being installed"* when the tree had only looked stale) — one sentence standing in for facts
 * that mean different things.
 *
 * 🔒 THE DEFERRAL ITSELF IS NOT THE DEFECT AND IS NOT TOUCHED. Autopsy Sur Taal established that the
 * write-time check must never install and never wait: three such waits burned 90 s of a free build's
 * clock while the model sat holding a file. This fixes what the report SAYS about the skips, which is
 * the fourth rule's fifth step — fix the system's honesty too.
 */

const base = (over: Partial<WriteTypecheckStats> = {}): WriteTypecheckStats => ({
  qualityNotedFiles: [],
  runs: 12, cleanRuns: 11, notRunRuns: 0, ownErrorsSurfaced: 3,
  elapsedMs: 18_000, timeouts: 0,
  skipped: 9, skippedNotTs: 0, skippedNoTsconfig: 0,
  skippedNotReady: 9,
  notReadyReasons: { 'manifest-changed': 9 },
  probeFailures: 0, compiledUnprobed: 0, projectVerdict: 'yes',
  disabledReason: null, warmupMs: 1_200, warmupSkipped: false,
  ...over,
} as unknown as WriteTypecheckStats);

describe('a skipped check is not an unchecked file (Q-910, autopsy 50378049)', () => {
  describe('the command this all rests on', () => {
    it('🔑 the write-time check compiles the PROJECT, not the one file just written', () => {
      // This is the whole premise: without it, a later clean run would prove nothing about the
      // skipped files, and the sentence below would be wrong in the other direction.
      const cmd = writeTypecheckCommand('writecheck');
      expect(cmd).toContain('--noEmit');
      expect(cmd).toContain('--incremental');
      // No per-file argument — nothing in the command names a path to compile.
      expect(cmd).not.toMatch(/--noEmit\s+\S*\.tsx?/);
    });

    it('…and it still stands down by name on each not-ready condition, unchanged', () => {
      const cmd = writeTypecheckCommand();
      for (const r of ['install-running', 'no-compiler', 'manifest-changed']) expect(cmd).toContain(r);
    });
  });

  describe('the report line', () => {
    it('🔴 THE REPORTED BUILD, as it read before: the skips with no idea what they cost', () => {
      const line = writeTypecheckSummary(base({ cleanRunCoveredSkips: null }), true);
      expect(line).toContain('9 TypeScript write(s) skipped before the compiler was ready');
      expect(line).toContain('package.json had changed since the last install');
      // Absent is not false: an old stats object says nothing extra rather than guessing.
      expect(line).not.toContain('those files were covered');
      expect(line).not.toContain('their first compile');
    });

    it('🔴 a clean run after the skips: says they were covered, and that they were late', () => {
      const line = writeTypecheckSummary(base({ cleanRunCoveredSkips: true }), true);
      expect(line).toContain('a later check compiled the whole project, so those files were covered');
      expect(line).toContain('just later than they should have been');
    });

    it('🔴 no clean run after the skips: says the end-of-build typecheck was their first compile', () => {
      const line = writeTypecheckSummary(base({ cleanRunCoveredSkips: false }), true);
      expect(line).toContain('no check succeeded after them');
      expect(line).toContain('end-of-build typecheck was their first compile');
    });

    it('a build with no skips never gets either sentence', () => {
      for (const covered of [true, false, null]) {
        const line = writeTypecheckSummary(base({ skippedNotReady: 0, notReadyReasons: {}, cleanRunCoveredSkips: covered }), true);
        expect(line).not.toContain('those files were covered');
        expect(line).not.toContain('their first compile');
      }
    });

    it('everything the line said before is still there', () => {
      const line = writeTypecheckSummary(base({ cleanRunCoveredSkips: true }), true);
      expect(line).toContain('12 run(s), 11 clean');
      expect(line).toContain('3 error(s) quoted back in the file just written');
      expect(line).toContain('the cache was warmed at build start');
      expect(line).toContain('(the check never installs and never waits)');
    });

    it('the OFF line and the never-ran lines are untouched', () => {
      expect(writeTypecheckSummary(base(), false)).toContain('OFF (AGENTV3_WRITE_TYPECHECK=off)');
      const never = writeTypecheckSummary(base({ runs: 0, cleanRuns: 0 }), true);
      expect(never).toContain('never ran');
      expect(never).toContain('9 TypeScript write(s) skipped');
    });
  });

  describe('🔒 the recorder — order is the whole answer', () => {
    const disp = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

    it('a skip puts the question back to FALSE', () => {
      // A clean run BEFORE the skip compiled a project that did not yet hold these files, so an
      // earlier `true` must not survive a later skip.
      expect(disp).toContain('s.cleanRunCoveredSkips = false;');
    });

    it('…and only a clean run answers it, and only when something was actually skipped', () => {
      expect(disp).toContain('if ((s.skippedNotReady ?? 0) > 0) s.cleanRunCoveredSkips = true;');
      // It sits inside the CLEAN-RUN branch, and nothing else intervenes — a compiler that never ran
      // covers nothing (autopsy 12c642ed's class, where four such runs were counted as clean).
      //
      // ⚠️ Anchored on the enclosing branch, NOT on a byte window. The first version of this case
      // looked back 260 characters and failed on the `neverRan` branch that legitimately sits just
      // above — a window measures distance, and the claim is about NESTING. This repo has paid for
      // byte-window guards before (`slice(0, 6000)`); the rule is to anchor on syntax.
      const branch = 'if (errors.length === 0) {';
      const from = disp.indexOf(branch);
      const to = disp.indexOf('if ((s.skippedNotReady ?? 0) > 0) s.cleanRunCoveredSkips = true;');
      expect(from).toBeGreaterThan(0);
      expect(to).toBeGreaterThan(from);
      const between = disp.slice(from + branch.length, to);
      expect(between).not.toContain('if (');   // nothing between the branch and the write
      expect(between).not.toContain('}');      // the branch has not closed before it
    });
  });
});
