import { describe, it, expect } from 'vitest';
import { weakScopeChatTerminal, weakScopeCatchResult } from '../src/server/AgentV3/weakScopeTerminal';
import { WEAK_SCOPE_STRONG, WEAK_SCOPE_UNAVAILABLE } from '../src/lib/weakScopeGuidance';

describe('weakScopeTerminal', () => {
  it('passes through a normal chat turn without a guidance code', () => {
    const t = weakScopeChatTerminal({ blocked: false, admission: null, reply: 'hi', now: 1 });
    expect(t.done).toEqual({ type: 'done', ok: true, summary: 'hi', ts: 1 });
    expect(t.result).toEqual({ type: 'result', ok: true, summary: 'hi', steps: 0, billedUsd: 0, billedInr: 0 });
  });

  it('attaches WEAK_SCOPE_* when blocked', () => {
    const strong = weakScopeChatTerminal({
      blocked: true,
      admission: { scope: 'strong', source: 'model' },
      reply: 'pick a module',
      now: 2,
    });
    expect(strong.done).toMatchObject({ ok: false, code: WEAK_SCOPE_STRONG });
    expect(strong.result).toMatchObject({ ok: false, code: WEAK_SCOPE_STRONG, billedUsd: 0 });
    expect(weakScopeCatchResult({ scope: null, source: 'unavailable' }).code).toBe(WEAK_SCOPE_UNAVAILABLE);
  });
});
