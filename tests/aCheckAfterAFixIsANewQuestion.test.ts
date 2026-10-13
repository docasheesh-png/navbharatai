import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  newRepeatProbeState, recordAndCheckRepeat, collectRepeatProbeSteer, noteMutations,
  isProbeBanned, MUTATING_TOOLS, PROBE_TOOLS,
} from '../src/server/AgentV3/RepeatProbeGuard';

/**
 * 🧬 A CHECK AFTER A FIX IS A NEW QUESTION, NOT A REPEAT — Q-912, autopsy `50378049` (BlockWorld,
 * 2026-10-12).
 *
 * The report carried a `LOOP GUARD` on `console_errors`. That call reads the LIVE app's console, so after
 * an edit it is a **new question with the same spelling** — check, fix, check again. The guard counted it
 * as a non-progressing repeat, nagged, and because `console_errors` is in `PROBE_TOOLS` it would
 * eventually have **refused the model's only way of telling whether its own fix had worked.**
 *
 * 🔑 THIS MODULE ALREADY MAKES THE ARGUMENT, one tool over. `PROBE_TOOLS`' safety note excludes `bash`
 * because a repeated `tsc --noEmit` *"looks identical to a loop and is usually a build legitimately
 * converging — check, fix, check again"*. `console_errors`, `screenshot`, `evaluate` and `browser_action`
 * have the same shape and were bannable anyway.
 *
 * 🔒 BUT THE DISCRIMINATOR IS NOT THE TOOL — it is whether anything CHANGED in between. So a signature's
 * count resets when the build mutated since it was last seen, and **the original autopsy's loop (six
 * identical `grep`s, nothing written between them) is still caught**, because nothing mutated during it.
 */

const grep = { name: 'grep', input: { pattern: "from '../types'" } };
const consoleErrors = { name: 'console_errors', input: {} };
const write = { name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } };
const emptyBash = { name: 'bash', input: { command: '' } };

describe('a check after a fix is a new question (Q-912, autopsy 50378049)', () => {
  describe('🔴 the reported loop: console_errors around a fix', () => {
    it('check → fix → check → fix → check is never steered', () => {
      const st = newRepeatProbeState();
      for (let round = 0; round < 5; round++) {
        expect(collectRepeatProbeSteer(st, [consoleErrors], 3)).toBeNull();
        noteMutations(st, [write]);
      }
      expect(isProbeBanned(st, 'console_errors', {})).toBe(false);
    });

    it('…and before this it was steered on the third look and then BANNED', () => {
      // The pre-fix behaviour, reproduced by simply never noting a mutation.
      const st = newRepeatProbeState();
      expect(recordAndCheckRepeat(st, 'console_errors', {}, 3)).toBeNull();
      expect(recordAndCheckRepeat(st, 'console_errors', {}, 3)).toBeNull();
      expect(recordAndCheckRepeat(st, 'console_errors', {}, 3)).toContain('LOOP GUARD');
      for (let i = 0; i < 4; i++) recordAndCheckRepeat(st, 'console_errors', {}, 3);
      expect(isProbeBanned(st, 'console_errors', {})).toBe(true);
    });
  });

  describe('🔒 the original loop this guard exists for is STILL caught', () => {
    it('six identical greps with nothing written between them', () => {
      const st = newRepeatProbeState();
      const steers = [1, 2, 3, 4, 5, 6].map(() => collectRepeatProbeSteer(st, [grep], 3));
      expect(steers.filter(Boolean).length).toBeGreaterThan(0);
      expect(steers[2]).toContain('LOOP GUARD');
      expect(isProbeBanned(st, 'grep', grep.input)).toBe(true);
    });

    it('a ban is lifted only by a real change, and then it must be earned again', () => {
      const st = newRepeatProbeState();
      for (let i = 0; i < 6; i++) recordAndCheckRepeat(st, 'grep', grep.input, 3);
      expect(isProbeBanned(st, 'grep', grep.input)).toBe(true);
      noteMutations(st, [write]);
      // The tree changed, so the same grep is a new question — and the count starts over.
      expect(recordAndCheckRepeat(st, 'grep', grep.input, 3)).toBeNull();
      expect(isProbeBanned(st, 'grep', grep.input)).toBe(false);
      expect(recordAndCheckRepeat(st, 'grep', grep.input, 3)).toBeNull();
      expect(recordAndCheckRepeat(st, 'grep', grep.input, 3)).toContain('LOOP GUARD');
    });

    it('a mutation on ANOTHER signature still frees this one — the build changed, not the call', () => {
      const st = newRepeatProbeState();
      recordAndCheckRepeat(st, 'grep', grep.input, 3);
      recordAndCheckRepeat(st, 'grep', grep.input, 3);
      noteMutations(st, [{ name: 'edit_file', input: { path: 'other.ts' } }]);
      expect(recordAndCheckRepeat(st, 'grep', grep.input, 3)).toBeNull();
    });
  });

  describe('🔴 an empty bash changes NOTHING — Q-738 must not come back', () => {
    it('endless empty bash calls still reach FINAL and still end the run', () => {
      // The first version of this fix counted every `bash`, so the seven empty calls of autopsy d0b2fcd6
      // each reset the count, FINAL was never reached and a run doing nothing forever would never end.
      const st = newRepeatProbeState();
      for (let i = 0; i < 7; i++) noteMutations(st, [emptyBash]);
      expect(st.mutations).toBe(0);
      const steers = [1, 2, 3].map(() => recordAndCheckRepeat(st, 'bash', emptyBash.input, 3));
      expect(steers[2]).toContain('LOOP GUARD');
    });

    it('a REAL bash does count as a change', () => {
      const st = newRepeatProbeState();
      noteMutations(st, [{ name: 'bash', input: { command: 'npm run build' } }]);
      expect(st.mutations).toBe(1);
    });
  });

  describe('🔒 the two sets, and that they still disagree deliberately', () => {
    it('every bannable probe is read-only, and no mutating tool is bannable', () => {
      for (const t of MUTATING_TOOLS) expect(PROBE_TOOLS.has(t)).toBe(false);
    });

    it('the live-app probes the report named are still in the probe set', () => {
      // They stay bannable — the fix is the mutation reset, not a carve-out that would let a genuine
      // console_errors loop run forever.
      for (const t of ['console_errors', 'screenshot', 'evaluate', 'browser_action']) {
        expect(PROBE_TOOLS.has(t)).toBe(true);
      }
    });

    it('a fresh state starts with no mutations and nothing seen', () => {
      const st = newRepeatProbeState();
      expect(st.mutations).toBe(0);
      expect(st.seenAt.size).toBe(0);
    });
  });

  describe('🔒 the wiring — mutations are noted BEFORE the turn\'s probes are counted', () => {
    const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8');

    it('noteMutations runs first, so a later turn\'s probe starts over', () => {
      const noted = runner.indexOf('noteMutations(repeatProbe, turn.toolUses)');
      const counted = runner.indexOf('collectRepeatProbeSteer(repeatProbe, turn.toolUses, loopThreshold)');
      expect(noted).toBeGreaterThan(0);
      expect(counted).toBeGreaterThan(noted);
    });

    it('it is behind the same flag and can never break a build', () => {
      const at = runner.indexOf('noteMutations(repeatProbe, turn.toolUses)');
      const line = runner.slice(at - 120, at + 120);
      expect(line).toContain('if (loopGuardOn)');
      expect(line).toContain('catch { /* never break a build */ }');
    });
  });
});
