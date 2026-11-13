import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameBuildInbox, gameBuildTargetReady } from '../src/lib/gameBuildInbox';
const read = (path: string) => readFileSync(path, 'utf8');
describe('new game handoff ownership and exactly once delivery', () => {
  it('claims synchronously once, surviving consumer remount and StrictMode effect replay', () => {
    const inbox = new GameBuildInbox();
    const request = inbox.put('alice', 'new racing game');
    expect(inbox.claim('alice', request.id)).toEqual(request);
    expect(inbox.claim('alice', request.id)).toBeNull();
  });
  it('does not allow another account to claim the request', () => {
    const inbox = new GameBuildInbox(); const req = inbox.put('alice', 'game');
    expect(inbox.claim('bob', req.id)).toBeNull();
    expect(inbox.claim('alice', req.id)).toEqual(req);
  });
  it('invalidates across account changes, including switching back', () => {
    const inbox = new GameBuildInbox(); const req = inbox.put('alice', 'game');
    inbox.bind('bob'); inbox.bind('alice');
    expect(inbox.claim('alice', req.id)).toBeNull();
  });
  it('supersedes pending clicks without timestamps or duplicate IDs', () => {
    const inbox = new GameBuildInbox(); const a = inbox.put('', 'a'), b = inbox.put('', 'b');
    expect(a.id).not.toBe(b.id); expect(inbox.claim('', a.id)).toBeNull();
    expect(inbox.claim('', b.id)?.text).toBe('b');
  });
  const req = { owner: 'alice', session: 'new' };
  const clean = { owner: 'alice', session: 'new', running: false, switching: false };
  it('permits only a rendered empty target session', () => expect(gameBuildTargetReady(req, clean)).toBe(true));
  it.each([
    { workspace: 'old-project' }, { running: true }, { switching: true },
    { session: 'old' }, { owner: 'bob' },
  ])('blocks unsafe target %j', (change) => expect(gameBuildTargetReady(req, { ...clean, ...change })).toBe(false));
});
describe('production wiring guards', () => {
  const app = read('src/App.tsx'), panel = read('src/components/agentv3/AgentV3Panel.tsx');
  const hook = read('src/hooks/useAgentV3Build.ts');
  it('template click cannot use old-project pendingFix', () => {
    const handler = app.slice(app.indexOf('onSelectGameTemplate='), app.indexOf('onSelectGameTemplate=') + 380);
    expect(handler).toContain('setV3Resume(null)'); expect(handler).toContain('setV3PendingFix(null)');
    expect(handler).toContain('setV3DeployRequest(null)'); expect(handler).toContain('gameBuildInbox.put');
    expect(handler).not.toContain('autoSend');
  });
  it('claims before reset and stages send on a later render with target guard', () => {
    const block = panel.slice(panel.indexOf('// Claim before resetting:'), panel.indexOf('// The repository import that opened'));
    expect(block.indexOf('.claim(')).toBeLessThan(block.indexOf('startNewSession()'));
    expect(block.indexOf('startNewSession()')).toBeLessThan(block.indexOf('setStagedGameBuild({'));
    expect(block).toContain('session: sessionIdRef.current');
    expect(block).toContain('gameBuildTargetReady');
    expect(block.indexOf('stagedGameConsumedRef.current = stagedGameBuild.id')).toBeLessThan(block.indexOf('void send('));
  });
  it('rejects stale history before abort, state adoption and workspace mutation', () => {
    const block = hook.slice(hook.indexOf('  const loadConversation ='), hook.indexOf('  /** The reason the LAST'));
    expect(block).toContain('loadGeneration === generationRef.current && loadOrdinal === conversationLoadOrdinalRef.current');
    const gate = block.indexOf('if (!currentLoad()) return null;\n      generationRef.current += 1;');
    expect(gate).toBeGreaterThan(0);
    for (const mutation of ['abortRef.current?.abort()', 'setState(next)', 'workspaceIdRef.current = conv.workspaceId'])
      expect(block.indexOf(mutation)).toBeGreaterThan(gate);
    expect(block).toContain('generationRef.current === committedGeneration');
  });
  it('panel stale history cannot adopt fallback or release newer switch lock', () => {
    const block = panel.slice(panel.indexOf('  const openConversation ='), panel.indexOf('  const newChatFromHistory'));
    expect(block).toContain('const openGeneration = ++openConversationGenRef.current');
    expect(block).toContain('if (!isCurrentOpen()) return;\n      if (restored)');
    expect(block).toContain('if (!isCurrentOpen()) return;\n        const rowTs');
    expect(block).toContain('if (isCurrentOpen()) sessionSwitchRef.current = false');
    expect(panel.slice(panel.indexOf('  const startNewSession ='), panel.indexOf('// History menu:'))).toContain('openConversationGenRef.current += 1');
  });
});
