import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ gemini: vi.fn(), groq: vi.fn(), leader: vi.fn(), fallback: vi.fn(), record: vi.fn() }));
vi.mock('./aiClients', () => ({ getGemini: () => ({ models: { generateContent: m.gemini } }), getGroq: () => ({ chat: { completions: { create: m.groq } } }), getClaude: vi.fn(), resolveApiKey: vi.fn() }));
vi.mock('../AI/AIRouterManager', () => ({ AIRouterManager: { getRouter: (name: string) => ({ routeRaced: name === 'professional-free' ? m.leader : m.fallback }) } }));
vi.mock('./AssistantSpendStore', () => ({ assistantSpendStore: { record: m.record } }));
import { callGemini, callGroq } from './aiCalls';
import { callProfessionalAIWithUsage } from './professionalRouting';
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); m.record.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllEnvs());
it('threads the Free lease signal to the direct Gemini request', async () => {
 const controller = new AbortController(); const beforeDispatch = vi.fn(); m.gemini.mockResolvedValue({ text: 'answer' });
 expect(await callGemini('hello', undefined, [], 'system', { signal: controller.signal, beforeDispatch })).toBe('answer');
 expect(m.gemini.mock.calls[0][0].config.abortSignal).toBe(controller.signal); expect(beforeDispatch).toHaveBeenCalled();
});
it('threads the Free lease signal to the direct Groq request', async () => {
 const controller = new AbortController(); m.groq.mockResolvedValue({ choices: [{ message: { content: 'answer' } }] });
 expect(await callGroq('hello', undefined, [], { signal: controller.signal })).toBe('answer'); expect(m.groq.mock.calls[0][1]).toEqual({ signal: controller.signal });
});
it('does not fabricate a successful quota-managed Groq answer on empty output', async () => {
 m.groq.mockResolvedValue({ choices: [] }); await expect(callGroq('hello', undefined, [], { signal: new AbortController().signal })).rejects.toThrow('No content');
});
it('rejects already-aborted direct requests without dispatch', async () => {
 const signal = AbortSignal.abort(); await expect(callGemini('hello', undefined, [], 'system', { signal })).rejects.toThrow(); await expect(callGroq('hello', undefined, [], { signal })).rejects.toThrow();
 expect(m.gemini).not.toHaveBeenCalled(); expect(m.groq).not.toHaveBeenCalled();
});
it('a cancelled professional leader cannot dispatch a fallback', async () => {
 const controller = new AbortController(); m.leader.mockImplementation(async () => { controller.abort(); throw new Error('cancelled primary'); });
 await expect(callProfessionalAIWithUsage('system', 'hello', 'free', { signal: controller.signal })).rejects.toThrow(); expect(m.fallback).not.toHaveBeenCalled();
 expect(m.leader).toHaveBeenCalledWith('hello', 'system', undefined, controller.signal);
});
it('an expired professional fence cannot dispatch a fallback', async () => {
 let expired = false; m.leader.mockImplementation(async () => { expired = true; throw new Error('primary failed'); });
 await expect(callProfessionalAIWithUsage('system', 'hello', 'free', { beforeDispatch: () => { if (expired) throw new Error('lease expired'); } })).rejects.toThrow('lease expired'); expect(m.fallback).not.toHaveBeenCalled();
});
it('an ordinary paid caller preserves original router arguments and successful accounting', async () => {
 m.leader.mockResolvedValue({ response: { content: 'paid answer', provider: 'GROQ', model: 'model', usage: { inputTokens: 2, outputTokens: 3 } }, telemetry: { success: true } });
 const answer = await callProfessionalAIWithUsage('system', 'hello', 'paid');
 expect(m.leader).toHaveBeenCalledWith('hello', 'system'); expect(answer.spend).toMatchObject({ provider: 'GROQ', inputTokens: 2, outputTokens: 3 }); expect(m.record).toHaveBeenCalledOnce();
});
