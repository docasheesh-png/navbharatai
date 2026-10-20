import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ calls: [] as string[], failMirror: false, failLookup: false, failBucket: false }));
vi.mock('google-auth-library', () => ({ GoogleAuth: class { getAccessToken = async () => 'test-token'; } }));
vi.mock('axios', () => ({ default: {
  get: async () => { state.calls.push('lookup'); if (state.failLookup) throw new Error('lookup unavailable'); return { data: { url: 'https://gen-lang-client-0866594388--v3-test-abcd.web.app' } }; },
  delete: async () => { state.calls.push('channel'); return {}; },
} }));
vi.mock('../src/server/AgentV3/bucketPublish', () => ({
  publishedAppsBucket: () => 'public-bucket', mirrorPublishToBucket: async () => ({}),
  removePublishFromBucket: async (key: string) => {
    state.calls.push('bucket:' + key);
    return { attempted: true, deleted: key === 'v3-test-abcd' ? !state.failMirror : !state.failBucket };
  },
}));
import { FirebaseHostingDeployer } from '../src/server/AgentV3/Deployment';

describe('a takedown removes all static serving paths before claiming success', () => {
  beforeEach(() => { state.calls = []; state.failMirror = false; state.failLookup = false; state.failBucket = false; });
  it('removes the mirror while its key is still recoverable, before deleting the channel', async () => {
    await expect(new FirebaseHostingDeployer().deleteChannelById('test')).resolves.toBe(true);
    expect(state.calls).toEqual(['lookup', 'bucket:v3-test-abcd', 'channel']);
  });
  it('leaves the channel recoverable when a mirror removal or lookup is uncertain', async () => {
    state.failMirror = true;
    await expect(new FirebaseHostingDeployer().deleteChannelById('test')).rejects.toThrow();
    expect(state.calls).not.toContain('channel');
    state.failMirror = false; state.failLookup = true;
    await expect(new FirebaseHostingDeployer().deleteChannelById('test')).rejects.toThrow();
    expect(state.calls).not.toContain('channel');
  });
  it('refuses offline success when bucket-only removal fails', async () => {
    state.failBucket = true;
    await expect(new FirebaseHostingDeployer().deleteChannel('workspace')).rejects.toThrow(/bucket copy/);
    expect(state.calls).not.toContain('channel');
  });
});
