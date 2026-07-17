import { describe, it, expect, afterEach } from 'vitest';
import { selectBackend, embeddingsAvailable } from './embeddings';

// selectBackend/embeddingsAvailable are pure over env (the SDK is only imported lazily inside the
// actual embed call), so we can test the routing without any network or credentials.
describe('embedding backend selection', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  const clearAll = () => {
    delete process.env.SEMANTIC_MEMORY_PROVIDER;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  };

  it('defaults to Vertex when a project is set (spend the Vertex credit)', () => {
    clearAll();
    process.env.GOOGLE_CLOUD_PROJECT = 'gen-lang-client-0866594388';
    expect(selectBackend()).toBe('vertex');
    expect(embeddingsAvailable()).toBe(true);
  });

  it('falls back to Gemini when only an API key is present', () => {
    clearAll();
    process.env.GEMINI_API_KEY = 'AIza-test';
    expect(selectBackend()).toBe('gemini');
    expect(embeddingsAvailable()).toBe(true);
  });

  it('prefers Vertex over Gemini by default when both are configured', () => {
    clearAll();
    process.env.GOOGLE_CLOUD_PROJECT = 'proj';
    process.env.GEMINI_API_KEY = 'AIza-test';
    expect(selectBackend()).toBe('vertex');
  });

  it('an explicit SEMANTIC_MEMORY_PROVIDER=gemini forces Gemini even with a project set', () => {
    clearAll();
    process.env.GOOGLE_CLOUD_PROJECT = 'proj';
    process.env.GEMINI_API_KEY = 'AIza-test';
    process.env.SEMANTIC_MEMORY_PROVIDER = 'gemini';
    expect(selectBackend()).toBe('gemini');
  });

  it('an explicit provider that is NOT configured falls through to what IS available', () => {
    clearAll();
    process.env.GEMINI_API_KEY = 'AIza-test';
    process.env.SEMANTIC_MEMORY_PROVIDER = 'vertex'; // forced vertex but no project → fall through
    expect(selectBackend()).toBe('gemini');
  });

  it('returns null / unavailable when nothing is configured', () => {
    clearAll();
    expect(selectBackend()).toBeNull();
    expect(embeddingsAvailable()).toBe(false);
  });
});
