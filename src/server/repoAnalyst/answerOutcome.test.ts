import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ fetchRepo: vi.fn(), gemini: vi.fn(), groq: vi.fn() }));
vi.mock('../lib/aiCalls', () => ({ callGemini: m.gemini, callGroq: m.groq }));
vi.mock('./githubFetch', async original => ({ ...await original<typeof import('./githubFetch')>(), fetchPublicRepo: m.fetchRepo }));
import { runRepoAnalystChat } from './analyst';
import { runRepoImprovementGen } from './generate';
const snapshot = { ref: { owner: 'acme', repo: 'widget' }, url: 'https://github.com/acme/widget', defaultBranch: 'main', stars: 1, forks: 0, openIssues: 0,
 license: 'MIT', languages: ['TypeScript'], topics: [], tree: ['src/index.ts'], readme: 'Real fetched fixture content', keyFiles: [], notes: [] };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('INFERENCE_GATEWAY_ENABLED', 'off'); m.fetchRepo.mockResolvedValue(snapshot); m.gemini.mockResolvedValue('A real answer'); });
afterEach(() => vi.unstubAllEnvs());
it('general analyst provider answer is reported exactly once', async () => {
 const onAnswer = vi.fn(); const beforeGeneration = vi.fn();
 await runRepoAnalystChat('How does this work?', [], undefined, { onAnswer, beforeGeneration });
 expect(beforeGeneration).toHaveBeenCalled(); expect(onAnswer).toHaveBeenCalledOnce(); expect(m.gemini).toHaveBeenCalledOnce();
});
it.each([runRepoAnalystChat, runRepoImprovementGen])('fetch failure is not an answer credit', async run => {
 m.fetchRepo.mockRejectedValue(new Error('Repository unavailable')); const onAnswer = vi.fn();
 await run('analyse acme/widget', [], undefined, { onAnswer }); expect(onAnswer).not.toHaveBeenCalled(); expect(m.gemini).not.toHaveBeenCalled();
});
it('improver static repository guidance is not an answer credit', async () => {
 const onAnswer = vi.fn(); await runRepoImprovementGen('hello', [], undefined, { onAnswer }); expect(onAnswer).not.toHaveBeenCalled(); expect(m.gemini).not.toHaveBeenCalled();
});
it.each([runRepoAnalystChat, runRepoImprovementGen])('lease is fenced after repository fetch and before model dispatch', async run => {
 const beforeGeneration = vi.fn(() => { throw new Error('lease expired'); }); const onAnswer = vi.fn();
 await expect(run('analyse acme/widget', [], undefined, { beforeGeneration, onAnswer })).rejects.toThrow('lease expired');
 expect(m.fetchRepo).toHaveBeenCalledOnce(); expect(m.gemini).not.toHaveBeenCalled(); expect(onAnswer).not.toHaveBeenCalled();
});
it('a usable generated artifact reports one answer', async () => {
 m.gemini.mockResolvedValue('=== FILE: tests/check.ts ===\nexport const checked = true;\n=== END FILE ==='); const onAnswer = vi.fn();
 const result = await runRepoImprovementGen('improve acme/widget', [], undefined, { onAnswer });
 expect(result.files).toHaveLength(1); expect(onAnswer).toHaveBeenCalledOnce();
});

it.each([runRepoAnalystChat, runRepoImprovementGen])('cancelled primary does not fall through to a second provider', async run => {
 const controller = new AbortController(); m.gemini.mockImplementation(async () => { controller.abort(); throw new Error('primary cancelled'); });
 const onAnswer = vi.fn(); await expect(run('analyse acme/widget', [], undefined, { signal: controller.signal, onAnswer })).rejects.toThrow();
 expect(m.groq).not.toHaveBeenCalled(); expect(onAnswer).not.toHaveBeenCalled();
});
