import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decidePushBranch } from '../src/server/AgentV3/pushAppTarget';
import { PLATFORM_REPO_DESCRIPTION } from '../src/server/AgentV3/GitHubAppClient';
import { WORK_BRANCH } from '../src/server/AgentV3/GitStorageTarget';

/**
 * 🔴 "PUT THIS APP IN MY GITHUB" MUST NEVER FORCE-PUSH OVER A REPOSITORY THE USER MADE
 * (admin 2026-09-07, found while tracing why the button failed on an app "already on GitHub").
 *
 * The route is `ensureRepo` (get-or-create) followed by `pushAll` (`git push --force` onto the default
 * branch). Correct for a mirror NavBharatAI created; irreversible destruction for a repository whose
 * default branch holds the USER'S history. The name alone cannot tell them apart, so the decision is
 * made from evidence before any push.
 */
describe('decidePushBranch — evidence in, branch out', () => {
  it('a repository created by this very call is pushed on its default branch', () => {
    const d = decidePushBranch({ created: true, defaultBranch: 'main' });
    expect(d).toEqual({ branch: 'main', mode: 'created', overwritesDefault: true });
  });

  it('a mirror NavBharatAI made earlier (our description) is pushed on its default branch — the build path already does', () => {
    const d = decidePushBranch({ created: false, description: PLATFORM_REPO_DESCRIPTION, defaultBranch: 'master' });
    expect(d).toEqual({ branch: 'master', mode: 'platform-mirror', overwritesDefault: true });
  });

  it('🔒 THE HAZARD: an existing repository with someone else\'s history goes to the working branch ONLY', () => {
    for (const description of [undefined, null, '', '   ', 'My real project', 'built with navbharatai pro v5.0']) {
      const d = decidePushBranch({ created: false, description, defaultBranch: 'main' });
      expect(d.branch, String(description)).toBe(WORK_BRANCH);
      expect(d.mode, String(description)).toBe('foreign-repo');
      expect(d.overwritesDefault, String(description)).toBe(false);
    }
  });

  it('an unknown default branch falls back to main rather than an empty ref', () => {
    expect(decidePushBranch({ created: true, defaultBranch: '' }).branch).toBe('main');
    expect(decidePushBranch({ created: true, defaultBranch: null }).branch).toBe('main');
  });

  it('the description match is exact after trimming — a near-miss is treated as foreign (the safe direction)', () => {
    expect(decidePushBranch({ created: false, description: `  ${PLATFORM_REPO_DESCRIPTION}  `, defaultBranch: 'main' }).mode).toBe('platform-mirror');
    expect(decidePushBranch({ created: false, description: `${PLATFORM_REPO_DESCRIPTION}!`, defaultBranch: 'main' }).mode).toBe('foreign-repo');
  });
});

describe('🔒 the wiring — the decision runs before the push, and the evidence actually reaches it', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const userClient = readFileSync(join(__dirname, '..', 'src/server/AgentV3/UserGitHubClient.ts'), 'utf8');
  const appClient = readFileSync(join(__dirname, '..', 'src/server/AgentV3/GitHubAppClient.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/github/push-app'");
    return at === -1 ? '' : route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('the push-app route decides the branch from the repository\'s own facts, upstream of pushAll', () => {
    const decideAt = handler.indexOf('decidePushBranch({ created: repo.created, description: repo.description');
    const pushAt = handler.indexOf('sync.pushAll(authedUrl, target.branch');
    expect(decideAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(decideAt);
    // The raw default branch must no longer be what gets pushed.
    expect(handler).not.toContain("sync.pushAll(authedUrl, repo.defaultBranch || 'main'");
  });

  it('🔒 the deploy branch is the branch that now holds THIS app — never the untouched default of a foreign repo', () => {
    expect(handler).toContain('deployBranch: target.branch');
    expect(handler).toContain('pushedBranch: target.branch');
  });

  it('🔒 the sibling: the large-ZIP GitHub backstop takes the same decision — it was the same ensureRepo + force-push', () => {
    expect(route).toContain("repoSync.pushAll(authedUrl, target.branch, 'Import large project from ZIP')");
    expect(route).not.toContain("pushAll(authedUrl, repo.defaultBranch || 'main', 'Import large project from ZIP')");
    // And it now remembers the repo durably, so the Publish screen knows about it on the next visit.
    const zipAt = route.indexOf("'Import large project from ZIP'");
    expect(route.slice(zipAt, zipAt + 900)).toContain('repoOwnedByUser: true, deployBranch: target.branch');
  });

  it('🔒 the description is read from GitHub by BOTH clients — evidence that never arrives is evidence that never protects', () => {
    for (const src of [userClient, appClient]) {
      expect(src).toContain("...(typeof r.description === 'string' ? { description: r.description } : {})");
      expect(src).toContain('description?: string | null;');
    }
  });

  it('every repository NavBharatAI creates carries the ONE description the decision reads', () => {
    // Two literal copies of the string would drift; both clients must use the exported constant.
    expect(userClient).toContain('description: PLATFORM_REPO_DESCRIPTION');
    expect(appClient).toContain('description: PLATFORM_REPO_DESCRIPTION');
    expect(userClient).not.toContain("description: 'Built with NavBharatAI Pro v5.0'");
    expect(appClient).not.toContain("description: 'Built with NavBharatAI Pro v5.0'");
  });
});
