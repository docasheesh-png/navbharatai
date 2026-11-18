/**
 * BR1994 — build-report autopsy (docs/build-report-autopsy-BR1994.md). Synthetic fixtures only; no customer payload.
 *
 * F1 · After the build told the user "⏳ Out of time — saving your app and summarising what was done.", the
 *      readiness hand-back said "⏳ Not finished yet — … I am continuing. Please keep this open." 19 s later.
 *      Once the build-wide FINAL budget stage was said, a hand-back promises nothing more.
 * F2 · The wall-clock ending said "I stopped after about 22 min" after a 25-minute build: it quoted the full
 *      builder's remaining budget, not the time the build had run. It now quotes the build's own elapsed time.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handBackNotice } from '../src/server/AgentV3/handBackNotice';
import { abortBuild, abortSummary, buildClockMinutes } from '../src/server/AgentV3/buildAbortCause';
import { BUDGET_NARRATION } from '../src/server/AgentV3/buildBudgetSteer';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

const CONTINUING = '⏳ Not finished yet — a few things still need fixing, and I am continuing. Please keep this open.';
const MIN = 60_000;

describe('F1 · no "I am continuing" after "Out of time" (pure)', () => {
  it('🔴 the final stage said ⇒ neither hand-back kind promises more work', () => {
    expect(handBackNotice('unfinished', 'The app is ready.', { outOfTime: true })).toBeNull();
    expect(handBackNotice('style', 'The app is ready.', { outOfTime: true })).toBeNull();
    expect(handBackNotice('style', 'The app is ready.', { outOfTime: true, previewLive: true })).toBeNull();
  });
  it('neighbours: unknown or false keeps main\'s lines exactly', () => {
    expect(handBackNotice('unfinished', 'The app is ready.')).toBe(CONTINUING);
    expect(handBackNotice('unfinished', 'The app is ready.', { outOfTime: false })).toBe(CONTINUING);
    expect(handBackNotice('style', 'The app is ready.', { outOfTime: undefined, previewLive: true })).toMatch(/your preview is already open/);
    expect(handBackNotice('style', 'The app is ready.', {})).toMatch(/before the preview opens/);
    expect(handBackNotice('unfinished', '   ', { outOfTime: false })).toBeNull(); // nothing claimed, as on main
  });
  it('the line it would contradict is the final budget narration', () => {
    expect(BUDGET_NARRATION.final).toBe('⏳ Out of time — saving your app and summarising what was done.');
  });
});

// ── AgentRunner, scripted (same harness shape as aBuildThatStoppedTalkingIsNotFinished.test.ts) ─────────
function scripted(messages: unknown[]): MessagesCreateClient {
  let i = 0;
  return { messages: { create: async () => { const m = messages[i] ?? { content: [{ type: 'text', text: 'end' }], stop_reason: 'end_turn' }; i++; return m as never; } } };
}
const use = { input_tokens: 5, output_tokens: 5 };
const write = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }], stop_reason: 'tool_use', usage: use });
const say = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: use });
const blockers = ['2 fake/incomplete code issue(s): not-implemented @ src/App.tsx:12'];
function runner(stream: AgentEventStream, script: unknown[], extra: Record<string, unknown> = {}) {
  const dispatcher = {
    dispatch: async (tu: { id: string }) => ({ tool_use_id: tu.id, content: 'ok', is_error: false }),
    assessBuildReadiness: async () => ({ score: 40, ready: false, blockers, warnings: [] as string[], tier: 'weak' }),
  };
  return new AgentRunner({
    client: new ClaudeClient(scripted(script)), dispatcher: dispatcher as never, state: new WorkspaceState(stream), events: stream,
    model: 'm', system: 's', tools: defaultToolCatalog(), expectsArtifacts: true, readinessGate: true, ...extra,
  });
}
const narrations = (stream: AgentEventStream) => stream.snapshot().filter((e) => e.type === 'narration').map((e) => (e as { text: string }).text);

describe('F1 · wired in AgentRunner\'s unfinished hand-back', () => {
  it('🔴 after the build said "Out of time", the hand-back still resumes but tells the user nothing new', async () => {
    const stream = new AgentEventStream();
    stream.budgetStagesSaid.add('final');
    await runner(stream, [write('a'), say('All done — the app is ready.'), say('Still thinking.'), say('Still thinking.')]).run('synthetic downloader app');
    expect(narrations(stream)).not.toContain(CONTINUING);
  });
  it('neighbour: before the final stage the hand-back says it is continuing, exactly as on main', async () => {
    const stream = new AgentEventStream();
    stream.budgetStagesSaid.add('wrapping');
    await runner(stream, [write('a'), say('All done — the app is ready.'), say('Still thinking.'), say('Still thinking.')]).run('synthetic downloader app');
    expect(narrations(stream)).toContain(CONTINUING);
  });
  it('🔒 every hand-back call site passes the build-wide final stage', () => {
    const src = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    const calls = src.match(/handBackNotice\([^\n]*\)/g) ?? [];
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c).toContain("outOfTime: events.budgetStagesSaid?.has('final') === true");
  });
});

describe('F2 · the wall-clock ending quotes the build\'s own minutes', () => {
  const now = 10_000_000_000;
  it('helper table (fail-safe: unknown start keeps main\'s runner figure)', () => {
    expect(buildClockMinutes(22 * MIN, now, now - 25 * MIN)).toBe(25);          // 🔴 BR1994's shape
    expect(buildClockMinutes(22 * MIN, now, undefined)).toBe(22);                // unknown ⇒ main
    expect(buildClockMinutes(22 * MIN, now, Number.NaN)).toBe(22);
    expect(buildClockMinutes(22 * MIN, now, 0)).toBe(22);
    expect(buildClockMinutes(22 * MIN, now, now + MIN)).toBe(22);                // a start in the future is not evidence
    expect(buildClockMinutes(22 * MIN, now, now - 10_000)).toBe(22);             // under half a minute rounds to 0 ⇒ main
    expect(buildClockMinutes(undefined, now, now - 25 * MIN)).toBeUndefined();   // no cap ⇒ no number, as on main
    expect(buildClockMinutes(0, now, now - 25 * MIN)).toBeUndefined();
  });
  it('the sentence the user reads', () => {
    expect(abortSummary('watchdog', { minutes: buildClockMinutes(22 * MIN, now, now - 25 * MIN), builtSomething: true })).toMatch(/^I stopped after about 25 min/);
  });
  async function stoppedByClock(stream: AgentEventStream) {
    const ac = new AbortController();
    abortBuild(ac, 'watchdog');
    return runner(stream, [write('a')], { maxBuildMs: 22 * MIN, signal: ac.signal }).run('synthetic downloader app');
  }
  it('🔴 a builder that started minutes into the build says the build\'s minutes', async () => {
    const result = await stoppedByClock(new AgentEventStream(500, Date.now() - 25 * MIN));
    expect(result.summary).toMatch(/about 25 min/);
  });
  it('neighbour: a runner that started with the build reads exactly as on main', async () => {
    const result = await stoppedByClock(new AgentEventStream());
    expect(result.summary).toMatch(/about 22 min/);
  });
  it('neighbour: a user Stop never quotes minutes', async () => {
    const ac = new AbortController();
    abortBuild(ac, 'user-stop');
    const result = await runner(new AgentEventStream(500, Date.now() - 25 * MIN), [write('a')], { maxBuildMs: 22 * MIN, signal: ac.signal }).run('x');
    expect(result.summary).toMatch(/^Stopped, as you asked\./);
  });
});
