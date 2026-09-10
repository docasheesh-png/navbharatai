import { describe, it, expect } from 'vitest';
import { decideDomainMove, OTHER_ACCOUNT_MESSAGE, MOVED_NOTE } from './domainMove';

describe('decideDomainMove — one tap within one account, a refusal across accounts', () => {
  it('no holder, or the same app ⇒ nothing to move', () => {
    expect(decideDomainMove(null, 'ws-b', 'u1')).toEqual({ action: 'none' });
    expect(decideDomainMove(undefined, 'ws-b', 'u1')).toEqual({ action: 'none' });
    expect(decideDomainMove({ workspaceId: 'ws-b', userId: 'u1' }, 'ws-b', 'u1')).toEqual({ action: 'none' });
  });

  it('same user, another app ⇒ move, naming where from', () => {
    expect(decideDomainMove({ workspaceId: 'ws-a', userId: 'u1' }, 'ws-b', 'u1')).toEqual({ action: 'move', from: 'ws-a' });
  });

  it('🔒 another account ⇒ refuse, and the message names nobody', () => {
    const d = decideDomainMove({ workspaceId: 'ws-a', userId: 'u2' }, 'ws-b', 'u1');
    expect(d.action).toBe('refuse');
    expect(OTHER_ACCOUNT_MESSAGE).not.toMatch(/ws-a|u2|@/);
  });

  it('🔒 a holder with no recorded user is never treated as ours', () => {
    // An old link written before userId was stored: moving it would be acting on a guess.
    expect(decideDomainMove({ workspaceId: 'ws-a', userId: '' }, 'ws-b', 'u1').action).toBe('refuse');
  });

  it('the on-screen note says how to undo, and prints no workspace id', () => {
    expect(MOVED_NOTE).toMatch(/move it back/i);
    expect(MOVED_NOTE).not.toMatch(/agentv3-|ws-/);
  });
});
