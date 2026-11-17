import { describe, expect, it } from 'vitest';
import { externalGameAssetsEnabled } from './assetPlan';
import { prepareGameAssets } from './assetSeed';

const Z = 'GiYNmFcDMVYSWW48Nrurm7j41gv1';
describe('L3 limited rollout gate (AGENTV3_EXTERNAL_GAME_ASSETS=admin)', () => {
  it('default stays off for everyone, including z', () => {
    expect(externalGameAssetsEnabled({}, Z)).toBe(false);
    expect(externalGameAssetsEnabled({ AGENTV3_EXTERNAL_GAME_ASSETS: 'off' }, Z)).toBe(false);
  });
  it('admin mode admits only z uid and allowlisted verified uids', () => {
    const env = { AGENTV3_EXTERNAL_GAME_ASSETS: 'admin' };
    expect(externalGameAssetsEnabled(env, Z)).toBe(true);
    expect(externalGameAssetsEnabled({ AGENTV3_EXTERNAL_GAME_ASSETS: ' ADMIN ' }, Z)).toBe(true);
    expect(externalGameAssetsEnabled(env, 'normal-user')).toBe(false);
    expect(externalGameAssetsEnabled(env, undefined)).toBe(false);
    expect(externalGameAssetsEnabled(env, '')).toBe(false);
    const allow = { ...env, AGENTV3_EXTERNAL_GAME_ASSETS_UIDS: ' a1 , b2 ' };
    expect(externalGameAssetsEnabled(allow, 'b2')).toBe(true);
    expect(externalGameAssetsEnabled(allow, 'c3')).toBe(false);
  });
  it('allowlist alone never enables without admin mode', () => {
    expect(externalGameAssetsEnabled({ AGENTV3_EXTERNAL_GAME_ASSETS_UIDS: 'a1' }, 'a1')).toBe(false);
  });
  it('on still means everyone (unchanged)', () => {
    expect(externalGameAssetsEnabled({ AGENTV3_EXTERNAL_GAME_ASSETS: 'on' }, 'normal-user')).toBe(true);
  });
  it('prepareGameAssets returns off for a non-allowlisted user in admin mode (no workspace touched)', async () => {
    // `signal` is a required option (the one production caller passes the build's abort signal); #4218 made
    // prepareGameAssets read it after the scenery step, so a call without one no longer reaches the assertion.
    const r = await prepareGameAssets({ prompt: 'a game with a table and chair', workspaceId: 'w', workspace: {} as never,
      signal: new AbortController().signal, verifiedOwnerUid: 'normal-user', env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'admin' } } as never);
    expect(r.status).toBe('off');
    expect(r.files).toEqual({});
  });
});
