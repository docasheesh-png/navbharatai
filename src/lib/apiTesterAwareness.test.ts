import { describe, it, expect } from 'vitest';
import { AppContextInjector } from '../server/AppContext/AppContextInjector';
import { APP_KNOWLEDGE_BASE } from '../server/AppContext/AppKnowledgeBase';
import { searchFeatures, navFor } from './offlineAssistant';
import { apiTesterHintFor } from '../server/AgentV3/RuntimeErrorClassify';

// AWARENESS LOCK (admin 2026-07-24: "API Tester ke bare me NavBharatAI/Pro/v5/Offline ko pata hai?").
// Every AI shares ONE source of truth — APP_KNOWLEDGE_BASE. Online AIs read it via
// AppContextInjector.getRelevantContext; the OFFLINE AI imports the same array. This proves the API Tester
// is discoverable everywhere AND that v5 proactively points users to it when an API call fails.

const api = APP_KNOWLEDGE_BASE.find(f => f.id === 'api-tester');
const runner = APP_KNOWLEDGE_BASE.find(f => f.id === 'code-testing-panel');

describe('API Tester — AI awareness (Free · Pro · Offline)', () => {
  it('lives in the shared KB with the CURRENT path (moved out of Code Studio)', () => {
    expect(api).toBeTruthy();
    expect(api!.path).toContain('Other AI → AI Tools → API Tester');
    expect(api!.path).not.toContain('Code Studio');
  });

  it('Free (nbi_chat) AND Pro (pro_chat) chat inject the API Tester for real API-problem queries', () => {
    for (const surface of ['nbi_chat', 'pro_chat']) {
      for (const q of ['api tester', 'my api is not working', 'test my api endpoint', 'api fail ho raha hai']) {
        const ctx = AppContextInjector.getRelevantContext(q, surface);
        expect(ctx, `${surface} / "${q}"`).toContain('API Tester');
      }
    }
  });

  it('the OFFLINE AI finds the API Tester (same shared KB, no internet)', () => {
    for (const q of ['api tester', 'test api', 'endpoint not working', 'api chalega ki nahi', 'network error']) {
      const ids = searchFeatures(q).map(m => m.feature.id);
      expect(ids, `offline / "${q}"`).toContain('api-tester');
    }
  });

  it('offers a real one-tap navigation target (never a dead button)', () => {
    expect(navFor(api!)).toEqual({ view: 'api' });
    expect(navFor(runner!)).toEqual({ view: 'testing' });
  });

  it('describes the CURRENT API Tester (CORS-bypass proxy · real response · safe)', () => {
    const text = `${api!.description} ${api!.howToUse}`.toLowerCase();
    expect(text).toContain('cors');
    expect(text).toContain('response');
    expect(text).toMatch(/method|get|post/);
  });
});

describe('v5 proactively suggests the API Tester when an API call fails', () => {
  it('returns the API Tester hint for CORS / HTTP-status / network errors', () => {
    for (const err of [
      'Access to fetch blocked by CORS policy',
      'GET https://api.example.com/users 500 (Internal Server Error)',
      'TypeError: Failed to fetch',
    ]) {
      const hint = apiTesterHintFor([err]);
      expect(hint, err).toContain('API Tester');
      expect(hint, err).toContain('Other AI → AI Tools → API Tester');
    }
  });

  it('stays silent for non-API errors (nudge fires only when relevant)', () => {
    expect(apiTesterHintFor(["Cannot read properties of undefined (reading 'map')"])).toBe('');
    expect(apiTesterHintFor([])).toBe('');
  });

  it('is white-label — never names an underlying provider', () => {
    const hint = apiTesterHintFor(['Failed to fetch']);
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok', 'Anthropic', 'OpenAI']) {
      expect(hint).not.toContain(vendor);
    }
  });
});
