import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ selected: true, grounding: vi.fn(), embedding: vi.fn(), context: vi.fn(), guard: vi.fn() }));
vi.mock('./runtime', () => ({ isGatewayRouteSelected: () => mock.selected, maybeGatewayGrounding: mock.grounding, maybeGatewayEmbedding: mock.embedding, currentInferenceGatewayContext: mock.context,
 InferenceGatewayTerminalError: class extends Error { readonly code = 'INFERENCE_GATEWAY_TERMINAL'; } }));
vi.mock('./dispatchBoundary', () => ({ assertNoUnclaimedGatewayDispatch: mock.guard }));
import { liveSearchContext } from '../../lib/liveSearchContext';
import { WebSearch } from '../../AgentV3/WebSearch';
import { embedText } from '../../memory/embeddings';
beforeEach(() => { vi.clearAllMocks(); mock.selected = true; mock.context.mockReturnValue({ signal: new AbortController().signal, deadlineAtMs: Date.now() + 60000 });
 mock.grounding.mockResolvedValue({ results: [{ title: 'Source', url: 'https://example.com/current', description: 'Current verified source excerpt' }] });
 mock.embedding.mockResolvedValue({ model: 'text-embedding-004', dimensions: 768, values: Array(768).fill(0.1) });
 vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'reviewed-project'); vi.stubEnv('SEMANTIC_MEMORY_PROVIDER', 'vertex'); vi.stubEnv('SEMANTIC_MEMORY_EMBED_MODEL', 'text-embedding-004'); });
afterEach(() => vi.unstubAllEnvs());
it('routes selected fresh questions through claimed search, preserving page enrichment and citations', async () => {
 const legacy = vi.fn(); const live = vi.fn(); const page = vi.fn(async () => ({ ok: true, text: 'Full source page' }));
 const result = await liveSearchContext('latest India news', { client: { search: legacy }, liveData: live, fetchPage: page });
 expect(mock.grounding).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled(); expect(live).not.toHaveBeenCalled();
 expect(result).toContain('Current verified source excerpt'); expect(result).toContain('Full source page'); expect(result).toContain('https://example.com/current');
 expect(page).toHaveBeenCalledOnce(); expect(mock.guard).not.toHaveBeenCalled();
});
it('does not spend on ordinary non-current conversation', async () => {
 expect(await liveSearchContext('hello')).toBe(''); expect(mock.grounding).not.toHaveBeenCalled();
});
it('never silently falls back to legacy search or empty grounding on a selected authority error', async () => {
 const legacy = vi.fn(); mock.grounding.mockRejectedValue(Error('authority unavailable'));
 await expect(liveSearchContext('latest news', { client: { search: legacy } })).rejects.toThrow(); expect(legacy).not.toHaveBeenCalled();
});
it('preserves legacy source dispatch when unselected', async () => {
 mock.selected = false; const live = vi.fn(async () => 'Current live source');
 expect(await liveSearchContext('weather today', { liveData: live })).toBe('Current live source');
 expect(mock.grounding).not.toHaveBeenCalled(); expect(mock.guard).toHaveBeenCalledWith('grounding-search');
});
it('preserves trimmed text, backend and vector identity through the claimed embedding adapter', async () => {
 const result = await embedText('  remembered text  ');
 expect(result).toHaveLength(768); expect(mock.embedding).toHaveBeenCalledWith('remembered text', expect.objectContaining({ signal: expect.any(AbortSignal) }));
 expect(mock.guard).not.toHaveBeenCalled();
});
it.each(['model', 'backend', 'dimension', 'response-model'])('never substitutes embedding %s', async change => {
 if (change === 'model') vi.stubEnv('SEMANTIC_MEMORY_EMBED_MODEL', 'another-model');
 if (change === 'backend') { vi.stubEnv('SEMANTIC_MEMORY_PROVIDER', 'gemini'); vi.stubEnv('GEMINI_API_KEY', 'synthetic-key'); }
 if (change === 'dimension') mock.embedding.mockResolvedValue({ model: 'text-embedding-004', dimensions: 256, values: Array(256).fill(0.1) });
 if (change === 'response-model') mock.embedding.mockResolvedValue({ model: 'other', dimensions: 768, values: Array(768).fill(0.1) });
 await expect(embedText('remember')).rejects.toThrow();
 if (change === 'model' || change === 'backend') expect(mock.embedding).not.toHaveBeenCalled();
});
it('does not silently drop selected memory when the shared budget rejects it', async () => {
 mock.embedding.mockRejectedValue(Error('budget unavailable'));
 await expect(embedText('remember')).rejects.toThrow(); expect(mock.guard).not.toHaveBeenCalled();
});
it('does not dispatch empty embedding content', async () => {
 expect(await embedText('  ')).toBeNull(); expect(mock.embedding).not.toHaveBeenCalled();
});

it('routes selected search tools through the same claimed operation instead of legacy providers', async () => {
 const result = await new WebSearch().search('public reference', 3);
 expect(result).toEqual([{ title: 'Source', url: 'https://example.com/current', snippet: 'Current verified source excerpt' }]);
 expect(mock.grounding).toHaveBeenCalledWith('public reference', expect.objectContaining({ maxResults: 3 }));
 expect(mock.guard).not.toHaveBeenCalled();
});

it('does not begin page enrichment when search completes after parent cancellation', async () => {
 const c = new AbortController(); mock.context.mockReturnValue({ signal: c.signal, deadlineAtMs: Date.now() + 60000 });
 mock.grounding.mockImplementation(async () => { c.abort(); return { results: [{ title: 'Source', url: 'https://example.com', description: 'snippet' }] }; });
 const page = vi.fn();
 await liveSearchContext('latest news', { fetchPage: page });
 expect(page).not.toHaveBeenCalled();
});
