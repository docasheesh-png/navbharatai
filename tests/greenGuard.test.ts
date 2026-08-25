import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decideGreenGuard, restorePlan, greenGuardMessage, greenGuardUnverifiedMessage,
  greenWorkspaceKey, isGreenSnapshotKey, greenGuardEnabled, buildRemoveCommand,
  wantsAttemptBack, attemptWorkspaceKey, attemptRestoredMessage, KEEP_CHANGES_PHRASE,
} from '../src/server/AgentV3/GreenGuard';

/**
 * ADMIN 2026-08-09: "pehli build me 4-5 min me working app ban jati hai — baad me 20 min tak use edit
 * kar ke kharab kyu kiya jata hai? … app banne ke baad kharab nahi honi chahiye."
 *
 * The decision half of the answer. Two layers, one rule each:
 *   LAYER 1 — a turn that ends with an EARNED green verdict becomes the last known good.
 *   LAYER 2 — a turn that ends not-green on a workspace that WAS green puts the good state back.
 * The guarantee this buys is monotonicity: a turn can help or do nothing, never harm — the same
 * property EndgameRepair's convergence guard already proves for a single repair pass, raised to the
 * level of the whole turn.
 */

describe('LAYER 1 — a verified working app becomes the last known good', () => {
  it('saves whenever the turn ends green', () => {
    const d = decideGreenGuard({ before: null, after: { green: true }, hasSnapshot: false, provenBroken: false });
    expect(d.action).toBe('save');
    // Even when a snapshot already exists — the newest working state is the one worth keeping.
    expect(decideGreenGuard({ before: { green: true }, after: { green: true }, hasSnapshot: true, provenBroken: false }).action).toBe('save');
  });

  /**
   * FIRST LIVE RUN, real build report 02be22e3 (2026-08-09) — the guard worked, and its WORDING did not.
   * It recorded "The turn ended with a verified working app" on a build whose own health said
   * "NOT READY · 66/100 — 5 incomplete features (placeholder code)". Two lines of one report
   * contradicting each other is exactly the failure class this project keeps killing.
   */
  it('says only what it MEASURED — "opened in a real browser and rendered", not "working"', () => {
    const d = decideGreenGuard({ before: null, after: { green: true }, hasSnapshot: false, provenBroken: false });
    expect(d.reason).toMatch(/opened in a real browser and rendered/);
    expect(d.reason).not.toMatch(/verified working app/);
  });

  it('an unfinished build is still protected, but the record says so', () => {
    const d = decideGreenGuard({ before: null, after: { green: true }, hasSnapshot: false, provenBroken: false, ready: false });
    // Still saved: a snapshot that LOADS is worth protecting — the alternative is protecting nothing.
    expect(d.action).toBe('save');
    expect(d.reason).toMatch(/best known state, not a finished one/);
  });

  it('a build with no unresolved blocker carries no caveat', () => {
    expect(decideGreenGuard({ before: null, after: { green: true }, hasSnapshot: false, provenBroken: false, ready: true }).reason)
      .not.toMatch(/best known state/);
  });

  it('WIRING: the readiness verdict really reaches the record', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('ready: !buildDiag.hasUnresolvedReadinessBlocker()');
  });
});

describe('LAYER 2 — a turn can never leave the user worse off than they started', () => {
  it('RESTORES when a working app stopped working this turn', () => {
    const d = decideGreenGuard({ before: { green: true }, after: { green: false }, hasSnapshot: true, provenBroken: true });
    expect(d.action).toBe('restore');
    expect(d.reason).toMatch(/was verified working before this turn/);
  });

  it('does NOT restore on a build that was never green — there is nothing good to go back to', () => {
    expect(decideGreenGuard({ before: { green: false }, after: { green: false }, hasSnapshot: true, provenBroken: true }).action).toBe('none');
    expect(decideGreenGuard({ before: null, after: { green: false }, hasSnapshot: false, provenBroken: true }).action).toBe('none');
  });

  it('is HONEST when it believes the app was working but never captured it', () => {
    const d = decideGreenGuard({ before: { green: true }, after: { green: false }, hasSnapshot: false, provenBroken: true });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/no verified-good snapshot was captured/i);
  });

  it('an unknown/absent verdict is never treated as green (green must be EARNED)', () => {
    expect(decideGreenGuard({ before: { green: true }, after: undefined, hasSnapshot: true, provenBroken: true }).action).toBe('restore');
    expect(decideGreenGuard({ before: undefined, after: undefined, hasSnapshot: true, provenBroken: true }).action).toBe('none');
  });
});

