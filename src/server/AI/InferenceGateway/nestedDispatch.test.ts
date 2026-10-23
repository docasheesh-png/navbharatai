import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ googleConstruct: vi.fn(), googleEmbed: vi.fn(), openaiConstruct: vi.fn(), openaiEmbed: vi.fn(), load: vi.fn(), append: vi.fn(), answer: vi.fn(), profileLoad: vi.fn(), verify: vi.fn() }));
vi.mock('../../lib/authMiddleware', async original => ({ ...await original<typeof import('../../lib/authMiddleware')>(), verifyFirebaseToken: m.verify }));
vi.mock('../../professionals/ClientProfileStore', () => ({ clientProfileStore: { load: m.profileLoad } }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { embedContent: m.googleEmbed }; constructor() { m.googleConstruct(); } } }));
vi.mock('openai', () => ({ OpenAI: class { embeddings = { create: m.openaiEmbed }; constructor() { m.openaiConstruct(); } } }));
vi.mock('../../memory/ConversationMemoryStore', () => ({ loadMemory: m.load, appendMemory: m.append }));
vi.mock('../../lib/professionalRouting', () => ({ callProfessionalAIWithUsage: m.answer }));
vi.mock('../../lib/ssrfGuard', () => ({ assertPublicHttpUrl: async () => ({ ok: true }), publicOnlyInit: (input: unknown) => input }));
import type { Request } from 'express';
import { runWithAuthenticatedInferenceGatewayRequest, runWithInferenceGatewayContext } from './runtime';
import { runWithGatewaySelection, InferenceGatewayTerminalError } from './dispatchBoundary';
import { liveSearchContext } from '../../lib/liveSearchContext';
import { WebSearch } from '../../AgentV3/WebSearch';
import { braveSearch, __resetBraveSearch } from '../../lib/braveSearch';
import { embedText } from '../../memory/embeddings';
import { retrieveMemoryBlock, rememberTurn } from '../../memory/conversationMemory';
import { EmbeddingStore } from '../../AgentV3/EmbeddingSearch';
import { runProfessionalChatWithUsage } from '../../professionals/engine';
import { webFetchUrl } from '../../AgentV3/webFetch';
let network: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => { vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE', 'all');
  vi.clearAllMocks(); m.verify.mockResolvedValue('verified-user'); m.profileLoad.mockResolvedValue(null); __resetBraveSearch(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); vi.stubEnv('STRICT_FREE_MODULES_ENABLED', 'off');
  vi.stubEnv('SEMANTIC_MEMORY', 'on'); vi.stubEnv('SEMANTIC_MEMORY_PROVIDER', 'gemini'); vi.stubEnv('GEMINI_API_KEY', 'non-secret-fixture');
  vi.stubEnv('AGENTV3_FILE_EMBEDDINGS', 'on'); vi.stubEnv('BRAVE_API_KEY', 'non-secret-fixture');
  network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('public documentation', { headers: { 'content-type': 'text/plain' } }));
  m.googleEmbed.mockResolvedValue({ embeddings: [{ values: [1, 2] }] }); m.openaiEmbed.mockResolvedValue({ data: [{ embedding: [1, 2] }] });
  m.load.mockResolvedValue([]); m.append.mockResolvedValue(undefined); m.answer.mockResolvedValue({ content: 'answer', spend: {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const selected = <T>(run: () => T) => runWithGatewaySelection(true, run);
const selectedAccount = <T>(run: () => T, deadlineAtMs = Date.now() + 90000, signal?: AbortSignal) => {
  vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'on');
  return runWithAuthenticatedInferenceGatewayRequest({ headers: {} } as Request, () => runWithInferenceGatewayContext({
    principalId: 'verified-user', tenantId: 'verified-user', surface: 'professional', policyKey: 'professional:unreviewed_ai',
    funding: 'platform-free-fallback', qualityTier: 'clinical', dataClass: 'health', mode: 'free-first-authorized-paid', deadlineAtMs, signal,
  }, run));
};
const memory = [{ role: 'user', text: 'Important private remembered details.', ts: Date.now(), embedding: [1, 2] }];
const expert = { id: 'unreviewed_ai', name: 'Expert', systemPrompt: 'Original persona' };
describe('selected nested search and embedding cannot escape their dispatch boundary', () => {
  it('blocks grounding before live-data, injected search or page callbacks', async () => {
    const liveData = vi.fn(), search = vi.fn(), fetchPage = vi.fn();
    await expect(selected(() => liveSearchContext('latest news', { liveData, client: { search }, fetchPage }))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(liveData).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled(); expect(fetchPage).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('keeps non-search ordinary messages a no-op, even under selection', async () => {
    await expect(selected(() => liveSearchContext('hello'))).resolves.toBe(''); expect(network).not.toHaveBeenCalled();
  });
  it.each(['search', 'npmInfo'] as const)('blocks WebSearch.%s before npm/DDG/paid rescue', async method => {
    const client = new WebSearch();
    await expect(selected(() => client[method]('npm react'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(network).not.toHaveBeenCalled();
  });
  it('blocks direct Brave requests before cache/coalescing/dispatch', async () => {
    await expect(selected(() => braveSearch('private question', 3, 'non-secret-fixture'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(network).not.toHaveBeenCalled();
  });
  it('blocks semantic-memory embeddings before SDK construction or a paid call', async () => {
    await expect(selected(() => embedText('Private memory'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(m.googleConstruct).not.toHaveBeenCalled(); expect(m.googleEmbed).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('blocks file embeddings outside the legacy best-effort catch', async () => {
    await expect(selected(() => new EmbeddingStore('non-secret-fixture').embed('source code'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(m.openaiConstruct).not.toHaveBeenCalled(); expect(m.openaiEmbed).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('file search rejects before loading its legacy vector store', async () => {
    const store = new EmbeddingStore('non-secret-fixture', 'workspace'); const hydrate = vi.spyOn(store, 'hydrate');
    await expect(selected(() => store.search('query'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(hydrate).not.toHaveBeenCalled(); expect(m.openaiEmbed).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('trusted nonempty recall does not swallow a selected embedding error after one authorized load', async () => {
    m.load.mockResolvedValue(memory);
    await expect(selectedAccount(() => retrieveMemoryBlock('verified-user', 'expert', 'question'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(m.load).toHaveBeenCalledOnce(); expect(m.googleConstruct).not.toHaveBeenCalled(); expect(m.googleEmbed).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('trusted empty memory performs one authorized load and no inference', async () => {
    await expect(selectedAccount(() => retrieveMemoryBlock('verified-user', 'expert', 'question'))).resolves.toBe('');
    expect(m.load).toHaveBeenCalledOnce(); expect(m.googleConstruct).not.toHaveBeenCalled(); expect(m.googleEmbed).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('bare selection cannot read arbitrary private account memory, even when empty', async () => {
    await expect(selected(() => retrieveMemoryBlock('victim-user', 'expert', 'question'))).rejects.toMatchObject({ reason: 'account-data-unverified' });
    expect(m.load).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('a verified selected account cannot read a different UID or load its profile', async () => {
    await expect(selectedAccount(() => retrieveMemoryBlock('victim-user', 'expert', 'question'))).rejects.toMatchObject({ reason: 'account-data-unverified' });
    await expect(selectedAccount(() => runProfessionalChatWithUsage({ ...expert, memory: {} } as any, 'hello', [], 'victim-user', 'free'))).rejects.toMatchObject({ reason: 'account-data-unverified' });
    expect(m.load).not.toHaveBeenCalled(); expect(m.profileLoad).not.toHaveBeenCalled(); expect(m.answer).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, 0])('rejects invalid/expired account-data deadline %s before store access', async deadline => {
    await expect(selectedAccount(() => retrieveMemoryBlock('verified-user', 'expert', 'question'), deadline)).rejects.toMatchObject({ reason: 'account-data-unverified' });
    expect(m.load).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('rejects cancelled account-data context before store access', async () => {
    await expect(selectedAccount(() => retrieveMemoryBlock('verified-user', 'expert', 'question'), Date.now() + 90000, AbortSignal.abort())).rejects.toMatchObject({ reason: 'account-data-unverified' });
    expect(m.load).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('memory ingest does not swallow the selected terminal error or persist a replacement', async () => {
    await expect(selected(() => rememberTurn('verified-user', 'expert', 'I would like you to remember these important details.', 'These are the important details for our next conversation.'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(m.append).not.toHaveBeenCalled(); expect(m.googleEmbed).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('professional recall cannot quietly degrade into a new model answer', async () => {
    m.load.mockResolvedValue(memory);
    await expect(selectedAccount(() => runProfessionalChatWithUsage(expert, 'hello', [], 'verified-user', 'free'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(m.answer).not.toHaveBeenCalled(); expect(m.load).toHaveBeenCalledOnce(); expect(m.googleConstruct).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('professional grounding cannot quietly degrade into an ungrounded answer', async () => {
    vi.stubEnv('SEMANTIC_MEMORY', 'off');
    await expect(selected(() => runProfessionalChatWithUsage(expert, 'latest news', [], 'verified-user', 'free'))).rejects.toBeInstanceOf(InferenceGatewayTerminalError);
    expect(m.answer).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it('does not disable unselected embedding functions', async () => {
    await expect(embedText('memory')).resolves.toEqual([1, 2]);
    await expect(new EmbeddingStore('non-secret-fixture').embed('source')).resolves.toEqual([1, 2]);
    expect(m.googleEmbed).toHaveBeenCalledOnce(); expect(m.openaiEmbed).toHaveBeenCalledOnce();
  });
  it('does not classify an ordinary public page read as an inference provider', async () => {
    await expect(selected(() => webFetchUrl('https://example.test/docs'))).resolves.toMatchObject({ ok: true, text: 'public documentation' });
    expect(network).toHaveBeenCalledOnce();
  });
});
