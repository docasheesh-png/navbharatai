// AN AI APP NEEDS NO KEY WHEN THE GATEWAY IS ON (admin 2026-09-30, choice "B"; autopsy d8ed307a).
//
// A Bengali "personal AI assistant" shipped asking its owner for an OpenAI key. The platform already
// had a keyless route (`APP_AI_GATEWAY` + `generate_ai` provider "navbharat"), but no builder was told
// to take it, and the specialist that wrote the AI client never saw any AI rule at all.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AI_IN_APP_RULE, GATEWAY_AI_RULE, aiInAppRule, architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { resolveAiProvider } from '../src/server/lib/AiGenerator';

describe('which AI route a builder is told to take', () => {
  it('gateway off: the rule is exactly today\'s, byte for byte', () => {
    expect(aiInAppRule({} as NodeJS.ProcessEnv)).toBe(AI_IN_APP_RULE);
    expect(aiInAppRule({ APP_AI_GATEWAY: 'yes' } as NodeJS.ProcessEnv)).toBe(AI_IN_APP_RULE);
  });

  it('gateway on: the keyless route comes first, the server rule stays for apps with a server', () => {
    const r = aiInAppRule({ APP_AI_GATEWAY: 'on' } as NodeJS.ProcessEnv);
    expect(r.startsWith(GATEWAY_AI_RULE)).toBe(true);
    expect(r).toContain(AI_IN_APP_RULE);
    expect(GATEWAY_AI_RULE).toMatch(/run_recipe with name "generate_ai" and input \{ "provider": "navbharat" \}/);
    expect(GATEWAY_AI_RULE).toMatch(/do NOT ask for an API key/);
    expect(GATEWAY_AI_RULE).toMatch(/after they PUBLISH, not in the preview/);
  });

  it('the recipe it names really resolves to the keyless provider', () => {
    expect(resolveAiProvider('navbharat', true)).toBe('navbharat');
    expect(resolveAiProvider(undefined, true)).toBe('navbharat');
  });

  it('the architect prompt reads the deployment\'s rule, not a fixed one', () => {
    const prev = process.env.APP_AI_GATEWAY;
    try {
      delete process.env.APP_AI_GATEWAY;
      expect(architectSystemPrompt()).not.toContain(GATEWAY_AI_RULE);
      process.env.APP_AI_GATEWAY = 'on';
      expect(architectSystemPrompt()).toContain(GATEWAY_AI_RULE);
    } finally {
      if (prev === undefined) delete process.env.APP_AI_GATEWAY; else process.env.APP_AI_GATEWAY = prev;
    }
  });

  it('the specialist that writes the AI client hears the same rule', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/aiRule: \(\) => aiInAppRule\(\),/);
    const sub = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');
    expect(sub).toMatch(/deps\.aiRule\?\.\(\)/);
  });
});
