import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { namesNoObject, assessBuildInput } from '../src/server/AgentV3/buildableInput';
import { voiceOf, voiceRequestedIn, inUserVoice, eventInUserVoice, PLATFORM_LINES } from '../src/server/AgentV3/platformVoice';
import { firstEtaLine, fleetEtaLine } from '../src/server/AgentV3/progressEta';
import { workingLine } from '../src/server/AgentV3/workingHeartbeat';
import { waitingForUserLine } from '../src/server/AgentV3/userWait';
import { createProviderSilenceMemory, silenceMemoryWindowMs } from '../src/server/AgentV3/providerSilenceMemory';
import { makeMultiProviderTurnRunner, createBuildBenchRegistry } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { SLOW_STREAM_MESSAGE, SILENT_OPEN_MARK } from '../src/server/AgentV3/turnDeadline';

const ok = { text: 'ok', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end_turn' } as any;
const noCooldowns = { until: () => 0, clear() {}, strike() {} } as any;
const params = { messages: [], system: '', tools: [] } as any;

describe('BR eb58abaf · 1 — an order that names no app asks instead of building', () => {
  it.each(['Mujhe ek app bnakar do', 'app bana ke do', 'ek app banaiye', 'kya aap ek app bana sakte ho', 'make me an app', 'build an app for me'])('%s → asks', (p) => {
    expect(namesNoObject(p)).toBe(true);
    expect(assessBuildInput(p).buildable).toBe(false);
  });
  it.each(['calculator banakar do', 'todo app bnakar do', 'ek bank app banao', 'banner banao', 'ek shop billing app banao', 'mujhe chahiye'])('%s → still builds', (p) => {
    expect(namesNoObject(p)).toBe(false);
  });
});

describe('BR eb58abaf · 2 — platform lines follow the user\'s language', () => {
  it('reads the voice from the prompt and from a mid-build ask', () => {
    expect(voiceOf('Mujhe ek app bnakar do')).toBe('hinglish');
    expect(voiceOf('make a todo app')).toBe('en');
    expect(voiceRequestedIn('Hindi me bolo')).toBe('hinglish');
    expect(voiceRequestedIn('हिंदी में बताओ')).toBe('hindi');
    expect(voiceRequestedIn('english please')).toBe('en');
    expect(voiceRequestedIn('add a login page')).toBeNull();
  });
  it('every live platform line the BR showed is translated, from the real generators', () => {
    const est = { estimateMs: 600_000, lowMs: 360_000, highMs: 840_000, confidence: 0.3 };
    const lines = ['Setting up your workspace…', 'Planning the file list…', workingLine(12_000), firstEtaLine(est, 0), firstEtaLine(est, 3), fleetEtaLine(est, 20), waitingForUserLine(120_000)];
    for (const l of lines) {
      const h = inUserVoice(l, 'hinglish');
      expect(h, l).not.toBe(l);
      expect(inUserVoice(l, 'hindi')).toMatch(/[\u0900-\u097F]/);
      expect(inUserVoice(l, 'en')).toBe(l);
    }
  });
  it('model prose is never touched', () => {
    const t = 'I will now create src/App.tsx with a planning list.';
    expect(inUserVoice(t, 'hinglish')).toBe(t);
    const e = { type: 'tool_result', summary: 'Planning the file list…' };
    expect(eventInUserVoice(e, 'hinglish')).toBe(e);
    expect((eventInUserVoice({ type: 'narration', text: 'Planning the file list…' }, 'hinglish') as any).text).toMatch(/Files ki list/);
    expect(PLATFORM_LINES.every((r) => r.re.source.startsWith('^'))).toBe(true);
  });
  it('wired at the route\'s one emit door and in the steer handler', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const ev = eventInUserVoice(redactEventForUser(honestResultEvent(e)), rb.voice);');
    expect(route).toContain('const asked = voiceRequestedIn(message); if (asked) rb.voice = asked;');
  });
});

