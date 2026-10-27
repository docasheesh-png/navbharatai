import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComparisonClient, executeComparisonCase, checkComparisonText, DEEPINFRA_BASE_URL } from './deepinfraComparisonClient';
import { COMPARISON_CASES, DEEPINFRA_COMPARISON_MODELS } from '../../lib/deepinfraComparison';
const model = DEEPINFRA_COMPARISON_MODELS[0];
const signal = () => new AbortController().signal;
const response = (content: string, extra = {}) => new Response(JSON.stringify({ id: 'synthetic', object: 'chat.completion', model,
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 12, completion_tokens: 8 }, ...extra }), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('fixed DeepInfra comparison requests', () => {
  it('checks concrete answers and parses requested code without executing it', () => {
    expect(checkComparisonText('math', '391')).toBe(true); expect(checkComparisonText('math', '392')).toBe(false);
    expect(checkComparisonText('hindi', 'भारत की राजधानी नई दिल्ली है।')).toBe(true);
    expect(checkComparisonText('hindi', 'New Delhi')).toBe(false);
    expect(checkComparisonText('json', '{"name":"NavbharatAI","languages":["hi","en"]}')).toBe(true);
    expect(checkComparisonText('json', '{"name":"NavbharatAI","languages":["hi","en"],"extra":true}')).toBe(false);
    expect(checkComparisonText('typescript', 'export function add(a:number,b:number):number{return a+b;}')).toBe(true);
    for (const code of ['export function add(a:number,b:number):number{return a-b;}', 'export function add(a:number,b:number):number{return a+b;} fetch("https://evil.test");', '```typescript\nexport function add(a:number,b:number):number{return a+b;}\n```']) expect(checkComparisonText('typescript', code)).toBe(false);
    for (const code of ['export async function add(a:number,b:number):number{return a+b;}', 'export function* add(a:number,b:number):number{return a+b;}', 'export function add(a?:number,b:number):number{return a+b;}', 'export function add(a:number=0,b:number):number{return a+b;}']) expect(checkComparisonText('typescript', code)).toBe(false);
  });
  it('pins endpoint and model, disables SDK retries, and strips ambient custom headers', async () => {
    vi.stubEnv('OPENAI_CUSTOM_HEADERS', 'Authorization: Bearer unrelated-secret\nX-Secret: private');
    const fetcher = vi.fn(async () => response('391')); vi.stubGlobal('fetch', fetcher);
    const observed = await executeComparisonCase(createComparisonClient('synthetic-key'), model, 'math', signal());
    expect(observed).toMatchObject({ passed: true, inputTokens: 12, outputTokens: 8 });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(`${DEEPINFRA_BASE_URL}/chat/completions`);
    expect(init.redirect).toBe('error'); expect(init.headers).toEqual({ Authorization: 'Bearer synthetic-key', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' });
    expect(JSON.parse(init.body as string)).toMatchObject({ model, reasoning_effort: 'none', max_tokens: 512, stream: false });
  });
  it('consumes SSE, including the final usage-only chunk and terminal marker', async () => {
    const chunks = [
      { model, choices: [{ delta: { content: 'NAVBHARAT_' }, finish_reason: null }] },
      { model, choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] },
      { model, choices: [], usage: { prompt_tokens: 7, completion_tokens: 4 } },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
    const result = await executeComparisonCase(createComparisonClient('synthetic'), model, 'stream', signal());
    expect(result).toMatchObject({ passed: true, inputTokens: 7, outputTokens: 4 }); expect(result.firstTokenMs).not.toBeNull();
  });
  it('does not accept a clean stream EOF without a terminal completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${JSON.stringify({ model, choices: [{ delta: { content: 'NAVBHARAT_OK' } }], usage: { prompt_tokens: 3, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })));
    expect(await executeComparisonCase(createComparisonClient('synthetic'), model, 'stream', signal())).toMatchObject({ passed: false, inputTokens: null, outputTokens: null });
  });
  it('does not settle an intermediate usage sample after more unmeasured text arrives', async () => {
    const chunks = [
      { model, choices: [{ delta: { content: 'NAVBHARAT_' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
      { model, choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
    expect(await executeComparisonCase(createComparisonClient('synthetic'), model, 'stream', signal())).toMatchObject({ passed: true, inputTokens: null, outputTokens: null });
  });
  it('checks tool name and arguments rather than treating any HTTP 200 as a pass', async () => {
    const answer = (city: string) => response('', { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'call', type: 'function', function: { name: 'get_weather', arguments: JSON.stringify({ city }) } }] } }] });
    const fetcher = vi.fn().mockResolvedValueOnce(answer('Jaipur')).mockResolvedValueOnce(answer('Delhi')); vi.stubGlobal('fetch', fetcher);
    const client = createComparisonClient('synthetic');
    expect((await executeComparisonCase(client, model, 'tool', signal())).passed).toBe(true);
    expect((await executeComparisonCase(client, model, 'tool', signal())).passed).toBe(false);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ tool_choice: { type: 'function', function: { name: 'get_weather' } } });
  });
  it('treats 429 as a failed measured attempt and makes no automatic retry or raw-error disclosure', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'secret-token-value', type: 'rate_limit_exceeded' } }), { status: 429, headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
    const result = await executeComparisonCase(createComparisonClient('synthetic'), model, 'math', signal());
    expect(result).toMatchObject({ passed: false, reason: 'rate-limit', inputTokens: null, outputTokens: null });
    expect(fetcher).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain('secret-token-value');
  });
  it('missing usage remains unknown and cannot turn into a zero-dollar measurement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('391', { usage: undefined })));
    expect(await executeComparisonCase(createComparisonClient('synthetic'), model, 'math', signal())).toMatchObject({ passed: true, inputTokens: null, outputTokens: null });
  });
  it('rejects an answer attributed to a different model, even when the answer is correct', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('391', { model: 'another-model' })));
    expect(await executeComparisonCase(createComparisonClient('synthetic'), model, 'math', signal())).toMatchObject({ passed: false, reason: 'model-mismatch', inputTokens: null, outputTokens: null });
  });
  it('an aborted run sends no inference request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const abort = new AbortController(); abort.abort();
    expect((await executeComparisonCase(createComparisonClient('synthetic'), model, 'math', abort.signal)).reason).toBe('cancelled');
    expect(fetcher).not.toHaveBeenCalled(); expect(COMPARISON_CASES).toHaveLength(6);
  });
});
