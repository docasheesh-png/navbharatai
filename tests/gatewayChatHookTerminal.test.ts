import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ post: vi.fn(), isCancel: vi.fn(() => false) }));
vi.mock('react', () => ({ useRef: (current: unknown) => ({ current }) }));
vi.mock('axios', () => ({ default: mock }));
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('../src/lib/authHeaders', () => ({ authHeader: async () => ({}) }));
vi.mock('../src/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../src/lib/platformHeader', () => ({ platformHeader: () => ({}) }));
vi.mock('../src/lib/vialMemory', () => ({ loadVials: () => ({}), saveVial: vi.fn() }));
import { useChatEngine, type ChatEngineDeps } from '../src/hooks/useChatEngine';
import type { Message } from '../src/types';
function fixture() {
  let messages: Message[] = [];
  const deps: ChatEngineDeps = {
    input: 'hello', messages: [], isLoading: false, sessions: [], currentSessionId: '', activeAgent: 'navbharatai', mode: 'chat',
    activeView: 'nbi_chat', activeIntent: 'general', errorContext: null, preferredLanguage: 'english', user: null, keys: {}, selectedModel: 'auto',
    apnapanProfile: {}, hasGeneratedCode: false, generatedCode: '', githubToken: null, files: {},
    setMessages: value => { messages = typeof value === 'function' ? value(messages) : value; },
    setInput: vi.fn(), setIsLoading: vi.fn(), setActiveIntent: vi.fn(), setErrorContext: vi.fn(), setPreferredLanguage: vi.fn(), setMode: vi.fn(),
    setShowAuth: vi.fn(), setUser: vi.fn(), setGithubToken: vi.fn(), setGithubRepoContext: vi.fn(), setFiles: vi.fn(), setHasGeneratedCode: vi.fn(),
    setIsAppBuilt: vi.fn(), addLog: vi.fn(), addToast: vi.fn(), incrementDailyUsage: vi.fn(), learnFromMessage: vi.fn(), updatePreview: vi.fn(),
  };
  return { deps, messages: () => messages, engine: () => useChatEngine(deps) };
}
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
describe('real Free chat hook terminal request handling', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.isCancel.mockReturnValue(false); vi.stubGlobal('fetch', vi.fn()); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each(['INFERENCE_GATEWAY_UNAVAILABLE', 'STRICT_FREE_UNAVAILABLE'])('does not turn JSON %s into another backend request', async code => {
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
  it.each(['INFERENCE_GATEWAY_UNAVAILABLE', 'STRICT_FREE_UNAVAILABLE'])('does not retry a non-OK streaming-path JSON %s response', async code => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code, reply: 'Unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    const f = fixture(); f.deps.selectedModel = 'openai'; f.deps.keys = { openai: 'test' };
    await f.engine().handleSendForTab('studio');
    expect(fetch).toHaveBeenCalledOnce(); expect(mock.post).not.toHaveBeenCalled(); expect(f.deps.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(f.messages().at(-1)?.text).toBe('Unavailable');
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
});
