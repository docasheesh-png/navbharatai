import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ post: vi.fn(), isCancel: vi.fn(() => false), authHeader: vi.fn(async () => ({})) }));
vi.mock('react', () => ({ useRef: vi.fn((current: unknown) => ({ current })), useEffect: vi.fn() }));
vi.mock('axios', () => ({ default: mock }));
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../src/lib/authHeaders', () => ({ authHeader: mock.authHeader }));
vi.mock('../src/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../src/lib/platformHeader', () => ({ platformHeader: () => ({}) }));
vi.mock('../src/lib/vialMemory', () => ({ loadVials: () => ({}), saveVial: vi.fn() }));
import { useRef, useEffect } from 'react';
import { useChatEngine, type ChatEngineDeps } from '../src/hooks/useChatEngine';
import type { Message } from '../src/types';
import { chatAvailabilityMessage } from '../src/server/lib/chatAvailabilityMessage';
import { CHAT_MODEL_TURN_CHARS } from '../src/lib/chatContextWindow';
function fixture() {
  let messages: Message[] = [];
  const deps: ChatEngineDeps = {
    input: 'hello', messages: [], isLoading: false, sessions: [], currentSessionId: '', activeAgent: 'navbharatai', mode: 'chat',
    activeView: 'nbi_chat', activeIntent: 'general', errorContext: null, preferredLanguage: 'english', user: null, keys: {}, selectedModel: 'auto',
    apnapanProfile: {}, hasGeneratedCode: false, generatedCode: '', githubToken: null, files: {},
    setMessages: value => { messages = typeof value === 'function' ? value(messages) : value; deps.messages = messages; },
    setInput: vi.fn(value => { deps.input = typeof value === 'function' ? value(deps.input) : value; }),
    setIsLoading: vi.fn(value => { deps.isLoading = typeof value === 'function' ? value(deps.isLoading) : value; }), setActiveIntent: vi.fn(), setErrorContext: vi.fn(), setPreferredLanguage: vi.fn(), setMode: vi.fn(),
    setShowAuth: vi.fn(), setUser: vi.fn(), setGithubToken: vi.fn(), setGithubRepoContext: vi.fn(), setFiles: vi.fn(), setHasGeneratedCode: vi.fn(),
    setIsAppBuilt: vi.fn(), addLog: vi.fn(), addToast: vi.fn(), incrementDailyUsage: vi.fn(), learnFromMessage: vi.fn(), updatePreview: vi.fn(),
  };
  // Preserve hook refs across explicit renders while passing the latest state snapshot, as React does.
  const refs: Array<{ current: unknown }> = [];
  return { deps, messages: () => messages, engine: () => {
    let index = 0;
    vi.mocked(useRef).mockImplementation((current: unknown) => refs[index++] ??= { current });
    return useChatEngine(deps);
  } };
}
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
// 🔴 THE 'axios' TRANSPORT IS GONE FROM EVERY CASE BELOW (admin 2026-11-25, the slow-reply report).
// The hook used to have TWO send paths and these cases covered both: a blocking `axios.post` that the
// free chat actually took, and the streaming `fetch` it reached only after that one failed. The blocking
// path is deleted, so there is one transport — but `axios` stays MOCKED on purpose, so every case can
// still assert that nothing in the hook reached for it. The `%s` parameter is kept so that a future
// second transport (a websocket, say) is added as a case rather than as a second untested path.
/** The shapes the axios cases used to set up, on the one transport that remains. */
const jsonBody = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
/** Every chat request this turn made: its parsed JSON body and the init it was sent with. */
const sent = () => vi.mocked(fetch).mock.calls.map(call => ({
  body: JSON.parse(String(call[1]?.body)) as Record<string, any>,
  init: call[1] as RequestInit & { headers: Record<string, string>; signal: AbortSignal },
}));
/** Nothing in the hook may reach for the deleted blocking path, in any case. */
const noBlockingSend = () => expect(mock.post).not.toHaveBeenCalled();
describe('real Free chat hook terminal request handling', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.isCancel.mockReturnValue(false); mock.authHeader.mockResolvedValue({}); vi.stubGlobal('fetch', vi.fn()); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each(['fetch-json', 'sse'])('preserves selected-language capacity failure without retry or success through %s', async transport => {
    const reply = chatAvailabilityMessage('capacity', { message: 'mujhe madad chahiye', replyLanguage: 'hi' });
    const failure = { code: 'CHAT_CAPACITY_EXHAUSTED', reply, error: reply };
    const f = fixture();
    {
      f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
      vi.mocked(fetch).mockResolvedValue(new Response(transport === 'sse' ? frame(failure) : JSON.stringify(failure), {
        status: transport === 'sse' ? 200 : 503, headers: { 'Content-Type': transport === 'sse' ? 'text/event-stream' : 'application/json' },
      }));
    }
    await f.engine().handleSendForTab('studio');
    expect(f.messages().filter(m => m.sender === 'ai')).toHaveLength(1);
    expect(f.messages().at(-1)?.text).toBe(reply);
    expect(f.deps.setErrorContext).toHaveBeenCalledWith(expect.objectContaining({ message: reply }));
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
    expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(mock.post).not.toHaveBeenCalled(); // there is no blocking send path left to fall back to
  });
  it('keeps an unexpected failure neutral while retaining its diagnostic error internally', async () => {
    const f = fixture(); f.deps.incrementDailyUsage = () => { throw new Error('synthetic provider budget failure'); };
    await f.engine().handleSend();
    // Admin 2026-10-30: an unknown failure says "high server load" (trust), never a raw provider detail.
    expect(f.messages().at(-1)?.text).toBe('High server load right now. Please try again after some time.');
    expect(f.messages().at(-1)?.text).not.toMatch(/provider|budget|trouble reaching/i);
    expect(f.deps.setErrorContext).toHaveBeenCalledWith(expect.objectContaining({ message: 'synthetic provider budget failure' }));
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
  });
  it.each(['fetch'])('carries current instruction then history then picker preference through %s without changing settings', async transport => {
    const cases = [
      { input: 'mujhe madad chahiye', picker: 'hindi', history: [], expected: 'hi' },
      { input: 'mujhe madad chahiye', picker: 'english', history: [], expected: 'en' },
      { input: 'Hello', picker: 'hinglish', history: [], expected: 'hinglish' },
      { input: 'Hello', picker: 'auto', history: [], expected: undefined },
      { input: 'Hello', picker: 'hindi', history: ['Reply in Tamil'], expected: 'ta' },
      { input: 'For this answer only, reply in English', picker: 'hindi', history: ['Reply in Tamil'], expected: 'en' },
    ];
    for (const example of cases) {
      const f = fixture(); f.deps.input = example.input; f.deps.preferredLanguage = example.picker;
      f.deps.messages = example.history.map((text, n) => ({ id: `language-${n}`, text, sender: 'user' as const, timestamp: new Date() }));
      {
        f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
        vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ reply: 'Answer' }), { headers: { 'Content-Type': 'application/json' } }));
      }
      await f.engine().handleSendForTab('studio');
      const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]?.body));
      expect(body.replyLanguage).toBe(example.expected);
      expect(body.message).toBe(example.input);
      expect(f.deps.setPreferredLanguage).not.toHaveBeenCalled();
    }
  });
  it.each(['INFERENCE_GATEWAY_UNAVAILABLE', 'STRICT_FREE_UNAVAILABLE', 'CHAT_ROUTE_UNAVAILABLE'])('does not turn JSON %s into another backend request', async code => {
    vi.mocked(fetch).mockResolvedValue(jsonBody({ code, reply: 'The selected route is unavailable.' }, 503));
    const f = fixture(); await f.engine().handleSend();
    expect(fetch).toHaveBeenCalledOnce(); noBlockingSend();
    expect(f.messages().filter(m => m.sender === 'ai')).toHaveLength(1);
    expect(f.messages().at(-1)?.text).toBe('The selected route is unavailable.');
    expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
  });
  it.each([500, 502, 503])('never retries an ambiguous HTTP %s even without gateway markers', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status, headers: { 'Content-Type': 'application/json' } }));
    const f = fixture(); await f.engine().handleSend();
    expect(fetch).toHaveBeenCalledOnce(); noBlockingSend();
    expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('does not repeat a guest-limit refusal across endpoints or inside streaming retry', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonBody({ code: 'guest_limit_reached', error: 'Sign in to continue.' }, 403));
    const f = fixture(); await f.engine().handleSend();
    expect(fetch).toHaveBeenCalledOnce(); noBlockingSend(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it.each(['abort', 'network'])('does not retry an ambiguous %s outcome on the default path', async kind => {
    // Was an Axios case. A dispatched request whose outcome is unknown must never become a second
    // logical request, whichever transport carried it — that is the assertion, and it is unchanged.
    vi.mocked(fetch).mockRejectedValue(kind === 'abort'
      ? new DOMException('Stopped', 'AbortError') : new TypeError('Network Error'));
    const f = fixture(); await f.engine().handleSend();
    expect(fetch).toHaveBeenCalledOnce(); noBlockingSend(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it.each(['INFERENCE_GATEWAY_UNAVAILABLE', 'STRICT_FREE_UNAVAILABLE', 'CHAT_ROUTE_UNAVAILABLE'])('does not retry a non-OK streaming-path JSON %s response', async code => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code, reply: 'Unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
    await f.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(mock.post).not.toHaveBeenCalled(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(f.messages().at(-1)?.text).toBe('Unavailable');
  });
  it.each(['fetch-json', 'sse'])('does not turn an explicit HTTP200 route failure into success through %s', async transport => {
    const reply = 'The AI service is temporarily unavailable. Please try again later.';
    const failure = { ok: false, code: 'CHAT_ROUTE_UNAVAILABLE', reply };
    const f = fixture();
    {
      f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
      vi.mocked(fetch).mockResolvedValue(new Response(transport === 'sse'
        ? frame({ c: reply }) + frame({ error: reply, code: failure.code, partial: false })
        : JSON.stringify(failure), { headers: { 'Content-Type': transport === 'sse' ? 'text/event-stream' : 'application/json' } }));
    }
    await f.engine().handleSendForTab('studio');
    expect(f.messages().filter(m => m.sender === 'ai')).toHaveLength(1);
    expect(f.messages().at(-1)?.text).toBe(reply);
    expect(f.deps.setErrorContext).toHaveBeenCalledWith(expect.objectContaining({ message: reply }));
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
    expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(mock.post).not.toHaveBeenCalled(); // there is no blocking send path left to fall back to
  });
  it('does not retry an ambiguous fetch outcome before response headers', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' }; await f.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(mock.post).not.toHaveBeenCalled(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('Stop aborts the default request and never appends a late answer or falls back', async () => {
    let finish!: (value: Response) => void; let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, options) => { signal = options!.signal!; return new Promise(resolve => { finish = resolve; }); });
    const f = fixture(); const engine = f.engine(); const pending = engine.handleSend();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); engine.stop();
    expect(signal?.aborted).toBe(true); finish(jsonBody({ reply: 'Late generated answer' })); await pending;
    expect(fetch).toHaveBeenCalledOnce(); noBlockingSend();
    expect(f.messages().some(m => m.text.includes('Late generated answer'))).toBe(false);
    expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('Stop before streaming response headers does not start another request', async () => {
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    }));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' }; const engine = f.engine();
    const pending = engine.handleSendForTab('studio'); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); engine.stop(); await pending;
    expect(fetch).toHaveBeenCalledOnce(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('labels truncated partial SSE as interrupted instead of silently displaying success', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(frame({ c: 'Partial only' }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' }; await f.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(f.messages().at(-1)?.text).toContain('Partial only\n\nThe connection ended before the reply was complete.');
    expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false); expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
  });
  it('error plus EOF preserves partial output, clears loading and never logs AI success or retries', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(frame({ c: 'Partial answer' }) + frame({ c: '\nReply interrupted.' })
      + frame({ error: 'The selected route stopped.', code: 'INFERENCE_GATEWAY_INTERRUPTED', partial: true }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' }; await f.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(f.messages().filter(m => m.sender === 'ai')).toHaveLength(1); expect(f.messages().at(-1)?.text).toBe('Partial answer\nReply interrupted.');
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
  });
  it('answers twenty sequential text turns with fresh identities and live controllers', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, options) => jsonBody({ reply: `Answer to ${JSON.parse(String(options?.body)).message}` }));
    const f = fixture();
    for (let n = 1; n <= 20; n++) {
      await f.engine().handleSend(`Question ${n}`);
      expect(f.deps.isLoading).toBe(false);
      expect(f.messages().at(-1)?.text).toBe(`Answer to Question ${n}`);
    }
    expect(fetch).toHaveBeenCalledTimes(20);
    noBlockingSend();
    const ids = sent().map(call => call.init.headers['x-nb-answer-request']);
    expect(new Set(ids).size).toBe(20);
    expect(sent().every(call => !call.init.signal.aborted)).toBe(true);
    expect(sent()[1].body.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Question 1', sender: 'user' }),
      expect.objectContaining({ text: 'Answer to Question 1', sender: 'ai' }),
    ]));
  });
  it.each(['fetch'])('carries per-chat language through %s without changing global preference', async transport => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ reply: 'A synthetic answer.' }), { headers: { 'Content-Type': 'application/json' } }));
    const f = fixture();
    f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
    const send = async (message: string) => { f.deps.input = message; await f.engine().handleSendForTab('studio'); };
    await send('Tell me about world trade.');
    await send('devnaagri me bataao');
    await send('aur details batao');
    const payloads = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(payloads[1].message).toBe('devnaagri me bataao');
    expect(payloads[2].replyLanguage).toBe('hi');
    expect(f.deps.setPreferredLanguage).not.toHaveBeenCalled();
    expect(f.deps.preferredLanguage).toBe('english');
    const next = fixture(); await next.engine().handleSend('A new conversation');
    expect(sent().at(-1)!.body.replyLanguage).toBe('en'); // Fresh chat uses the unchanged picker, not the previous chat's Hindi.
  });
  it('keeps a script request after a failed response and before client history text trimming', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonBody({ code: 'CHAT_ROUTE_UNAVAILABLE', reply: 'Unavailable' }, 503))
      .mockResolvedValue(jsonBody({ reply: 'A synthetic answer.' }));
    const f = fixture(); await f.engine().handleSend('devnaagri me bataao');
    await f.engine().handleSend('Try again');
    expect(sent()[1].body.replyLanguage).toBe('hi');
    expect(f.deps.setPreferredLanguage).not.toHaveBeenCalled();
    // One turn longer than a turn may be transmitted, so the clip still happens. The length is read
    // from the window's own constant rather than written as 2000: the clip is the server's per-turn
    // bound now (`CHAT_MAX_HISTORY_TURN_CHARS`), so a turn is never cut twice to two lengths.
    const longTurn = `Reply in Hindi. ${'background '.repeat(500)}. Reply in English`;
    expect(longTurn.length).toBeGreaterThan(CHAT_MODEL_TURN_CHARS);
    f.deps.messages = [{ id: 'older', sender: 'user', text: longTurn, timestamp: new Date() }];
    f.deps.input = 'next question'; await f.engine().handleSendForTab('studio');
    const body = sent().at(-1)!.body;
    expect(body.replyLanguage).toBe('en');
    expect(body.history[0].text).not.toContain('Reply in English');
    expect(body.history[0].text.length).toBe(CHAT_MODEL_TURN_CHARS);
  });
  it.each(['CHAT_ROUTE_UNAVAILABLE', 'FREE_ANSWER_UNAVAILABLE', 'FREE_ANSWER_BUSY'])('allows a fresh manual turn after terminal %s without automatic replay', async code => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonBody({ reply: 'First answer' }))
      .mockResolvedValueOnce(jsonBody({ code, reply: 'Unavailable for this turn' }, 503))
      .mockResolvedValueOnce(jsonBody({ reply: 'Third answer' }));
    const f = fixture();
    await f.engine().handleSend('First question');
    await f.engine().handleSend('Second question');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(f.deps.isLoading).toBe(false);
    await f.engine().handleSend('Manual retry');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(f.messages().at(-1)?.text).toBe('Third answer');
    noBlockingSend();
  });
  it.each(['resolve', 'reject'])('an aborted predecessor cannot mutate its successor after late %s', async outcome => {
    const finish: Array<(value: Response) => void> = [];
    const fail: Array<(error: unknown) => void> = [];
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve, reject) => { finish.push(resolve); fail.push(reject); }));
    const f = fixture();
    const firstEngine = f.engine();
    const first = firstEngine.handleSend('First question');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    firstEngine.stop();
    const second = f.engine().handleSend('Second question');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(f.deps.isLoading).toBe(true);
    const before = structuredClone(f.messages());
    const logCount = vi.mocked(f.deps.addLog).mock.calls.length;
    const errorCount = vi.mocked(f.deps.setErrorContext).mock.calls.length;
    if (outcome === 'resolve') finish[0](jsonBody({ reply: 'Late first answer' }));
    else fail[0](new TypeError('Late failure'));
    await first;
    expect(f.messages()).toEqual(before);
    expect(vi.mocked(f.deps.addLog).mock.calls).toHaveLength(logCount);
    expect(vi.mocked(f.deps.setErrorContext).mock.calls).toHaveLength(errorCount);
    const predecessorChangedLoading = !f.deps.isLoading;
    const predecessorWroteNotice = f.messages().some(message => message.text === 'The reply was stopped.');
    finish[1](jsonBody({ reply: 'Second answer' }));
    await second;
    expect(predecessorChangedLoading).toBe(false);
    expect(predecessorWroteNotice).toBe(false);
    expect(f.messages().at(-1)?.text).toBe('Second answer');
    noBlockingSend();
  });

  it.each(['fetch'])('preserves explicit maintenance and does not replay, sign out or log success through %s', async transport => {
    const data = { maintenance: true, reply: 'AI services are paused for maintenance.' };
    const f = fixture();
    {
      f.deps.keys = { openai: 'test' }; f.deps.selectedModel = 'openai';
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(data), { status: 503 }));
    }
    await f.engine().handleSendForTab('studio');
    expect(f.messages().at(-1)?.text).toBe(data.reply);
    expect(f.deps.isLoading).toBe(false);
    expect(f.deps.setUser).not.toHaveBeenCalled();
    expect(f.deps.setShowAuth).not.toHaveBeenCalled();
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
    expect(fetch).toHaveBeenCalledOnce();
    expect(mock.post).not.toHaveBeenCalled(); // there is no blocking send path left to fall back to
  });
  it('locks synchronously before preparation so two same-render sends do not dispatch twice', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonBody({ reply: 'Only one answer' }));
    const f = fixture(); const engine = f.engine();
    await Promise.all([engine.handleSend('One'), engine.handleSend('Two')]);
    expect(fetch).toHaveBeenCalledOnce(); noBlockingSend();
    expect(f.messages().filter(message => message.sender === 'user')).toHaveLength(1);
  });
  it('does not dispatch an old request after delayed authentication resumes over its successor', async () => {
    let finishAuth!: (headers: Record<string, string>) => void;
    mock.authHeader.mockImplementationOnce(() => new Promise(resolve => { finishAuth = resolve; }));
    vi.mocked(fetch).mockResolvedValue(jsonBody({ reply: 'Successor answer' }));
    const f = fixture(); const firstEngine = f.engine();
    const first = firstEngine.handleSend('First');
    await vi.waitFor(() => expect(mock.authHeader).toHaveBeenCalledOnce());
    firstEngine.stop();
    await f.engine().handleSend('Second');
    finishAuth({}); await first;
    expect(fetch).toHaveBeenCalledOnce(); noBlockingSend();
    expect(sent()[0].body.message).toBe('Second');
    expect(f.messages().at(-1)?.text).toBe('Successor answer');
  });
  it.each([401, 403, 503])('late stopped HTTP %s cannot sign out, append errors or clear the successor', async status => {
    let finish!: (response: Response) => void;
    let finishSecond!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    const f = fixture(); f.deps.keys = { openai: 'test' }; f.deps.selectedModel = 'openai';
    const firstEngine = f.engine(); const first = firstEngine.handleSendForTab('studio', 'First');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); firstEngine.stop();
    const secondEngine = f.engine(); const second = secondEngine.handleSendForTab('studio', 'Second');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const before = structuredClone(f.messages()); const logCount = vi.mocked(f.deps.addLog).mock.calls.length;
    finish(new Response(JSON.stringify({ code: 'guest_limit_reached', error: 'Sign in' }), { status })); await first;
    expect(f.deps.isLoading).toBe(true); expect(f.messages()).toEqual(before);
    expect(vi.mocked(f.deps.addLog).mock.calls).toHaveLength(logCount);
    expect(f.deps.setUser).not.toHaveBeenCalled(); expect(f.deps.setShowAuth).not.toHaveBeenCalled();
    secondEngine.stop();
    expect(vi.mocked(fetch).mock.calls[1][1]?.signal?.aborted).toBe(true);
    finishSecond(new Response(JSON.stringify({ reply: 'Stopped second' }))); await second;
    expect(f.messages()).toEqual(before);
  });
  it('keeps stopped stream text isolated from late chunks and a same-millisecond successor', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    vi.mocked(fetch).mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const encode = (text: string) => new TextEncoder().encode(text);
    const f = fixture(); f.deps.keys = { openai: 'test' }; f.deps.selectedModel = 'openai';
    const firstEngine = f.engine(); const first = firstEngine.handleSendForTab('studio', 'First');
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0].enqueue(encode(frame({ c: 'First partial' })));
    await vi.waitFor(() => expect(f.messages().at(-1)?.text).toContain('First partial'));
    firstEngine.stop();
    const second = f.engine().handleSendForTab('studio', 'Second');
    await vi.waitFor(() => expect(streams).toHaveLength(2));
    const before = structuredClone(f.messages());
    streams[0].enqueue(encode(frame({ c: 'Late first chunk' }) + 'data: [DONE]\n\n')); await first;
    expect(f.messages()).toEqual(before); expect(f.deps.isLoading).toBe(true);
    streams[1].enqueue(encode(frame({ c: 'Second answer' }) + 'data: [DONE]\n\n')); await second;
    expect(f.messages().filter(message => message.sender === 'ai').map(message => message.text)).toEqual(['First partial ⏹ (stopped)', 'Second answer']);
    expect(new Set(f.messages().map(message => message.id)).size).toBe(f.messages().length);
  });

  it.each(['network', 'timeout', 'abort'].flatMap(kind => [true, false].flatMap(sse => [true, false].map(partial => ({ kind, sse, partial })))))
    ('finalizes one honest bubble after a reader failure: $kind, SSE=$sse, partial=$partial', async ({ kind, sse, partial }) => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonBody({ reply: 'First answer' }));
      const f = fixture(); await f.engine().handleSend('First question');
      f.deps.keys = { openai: 'test' }; f.deps.selectedModel = 'openai';
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
      vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': sse ? 'text/event-stream' : 'text/plain' } }));
      const pending = f.engine().handleSendForTab('studio', 'Second question');
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      if (partial) {
        controller.enqueue(new TextEncoder().encode(sse ? frame({ c: 'Second partial answer' }) : 'Second partial answer'));
        await vi.waitFor(() => expect(f.messages().at(-1)?.text).toContain('Second partial answer'));
      }
      controller.error(kind === 'network' ? new TypeError('Transport failed') : new DOMException('Transport ended', kind === 'timeout' ? 'TimeoutError' : 'AbortError'));
      await pending;
      const answers = f.messages().filter(message => message.sender === 'ai');
      expect(answers).toHaveLength(2);
      expect(answers[1].text).toContain('The connection ended before the reply was complete.');
      if (partial) expect(answers[1].text).toContain('Second partial answer');
      expect(answers[1].text).not.toMatch(/▋|\(stopped\)/);
      expect(new Set(f.messages().map(message => message.id)).size).toBe(f.messages().length);
      expect(f.deps.isLoading).toBe(false);
      expect(body.locked).toBe(false);
      expect(f.deps.setErrorContext).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('connection ended') }));
      expect(vi.mocked(f.deps.addLog).mock.calls.filter(([message, level]) => message.includes('AI Response received') && level === 'success')).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(2); noBlockingSend();
      vi.mocked(fetch).mockResolvedValueOnce(jsonBody({ reply: 'Manual successor answer' }));
      await f.engine().handleSendForTab('studio', 'Manual retry');
      expect(f.messages().at(-1)?.text).toBe('Manual successor answer');
      expect(fetch).toHaveBeenCalledTimes(3);
    });

  it.each([false, true])('a stopped reader cannot overwrite its successor or closed-chat navigation (navigate=%s)', async navigate => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let finishSuccessor!: (response: Response) => void;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSuccessor = resolve; }));
    const f = fixture(); f.deps.keys = { openai: 'test' }; f.deps.selectedModel = 'openai';
    const firstEngine = f.engine(); const first = firstEngine.handleSendForTab('studio', 'First question');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.enqueue(new TextEncoder().encode(frame({ c: 'Stopped partial' })));
    await vi.waitFor(() => expect(f.messages().at(-1)?.text).toContain('Stopped partial'));
    firstEngine.stop();
    expect(f.messages().at(-1)?.text).toBe('Stopped partial ⏹ (stopped)');
    if (navigate) {
      // Closing the active Free window calls Stop before replacing the conversation in App.tsx.
      f.deps.currentSessionId = 'synthetic-new-conversation';
      f.deps.setMessages([]);
    }
    const second = f.engine().handleSendForTab('studio', 'Successor question');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const before = structuredClone(f.messages());
    const errorsBefore = vi.mocked(f.deps.setErrorContext).mock.calls.length;
    controller.error(new DOMException('Aborted transport settled late', 'AbortError')); await first;
    expect(f.messages()).toEqual(before); expect(f.deps.isLoading).toBe(true);
    expect(vi.mocked(f.deps.setErrorContext).mock.calls).toHaveLength(errorsBefore);
    expect(body.locked).toBe(false);
    finishSuccessor(new Response(JSON.stringify({ reply: 'Successor answer' }), { headers: { 'Content-Type': 'application/json' } }));
    await second;
    expect(f.messages().at(-1)?.text).toBe('Successor answer');
    expect(f.deps.isLoading).toBe(false);
    expect(new Set(f.messages().map(message => message.id)).size).toBe(f.messages().length);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

});

