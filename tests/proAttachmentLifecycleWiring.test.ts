import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

// Wiring guards supplement (not replace) runtime erasure and authorization tests.
describe('private original lifecycle wiring', () => {
  it('erases originals before generic records or the sign-in credential', () => {
    const profile = source('src/server/routes/profile.ts');
    const erase = profile.indexOf('await proAttachmentStore.erase(identity.uid)');
    expect(erase).toBeGreaterThan(0);
    expect(erase).toBeLessThan(profile.indexOf('await deleteUserData(db, identity.uid)'));
    expect(erase).toBeLessThan(profile.indexOf('await deleteAuthAccount(identity.uid)'));
    const failurePath = profile.slice(erase, profile.indexOf('// DERIVED IDS FIRST', erase));
    expect(failurePath).toContain('return res.status(503)');
    expect(failurePath).toContain('accountDeleted: false');
    expect(failurePath).toContain('retryRequired: true');
  });

  it('keeps retrieval/deletion registered and adds no destructive expiry job', () => {
    const server = source('server.ts');
    expect(server).toContain('  registerProAttachmentRoutes(app, chatLimiter);');
    expect(server).not.toContain('sweepProAttachments');
  });

  it('removes originals before conversation removal and unsend truncation', () => {
    const route = source('src/server/routes/agentv3.ts');
    const deletion = route.slice(route.indexOf("app.delete('/api/agentv3/conversations/:id'"));
    expect(deletion.indexOf('await eraseConversationOriginals')).toBeLessThan(deletion.indexOf('await purgeWorkspace'));
    expect(deletion).toContain('userId && rec?.userId === userId');
    const unsend = route.slice(route.indexOf("app.post('/api/agentv3/unsend'"));
    expect(unsend.indexOf('await eraseConversationOriginals')).toBeLessThan(unsend.indexOf('await store.truncateMessages'));
    expect(unsend).toContain('req.body?.attachmentMessageId, true');
    expect(unsend).toContain('verifiedUid && rec.userId === verifiedUid');
  });

  it('classifies private originals as user data with a dedicated eraser', () => {
    const registry = source('tests/everyCollectionIsClassified.test.ts');
    expect(registry).toContain("pro_attachment_owners_v1: { kind: 'user'");
    expect(registry).toContain("file: 'src/server/lib/proAttachmentStore.ts'");
  });
});
