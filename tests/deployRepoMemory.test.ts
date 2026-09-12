import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { repoAvailableForDeploy, resolveDeployRepo, parseRepoUrl, ownRepoMemoryPatch, ownRepoRecordComplete, deployRepoNameOf, renameStorageRepoPatch } from '../src/server/AgentV3/deployRepoMemory';

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
  /**
   * ⚠️ THESE CASES CARRY A COMPLETE RECORD NOW, AND THAT IS THE FIX, NOT A WEAKENED TEST
   * (2026-09-12). They used to pass `{ repoOwnedByUser: true }` alone and assert "available" — which
   * is what the code did, and what was wrong: `resolveDeployRepo` cannot build a URL without a name,
   * so that record made one function promise a deploy the next one could not produce. The intent
   * being tested ("a durable yes beats an ephemeral no") is unchanged; only the record is now whole.
   */
  const COMPLETE = { repoOwnedByUser: true, repoOwner: 'asheesh', deployRepoName: 'mitrify' } as const;

  it('🔒 THE EXACT BUG: durable yes + ephemeral no (a reload) resolves to available', () => {
    expect(repoAvailableForDeploy({ hasRepo: false }, COMPLETE)).toBe(true);
    expect(repoAvailableForDeploy(undefined, COMPLETE)).toBe(true);
  });

  it('a genuinely repo-less app (neither source knows one) is not available', () => {
    expect(repoAvailableForDeploy({ hasRepo: false }, null)).toBe(false);
    expect(repoAvailableForDeploy(null, { repoOwnedByUser: false })).toBe(false);
    expect(repoAvailableForDeploy(null, null)).toBe(false);
  });

  it('🔴 a record that claims ownership but cannot NAME the repo is not available', () => {
    // The state the own-repo import path actually wrote (admin 2026-09-12: "github already connect
    // hai … fir se github connect ki bol raha hai"). Answering "available" here is a promise the
    // deploy breaks, and it is what made one screen contradict itself.
    expect(repoAvailableForDeploy({ hasRepo: false }, { repoOwnedByUser: true })).toBe(false);
    expect(repoAvailableForDeploy(null, { repoOwnedByUser: true, repoOwner: 'asheesh' })).toBe(false);
    expect(repoAvailableForDeploy(null, { repoOwnedByUser: true, deployRepoName: 'mitrify' })).toBe(false);
    expect(repoAvailableForDeploy(null, { repoOwnedByUser: true, repoOwner: '  ', deployRepoName: '  ' })).toBe(false);
  });

  it('the two readers agree — available implies a resolvable repo, always', () => {
    // The invariant the bug violated, asserted directly rather than case by case.
    const records = [
      null,
      { repoOwnedByUser: true },
      { repoOwnedByUser: true, repoOwner: 'asheesh' },
      { repoOwnedByUser: true, repoOwner: 'asheesh', repoName: 'app-mirror-1' },
      { repoOwnedByUser: true, repoOwner: 'asheesh', deployRepoName: 'mitrify' },
      { repoOwnedByUser: false, repoOwner: 'asheesh', deployRepoName: 'mitrify' },
    ];
    for (const rec of records) {
      if (repoAvailableForDeploy(null, rec)) expect(resolveDeployRepo(null, rec)).not.toBeNull();
    }
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

  /**
   * ⚠️ THESE TWO NOW ASSERT THE CALL, NOT THE FIELD SPELLING (2026-09-12), and that change is the
   * point. They used to match the literal object literal — `'repoOwner: login, repoOwnedByUser: true,
   * deployBranch: repoBranch'` — which passed happily while the own-repo block quietly omitted the
   * repo NAME, because the name was never in the string being matched. A test that spells out three
   * of four fields cannot notice the fourth going missing. Asserting that the block builds its patch
   * through `ownRepoMemoryPatch` puts completeness where it can be enforced once, in the builder.
   */
  it('own-repo storage mode persists ownership and the BASE branch (never the work branch)', () => {
    const at = route.indexOf("if (target.mode === 'own-repo') {");
    const nextAt = route.indexOf('} else {', at);
    const block = route.slice(at, nextAt);
    expect(block).toContain('ownRepoMemoryPatch({ owner: target.owner, repo: target.repo');
    expect(block).toContain('deployBranch: target.baseBranch');
    // The trap this guards: navbharatai/work can hold unreviewed, mid-session edits — deploying it
    // would be worse than deploying nothing.
    expect(block).not.toContain('deployBranch: target.workBranch');
    // 🔒 An imported repo is NOT the storage repo. Pinning it as one would aim a later mirror
    // fall-back at the user's real repository — the destructive direction of this same bug.
    expect(block).toContain('storesCode: false');
  });

  it('the user-account mirror mode persists ownership too — it is exactly as deployable', () => {
    const ownRepoAt = route.indexOf("if (target.mode === 'own-repo') {");
    const mirrorAt = route.indexOf('} else {', ownRepoAt);
    const catchAt = route.indexOf('} catch { repoSync = undefined;', mirrorAt);
    const block = route.slice(mirrorAt, catchAt);
    expect(block).toContain('ownRepoMemoryPatch({ owner: login, repo: repoName');
    // This mirror really IS where the build pushes, so the storage name is pinned with it.
    expect(block).toContain('storesCode: true');
  });

  /**
   * 🔒 THE CLASS FIX, CHECKED MECHANICALLY. The bug was not "someone forgot a field" — it was that
   * forgetting one was POSSIBLE and silent. Every durable write that claims the user owns this app's
   * repo must be built by `ownRepoMemoryPatch`, which cannot emit a partial fact. A future fifth call
   * site that hand-rolls the object fails here instead of shipping another half-written record.
   */
  it('every durable "the user owns this repo" write is built by the one helper', () => {
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const handRolled = code.match(/repoOwnedByUser:\s*true/g) ?? [];
    // The only surviving occurrences are inside calls that spread the helper's own result.
    expect(handRolled).toEqual([]);
    expect(code).toContain('ownRepoMemoryPatch(');
  });
});