describe('bounded pending question integration',()=>{
 beforeEach(()=>{vi.clearAllMocks();mock.isCancel.mockReturnValue(false);mock.authHeader.mockResolvedValue({});vi.stubGlobal('fetch',vi.fn());vi.spyOn(console,'error').mockImplementation(()=>{});});
 afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('explicitly queues three questions behind an active turn, preserving ordered fresh history',async()=>{
 vi.stubGlobal('fetch',vi.fn());let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});let active=0,peak=0;
 vi.mocked(fetch).mockImplementation(async(_url,options)=>{const body=JSON.parse(String(options?.body));peak=Math.max(peak,++active);if(body.message==='First')await hold;active--;return jsonBody({reply:`Answer to ${body.message}`});});
 const f=fixture();const engine=f.engine();const first=engine.handleSend('First');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
 for(const text of ['Second','Third','Fourth'])expect(engine.queueQuestion(text)).toBe(true);expect(engine.queueQuestion('Fifth')).toBe(false);
 release();await first;await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(4));await vi.waitFor(()=>expect(f.messages().filter(m=>m.sender==='ai')).toHaveLength(4));
 expect(sent().map(c=>c.body.message)).toEqual(['First','Second','Third','Fourth']);expect(peak).toBe(1);
 expect(sent()[3].body.history.map((m:Message)=>m.text)).toContain('Answer to Third');
 expect(f.messages().filter(m=>m.sender==='user').map(m=>m.text)).toEqual(['First','Second','Third','Fourth']);
});
it.each(['stop','session','account'] as const)('does not dispatch queued questions after %s changes',async change=>{
 let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});vi.mocked(fetch).mockImplementation(async()=>{await hold;return jsonBody({reply:'First answer'});});
 const f=fixture();const engine=f.engine();const first=engine.handleSend('First');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());expect(engine.queueQuestion('Second')).toBe(true);
 if(change==='stop')engine.stop();if(change==='session')f.deps.currentSessionId='new-session';if(change==='account')f.deps.user={uid:'new-user'} as any;
 f.engine();release();await first;await new Promise(r=>setTimeout(r,10));expect(fetch).toHaveBeenCalledOnce();
});
it.each(['failure','incomplete'] as const)('clears pending questions after an %s answer',async outcome=>{
 let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});vi.mocked(fetch).mockImplementation(async()=>{await hold;if(outcome==='failure')return jsonBody({},503);return jsonBody({reply:'Partial answer',stalled:true});});
 const f=fixture();const engine=f.engine();const first=engine.handleSend('First');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());expect(engine.queueQuestion('Second')).toBe(true);
 release();await first;await new Promise(r=>setTimeout(r,10));expect(fetch).toHaveBeenCalledOnce();
});
it('does not erase a new draft when the queued question starts',async()=>{
 let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});vi.mocked(fetch).mockImplementation(async(_url,options)=>{if(JSON.parse(String(options?.body)).message==='First')await hold;return jsonBody({reply:'Answer'});});
 const f=fixture();const engine=f.engine();const first=engine.handleSend('First');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());engine.queueQuestion('Second');f.deps.input='Unsent draft';
 release();await first;await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));expect(f.deps.input).toBe('Unsent draft');
});

it('cancels queued work when the hook unmounts',async()=>{
 let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});vi.mocked(fetch).mockImplementation(async()=>{await hold;return jsonBody({reply:'Late answer'});});
 const f=fixture();const engine=f.engine();const cleanup=vi.mocked(useEffect).mock.calls.at(-1)![0]();
 const first=engine.handleSend('First');await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());engine.queueQuestion('Second');
 if(typeof cleanup==='function')cleanup();release();await first;await new Promise(r=>setTimeout(r,10));expect(fetch).toHaveBeenCalledOnce();expect(engine.queueQuestion('Third')).toBe(false);
});
});
