import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ post: vi.fn(), isCancel: vi.fn(() => false), authHeader: vi.fn(async () => ({})) }));
vi.mock('react', () => ({ useRef: vi.fn((current: unknown) => ({ current })) }));
vi.mock('axios', () => ({ default: mock }));
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../src/lib/authHeaders', () => ({ authHeader: mock.authHeader }));
vi.mock('../src/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../src/lib/platformHeader', () => ({ platformHeader: () => ({}) }));
vi.mock('../src/lib/vialMemory', () => ({ loadVials: () => ({}), saveVial: vi.fn() }));
import { useRef } from 'react';
import { useChatEngine, type ChatEngineDeps } from '../src/hooks/useChatEngine';
import type { Message } from '../src/types';
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
describe('real Free chat hook terminal request handling', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.isCancel.mockReturnValue(false); mock.authHeader.mockResolvedValue({}); vi.stubGlobal('fetch', vi.fn()); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each(['INFERENCE_GATEWAY_UNAVAILABLE', 'STRICT_FREE_UNAVAILABLE', 'CHAT_ROUTE_UNAVAILABLE'])('does not turn JSON %s into another backend request', async code => {
    mock.post.mockRejectedValue({ response: { status: 503, data: { code, reply: 'The selected route is unavailable.' } }, message: 'Request failed' });
    const f = fixture(); await f.engine().handleSend();
    expect(mock.post).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    expect(f.messages().filter(m => m.sender === 'ai')).toHaveLength(1);
    expect(f.messages().at(-1)?.text).toBe('The selected route is unavailable.');
    expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
  });
  it.each([500, 502, 503])('never retries an ambiguous HTTP %s even without gateway markers', async status => {
    mock.post.mockRejectedValue({ response: { status, data: {} }, message: 'Request failed' });
    const first = fixture(); await first.engine().handleSend(); expect(mock.post).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status, headers: { 'Content-Type': 'application/json' } }));
    const second = fixture(); second.deps.selectedModel = 'openai'; second.deps.keys = { openai: 'test' }; await second.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(second.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('does not repeat a guest-limit refusal across endpoints or inside streaming retry', async () => {
    mock.post.mockRejectedValue({ response: { status: 403, data: { code: 'guest_limit_reached', error: 'Sign in to continue.' } }, message: 'Request failed' });
    const first = fixture(); await first.engine().handleSend(); expect(mock.post).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: 'guest_limit_reached', error: 'Sign in to continue.' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    const second = fixture(); second.deps.selectedModel = 'openai'; second.deps.keys = { openai: 'test' }; await second.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(second.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it.each(['cancel', 'network'])('does not retry an ambiguous Axios %s outcome', async kind => {
    mock.isCancel.mockReturnValue(kind === 'cancel'); mock.post.mockRejectedValue({ message: 'Network Error', code: 'ERR_NETWORK' });
    const f = fixture(); await f.engine().handleSend();
    expect(mock.post).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it.each(['INFERENCE_GATEWAY_UNAVAILABLE', 'STRICT_FREE_UNAVAILABLE', 'CHAT_ROUTE_UNAVAILABLE'])('does not retry a non-OK streaming-path JSON %s response', async code => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code, reply: 'Unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
    await f.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(mock.post).not.toHaveBeenCalled(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(f.messages().at(-1)?.text).toBe('Unavailable');
  });
  it.each(['axios', 'fetch-json', 'sse'])('does not turn an explicit HTTP200 route failure into success through %s', async transport => {
    const reply = 'The AI service is temporarily unavailable. Please try again later.';
    const failure = { ok: false, code: 'CHAT_ROUTE_UNAVAILABLE', reply };
    const f = fixture();
    if (transport === 'axios') mock.post.mockResolvedValue({ data: failure });
    else {
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
    expect(transport === 'axios' ? mock.post : fetch).toHaveBeenCalledOnce();
    expect(transport === 'axios' ? fetch : mock.post).not.toHaveBeenCalled();
  });
  it('does not retry an ambiguous fetch outcome before response headers', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' }; await f.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(mock.post).not.toHaveBeenCalled(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
  });
  it('Stop aborts the default Axios request and never appends a late answer or falls back', async () => {
    let finish!: (value: unknown) => void; let signal: AbortSignal | undefined;
    mock.post.mockImplementation((_url, _body, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
    const f = fixture(); const engine = f.engine(); const pending = engine.handleSend();
    await vi.waitFor(() => expect(mock.post).toHaveBeenCalledOnce()); engine.stop();
    expect(signal?.aborted).toBe(true); finish({ data: { reply: 'Late generated answer' } }); await pending;
    expect(fetch).not.toHaveBeenCalled(); expect(f.messages().some(m => m.text.includes('Late generated answer'))).toBe(false);
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
    mock.post.mockImplementation(async (_url, body) => ({ data: { reply: `Answer to ${body.message}` } }));
    const f = fixture();
    for (let n = 1; n <= 20; n++) {
      await f.engine().handleSend(`Question ${n}`);
      expect(f.deps.isLoading).toBe(false);
      expect(f.messages().at(-1)?.text).toBe(`Answer to Question ${n}`);
    }
    expect(mock.post).toHaveBeenCalledTimes(20);
    expect(fetch).not.toHaveBeenCalled();
    const ids = mock.post.mock.calls.map(([, , options]) => options.headers['x-nb-answer-request']);
    expect(new Set(ids).size).toBe(20);
    expect(mock.post.mock.calls.every(([, , options]) => !options.signal.aborted)).toBe(true);
    expect(mock.post.mock.calls[1][1].history).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Question 1', sender: 'user' }),
      expect.objectContaining({ text: 'Answer to Question 1', sender: 'ai' }),
    ]));
  });
  it.each(['axios', 'fetch'])('carries per-chat language through %s without changing global preference', async transport => {
    mock.post.mockResolvedValue({ data: { reply: 'A synthetic answer.' } });
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ reply: 'A synthetic answer.' }), { headers: { 'Content-Type': 'application/json' } }));
    const f = fixture();
    if (transport === 'fetch') { f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' }; }
    const send = async (message: string) => { f.deps.input = message; await f.engine().handleSendForTab('studio'); };
    await send('Tell me about world trade.');
    await send('devnaagri me bataao');
    await send('aur details batao');
    const payloads = transport === 'axios' ? mock.post.mock.calls.map(call => call[1])
      : vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(payloads[1].message).toBe('devnaagri me bataao');
    expect(payloads[2].replyLanguage).toBe('hi');
    expect(f.deps.setPreferredLanguage).not.toHaveBeenCalled();
    expect(f.deps.preferredLanguage).toBe('english');
    const next = fixture(); await next.engine().handleSend('A new conversation');
    expect(mock.post.mock.calls.at(-1)![1].replyLanguage).toBeUndefined();
  });
  it('keeps a script request after a failed response and before client history text trimming', async () => {
    mock.post.mockRejectedValueOnce({ response: { status: 503, data: { code: 'CHAT_ROUTE_UNAVAILABLE', reply: 'Unavailable' } } })
      .mockResolvedValue({ data: { reply: 'A synthetic answer.' } });
    const f = fixture(); await f.engine().handleSend('devnaagri me bataao');
    await f.engine().handleSend('Try again');
    expect(mock.post.mock.calls[1][1].replyLanguage).toBe('hi');
    expect(f.deps.setPreferredLanguage).not.toHaveBeenCalled();
    const longTurn = `Reply in Hindi. ${'background '.repeat(220)}. Reply in English`;
    f.deps.messages = [{ id: 'older', sender: 'user', text: longTurn, timestamp: new Date() }];
    f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ reply: 'A synthetic answer.' }), { headers: { 'Content-Type': 'application/json' } }));
    f.deps.input = 'next question'; await f.engine().handleSendForTab('studio');
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.replyLanguage).toBe('en');
    expect(body.history[0].text).not.toContain('Reply in English');
    expect(body.history[0].text.length).toBe(2000);
  });
  it.each(['CHAT_ROUTE_UNAVAILABLE', 'FREE_ANSWER_UNAVAILABLE', 'FREE_ANSWER_BUSY'])('allows a fresh manual turn after terminal %s without automatic replay', async code => {
    mock.post.mockResolvedValueOnce({ data: { reply: 'First answer' } })
      .mockRejectedValueOnce({ response: { status: 503, data: { code, reply: 'Unavailable for this turn' } }, message: 'Request failed' })
      .mockResolvedValueOnce({ data: { reply: 'Third answer' } });
    const f = fixture();
    await f.engine().handleSend('First question');
    await f.engine().handleSend('Second question');
    expect(mock.post).toHaveBeenCalledTimes(2);
    expect(f.deps.isLoading).toBe(false);
    await f.engine().handleSend('Manual retry');
    expect(mock.post).toHaveBeenCalledTimes(3);
    expect(f.messages().at(-1)?.text).toBe('Third answer');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])('an aborted predecessor cannot mutate its successor after late %s', async outcome => {
    const finish: Array<(value: unknown) => void> = [];
    const fail: Array<(error: unknown) => void> = [];
    mock.post.mockImplementation(() => new Promise((resolve, reject) => { finish.push(resolve); fail.push(reject); }));
    const f = fixture();
    const firstEngine = f.engine();
    const first = firstEngine.handleSend('First question');
    await vi.waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1));
    firstEngine.stop();
    const second = f.engine().handleSend('Second question');
    await vi.waitFor(() => expect(mock.post).toHaveBeenCalledTimes(2));
    expect(f.deps.isLoading).toBe(true);
    const before = structuredClone(f.messages());
    const logCount = vi.mocked(f.deps.addLog).mock.calls.length;
    const errorCount = vi.mocked(f.deps.setErrorContext).mock.calls.length;
    if (outcome === 'resolve') finish[0]({ data: { reply: 'Late first answer' } });
    else fail[0]({ response: { status: 503, data: {} }, message: 'Late failure' });
    await first;
    expect(f.messages()).toEqual(before);
    expect(vi.mocked(f.deps.addLog).mock.calls).toHaveLength(logCount);
    expect(vi.mocked(f.deps.setErrorContext).mock.calls).toHaveLength(errorCount);
    const predecessorChangedLoading = !f.deps.isLoading;
    const predecessorWroteNotice = f.messages().some(message => message.text === 'The reply was stopped.');
    finish[1]({ data: { reply: 'Second answer' } });
    await second;
    expect(predecessorChangedLoading).toBe(false);
    expect(predecessorWroteNotice).toBe(false);
    expect(f.messages().at(-1)?.text).toBe('Second answer');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['axios', 'fetch'])('preserves explicit maintenance and does not replay, sign out or log success through %s', async transport => {
    const data = { maintenance: true, reply: 'AI services are paused for maintenance.' };
    const f = fixture();
    if (transport === 'axios') mock.post.mockRejectedValue({ response: { status: 503, data }, message: 'Request failed' });
    else {
      f.deps.keys = { openai: 'test' }; f.deps.selectedModel = 'openai';
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(data), { status: 503 }));
    }
    await f.engine().handleSendForTab('studio');
    expect(f.messages().at(-1)?.text).toBe(data.reply);
    expect(f.deps.isLoading).toBe(false);
    expect(f.deps.setUser).not.toHaveBeenCalled();
    expect(f.deps.setShowAuth).not.toHaveBeenCalled();
    expect(f.deps.addLog).not.toHaveBeenCalledWith(expect.stringContaining('AI Response received'), 'success');
    expect(transport === 'axios' ? mock.post : fetch).toHaveBeenCalledOnce();
    expect(transport === 'axios' ? fetch : mock.post).not.toHaveBeenCalled();
  });
  it('locks synchronously before preparation so two same-render sends do not dispatch twice', async () => {
    mock.post.mockResolvedValue({ data: { reply: 'Only one answer' } });
    const f = fixture(); const engine = f.engine();
    await Promise.all([engine.handleSend('One'), engine.handleSend('Two')]);
    expect(mock.post).toHaveBeenCalledOnce();
    expect(f.messages().filter(message => message.sender === 'user')).toHaveLength(1);
  });
  it('does not dispatch an old request after delayed authentication resumes over its successor', async () => {
    let finishAuth!: (headers: Record<string, string>) => void;
    mock.authHeader.mockImplementationOnce(() => new Promise(resolve => { finishAuth = resolve; }));
    mock.post.mockResolvedValue({ data: { reply: 'Successor answer' } });
    const f = fixture(); const firstEngine = f.engine();
    const first = firstEngine.handleSend('First');
    await vi.waitFor(() => expect(mock.authHeader).toHaveBeenCalledOnce());
    firstEngine.stop();
    await f.engine().handleSend('Second');
    finishAuth({}); await first;
    expect(mock.post).toHaveBeenCalledOnce();
    expect(mock.post.mock.calls[0][1].message).toBe('Second');
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

});