/**
 * 🔴 THE 2026-09-12 ROOT CAUSE, IN ONE SENTENCE: the fact "this app lives in the user's own GitHub"
 * is four fields, and one writer wrote three of them.
 *
 * The admin's report was the same sentence as 2026-09-06 — *"github already connect hai, app github
 * se hi import ki hai, fir se github connect ki bol raha hai"* — which is why it is worth being
 * precise about what was actually wrong. The MODULE was right. The own-repo import path built its
 * own object literal and omitted `repoName`, so the record claimed ownership it could not name.
 *
 * And the obvious repair — "just add repoName" — was the destructive one. `repoName` is the STORAGE
 * repo, re-read next turn as the name to push to; writing the user's real repository into it would
 * aim a later mirror fall-back at their own code. Hence a separate `deployRepoName`, and a builder
 * that has to be told which of the two a repo is.
 */
describe('ownRepoMemoryPatch — the fact is whole or it is not written', () => {
  it('an own-repo IMPORT records the deploy repo and leaves the storage name alone', () => {
    const patch = ownRepoMemoryPatch({ owner: 'asheesh', repo: 'mitrify', deployBranch: 'main', storesCode: false });
    expect(patch).toEqual({
      repoOwner: 'asheesh', deployRepoName: 'mitrify', repoOwnedByUser: true, deployBranch: 'main',
    });
    // 🔒 The destructive direction: pinning the user's real repository as the storage repo.
    expect(patch).not.toHaveProperty('repoName');
  });

  it('a repo we created and pushed to IS the storage repo, so both names are written', () => {
    const patch = ownRepoMemoryPatch({ owner: 'asheesh', repo: 'app-x1', deployBranch: 'main', storesCode: true });
    expect(patch).toEqual({
      repoOwner: 'asheesh', deployRepoName: 'app-x1', repoName: 'app-x1', repoOwnedByUser: true, deployBranch: 'main',
    });
  });

  it('an incomplete fact writes NOTHING — never a record that claims what it cannot name', () => {
    expect(ownRepoMemoryPatch({ owner: '', repo: 'mitrify', deployBranch: 'main', storesCode: false })).toBeNull();
    expect(ownRepoMemoryPatch({ owner: 'asheesh', repo: '', deployBranch: 'main', storesCode: false })).toBeNull();
    expect(ownRepoMemoryPatch({ owner: 'asheesh', repo: 'mitrify', deployBranch: '', storesCode: false })).toBeNull();
    expect(ownRepoMemoryPatch({ owner: '  ', repo: '  ', deployBranch: '  ', storesCode: true })).toBeNull();
  });

  it('whatever it does write is, by construction, a record both readers accept', () => {
    const patch = ownRepoMemoryPatch({ owner: ' asheesh ', repo: ' mitrify ', deployBranch: ' main ', storesCode: false });
    expect(ownRepoRecordComplete(patch)).toBe(true);
    expect(resolveDeployRepo(null, patch)).toEqual({
      owner: 'asheesh', repo: 'mitrify', repoUrl: 'https://github.com/asheesh/mitrify', branch: 'main',
    });
  });
});

