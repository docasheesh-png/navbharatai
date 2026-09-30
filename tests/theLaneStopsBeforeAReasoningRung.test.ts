// Autopsy 33812996 (2026-09-30, "Circle to Search", Weak). The fast lane generated 26 files on
// glm-4.7-flashx in 115 s, then spent 560 s — 77% of the lane — REPAIRING: flashx crawled and was
// abandoned inside the second repair call, the same call walked on to kimi-k2.7-code (197 s of
// reasoning, 12,000 tokens, no answer), then to glm-5.3 until the lane's own clock ended it. Nothing was
// fixed; the full builder then built the app on the same KIMI in its tool loop.
//
// `stopLane` (Study-Racer, 2026-09-25) already made the lane hand off when its chain fell to a
// reasoning rung — but it was consulted only by GENERATION, and only after a reasoning rung had SERVED
// a call. The repair loop never asked, and a fall inside one call was never seen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  makeMultiProviderTurnRunner, sharedRateLimitCooldowns, isReasoningRungStop, ReasoningRungStopError,
} from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

beforeEach(() => sharedRateLimitCooldowns.reset());

const ok = (text: string): TurnResult => ({
  text, toolUses: [], stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  rawContent: [{ type: 'text', text }],
});
const failing = (): TurnRunner => ({ runTurn: vi.fn().mockRejectedValue(new Error('OpenAI-compatible call (GLM/Kimi) timed out — abandoned for crawling after 48028ms')) });
const answering = (t: string): TurnRunner => ({ runTurn: vi.fn().mockResolvedValue(ok(t)) });
const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'repair these errors' }] };

describe('the ladder walk', () => {
  const ladder = () => {
    const kimi = answering('kimi');
    const glm53 = answering('glm-5.3');
    const chain = [
      { name: 'GLM', runner: failing(), modelId: 'glm-4.7-flashx' },
      { name: 'KIMI', runner: kimi, modelId: 'kimi-k2.7-code' },
      { name: 'GLM53', runner: glm53, modelId: 'glm-5.3', reportAs: 'GLM' },
    ];
    return { chain, kimi, glm53 };
  };

  it('🔴 with the flag, the walk stops BEFORE calling a rung that always reasons', async () => {
    const { chain, kimi, glm53 } = ladder();
    const err = await makeMultiProviderTurnRunner(chain).runTurn({ ...PARAMS, stopAtReasoningRung: true }).catch((e) => e);
    expect(isReasoningRungStop(err)).toBe(true);
    expect((err as ReasoningRungStopError).model).toBe('kimi-k2.7-code');
    expect(kimi.runTurn).not.toHaveBeenCalled();
    expect(glm53.runTurn).not.toHaveBeenCalled();
  });

  it('without the flag the walk is unchanged — the full builder still reaches those rungs', async () => {
    const { chain, kimi } = ladder();
    const res = await makeMultiProviderTurnRunner(chain).runTurn(PARAMS);
    expect(res.text).toBe('kimi');
    expect(kimi.runTurn).toHaveBeenCalledTimes(1);
  });

  it('a rung that answers directly after the opener is still used', async () => {
    const haiku = answering('haiku');
    const res = await makeMultiProviderTurnRunner([
      { name: 'GLM', runner: failing(), modelId: 'glm-4.7-flashx' },
      { name: 'CLAUDE_HAIKU', runner: haiku, modelId: 'claude-haiku-4-5-20251001' },
    ]).runTurn({ ...PARAMS, stopAtReasoningRung: true });
    expect(res.text).toBe('haiku');
  });

  it('the stop is not a failure of that rung — nothing is benched, the next turn without the flag reaches it', async () => {
    const { chain, kimi } = ladder();
    const runner = makeMultiProviderTurnRunner(chain);
    await runner.runTurn({ ...PARAMS, stopAtReasoningRung: true }).catch(() => undefined);
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('kimi');
    expect(kimi.runTurn).toHaveBeenCalledTimes(1);
  });
});

describe('the repair loop asks the same question generation asks', () => {
  const manifest = ['src/types.ts :: types', 'src/hooks/useThing.ts :: hook', 'src/components/Card.tsx :: card', 'src/App.tsx :: root'].join('\n');
  const block = (p: string) => `<<<FILE ${p}>>>\nexport const x = 1;\n<<<ENDFILE>>>`;

  function run(stopAfterVerify: string | null) {
    // The fall happens AFTER generation — during verify/repair, exactly as in the report.
    let verified = false;
    const stop = () => (verified ? stopAfterVerify : null);
    const repair = vi.fn().mockResolvedValue([{ path: 'src/App.tsx', content: 'export const y = 2;' }]);
    const p = runSimpleBuild({
      prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx', 'src/main.tsx'],
      generate: async (system: string, user: string) => {
        if (user.includes('Plan the file list')) return manifest;
        if (system.includes('SHARED CONTRACT')) return 'export type X = 1;';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/x.ts';
        return block(path);
      },
      writeFiles: async () => undefined,
      verify: async () => { verified = true; return { ok: false, ran: true, errors: "src/App.tsx(1,1): error TS2304: Cannot find name 'Z'." }; },
      repair,
      stopLane: stop,
      maxRepairs: 3,
    } as never);
    return { p, repair };
  }

  it('🔴 a lane told to stop spends no repair call', async () => {
    const { p, repair } = run('the next engine reasons before every answer');
    const r = await p;
    expect(r.ok).toBe(false);
    expect(repair).not.toHaveBeenCalled();
  });

  it('a lane not told to stop repairs as before', async () => {
    const { p, repair } = run(null);
    await p;
    expect(repair).toHaveBeenCalled();
  });
});

describe('the route wires both halves under the one kill switch', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  it('every lane call asks the walk to stop before a reasoning rung', () => {
    expect(route).toContain('stopAtReasoningRung: fastLaneReasoningGateEnabled(),');
  });
  it('a stop is turned into the lane\'s hand-off reason and recorded', () => {
    expect(route).toContain('if (isReasoningRungStop(err) && !fastLaneReasoningRung) {');
  });
});
