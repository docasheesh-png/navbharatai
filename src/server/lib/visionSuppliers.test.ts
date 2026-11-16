import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseCheaperVisionCatalog, pickCheaperVisionModel, pickQubaxVisionRow, QUBAX_VISION_MODELS,
  setVisionSupplierDepsForTests, tryCheaperInferenceVision, tryQubaxVision,
} from './visionSuppliers';

const png = { name: 'a.png', type: 'image/png', base64: 'iVBORw0KGgo=' };
const pdf = { name: 'a.pdf', type: 'application/pdf', base64: 'JVBERi0=' };
const opts = { prompt: 'what is in this photo?' };

function fakeStore() {
  const reservation = { id: 'r1', mayDispatch: true } as any;
  return { reservePaid: vi.fn(async () => reservation), settlePaid: vi.fn(async () => true), reservation };
}
const feedDb = (rows: unknown[]) => async () => rows as any;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { setVisionSupplierDepsForTests(null); vi.restoreAllMocks(); });

describe('Qubax vision: only documented image-reading MULTIMODAL rows', () => {
  const row = (label: string, modality = 'multimodal', inputNanoUsd = 100_000_000, outputNanoUsd = 400_000_000) =>
    ({ sourceModelLabel: label, modality, inputNanoUsd, outputNanoUsd });
  it('ignores text rows, unknown families and unpriced rows; picks the cheapest for the request', () => {
    const picked = pickQubaxVisionRow([
      row('deepseek-v4-flash', 'multimodal', 1, 1), row('gemini-2.5-flash', 'text', 1, 1),
      row('gemini-2.5-flash'), row('gemma-3-12b-it', 'multimodal', 40_000_000, 80_000_000),
      { ...row('gemma-3-27b-it'), inputNanoUsd: null },
    ], 2_000);
    expect(picked?.modelId).toBe('gemma-3-12b-it');
    expect(QUBAX_VISION_MODELS).not.toContain('deepseek-v4-flash');
  });
  it('is default-on (switch unset), holds before dispatch, settles to reported tokens, and returns text only', async () => {
    const store = fakeStore();
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe('gemini-2.5-flash-lite');
      expect(body.messages.at(-1).content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
      return json({ choices: [{ message: { content: ' a red bicycle ' } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    });
    setVisionSupplierDepsForTests({ fetch: fetchImpl as any, store: () => store, qubaxRows: feedDb([row('gemini-2.5-flash-lite')]) });
    const out = await tryQubaxVision([png], opts, { QUBAX_API_KEY: 'k' } as any);
    expect(out).toEqual({ text: 'a red bicycle', model: 'gemini-2.5-flash-lite' });
    expect(store.reservePaid).toHaveBeenCalledOnce();
    // 1000 × $0.10/M + 100 × $0.40/M = $0.00014
    expect(store.settlePaid).toHaveBeenCalledWith(store.reservation, 140_000);
  });
  it('kill switch off, missing key, or a PDF batch never calls Qubax', async () => {
    const fetchImpl = vi.fn();
    setVisionSupplierDepsForTests({ fetch: fetchImpl as any, store: () => fakeStore(), qubaxRows: feedDb([row('gemini-2.5-flash')]) });
    expect(await tryQubaxVision([png], opts, { QUBAX_API_KEY: 'k', QUBAX_ENABLED: 'off' } as any)).toBeNull();
    expect(await tryQubaxVision([png], opts, {} as any)).toBeNull();
    expect(await tryQubaxVision([png, pdf], opts, { QUBAX_API_KEY: 'k' } as any)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('a failed call returns null (the chain falls through) and keeps the hold when nothing proves the cost', async () => {
    const store = fakeStore();
    setVisionSupplierDepsForTests({ fetch: (async () => json({ error: 'busy' }, 503)) as any, store: () => store, qubaxRows: feedDb([row('gemini-2.5-flash')]) });
    expect(await tryQubaxVision([png], opts, { QUBAX_API_KEY: 'k' } as any)).toBeNull();
    expect(store.settlePaid).not.toHaveBeenCalled();
  });
  it('no dispatch when the shared budget refuses', async () => {
    const fetchImpl = vi.fn();
    const store = { reservePaid: vi.fn(async () => ({ id: 'r', mayDispatch: false })), settlePaid: vi.fn() };
    setVisionSupplierDepsForTests({ fetch: fetchImpl as any, store: () => store as any, qubaxRows: feedDb([row('gemini-2.5-flash')]) });
    expect(await tryQubaxVision([png], opts, { QUBAX_API_KEY: 'k' } as any)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('CheaperInference vision: the catalog capability flag is the authority', () => {
  const catalog = { data: [
    { id: 'text-only', type: 'text', capabilities: { vision: false }, pricing: { input_per_million: '0.01', output_per_million: '0.02' } },
    { id: 'vision-think', type: 'text', capabilities: { vision: true, reasoning: true }, pricing: { input_per_million: '0.01', output_per_million: '0.02' } },
    { id: 'vision-cheap', type: 'text', endpoint: '/v1/chat/completions', capabilities: { vision: true }, pricing: { currency: 'USD', input_per_million: '0.05', output_per_million: '0.2' } },
    { id: 'vision-unpriced', type: 'text', capabilities: { vision: true }, pricing: {} },
  ] };
  it('keeps only priced vision rows and prefers non-reasoning models', () => {
    const models = parseCheaperVisionCatalog(catalog);
    expect(models.map(m => m.id).sort()).toEqual(['vision-cheap', 'vision-think']);
    expect(pickCheaperVisionModel(models, 2_000)?.id).toBe('vision-cheap');
  });
  it('is default-on for everyone (switch unset), and settles to the billed receipt', async () => {
    const store = fakeStore();
    const fetchImpl = vi.fn(async (url: string) => String(url).includes('/models')
      ? json(catalog)
      : json({ choices: [{ message: { content: 'a cat' } }], billing: { status: 'settled', currency: 'USD', billed_cost_usd: '0.000123' } }));
    setVisionSupplierDepsForTests({ fetch: fetchImpl as any, store: () => store, qubaxRows: async () => [] });
    const out = await tryCheaperInferenceVision([png], opts, { CHEAPERINFERENCE_API_KEY: 'ci_test' } as any);
    expect(out?.text).toBe('a cat');
    expect(store.settlePaid).toHaveBeenCalledWith(store.reservation, 123_000);
  });
  it('CHEAPERINFERENCE=off is the only switch that stops it', async () => {
    const fetchImpl = vi.fn();
    setVisionSupplierDepsForTests({ fetch: fetchImpl as any, store: () => fakeStore(), qubaxRows: async () => [] });
    expect(await tryCheaperInferenceVision([png], opts, { CHEAPERINFERENCE_API_KEY: 'ci_test', CHEAPERINFERENCE: 'off' } as any)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('no vision model in the catalog → null without a paid call', async () => {
    const store = fakeStore();
    setVisionSupplierDepsForTests({ fetch: (async () => json({ data: [catalog.data[0]] })) as any, store: () => store, qubaxRows: async () => [] });
    expect(await tryCheaperInferenceVision([png], opts, { CHEAPERINFERENCE_API_KEY: 'ci_test' } as any)).toBeNull();
    expect(store.reservePaid).not.toHaveBeenCalled();
  });
});
