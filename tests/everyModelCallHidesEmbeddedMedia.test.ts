// EVERY MODEL CALL PASSES ONE DOOR THAT HIDES EMBEDDED MEDIA (single-file game autopsy, 2026-11-14; closes Q-2666).
// #4203 proved it for `AgentRunner`. The fast lane, one-shot builder, judges and surplus runners build their own prompts and
// reach a model through a LEAF runner — so the elision is at the leaves, and this census names every leaf.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { elideTurnParams } from '../src/server/AgentV3/elideTurnMedia';
import { buildGameFixture, longBase64Runs } from './helpers/singleFileGameFixture';

const GAME = buildGameFixture().html;

describe('elideTurnParams', () => {
  it('hides media in a string request, in text blocks and in a tool result — and keeps the code', () => {
    const p = elideTurnParams({
      system: 'You are a builder.',
      messages: [
        { role: 'user', content: 'edit this:\n' + GAME },
        { role: 'user', content: [{ type: 'text', text: GAME }, { type: 'tool_result', tool_use_id: 't', content: GAME }] },
      ],
    });
    const all = JSON.stringify(p.messages);
    expect(longBase64Runs(all, 200)).toEqual([]);
    expect(all).toContain('addShelfItem');
    expect(all).toContain('media omitted');
  });
  it('NEVER touches a picture the user meant the model to see (vision blocks)', () => {
    const shot = 'iVBORw0KGgo' + 'A'.repeat(6000);
    const messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot } }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + shot } }] }];
    expect(elideTurnParams({ messages }).messages).toBe(messages);
  });
  it('returns the SAME object when there is nothing to hide, and survives garbage', () => {
    const params = { messages: [{ role: 'user', content: 'hello' }], system: 's' };
    expect(elideTurnParams(params)).toBe(params);
    expect(() => elideTurnParams({} as never)).not.toThrow();
    expect(() => elideTurnParams({ messages: null as never })).not.toThrow();
  });
});

describe('CENSUS: every leaf runner that calls a provider hides media first', () => {
  const root = join(__dirname, '..', 'src/server');
  /** A "leaf" calls a provider itself; wrappers (stop signal, language, pacing, accounting, fail-open) pass through to one. */
  const LEAVES: Record<string, string> = {
    'AgentV3/ClaudeClient.ts': 'the Anthropic client',
    'AgentV3/providers/OpenAiToolRunner.ts': 'OpenAI-compatible providers',
    'AgentV3/providers/GeminiToolRunner.ts': 'Gemini',
    'AgentV3/providers/SurplusTurnRunner.ts': 'surplus models',
  };
  it('each named leaf calls elideTurnParams in its runTurn', () => {
    for (const rel of Object.keys(LEAVES)) {
      const text = readFileSync(join(root, rel), 'utf8');
      expect(/params = elideTurnParams\(params\);/.test(text), rel).toBe(true);
    }
  });
  it('a NEW class that implements TurnRunner and calls a provider must be added to LEAVES (or be a wrapper)', () => {
    const wrappers = new Set(['AgentV3/providers/MultiProviderTurnRunner.ts', 'AgentV3/replyLanguageBinding.ts', 'AgentV3/answerNotDeliberate.ts', 'AgentV3/stopSignal.ts', 'AgentV3/recordedTextCall.ts', 'AI/RouterOne/catalogueAccounting.ts', 'AI/SurplusRegistry/buildSession.ts', 'AI/SurplusRegistry/surplusPreWriteFailOpen.ts', 'AI/SurplusRegistry/scopeAdmission.ts', 'routes/agentv3Resilient.ts', 'routes/agentv3.ts', 'AgentV3/judgeChain.ts']);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
        if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
        const rel = relative(root, p).replace(/\\/g, '/');
        if (rel in LEAVES || wrappers.has(rel)) continue;
        const text = readFileSync(p, 'utf8');
        // a provider call: an SDK's chat/messages/generate call from inside a runTurn
        if (/async runTurn\s*\(/.test(text) && /(chat\.completions\.create|messages\.(create|stream)|generateContent)\s*\(/.test(text)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders, 'a runner that calls a provider must hide embedded media: add it to LEAVES and call elideTurnParams').toEqual([]);
  });
});
