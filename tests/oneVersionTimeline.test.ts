// ONE VERSION TIMELINE, AND GOING BACK REALLY GOES BACK (admin 2026-10-11, Q-128: "one timeline — Time Machine
// is the one version history; the History tab becomes a view of it").
//
// Three defects behind one decision, each locked here:
//  1. Time Machine's Restore changed only the browser's copy (`setFiles` + `updatePreview`); the saved app the
//     next build reads stayed on the newer files. THE CLASS: a restore that changes the view, not the thing.
//  2. Time Machine's "this app" was App's legacy `pro-<timestamp>` session, while the builder keeps its app
//     under the sticky v5 session — so the current app's versions were listed as "another app".
//  3. The builder's History tab listed sandbox git steps as the app's history, beside a different list in
//     Time Machine. Now both screens render ONE component over ONE store.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { versionRestorePlan, versionRestoreMessage, beforeRestoreVersionName, MAX_OMITTED_PATHS_REMEMBERED } from '../src/server/project/versionRestore';
import { historyKeyFor, readVersionRestoreResponse } from '../src/lib/versionRestoreClient';
import { restorePointKey } from '../src/server/AgentV3/restorePoint';
import { planVersionFiles } from '../src/server/project/BuildHistoryStore';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('🔒 a restore puts the whole app back — never a mix of old and new', () => {
  const current = { 'src/App.tsx': 'new app', 'src/New.tsx': 'added after', 'src/Same.tsx': 'same' };
  const version = { 'src/App.tsx': 'old app', 'src/Same.tsx': 'same' };

  it('writes what differs, removes what the version never had, and the target is exactly the version', () => {
    const plan = versionRestorePlan({ versionFiles: version, current });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.target).toEqual(version);
    expect(plan.write).toEqual({ 'src/App.tsx': 'old app' });
    expect(plan.remove).toEqual(['src/New.tsx']);
    expect(plan.unchanged).toBe(1);
    expect(plan.noChange).toBe(false);
  });

  it('🔒 an unreadable version is never "an empty app" — refusing beats wiping', () => {
    for (const v of [null, undefined, {}]) expect(versionRestorePlan({ versionFiles: v, current }).ok).toBe(false);
  });

  it('a file the version could not keep is never deleted', () => {
    const named = versionRestorePlan({ versionFiles: version, omittedFileCount: 1, omittedPaths: ['src/New.tsx'], current });
    expect(named.ok && named.remove).toEqual([]);
    expect(named.ok && named.target['src/New.tsx']).toBe('added after');
    expect(named.ok && named.keptUnknown).toBe(0);
    // An older version that does not say which: every unlisted current file is kept, and COUNTED.
    const unnamed = versionRestorePlan({ versionFiles: version, omittedFileCount: 1, current });
    expect(unnamed.ok && unnamed.remove).toEqual([]);
    expect(unnamed.ok && unnamed.keptUnknown).toBe(1);
  });

  it('the app already being that version changes nothing', () => {
    const plan = versionRestorePlan({ versionFiles: version, current: { ...version } });
    expect(plan.ok && plan.noChange).toBe(true);
  });

  it('a version now remembers which files it could not keep, bounded', () => {
    const big = 'x'.repeat(400_000);
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`src/f${i}.ts`] = `${big}${i}`;
    const plan = planVersionFiles(files, { AGENTV3_COMPACT_STORAGE: 'off' } as NodeJS.ProcessEnv);
    expect(plan.omitted.length).toBeGreaterThan(0);
    expect(MAX_OMITTED_PATHS_REMEMBERED).toBeGreaterThanOrEqual(100);
    const store = code('src/server/project/BuildHistoryStore.ts');
    expect(store).toContain('omittedPaths: plan.omitted.slice(0, MAX_OMITTED_PATHS_REMEMBERED)');
  });
});