describe('IGNORANCE IS NOT EVIDENCE — an unverifiable turn is never undone (admin report 2026-08-25)', () => {
  it('KEEPS the turn when the app could not be opened, even though it was green before', () => {
    const d = decideGreenGuard({
      before: { green: true }, after: { green: false }, hasSnapshot: true, provenBroken: false,
    });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/could not be opened/i);
    expect(d.reason).toMatch(/last known good version is still saved/i);
  });

  it('still RESTORES when the app was actually opened and seen broken', () => {
    const d = decideGreenGuard({
      before: { green: true }, after: { green: false }, hasSnapshot: true, provenBroken: true,
    });
    expect(d.action).toBe('restore');
  });

  it("THE ADMIN'S BUG, END TO END: a preview that is DOWN can no longer erase the speed edit", () => {
    // The workspace was green once (snapshot exists). The user asks for more speed. The engine writes
    // it. The preview cannot be opened at all — which is exactly what that build's prompt said was
    // wrong. Before this fix every one of these turns RESTORED, so the speed edit vanished and the
    // file went back to an older snapshot that still had speed 0 — "speed fir se 0 ho gayi".
    const turns = Array.from({ length: 4 }, () => decideGreenGuard({
      before: { green: true }, after: { green: false }, hasSnapshot: true, provenBroken: false,
    }));
    expect(turns.every((t) => t.action === 'none')).toBe(true);
    expect(turns.some((t) => t.action === 'restore')).toBe(false);
  });

  it('a turn that ends GREEN is saved regardless of the flag — green outranks everything', () => {
    for (const provenBroken of [true, false]) {
      expect(decideGreenGuard({
        before: { green: true }, after: { green: true }, hasSnapshot: true, provenBroken,
      }).action).toBe('save');
    }
  });

  it('tells the user their change was kept AND unchecked — never silently, never as "done"', () => {
    const m = greenGuardUnverifiedMessage();
    expect(m).toMatch(/could not open your app/i);
    expect(m).toMatch(/saved/i);
    expect(m).toMatch(/nothing was lost/i);
    // White-label law: no vendor, model or infrastructure name may reach a user.
    expect(m.toLowerCase()).not.toMatch(/e2b|sandbox|glm|kimi|claude|gemini|grok|anthropic|vite|playwright/);
  });
});

describe('WIRING — the guard is told what was OBSERVED, not merely what was not green', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('passes the real observation flag into the decision', () => {
    expect(route).toContain('provenBroken: previewProvenBroken,');
  });

  it('a route regression still counts as OBSERVED, so the veto keeps its teeth', () => {
    // Without this the fix above would silently disable the route-fingerprint veto: it sets
    // previewGreen = false after opening a page that did not render, which is an observation.
    const at = route.indexOf('veto: Green Guard now restores');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 600)).toContain('previewProvenBroken = true;');
  });

  it('the kept-but-unchecked branch tells the user and records an honest finding', () => {
    const at = route.indexOf('── GREEN GUARD, LAYER 2');
    const seg = route.slice(at, at + 7000);
    expect(seg).toContain('greenGuardUnverifiedMessage()');
    expect(seg).toContain('GREEN_GUARD_UNVERIFIED');
  });
});

