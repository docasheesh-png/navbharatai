import { describe, it, expect } from 'vitest';
import { deploymentStore, withDeploymentPersistence } from './DeploymentStore';

describe('DeploymentStore (R5 §5.1, VITEST-skip: no Firestore)', () => {
  it('record() is a best-effort no-op in tests and never throws', async () => {
    await expect(deploymentStore.record('agentv3-u1-s1', 'u1', 'https://x.web.app', 5)).resolves.toBeUndefined();
  });

  it('get() returns null in tests (Firestore skipped)', async () => {
    expect(await deploymentStore.get('agentv3-u1-s1')).toBeNull();
  });
});

describe('withDeploymentPersistence', () => {
  it('returns the base deploy URL unchanged and preserves the DeployFn signature', async () => {
    let calledWith: { ws: string; size: number } | null = null;
    const base = async (ws: string, files: Map<string, Buffer>) => {
      calledWith = { ws, size: files.size };
      return `https://site--${ws}.web.app`;
    };
    const wrapped = withDeploymentPersistence(base, 'u1');
    const files = new Map<string, Buffer>([['index.html', Buffer.from('<h1>hi</h1>')]]);
    const url = await wrapped('agentv3-u1-s1', files);
    expect(url).toBe('https://site--agentv3-u1-s1.web.app');
    expect(calledWith).toEqual({ ws: 'agentv3-u1-s1', size: 1 });
  });

  it('propagates a deploy failure (recording never masks a real error)', async () => {
    const base = async () => { throw new Error('Firebase 403'); };
    const wrapped = withDeploymentPersistence(base, null);
    await expect(wrapped('ws', new Map())).rejects.toThrow('Firebase 403');
  });
});
