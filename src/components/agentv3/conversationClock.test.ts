import { describe, expect, it } from 'vitest';
import { createConversationEventClock, nextUserMessageTs } from './conversationClock';
import { agentV3Reducer } from './agentV3Reducer';
import { initialAgentV3State, type AgentV3WireEvent } from './agentV3Types';
const reply = (ts: number, id = 'reply'): AgentV3WireEvent => ({ type: 'narration', agent: 'architect', text: 'Response', id, ts });
const ts = (e: AgentV3WireEvent) => 'ts' in e ? e.ts : undefined;

describe('causal live conversation clock', () => {
  it.each([100, 1_000_000])('keeps user before responses for server clock %s', server => {
    const clock = createConversationEventClock(10_000);
    expect(ts(clock.project(reply(server)))).toBe(10_001);
    expect(ts(clock.project(reply(server + 50, 'next')))).toBe(10_051);
  });
  it('preserves event positions on reconnect and streams/finalizes one reply without duplicates', () => {
    const clock = createConversationEventClock(500);
    const delta: AgentV3WireEvent = { type: 'stream_delta', kind: 'text', agent: 'architect', delta: 'Res', id: 'reply', ts: 10 };
    let state = agentV3Reducer(initialAgentV3State(), clock.project(delta));
    state = agentV3Reducer(state, clock.project(reply(20)));
    expect(state.narration).toHaveLength(1);
    expect(state.narration[0]).toMatchObject({ text: 'Response', ts: 501, streaming: false });
    expect(ts(clock.project(delta))).toBe(501);
  });
  it('places a second prompt after prior replies even if the device clock moved backwards', () => {
    expect(nextUserMessageTs(100, [[{ ts: 900 }], [{ ts: 1_000 }], [{ ts: NaN }]])).toBe(1_001);
    const clock = createConversationEventClock(1_001);
    expect(ts(clock.project(reply(5)))).toBeGreaterThan(1_001);
  });
  it('anchors mid-build steering without moving earlier replayed activity', () => {
    const clock = createConversationEventClock(100);
    const original = reply(5);
    expect(ts(clock.project(original))).toBe(101);
    clock.markUserMessage(200);
    expect(ts(clock.project(reply(6, 'steer-answer')))).toBe(201);
    expect(ts(clock.project(original))).toBe(101);
  });
  it('orders equal or regressed event times and keeps separate turns independent', () => {
    const clock = createConversationEventClock(100);
    expect(ts(clock.project(reply(50, 'a')))).toBe(101);
    expect(ts(clock.project(reply(50, 'b')))).toBe(102);
    expect(ts(clock.project(reply(40, 'c')))).toBe(103);
    expect(ts(createConversationEventClock(1).project(reply(50, 'a')))).toBe(2);
  });
  it('does not invent timestamps for terminal results or cold history', () => {
    expect(createConversationEventClock().project(reply(5))).toEqual(reply(5));
    const result = { type: 'result', ok: true, summary: 'Done', steps: 1, billedUsd: 0 } as AgentV3WireEvent;
    expect(createConversationEventClock(100).project(result)).toBe(result);
  });
});
