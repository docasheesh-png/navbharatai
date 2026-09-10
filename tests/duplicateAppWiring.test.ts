import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Duplicate app (ROADMAP §13, 3.6): the wiring, locked against the real source. */
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const routes = src('src/server/routes/agentv3.ts');
const panel = src('src/components/agentv3/AgentV3Panel.tsx');
const hook = src('src/hooks/useAgentV3Build.ts');

const start = routes.indexOf("app.post('/api/agentv3/conversations/:id/duplicate'");
const block = routes.slice(start, start + 3500);

describe('🔒 the duplicate route', () => {
  it('exists, resolves identity from the VERIFIED token, and refuses anon', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('await resolveReadIdentity(req)');
    expect(block).toContain("if (!userId || userId === 'anon') {");
  });

  it('reaches the source only through conversationAccess — never a claimed id', () => {
    expect(block).toContain('candidateConversationIds(req.params.id, userId)');
    expect(block).toContain('conversationAccess(rec, userId)');
  });

  it('copies files + chat into a workspace minted for the SAME user, under a fresh name', () => {
    expect(block).toContain('workspaceIdFor(userId, newSessionId)');
    expect(block).toContain('await saveWorkspaceFiles(newWorkspaceId, files);');
    expect(block).toContain('messages: source.messages ?? []');
    expect(block).toContain('copyName(effectiveAppName(source)');
  });

  it('🔒 copies NOTHING that points at a place in the world', () => {
    // The create/update calls must not carry the repo, branch, domain or pin fields.
    const writes = block.slice(block.indexOf('await store.create('), block.indexOf('res.json({ ok: true'));
    for (const field of ['repoName', 'repoOwner', 'deployBranch', 'backendDomain', 'pinned']) {
      expect(writes).not.toMatch(new RegExp(`\\b${field}:`));
    }
  });

  it('refuses honestly when there is nothing to copy, and never claims a build in progress', () => {
    expect(block).toContain('nothing to copy');
    expect(block).toContain('copyStatus(source.status)');
  });
});

describe('the client', () => {
  it('has the hook method and the button, and opens the copy it just made', () => {
    expect(hook).toContain("/duplicate`");
    expect(panel).toContain('title="Make a copy of this app"');
    expect(panel).toContain('await openConversation(r.id);');
    expect(panel).toContain('those stay with the original');
  });
});