describe('what the user is told', () => {
  it('says the app before is saved, and says plainly when the running copy still needs a second press', () => {
    const ok = versionRestoreMessage({ name: 'Login works', savedBefore: true, keptUnknown: 0, sandbox: 'updated', noChange: false });
    expect(ok).toContain('back to "Login works"');
    expect(ok).toMatch(/come forward again/);
    const retry = versionRestoreMessage({ name: 'Login works', savedBefore: true, keptUnknown: 0, sandbox: 'not-updated', noChange: false });
    expect(retry).toMatch(/tap Restore on this version again/);
    expect(beforeRestoreVersionName('Login works')).toBe('Before going back to "Login works"');
  });

  it('🔒 an OK status with no files is not a restore — the screen is never handed an empty app', () => {
    expect(readVersionRestoreResponse(true, { ok: true, files: {} }).ok).toBe(false);
    expect(readVersionRestoreResponse(true, { ok: true }).ok).toBe(false);
    expect(readVersionRestoreResponse(false, { error: 'A build is running' })).toEqual({ ok: false, message: 'A build is running' });
    const good = readVersionRestoreResponse(true, { ok: true, files: { 'a.ts': 'x', bad: 1 }, message: 'm', sandbox: 'not-updated' });
    expect(good).toEqual({ ok: true, files: { 'a.ts': 'x' }, message: 'm', needsRetry: true });
  });
});

describe('🔒 the screen lists the key the writer writes', () => {
  it('historyKeyFor is restorePointKey, case for case', () => {
    const cases: Array<[string, string | null]> = [
      ['agentv3-uid1-pro-1700000000000', 'uid1'],
      ['agentv3-uid1-6f1c2b9e-uuid', 'uid1'],
      ['agentv3-anon-abc', null],
      ['agentv3-uid2-x', 'uid1'],
      ['legacy-workspace', 'uid1'],
      ['agentv3-uid1-x', 'bad uid!'],
      ['agentv3-bad uid!-x', 'bad uid!'], // an unusable uid strips nothing, even where its prefix appears
      ['agentv3-' + 'u'.repeat(65) + '-x', 'u'.repeat(65)],
      ['', 'uid1'],
    ];
    for (const [ws, uid] of cases) expect(historyKeyFor(ws, uid), `${ws} / ${uid}`).toBe(restorePointKey(ws, uid));
  });
});

describe('🔒 one timeline, one restore', () => {
  const timeline = code('src/components/versions/VersionTimeline.tsx');
  const tm = code('src/components/ide/CodeVersioning.tsx');
  const panel = code('src/components/agentv3/AgentV3Panel.tsx');
  const views = code('src/components/panels/ViewPanels.tsx');
  const route = code('src/server/routes/agentv3.ts');

  it('both screens render the one timeline', () => {
    expect(tm).toContain('<VersionTimeline');
    expect(panel).toContain('<VersionTimeline');
  });

  it('a restore is the server restore — no screen downloads a version and calls that a restore', () => {
    expect(timeline).toContain("fetch('/api/agentv3/restore-version'");
    for (const [name, src] of [['Time Machine', tm], ['History tab', panel], ['timeline', timeline]] as const) {
      expect(src.includes('/api/build-history/${encodeURIComponent(sessionId)}/${encodeURIComponent('), name).toBe(false);
    }
    expect(route).toContain("app.post('/api/agentv3/restore-version'");
  });

  it('the route saves the app as it stands BEFORE it replaces it, and replaces rather than merges', () => {
    const at = route.indexOf("app.post('/api/agentv3/restore-version'");
    const body = route.slice(at, route.indexOf('app.post(', at + 10));
    const before = body.indexOf('beforeRestoreVersionName(');
    const replace = body.indexOf("saveWorkspaceFiles(workspaceId, plan.target, { mode: 'replace' })");
    expect(before).toBeGreaterThan(-1);
    expect(replace).toBeGreaterThan(before);
    expect(body).toContain('if (!savedBefore) {');
    expect(body).toContain('verifiedWorkspaceReadOk(verifiedUid, workspaceId)');
    expect(body).toContain('workspaceBuildIsLive(');
    expect(body).toContain('restorePlan(plan.target, live)');
  });

  it("Time Machine's current app is the builder's app, not the legacy pro- session", () => {
    expect(views).toContain('historyKeyFor(timeMachineWorkspace, user?.uid)');
    expect(views).not.toMatch(/<CodeVersioning[\s\S]{0,200}sessionId=\{currentProSessionId\}/);
  });
});
