// THE BACKEND IS REMEMBERED AFTER A RELOAD (Q-806, found by the Render audit of 2026-09-07). "Deploy backend" told
// the truth while the screen stayed open and then forgot it: after a reload the button was offered again as if
// nothing had been deployed, and "live at …" was gone. THE CLASS: a fact learned once, kept only in a screen's
// memory. The deploy and each status check now write it on the app's own record; the Publish screen reads it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deployedRecord, checkedRecord, readBackendDeployRecord, backendDeployView, RESUME_CHECK_WITHIN_MS } from '../src/lib/backendDeployRecord';
import { InMemoryConversationStore } from '../src/server/AgentV3/ConversationStore';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const T = 1_760_000_000_000;

describe('the record', () => {
  it('a deploy starts it unknown; a verdict for THAT service settles it', () => {
    const d = deployedRecord('srv-1', 'https://app.example.com', T);
    expect(d).toMatchObject({ serviceId: 'srv-1', live: null, phase: 'in-progress', deployedAt: T });
    expect(checkedRecord(d, 'srv-1', { live: true, phase: 'live', message: 'Your backend is live.' }, T + 60_000)).toMatchObject({ live: true, phase: 'live', checkedAt: T + 60_000 });
    expect(checkedRecord(d, 'srv-1', { phase: 'in-progress' }, T + 5_000)).toMatchObject({ live: null, checkedAt: T + 5_000 });
  });

  it('🔒 a verdict about ANOTHER service never overwrites this one', () => {
    expect(checkedRecord(deployedRecord('srv-1', 'u', T), 'srv-2', { live: false }, T)).toBeNull();
    expect(checkedRecord(null, 'srv-1', { live: true }, T)).toBeNull();
  });

  it('anything without a service and an address is not a record', () => {
    expect(readBackendDeployRecord(null)).toBeNull();
    expect(readBackendDeployRecord({ url: 'u' })).toBeNull();
    expect(readBackendDeployRecord({ serviceId: 's' })).toBeNull();
    expect(readBackendDeployRecord({ serviceId: 's', url: 'u' })?.live).toBeNull();
  });
});

describe('what the Publish screen says when it opens', () => {
  it('live: the address, in so many words', () => {
    expect(backendDeployView({ ...deployedRecord('s', 'https://a.example.com', T), live: true }, T)?.line).toBe('✅ Your backend is live at https://a.example.com.');
  });

  it('broken: the last sentence the user was told', () => {
    expect(backendDeployView({ ...deployedRecord('s', 'u', T), live: false, message: 'Your backend did not start.' }, T)?.line).toContain('did not start');
  });

  it('a check a reload interrupted is resumed, but only while it is still fresh', () => {
    const d = deployedRecord('s', 'u', T);
    expect(backendDeployView(d, T + 60_000)?.resumeCheck).toBe(true);
    const old = backendDeployView(d, T + RESUME_CHECK_WITHIN_MS + 1);
    expect(old?.resumeCheck).toBe(false);
    expect(old?.line).toMatch(/never confirmed/);
  });
});

describe('🔒 it is durable', () => {
  it('the store keeps it across reads', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'w1', userId: 'u', prompt: 'p', status: 'complete', messages: [], usage: { inputTokens: 0, outputTokens: 0 }, createdAt: T, updatedAt: T } as any);
    await store.update('w1', { backendDeploy: deployedRecord('srv-1', 'https://a', T), updatedAt: T });
    expect((await store.get('w1'))?.backendDeploy?.serviceId).toBe('srv-1');
  });

  it('the Firestore store writes and reads the field', () => {
    const fs = code('src/server/AgentV3/FirestoreConversationStore.ts');
    expect(fs).toContain('if (patch.backendDeploy !== undefined) out.backendDeploy = { ...patch.backendDeploy };');
    expect(fs).toContain('...(meta.backendDeploy ? { backendDeploy: meta.backendDeploy } : {}),');
  });
});

describe('🔒 the wiring', () => {
  const route = code('src/server/routes/agentv3.ts');

  it('the deploy writes it, the status check settles it, and an owner-only route reads it', () => {
    expect(route).toContain('backendDeploy: deployedRecord(result.serviceId,');
    expect(route).toContain('checkedRecord(readBackendDeployRecord(');
    const at = route.indexOf("app.get('/api/agentv3/deploy-record'");
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 1200)).toContain('assertVerifiedWorkspaceOwner(req, workspaceId)');
  });

  it('a duplicated app does not inherit the original\'s backend — the record names THAT service', () => {
    const raw = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const at = raw.indexOf('// Files + chat + name. Deliberately NOT:');
    expect(raw.slice(at, at + 300)).toContain('backendDeploy');
    expect(raw.slice(at, at + 900)).not.toContain('backendDeploy: source');
  });

  it('the Publish screen reads it when it opens', () => {
    const chooser = code('src/components/agentv3/HostingChooser.tsx');
    expect(chooser).toContain('`/api/agentv3/deploy-record?workspaceId=${encodeURIComponent(workspaceId)}`');
    expect(chooser).toContain('if (view.resumeCheck) void verifyBackend(rec.serviceId, rec.url);');
  });
});