describe('the restore is a REAL restore, not an overlay', () => {
  it('writes back changed files, keeps identical ones, and removes what the bad turn added', () => {
    const good = { 'a.tsx': 'GOOD', 'b.tsx': 'SAME' };
    const broken = { 'a.tsx': 'BROKEN', 'b.tsx': 'SAME', 'c.tsx': 'NEW FROM THE BAD EDIT' };
    const plan = restorePlan(good, broken);
    expect(plan.write).toEqual({ 'a.tsx': 'GOOD' });
    expect(plan.unchanged).toBe(1);
    // THE HYBRID TRAP: leaving c.tsx behind yields a third state that was never tested — neither the
    // working app nor the broken one. That is how a "rollback" quietly makes things worse.
    expect(plan.remove).toEqual(['c.tsx']);
  });

  it('a file the bad turn DELETED comes back', () => {
    const plan = restorePlan({ 'a.tsx': 'GOOD', 'gone.tsx': 'RESTORED' }, { 'a.tsx': 'GOOD' });
    expect(plan.write).toEqual({ 'gone.tsx': 'RESTORED' });
    expect(plan.remove).toEqual([]);
  });

  it('an already-correct tree produces NO writes at all (restore is idempotent)', () => {
    const same = { 'a.tsx': 'GOOD' };
    const plan = restorePlan(same, same);
    expect(plan.write).toEqual({});
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('survives empty/absent inputs rather than throwing mid-restore', () => {
    expect(restorePlan({}, {})).toEqual({ write: {}, remove: [], unchanged: 0 });
    expect(restorePlan(undefined as any, undefined as any).write).toEqual({});
  });
});

describe('what the user is told', () => {
  it('says plainly what happened and that nothing was lost', () => {
    const msg = greenGuardMessage(restorePlan({ 'a.tsx': 'GOOD' }, { 'a.tsx': 'BAD', 'c.tsx': 'NEW' }));
    expect(msg).toMatch(/restored the last version that ran correctly/);
    expect(msg).toMatch(/1 file put back/);
    expect(msg).toMatch(/1 file added by that attempt removed/);
    expect(msg).toMatch(/nothing of it was lost/i);
  });

  it('names no AI vendor or model — legal/user surfaces stay white-label', () => {
    const msg = greenGuardMessage(restorePlan({ 'a.tsx': 'G' }, { 'a.tsx': 'B' }));
    expect(msg).not.toMatch(/\b(claude|anthropic|gpt|openai|gemini|glm|kimi|grok|sonnet|opus|haiku)\b/i);
  });
});

describe('where a snapshot lives — and why it must never look like an app', () => {
  it('reuses the project file store under a suffixed key', () => {
    expect(greenWorkspaceKey('agentv3-u1-s1')).toBe('agentv3-u1-s1::green');
    expect(isGreenSnapshotKey('agentv3-u1-s1::green')).toBe(true);
    expect(isGreenSnapshotKey('agentv3-u1-s1')).toBe(false);
    expect(isGreenSnapshotKey(undefined as any)).toBe(false);
  });

  it('THE SIBLING: the user\'s app list excludes snapshots', () => {
    // listUserWorkspaceApps prefix-scans `agentv3-<uid>-`, and a snapshot key shares that prefix — so
    // without this the user would see their app TWICE and could open the backup by mistake.
    const store = readFileSync(join(process.cwd(), 'src/server/AgentV3/WorkspaceFileStore.ts'), 'utf8');
    const at = store.indexOf('export async function listUserWorkspaceApps');
    expect(store.slice(at, at + 1600)).toContain('isGreenSnapshotKey(d.id)');
  });
});

describe('the kill switch (project convention: off without a deploy)', () => {
  it('is on by default and off only when explicitly set', () => {
    expect(greenGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(greenGuardEnabled({ AGENTV3_GREEN_GUARD: 'off' } as any)).toBe(false);
    expect(greenGuardEnabled({ AGENTV3_GREEN_GUARD: ' OFF ' } as any)).toBe(false);
    expect(greenGuardEnabled({ AGENTV3_GREEN_GUARD: 'on' } as any)).toBe(true);
  });
});

describe('removing what the failed attempt added — in the SANDBOX too', () => {
  it('builds a bounded rm for safe workspace paths', () => {
    expect(buildRemoveCommand(['src/New.tsx', 'lib/a-b_c.ts'])).toBe("rm -f -- 'src/New.tsx' 'lib/a-b_c.ts'");
    expect(buildRemoveCommand([])).toBe('');
  });

  it('DROPS anything that could escape the workspace or the quotes (no injection surface)', () => {
    const bad = ['../../etc/passwd', '/etc/passwd', "a';rm -rf /;'", 'a$(whoami)', 'a`id`', 'a b|c', 'a\nb', '-rf'];
    for (const p of bad) expect(buildRemoveCommand([p]), p).toBe('');
    // A safe path alongside bad ones survives; the bad ones are dropped, never escaped.
    expect(buildRemoveCommand(['ok.ts', '../evil'])).toBe("rm -f -- 'ok.ts'");
  });

  it('is capped, so a pathological restore cannot build an unbounded command line', () => {
    const many = Array.from({ length: 500 }, (_, i) => `f${i}.ts`);
    expect(buildRemoveCommand(many, 3)).toBe("rm -f -- 'f0.ts' 'f1.ts' 'f2.ts'");
  });
});

describe('LAYER 2 WIRING — the guard is on the real save path and can never cost a user their files', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const at = route.indexOf('── GREEN GUARD, LAYER 2');
  // Widened from 5200 when the kept-but-unchecked branch landed (2026-08-25). The window still means
  // "inside the Green Guard block" — it ends just past the plain-save fallback, which is the block's
  // last line — so every assertion below is still about this code and not something further down.
  const seg = route.slice(at, at + 6400);

  it('sits at the durable file save — the exact line that used to overwrite a working app', () => {
    expect(at).toBeGreaterThan(-1);
    expect(seg).toContain('decideGreenGuard(');
    expect(seg).toContain('greenWorkspaceKey(workspaceId)');
  });

  it('green is EARNED — only a real-browser render sets it', () => {
    // Both setters sit beside a recordPreviewVerified() call; nothing else may set it. (The window is
    // wide enough to clear the GREEN FREEZE latch block (which latches the snapshot only on a real
    // browser render) that now sits between the setter and the
    // recordPreviewVerified() call — the earned-green association is unchanged, only spaced out.)
    const setters = route.match(/previewGreen = true;/g) || [];
    expect(setters.length).toBe(2);
    for (const m of route.matchAll(/previewGreen = true;/g)) {
      expect(route.slice(m.index!, m.index! + 1400)).toContain('recordPreviewVerified()');
    }
  });

  it('the failed attempt is KEPT before anything is undone', () => {
    // The key moved behind attemptWorkspaceKey() when the "keep my changes" hatch began reading it —
    // one helper for the writer and the reader, so the two can never disagree about where it lives.
    const keep = seg.indexOf('attemptWorkspaceKey(workspaceId)');
    expect(keep).toBeGreaterThan(-1);
    expect(keep).toBeLessThan(seg.indexOf('saveWorkspaceFiles(workspaceId, snapshot)'));
  });

  it('the plain save still runs when the guard did not save — a user never loses their files', () => {
    expect(seg).toContain('if (!saved) saveWorkspaceFiles(workspaceId, toSave)');
    expect(seg).toContain('/* the guard must never cost a user their save');
  });

  it('is flag-gated and records its decision for the admin either way', () => {
    expect(seg).toContain('greenGuardEnabled()');
    expect(seg).toContain('GREEN_GUARD_');
  });
});

describe('"KEEP MY CHANGES" — the escape hatch, because a net you cannot leave is a cage', () => {
  /**
   * Green Guard has exactly one honest false positive: a user who asked for something LARGE on purpose
   * (a framework migration, a rewrite) is rolled back because their app legitimately does not render
   * yet. The attempt was already preserved; this makes it reachable in one sentence.
   */
  it('honours the exact words the restore message tells the user', () => {
    expect(wantsAttemptBack('keep my changes')).toBe(true);
    expect(wantsAttemptBack('  KEEP MY CHANGES  ')).toBe(true);
    // People write instructions, not commands — the phrase inside a longer sentence still counts.
    expect(wantsAttemptBack('keep my changes and add a login page')).toBe(true);
  });

  it('honours the Hinglish a real user of this app actually types', () => {
    expect(wantsAttemptBack('mere changes rakho')).toBe(true);
    expect(wantsAttemptBack('wo wapas do')).toBe(true);
    expect(wantsAttemptBack('purana wala wapas chahiye')).toBe(true);
  });

  it('is NOT a classifier — a merely similar request must not restore a broken tree', () => {
    // Getting this wrong either strands the user or overwrites a working app with a broken one, so
    // nothing is inferred beyond the stated phrase.
    expect(wantsAttemptBack('keep the design the same')).toBe(false);
    expect(wantsAttemptBack('do not change my code')).toBe(false);
    expect(wantsAttemptBack('undo that')).toBe(false);
    expect(wantsAttemptBack('revert')).toBe(false);
    expect(wantsAttemptBack('')).toBe(false);
    expect(wantsAttemptBack(null)).toBe(false);
  });

  it('the restore message TELLS the user those exact words (or the hatch is undiscoverable)', () => {
    const msg = greenGuardMessage(restorePlan({ 'a.tsx': 'G' }, { 'a.tsx': 'B' }));
    expect(msg).toContain(KEEP_CHANGES_PHRASE);
    expect(msg).toMatch(/the attempt is saved too/);
  });

  it('handing the attempt back does not pretend it works', () => {
    const msg = attemptRestoredMessage(3);
    expect(msg).toMatch(/3 files/);
    expect(msg).toMatch(/did not run correctly/); // honest: this version was rolled back for a reason
  });

  it('the attempt key is the same one the rollback wrote to', () => {
    expect(attemptWorkspaceKey('ws1')).toBe('ws1::attempt');
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('saveWorkspaceFiles(attemptWorkspaceKey(workspaceId), toSave)');
  });

  it('WIRING: it runs BEFORE the file guardian, so one restore path carries it into the sandbox', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const hatch = route.indexOf('── "KEEP MY CHANGES"');
    const guardian = route.indexOf('const plan = planFileGuardian(');
    expect(hatch).toBeGreaterThan(-1);
    expect(hatch).toBeLessThan(guardian);
    const seg = route.slice(hatch, hatch + 3200);
    expect(seg).toContain('wantsAttemptBack(prompt)');
    expect(seg).toContain('GREEN_GUARD_ATTEMPT_RESTORED');
    // Honest when there is nothing to give back, rather than silently doing nothing.
    expect(seg).toContain('There is no earlier version of yours saved to bring back');
  });
});
