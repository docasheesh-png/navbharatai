import { describe, it, expect } from 'vitest';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * White-Label Law — the user must NEVER learn which third-party model builds their app. The KB is read by
 * user-facing AIs (Free Chat, Pro Chat, the Professionals) to answer questions, so a KB entry that names a
 * backend model can leak it into a user-facing reply. This locks the flagship user-facing entries so they
 * describe NavBharatAI's own "engine/tiers" without naming GLM / Kimi / Claude / Sonnet / Opus / Gemini / Grok.
 *
 * DELIBERATELY NOT COVERED (both legitimate, do not "fix"):
 *  • Admin-only entries (Live Metrics, the v5.0 Cost-Ladder) — provider names are allowed on admin surfaces.
 *  • "Bring your own AI provider for YOUR app" (Brain Engine / the generateText helper) — there the user is
 *    choosing to add OpenAI / Anthropic / Gemini to their OWN app; that is not our build engine.
 */
const BACKEND_MODELS = /\bGLM\b|\bKimi\b|\bClaude\b|\bSonnet\b|\bOpus\b|\bGemini\b|\bGrok\b/;
const surfaceText = (id: string) => {
  const e = APP_KNOWLEDGE_BASE.find((f) => f.id === id)!;
  return `${e.name} ${e.path} ${e.description ?? ''} ${e.howToUse ?? ''}`;
};

describe('agentv3_builder (the power-tier / billing explainer) names no backend model', () => {
  it('describes tiers + billing as NavBharatAI engines, not GLM/Kimi/Claude/Sonnet/Opus/Gemini/Grok', () => {
    const t = surfaceText('agentv3_builder');
    const hit = t.match(BACKEND_MODELS);
    expect(hit, hit ? `leaked "${hit[0]}"` : '').toBeNull();
  });
});

describe('No "Claude Code" positioning leak in user-facing build entries', () => {
  it.each(['agentv3_github_storage', 'auto-test-generation'])('%s does not mention "Claude Code"', (id) => {
    expect(surfaceText(id)).not.toMatch(/Claude Code/);
  });
});