describe('deployRepoNameOf — the deploy name wins, the storage name is only the old fallback', () => {
  it('prefers the deploy repo when both are present and they differ', () => {
    // Exactly the imported-app shape: storage is the derived mirror, deploy is their real repo.
    expect(deployRepoNameOf({ repoName: 'app-mirror-9f3k', deployRepoName: 'mitrify' })).toBe('mitrify');
  });

  it('falls back to the storage name for records written before the field existed', () => {
    // Right for mirror-stored apps, where the two are the same repository.
    expect(deployRepoNameOf({ repoName: 'app-mirror-9f3k' })).toBe('app-mirror-9f3k');
  });

  it('a blank of either kind is not a name', () => {
    expect(deployRepoNameOf({ deployRepoName: '   ', repoName: '  ' })).toBe('');
    expect(deployRepoNameOf(null)).toBe('');
    expect(deployRepoNameOf(undefined)).toBe('');
  });
});

/**
 * 🔴 THE SIBLING THE SPLIT CREATED, AND WHY IT HAD TO BE HUNTED (rule 3).
 *
 * Splitting one field into two is not free: every place that WROTE the old field now has to decide
 * whether the other one moves with it. Renaming an app renames its storage repo on GitHub — which,
 * while one field carried both meanings, was automatically right for the deploy as well. These cases
 * pin the rule that replaces "automatically".
 */
describe('renameStorageRepoPatch — the deploy name moves only when the rename moved its repo', () => {
  it('a mirror-stored app: one repository, so both names follow the rename', () => {
    expect(renameStorageRepoPatch({ repoName: 'old-name', deployRepoName: 'old-name' }, 'new-name'))
      .toEqual({ repoName: 'new-name', deployRepoName: 'new-name' });
  });

  it('a record from before the split: the deploy name WAS the storage name, so it follows', () => {
    expect(renameStorageRepoPatch({ repoName: 'old-name' }, 'new-name'))
      .toEqual({ repoName: 'new-name', deployRepoName: 'new-name' });
  });

  it('🔒 an app imported from the user OWN repo: the rename touched the mirror, not their repo', () => {
    // The deploy must keep pointing at `asheesh/mitrify`. Moving it here would aim a real deploy at a
    // repository that was never renamed and does not exist under the new name.
    expect(renameStorageRepoPatch({ repoName: 'app-mirror-9f3k', deployRepoName: 'mitrify' }, 'new-name'))
      .toEqual({ repoName: 'new-name' });
  });

  it('a brand-new app that has never been pushed: nothing to preserve, both are set', () => {
    expect(renameStorageRepoPatch(null, 'new-name')).toEqual({ repoName: 'new-name', deployRepoName: 'new-name' });
    expect(renameStorageRepoPatch({}, 'new-name')).toEqual({ repoName: 'new-name', deployRepoName: 'new-name' });
  });

  it('an empty new name never invents a deploy repo', () => {
    expect(renameStorageRepoPatch({ repoName: 'old-name' }, '   ')).toEqual({ repoName: '' });
  });
});
