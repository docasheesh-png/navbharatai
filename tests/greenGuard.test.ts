import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decideGreenGuard, restorePlan, greenGuardMessage,
  greenWorkspaceKey, isGreenSnapshotKey, greenGuardEnabled,
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
    const d = decideGreenGuard({ before: null, after: { green: true }, hasSnapshot: false });
    expect(d.action).toBe('save');
    // Even when a snapshot already exists — the newest working state is the one worth keeping.
    expect(decideGreenGuard({ before: { green: true }, after: { green: true }, hasSnapshot: true }).action).toBe('save');
  });
});

describe('LAYER 2 — a turn can never leave the user worse off than they started', () => {
  it('RESTORES when a working app stopped working this turn', () => {
    const d = decideGreenGuard({ before: { green: true }, after: { green: false }, hasSnapshot: true });
    expect(d.action).toBe('restore');
    expect(d.reason).toMatch(/was verified working before this turn/);
  });

  it('does NOT restore on a build that was never green — there is nothing good to go back to', () => {
    expect(decideGreenGuard({ before: { green: false }, after: { green: false }, hasSnapshot: true }).action).toBe('none');
    expect(decideGreenGuard({ before: null, after: { green: false }, hasSnapshot: false }).action).toBe('none');
  });

  it('is HONEST when it believes the app was working but never captured it', () => {
    const d = decideGreenGuard({ before: { green: true }, after: { green: false }, hasSnapshot: false });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/no verified-good snapshot was captured/i);
  });

  it('an unknown/absent verdict is never treated as green (green must be EARNED)', () => {
    expect(decideGreenGuard({ before: { green: true }, after: undefined, hasSnapshot: true }).action).toBe('restore');
    expect(decideGreenGuard({ before: undefined, after: undefined, hasSnapshot: true }).action).toBe('none');
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
