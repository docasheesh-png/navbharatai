import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { repoAvailableForDeploy, resolveDeployRepo, parseRepoUrl } from '../src/server/AgentV3/deployRepoMemory';

/**
 * "GITHUB SE IMPORT KI HAI, MATLAB CONNECT HAI!" (admin 2026-09-06).
 *
 * The admin was right, and the code confirmed it: an import CAN genuinely land an app in the user's
 * own GitHub — but until this fix, that fact reached the client only as a live stream event, scoped
 * to that one browser tab. The Publish/Deploy-backend screen's `deployRepo` is built from React state
 * that starts empty on every reload, so a workspace whose import genuinely succeeded would, on the
 * very next visit, be told to "push this app to a repo of your own" — a true fact about the SESSION'S
 * memory, delivered as if it were a fact about the app.
 */
describe('repoAvailableForDeploy — an empty client claim never overrides a durable yes', () => {
  it('🔒 THE EXACT BUG: durable yes + ephemeral no (a reload) resolves to available', () => {
    expect(repoAvailableForDeploy({ hasRepo: false }, { repoOwnedByUser: true })).toBe(true);
    expect(repoAvailableForDeploy(undefined, { repoOwnedByUser: true })).toBe(true);
  });

  it('a genuinely repo-less app (neither source knows one) is not available', () => {
    expect(repoAvailableForDeploy({ hasRepo: false }, null)).toBe(false);
    expect(repoAvailableForDeploy(null, { repoOwnedByUser: false })).toBe(false);
    expect(repoAvailableForDeploy(null, null)).toBe(false);
  });

  it('a fresh client claim this very turn is honoured even with no durable record yet', () => {
    // e.g. "Put this app in my GitHub" just ran, before its durable write landed.
    expect(repoAvailableForDeploy({ hasRepo: true }, null)).toBe(true);
  });
});

describe('parseRepoUrl', () => {
  it('parses a clean github URL, tolerating .git and a trailing slash', () => {
    expect(parseRepoUrl('https://github.com/asheesh/mitrify')).toEqual({ owner: 'asheesh', repo: 'mitrify' });
    expect(parseRepoUrl('https://github.com/asheesh/mitrify.git')).toEqual({ owner: 'asheesh', repo: 'mitrify' });
    expect(parseRepoUrl('https://github.com/asheesh/mitrify/')).toEqual({ owner: 'asheesh', repo: 'mitrify' });
  });

  it('rejects anything that is not exactly an owner/repo URL', () => {
    for (const u of ['', 'not a url', 'https://gitlab.com/a/b', 'https://github.com/a/b/c', 'https://github.com/a']) {
      expect(parseRepoUrl(u), u).toBeNull();
    }
  });
});

describe('resolveDeployRepo — client wins when usable, durable memory is the fallback', () => {
  const durable = { repoOwner: 'asheesh', repoName: 'mitrify', repoOwnedByUser: true, deployBranch: 'main' };

  it('a parseable client URL wins, even with a durable record present', () => {
    const r = resolveDeployRepo('https://github.com/other/app', durable);
    expect(r).toEqual({ owner: 'other', repo: 'app', repoUrl: 'https://github.com/other/app', branch: 'main' });
  });

  it('🔒 no usable client URL falls back to the durable record — the exact fix', () => {
    const r = resolveDeployRepo(undefined, durable);
    expect(r).toEqual({ owner: 'asheesh', repo: 'mitrify', repoUrl: 'https://github.com/asheesh/mitrify', branch: 'main' });
  });

  it('🔒 the durable BRANCH travels too — never silently defaults past a real recorded value', () => {
    const r = resolveDeployRepo('', { ...durable, deployBranch: 'trunk' });
    expect(r?.branch).toBe('trunk');
  });

  it('a durable record not owned by the user is never offered', () => {
    expect(resolveDeployRepo('', { ...durable, repoOwnedByUser: false })).toBeNull();
  });

  it('an incomplete durable record (missing owner or name) is never offered', () => {
    expect(resolveDeployRepo('', { repoOwnedByUser: true, repoName: 'mitrify' })).toBeNull();
    expect(resolveDeployRepo('', { repoOwnedByUser: true, repoOwner: 'asheesh' })).toBeNull();
  });

  it('neither source names a repo — null, and the caller\'s existing honest hand-off stands', () => {
    expect(resolveDeployRepo('', null)).toBeNull();
    expect(resolveDeployRepo(undefined, undefined)).toBeNull();
  });

  it('no durable branch recorded defaults to main, same as before this feature existed', () => {
    const r = resolveDeployRepo('', { repoOwner: 'a', repoName: 'b', repoOwnedByUser: true });
    expect(r?.branch).toBe('main');
  });
});

describe('🔒 the wiring — both routes actually consult durable memory, and the branch reaches creation', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('the publish refusal path ORs the client claim with the durable record', () => {
    const at = route.indexOf('repoAvailableForDeploy(');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 400)).toContain('durableRepoRec');
  });

  it('deploy-backend resolves the repo from durable memory, and uses it everywhere repoUrl mattered', () => {
    const handlerAt = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    const handlerEnd = route.indexOf('app.post(', handlerAt + 40);
    const handler = route.slice(handlerAt, handlerEnd);
    expect(handler).toContain('resolveDeployRepo(repoUrl, durableRepoRec)');
    expect(handler).toContain('effectiveRepoUrl');
    // 🔒 The raw, ephemeral `repoUrl` must not still gate creation or the match call — that would
    // silently reintroduce the exact bug this closes for every path except the message wording.
    expect(handler).not.toMatch(/deployBackendToRender\(\{ repoUrl,/);
    expect(handler).not.toMatch(/reason === 'no-service' && repoUrl &&/);
  });

  it('🔒 the resolved BRANCH reaches service creation — not left to silently default', () => {
    const handlerAt = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    const handlerEnd = route.indexOf('app.post(', handlerAt + 40);
    const handler = route.slice(handlerAt, handlerEnd);
    expect(handler).toContain('branch: resolvedRepo?.branch');
  });
});

describe('🔒 the wiring — importing a repo the user owns is remembered DURABLY, not only streamed', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('own-repo storage mode persists ownership and the BASE branch (never the work branch)', () => {
    const at = route.indexOf("if (target.mode === 'own-repo') {");
    const nextAt = route.indexOf('} else {', at);
    const block = route.slice(at, nextAt);
    expect(block).toContain('repoOwnedByUser: true, deployBranch: target.baseBranch');
    // The trap this guards: navbharatai/work can hold unreviewed, mid-session edits — deploying it
    // would be worse than deploying nothing.
    expect(block).not.toContain('deployBranch: target.workBranch');
  });

  it('the user-account mirror mode persists ownership too — it is exactly as deployable', () => {
    const ownRepoAt = route.indexOf("if (target.mode === 'own-repo') {");
    const mirrorAt = route.indexOf('} else {', ownRepoAt);
    const catchAt = route.indexOf('} catch { repoSync = undefined;', mirrorAt);
    const block = route.slice(mirrorAt, catchAt);
    expect(block).toContain('repoOwner: login, repoOwnedByUser: true, deployBranch: repoBranch');
  });
});
