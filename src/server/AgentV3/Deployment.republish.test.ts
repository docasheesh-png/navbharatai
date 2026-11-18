import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('google-auth-library', () => ({ GoogleAuth: class { async getAccessToken() { return 'test-token'; } } }));
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn(), patch: vi.fn() }, AxiosError: class extends Error {} }));
vi.mock('./DeploymentStore', () => ({
  readDeploymentForPublish: vi.fn(),
  isLiveDeployment: (rec: { url?: string; status?: string } | null) => Boolean(rec?.url && (!rec.status || rec.status === 'active')),
}));
vi.mock('./bucketPublish', async (importOriginal) => ({
  ...await importOriginal<typeof import('./bucketPublish')>(),
  mirrorPublishToBucket: vi.fn(), removePublishFromBucket: vi.fn(),
}));

import axios from 'axios';
import { FirebaseHostingDeployer, makeChannelId } from './Deployment';
import { readDeploymentForPublish } from './DeploymentStore';
import { mirrorPublishToBucket, removePublishFromBucket } from './bucketPublish';
import { bucketOnlySubdomain } from './bucketOnlyPublish';
import { snapshotChannelId } from './previewSnapshot';
import { LEGACY_SERVICE_WORKER_V1 } from './appDefaults';

const WS = 'ws-republish';
const SITE = 'gen-lang-client-0866594388';
const SUB = 'v3-ws-republish-randomhash';
const RAW_URL = `https://${SITE}--${SUB}.web.app`;
const EDGE_URL = `https://${SUB}.mitrify.in`;
const files = () => new Map([['index.html', Buffer.from('new page')]]);
const record = (url: string) => ({ workspaceId: WS, userId: 'user', url, fileCount: 1, updatedAt: 1 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PUBLISHED_APP_DOMAIN', 'mitrify.in');
  vi.stubEnv('PUBLISHED_APPS_BUCKET_ONLY', 'off');
  vi.stubEnv('AGENTV3_SNAPSHOT_BUCKET', 'off');
  vi.mocked(readDeploymentForPublish).mockResolvedValue(null);
  vi.mocked(mirrorPublishToBucket).mockResolvedValue({ attempted: true, bucket: 'bucket', uploaded: 1, failed: 0 });
  vi.mocked(axios.get).mockResolvedValue({ data: { url: RAW_URL } });
  vi.mocked(axios.patch).mockResolvedValue({ data: {} });
  vi.mocked(axios.post).mockImplementation(async (url) => {
    if (url.includes('/channels?channelId=')) return { data: { url: RAW_URL } };
    if (url.includes('populateFiles')) return { data: { uploadRequiredHashes: [] } };
    if (url.includes('/versions')) return { data: { name: 'sites/site/versions/new' } };
    return { data: {} };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('republish uses the real registry and publish path', () => {
  it.each([`https://${bucketOnlySubdomain(WS)}.mitrify.in`, EDGE_URL])('updates the existing edge address %s', async (url) => {
    vi.mocked(readDeploymentForPublish).mockResolvedValue(record(url));
    expect(await new FirebaseHostingDeployer().deployStatic(WS, files())).toBe(url);
    expect(mirrorPublishToBucket).toHaveBeenCalledWith(new URL(url).hostname.split('.')[0], expect.any(Map));
    expect(axios.post).not.toHaveBeenCalled();
  });

  it.each([`https://${bucketOnlySubdomain(WS)}.mitrify.in`, EDGE_URL])('preserves the live prefix after a partial update of %s', async (url) => {
    vi.mocked(readDeploymentForPublish).mockResolvedValue(record(url));
    vi.mocked(mirrorPublishToBucket).mockResolvedValue({ attempted: true, bucket: 'bucket', uploaded: 1, failed: 1 });
    await expect(new FirebaseHostingDeployer().deployStatic(WS, files())).rejects.toThrow('Some files may have changed');
    expect(removePublishFromBucket).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not treat an unreadable registry as an unpublished app', async () => {
    vi.mocked(readDeploymentForPublish).mockRejectedValue(new Error('registry unavailable'));
    await expect(new FirebaseHostingDeployer().deployStatic(WS, files())).rejects.toThrow('registry unavailable');
    expect(mirrorPublishToBucket).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('releases a raw Firebase URL only after verifying the existing channel', async () => {
    vi.mocked(readDeploymentForPublish).mockResolvedValue(record(RAW_URL));
    expect(await new FirebaseHostingDeployer().deployStatic(WS, files())).toBe(RAW_URL);
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining(`/channels/${makeChannelId(WS)}`), expect.any(Object));
    const urls = vi.mocked(axios.post).mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes('/releases?versionName='))).toBe(true);
    expect(urls.some((url) => url.includes('/channels?channelId='))).toBe(false);
  });

  it('does not release or report success at an obsolete Firebase address', async () => {
    vi.mocked(readDeploymentForPublish).mockResolvedValue(record(RAW_URL));
    vi.mocked(axios.get).mockResolvedValue({ data: { url: `https://${SITE}--different.web.app` } });
    await expect(new FirebaseHostingDeployer().deployStatic(WS, files())).rejects.toThrow('could not be verified');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not recreate a deleted channel behind an obsolete raw address', async () => {
    vi.mocked(readDeploymentForPublish).mockResolvedValue(record(RAW_URL));
    vi.mocked(axios.get).mockRejectedValue(Object.assign(new Error('missing'), { response: { status: 404 } }));
    await expect(new FirebaseHostingDeployer().deployStatic(WS, files())).rejects.toThrow('channel lookup');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('keeps snapshots independent of the published registry', async () => {
    vi.mocked(readDeploymentForPublish).mockRejectedValue(new Error('registry unavailable'));
    await new FirebaseHostingDeployer().deployStatic(WS, files(), snapshotChannelId(WS));
    expect(readDeploymentForPublish).not.toHaveBeenCalled();
  });

  it('upgrades the shipped legacy worker while preserving a custom one', async () => {
    vi.mocked(readDeploymentForPublish).mockResolvedValue(record(EDGE_URL));
    const bundle = files();
    bundle.set('sw.js', Buffer.from(LEGACY_SERVICE_WORKER_V1));
    bundle.set('custom/sw.js', Buffer.from('/* my custom worker */'));
    await new FirebaseHostingDeployer().deployStatic(WS, bundle);
    expect(bundle.get('sw.js')?.toString()).toContain('app defaults, v2');
    expect(bundle.get('custom/sw.js')?.toString()).toBe('/* my custom worker */');
  });
});
