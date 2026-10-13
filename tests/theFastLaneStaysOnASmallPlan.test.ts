// Q-926 (autopsy db07e0af; admin 2026-10-13: "han, apka suggestion ke anusar banao").
//
// A todo app on Weak: GLM flash crawled on one file call, the next rung (kimi) reasons before every answer, and the
// fast lane stopped in front of it and handed three files to the full builder — which then built the rest on the
// SAME reasoning engine, one sequential step at a time. First render: 248 s. Locked here:
//   1. the decision: a lane with a small plan whose own budget can carry the reasoning price per wave stays;
//      a big plan, a lane short of time, or the kill switch hands off exactly as before;
//   2. in the lane: per-file calls carry `mayReason`, decided per tier from what is LEFT; plan and contract calls
//      never do (the 33812996 / Study-Racer protections stand);
//   3. in the route: a per-file call with `mayReason` is not stopped in front of the rung, the lane is not told to
//      stop when the rung answers it, and every stay is measured in the report.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mayStayOnReasoningRung, wavesFor, reasoningStayNote, reasoningStayEnabled, REASONING_STAY_MAX_FILES, REASONING_WAVE_MS, laneOutcomeWords, recordReasoningStays,
} from '../src/server/AgentV3/FastLaneBudget';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('1 · the decision', () => {
  it('🔴 db07e0af\'s plan: 17 files in four waves at the start of the lane fits a 240 s budget — it stays', () => {
    expect(wavesFor([5, 6, 3, 3], 8)).toBe(4);
    expect(mayStayOnReasoningRung({ remainingFiles: 17, remainingWaves: 4, elapsedMs: 9_000, overallMs: 240_000 })).toBe(true);
  });
  it('a plan bigger than the cap hands off, however much time is left', () => {
    expect(mayStayOnReasoningRung({ remainingFiles: REASONING_STAY_MAX_FILES + 1, remainingWaves: 3, elapsedMs: 0, overallMs: 480_000 })).toBe(false);
  });
  it('a lane whose remaining budget cannot carry the waves at the reasoning price hands off', () => {
    const waves = 3;
    const overallMs = 240_000;
    const justFits = overallMs - waves * REASONING_WAVE_MS;
    expect(mayStayOnReasoningRung({ remainingFiles: 10, remainingWaves: waves, elapsedMs: justFits, overallMs })).toBe(true);
    expect(mayStayOnReasoningRung({ remainingFiles: 10, remainingWaves: waves, elapsedMs: justFits + 1, overallMs })).toBe(false);
  });
  it('nothing left, or the kill switch, means no stay', () => {
    expect(mayStayOnReasoningRung({ remainingFiles: 0, remainingWaves: 0, elapsedMs: 0, overallMs: 240_000 })).toBe(false);
    const off = { AGENTV3_FASTLANE_REASONING_STAY: 'off' } as NodeJS.ProcessEnv;
    expect(reasoningStayEnabled(off)).toBe(false);
    expect(mayStayOnReasoningRung({ remainingFiles: 5, remainingWaves: 1, elapsedMs: 0, overallMs: 240_000 }, off)).toBe(false);
    expect(reasoningStayEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
  it('how the lane ended is said in plain words', () => {
    expect(laneOutcomeWords({ ok: true })).toBe('The lane finished the app itself.');
    expect(laneOutcomeWords({ ok: false, stopped: true })).toBe('The lane was stopped by the user.');
    expect(laneOutcomeWords({ ok: false, reason: 'verify_failed', salvagedPaths: ['a', 'b'] })).toBe('The lane still handed off (verify_failed), with 2 finished file(s).');
  });
  it('the report line measures every stay', () => {
    expect(reasoningStayNote([], 'x')).toBe('');
    const line = reasoningStayNote([{ model: 'kimi-k2.7-code', ms: 21_000 }, { model: 'kimi-k2.7-code', ms: 14_000 }, { model: 'kimi-k2.7-code', ms: 33_000 }], 'The lane finished the app itself.');
    expect(line).toContain('stayed on kimi-k2.7-code');
    expect(line).toContain('3 file call(s), median 21s, slowest 33s.');
    expect(line).toContain('The lane finished the app itself.');
  });
});

describe('2 · in the lane: only per-file calls may carry on, decided from what is left', () => {
  type Seen = { kind: 'plan' | 'contract' | 'file'; mayReason: boolean; path?: string };
  async function lane(files: number) {
    const seen: Seen[] = [];
    const paths = Array.from({ length: files }, (_, i) => (i === 0 ? 'src/App.tsx' : `src/components/Part${i}.tsx`));
    await runSimpleBuild({
      prompt: 'a todo app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx', 'src/main.tsx', 'index.html'],
      maxRepairs: 0,
      generate: async (_s: string, user: string, opts?: { mayReason?: boolean }) => {
        const kind: Seen['kind'] = user.includes('Plan the file list') ? 'plan' : user.includes('Design the shared contract') ? 'contract' : 'file';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        seen.push({ kind, mayReason: opts?.mayReason === true, ...(kind === 'file' ? { path } : {}) });
        if (kind === 'plan') return paths.map((p) => `${p} :: ${p}`).join('\n');
        if (kind === 'contract') return 'export interface Todo { id: string }';
        return `<<<FILE ${path}>>>\nexport default function X() { return null; }\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
      verify: async () => ({ ok: true, errors: '', ran: true }),
    } as never).catch(() => null);
    return seen;
  }
  it('🔴 a small plan: every per-file call may carry on; the plan and contract calls never do', async () => {
    const seen = await lane(6);
    const files = seen.filter((s) => s.kind === 'file');
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((s) => s.mayReason)).toBe(true);
    expect(seen.filter((s) => s.kind !== 'file').every((s) => !s.mayReason)).toBe(true);
  });
  it('a plan past the cap: its big tier hands off as today; once what is left is small, the last tier may carry on', async () => {
    const seen = await lane(REASONING_STAY_MAX_FILES + 4);
    const parts = seen.filter((s) => s.kind === 'file' && s.path !== 'src/App.tsx');
    const root = seen.filter((s) => s.kind === 'file' && s.path === 'src/App.tsx');
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.some((s) => s.mayReason)).toBe(false); // 24 left at the components tier: past the cap
    expect(root.length).toBe(1);
    expect(root[0].mayReason).toBe(true);                // 1 left at the root's tier: small
  });
});

describe('3 · in the route: the call is let through, the lane keeps going, the stay is measured', () => {
  const route = read('src/server/routes/agentv3.ts');
  it('a mayReason call is not stopped in front of the rung', () => {
    expect(route).toContain('stopAtReasoningRung: fastLaneReasoningGateEnabled() && !mayReason,');
  });
  it('a rung that answers a mayReason call does not stop the lane — the answer is measured instead', () => {
    expect(route).toMatch(/if \(mayReason && modelAlwaysReasons\(servedBy\.model\)\) \{\s*\/\/[^\n]*\n\s*laneReasoningStays\.push\(/);
  });
  it('continuations carry the same decision, and the measurement reaches the report as an engine fact', () => {
    expect(route).toContain('fastGenerateOnce(system, continuationPrompt(text), genOpts?.deadlineAt, genOpts?.mayReason === true)');
    expect(route).toContain('recordReasoningStays(buildDiag, laneReasoningStays, sb);');
    expect(PROCESS_ONLY_CODES.has('FAST_LANE_STAYED_ON_REASONING_RUNG')).toBe(true);
  });
  it('the record: one engine fact when the lane stayed, nothing when it did not', () => {
    const rows: Array<{ code: string; message: string }> = [];
    const report = { record: (i: { code: string; message: string }) => { rows.push(i); } };
    recordReasoningStays(report, [], { ok: true });
    expect(rows).toEqual([]);
    recordReasoningStays(report, [{ model: 'kimi-k2.7-code', ms: 21_000 }], { ok: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('FAST_LANE_STAYED_ON_REASONING_RUNG');
    expect(rows[0].message).toContain('The lane finished the app itself.');
  });
});
