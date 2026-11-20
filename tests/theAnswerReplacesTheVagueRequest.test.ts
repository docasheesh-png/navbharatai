// failedbr #1357 (2026-11-20): after our one question, the build prompt was "All GTA V game app\nMake a i videos kahani app
// for youtubers…". Every reader saw GTA first — "clone of GTA", game domain, a game kit — and the user's answer was never
// the subject.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestGuessPrompt } from '../src/server/AgentV3/clarityGate';
import { mentionsBuildNoun } from '../src/server/AgentV3/IntentClassifier';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';

const FIRST = 'All GTA V game app';
const REPLY = 'Make a i videos kahani app for youtubers they are make own on storie';

describe('the answer to our question is the request when it names an app (failedbr #1357)', () => {
  it('the reported reply leads alone, and is no longer read as a GTA clone', () => {
    expect(mentionsBuildNoun(REPLY.toLowerCase())).toBe(true);
    const p = bestGuessPrompt(FIRST, REPLY, mentionsBuildNoun(REPLY.toLowerCase()));
    expect(p.startsWith(REPLY)).toBe(true);
    expect(p).not.toContain('GTA');
    expect((analyzeAppScope(p) as { famousApp?: string }).famousApp).not.toBe('GTA');
  });
  it('a reply that names nothing keeps the first request', () => {
    for (const r of ['haan', 'jo tumhe theek lage']) {
      expect(mentionsBuildNoun(r)).toBe(false);
      expect(bestGuessPrompt(FIRST, r, mentionsBuildNoun(r)).startsWith(`${FIRST}\n${r}`)).toBe(true);
    }
  });
  it('🔒 the route passes the reply\'s own answer', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('bestGuessPrompt(lastRequestTurn.text, typedPrompt, mentionsBuildNoun(typedPrompt.toLowerCase()))');
  });
});
