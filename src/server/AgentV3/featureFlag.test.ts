import { describe, it, expect, afterEach } from 'vitest';
import { agentV3FreeList, isAgentV3FreeUser } from './featureFlag';

const save = { ...process.env };
afterEach(() => {
  process.env.AGENTV3_FREE_LIST = save.AGENTV3_FREE_LIST;
  process.env.AGENTV3_ALLOWLIST = save.AGENTV3_ALLOWLIST;
  if (save.AGENTV3_FREE_LIST === undefined) delete process.env.AGENTV3_FREE_LIST;
  if (save.AGENTV3_ALLOWLIST === undefined) delete process.env.AGENTV3_ALLOWLIST;
});

describe('agentV3FreeList / isAgentV3FreeUser (paid-public FREE-list)', () => {
  it('BACKWARD-COMPAT: unset AGENTV3_FREE_LIST defaults to the current allowlist (today = the admins)', () => {
    delete process.env.AGENTV3_FREE_LIST;
    process.env.AGENTV3_ALLOWLIST = 'aashishcpmt09@gmail.com, doc.asheesh@icloud.com';
    expect(agentV3FreeList()).toEqual(['aashishcpmt09@gmail.com', 'doc.asheesh@icloud.com']);
    expect(isAgentV3FreeUser(null, 'AASHISHCPMT09@GMAIL.COM')).toBe(true); // email match, case-insensitive
    expect(isAgentV3FreeUser('some-uid', 'stranger@x.com')).toBe(false);
  });

  it('an explicit AGENTV3_FREE_LIST takes precedence over the allowlist (split ACCESS vs FREE)', () => {
    process.env.AGENTV3_ALLOWLIST = ''; // public access (everyone), but…
    process.env.AGENTV3_FREE_LIST = 'admin-uid-1, admin@navbharatai.in';
    expect(isAgentV3FreeUser('admin-uid-1', null)).toBe(true);   // uid match → free
    expect(isAgentV3FreeUser('paying-user', 'someone@else.com')).toBe(false); // a paying public user
    expect(isAgentV3FreeUser(null, 'ADMIN@NAVBHARATAI.IN')).toBe(true);
  });

  it('empty free-list AND empty allowlist → nobody is free (all paid)', () => {
    process.env.AGENTV3_FREE_LIST = '';
    process.env.AGENTV3_ALLOWLIST = '';
    expect(agentV3FreeList()).toEqual([]);
    expect(isAgentV3FreeUser('anyone', 'any@one.com')).toBe(false);
  });

  it('never matches on empty/blank identity (no accidental free access)', () => {
    process.env.AGENTV3_FREE_LIST = 'real@admin.com';
    expect(isAgentV3FreeUser(null, null)).toBe(false);
    expect(isAgentV3FreeUser('', '')).toBe(false);
  });
});