describe('BR eb58abaf · 3/4 — a silent rung is benched for the rung, in-build and across builds', () => {
  const silentTimeout = () => new Error(`OpenAI-compatible call (GLM/Kimi) timed out after 15000ms — ${SILENT_OPEN_MARK}`);
  it('a silent TIMEOUT (no abandon left) benches family::model, so the next call on another key skips it', async () => {
    const calls: string[] = [];
    const glm = (n: string) => ({ runTurn: async () => { calls.push(n); throw silentTimeout(); } });
    const kimi = { runTurn: async () => { calls.push('KIMI'); return ok; } };
    const bench = createBuildBenchRegistry();
    const chain = () => [
      { name: 'GLM', runner: glm('GLM') as any, modelId: 'glm-4.7-flashx' },
      { name: 'GLM#2', reportAs: 'GLM', runner: glm('GLM#2') as any, modelId: 'glm-4.7-flashx' },
      { name: 'KIMI', runner: kimi as any, modelId: 'kimi-k2.7-code' },
    ];
    const benched: string[] = [];
    await makeMultiProviderTurnRunner(chain() as any, { bench, cooldowns: noCooldowns, onProviderBenched: (f, r) => benched.push(r) }).runTurn(params);
    await makeMultiProviderTurnRunner(chain() as any, { bench, cooldowns: noCooldowns }).runTurn(params);
    expect(calls).toEqual(['GLM', 'KIMI', 'KIMI']);
    expect(benched.join(' ')).toMatch(/had not started answering/);
  });
  it('a rung silent for ANOTHER build is opened past by a new build, then re-tried after the window', async () => {
    let t = 1_000_000;
    const now = () => t;
    const memory = createProviderSilenceMemory(() => 180_000);
    const calls: string[] = [];
    const mk = (silent: boolean) => [
      { name: 'GLM', runner: { runTurn: async (p: any) => { calls.push('GLM'); if (silent && p.canAbandonSlowStream?.()) throw new Error(`${SLOW_STREAM_MESSAGE} after 15000ms — ${SILENT_OPEN_MARK}`); return ok; } } as any, modelId: 'glm-4.7-flashx' },
      { name: 'KIMI', runner: { runTurn: async () => { calls.push('KIMI'); return ok; } } as any, modelId: 'kimi-k2.7-code' },
    ];
    await makeMultiProviderTurnRunner(mk(true) as any, { bench: createBuildBenchRegistry(), cooldowns: noCooldowns, silenceMemory: memory, now }).runTurn(params);
    t += 30_000;
    await makeMultiProviderTurnRunner(mk(false) as any, { bench: createBuildBenchRegistry(), cooldowns: noCooldowns, silenceMemory: memory, now }).runTurn(params);
    t += 200_000;
    await makeMultiProviderTurnRunner(mk(false) as any, { bench: createBuildBenchRegistry(), cooldowns: noCooldowns, silenceMemory: memory, now }).runTurn(params);
    expect(calls).toEqual(['GLM', 'KIMI', 'KIMI', 'GLM']);
  });
  it('never empties the ladder: a lone silent rung is still called', async () => {
    const memory = createProviderSilenceMemory(() => 180_000);
    memory.record('GLM::glm-4.7-flashx', Date.now());
    const calls: string[] = [];
    await makeMultiProviderTurnRunner([{ name: 'GLM', runner: { runTurn: async () => { calls.push('GLM'); return ok; } } as any, modelId: 'glm-4.7-flashx' }] as any, { cooldowns: noCooldowns, silenceMemory: memory }).runTurn(params);
    expect(calls).toEqual(['GLM']);
  });
  it('window env is clamped; the plan-first runner shares the build bench', () => {
    expect(silenceMemoryWindowMs({})).toBe(180_000);
    expect(silenceMemoryWindowMs({ AGENTV3_SILENCE_MEMORY_SECONDS: '5' })).toBe(30_000);
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('tierPlanRunner(powerLevelReqEffective, noClaudeBuild, buildBench, recordProviderBenched)');
  });
});
