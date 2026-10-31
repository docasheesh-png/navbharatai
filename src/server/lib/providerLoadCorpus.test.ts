import { describe, it, expect } from 'vitest';
import { providerLoadCorpus } from './providerLoadCorpus';
// Lives beside the corpus (server tree) so the frontend `tsc --noEmit` graph never pulls src/server in.
describe('provider load corpus', () => {
  it('corpus scales to 10 lakh unique prompts', () => {
    const q = providerLoadCorpus(1_000_000); expect(q).toHaveLength(1_000_000);
    expect(new Set(q.map(x => x.prompt)).size).toBe(1_000_000);
    expect(() => providerLoadCorpus(1_000_001)).toThrow();
  });
});
