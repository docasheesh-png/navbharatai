/**
 * PRESSING RESUME MUST NEVER EMPTY THE SCREEN.
 *
 * ADMIN REPORT 2026-08-16, verbatim:
 *   "app ready hai, ban gayi hai … right upper corner par 'resume/stop' aata hai. maine resume par
 *    click kar diya — pura app wapas banne laga, sara data gayab, sari files gayab, sara preview gayab."
 *
 * TWO INDEPENDENT DEFECTS, both fixed, and either alone was enough to cause this:
 *
 * 1️⃣ `resume()` reset the client state to `initialAgentV3State()` and carried only `activityLog`,
 *    `diffs` and `todos` forward. It had the right instinct — "state that outlives a single turn must
 *    survive the reconnect" — and the wrong list: it dropped `files` and `previewUrl`, the two things
 *    the user actually SEES. Pressing Resume on a FINISHED build (whose attach necessarily 404s,
 *    because there is nothing left to attach to) therefore blanked the whole app while the banner
 *    said "your files are safe". They were safe on the server, which is no comfort when the screen
 *    is empty.
 *
 * 2️⃣ The durable restore for that exact case already existed — the "SAB CHALA GAYA" fix of
 *    2026-07-12 — but was bolted onto the AUTO-resume effect only. The two BUTTONS a user actually
 *    presses called `resumeBuild(...)` bare, so the failure that fix was written for came back
 *    through a different door five weeks later. A fix attached to one call site is a coincidence,
 *    not a fix.
 *
 * 🔒 THE RULE THESE TESTS PIN: WORKSPACE facts (files, preview, checkpoints) survive a reconnect;
 *    STREAM facts (narration, activity, terminal) are rebuilt from the replay.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';
import { shouldRestoreFinishedBuild } from '../src/hooks/agentV3StreamError';

const hook = readFileSync(join(__dirname, '../src/hooks/useAgentV3Build.ts'), 'utf8');
const panel = readFileSync(join(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

/** The reset `resume()` performs, extracted so the test reasons about the real object shape. */
function resumeReset(prev: ReturnType<typeof initialAgentV3State>) {
  return {
    ...initialAgentV3State(),
    files: prev.files,
    previewUrl: prev.previewUrl,
    checkpoints: prev.checkpoints,
    activityLog: prev.activityLog,
    diffs: prev.diffs,
    todos: prev.todos,
  };
}

describe('🔒 1️⃣ the app survives a reconnect', () => {
  const before = {
    ...initialAgentV3State(),
    files: [{ path: 'src/App.tsx', content: 'x' }, { path: 'package.json', content: '{}' }],
    previewUrl: 'https://5173-abc.e2b.app',
    checkpoints: [{ id: 'c1' }],
    narration: [{ agent: 'architect', text: 'building…', ts: 1 }],
    terminal: [{ line: 'npm run dev' }],
  } as never as ReturnType<typeof initialAgentV3State>;

  const after = resumeReset(before);

  it('the FILES are still there — this is the whole report', () => {
    expect(after.files).toHaveLength(2);
    expect(after.files).toEqual(before.files);
  });

  it('the PREVIEW is still there', () => {
    expect(after.previewUrl).toBe('https://5173-abc.e2b.app');
  });

  it('checkpoints survive too — they are workspace facts, not stream facts', () => {
    expect(after.checkpoints).toEqual(before.checkpoints);
  });

  it('🔒 but STREAM state IS cleared — the replay rebuilds it, and keeping it would duplicate', () => {
    expect(after.narration).toEqual([]);
    expect(after.terminal).toEqual([]);
    expect(after.activity).toEqual([]);
  });

  it('the fields the earlier fix already protected are untouched', () => {
    expect(after.activityLog).toEqual(before.activityLog);
    expect(after.diffs).toEqual(before.diffs);
    expect(after.todos).toEqual(before.todos);
  });

  it('🔒 the real resume() carries exactly these forward — pinned against the source', () => {
    // The reset lives inside a 12k-line hook; nothing FAILS if a refactor drops a line from it, the
    // user's app just silently vanishes again. So the source itself is the assertion.
    // Slice to the next function rather than a byte count — the reset moved DEEPER into resume()
    // when it was gated on the confirmed attach, and a fixed window is exactly the kind of pin that
    // silently stops guarding after an honest refactor.
    const at = hook.indexOf('const resume = useCallback');
    const body = hook.slice(at, hook.indexOf('const shipToMain', at));
    for (const field of ['files: prev.files', 'previewUrl: prev.previewUrl', 'checkpoints: prev.checkpoints']) {
      expect(body, field).toContain(field);
    }
  });

  it('🔒 the reset runs ONLY after the attach confirms a live stream (2026-08-17)', () => {
    // The second half of the same class: even with the workspace facts preserved, resetting BEFORE
    // /attach answered cleared the narration — the "Done ✓ · cost · Build health" summary — on the
    // promise of a replay. A GONE attach has no replay, so the user watched a finished conversation
    // become one lonely notice. The reset exists only to make room for a replay: it must sit AFTER
    // the `res.ok` check, and the gone path must not touch state beyond appending its notice.
    const at = hook.indexOf('const resume = useCallback');
    const body = hook.slice(at, hook.indexOf('const shipToMain', at));
    const resetAt = body.indexOf('...initialAgentV3State()');
    const confirmAt = body.indexOf('if (!res.ok || !res.body)');
    expect(resetAt, 'the making-room reset must exist').toBeGreaterThan(-1);
    expect(confirmAt, 'the attach confirmation check must exist').toBeGreaterThan(-1);
    expect(resetAt, 'reset must come AFTER the ok-check, i.e. only on a confirmed live attach').toBeGreaterThan(confirmAt);
    // And the gone path stays additive: it appends a narration notice, never a state reset.
    const goneBlock = body.slice(confirmAt, body.indexOf('// Live build CONFIRMED'));
    expect(goneBlock).not.toContain('initialAgentV3State');
  });

  it('the gone notice never orders the user to resend work they did not lose', () => {
    // "Send your message again" was written for a dropped mid-build connection, but the Resume
    // button shows it to a user who sent nothing — being told to redo unremembered work IS the
    // jhatka. The default must stay calm and truthful instead.
    const at = hook.indexOf('const resume = useCallback');
    const body = hook.slice(at, hook.indexOf('const shipToMain', at));
    expect(body).not.toContain('Send your message again');
    expect(body).toContain('Everything is saved');
  });
});

describe('🔒 2️⃣ every re-attach path carries the recovery', () => {
  it('there is ONE attach helper, and it does the durable restore', () => {
    expect(panel).toContain('const attachToBuild = useCallback');
    const at = panel.indexOf('const attachToBuild = useCallback');
    const body = panel.slice(at, at + 1200);
    expect(body).toContain('shouldRestoreFinishedBuild');
    expect(body).toContain('openConversation');
  });

  it('🔒 no call site calls resumeBuild directly any more — that is how the bug returned', () => {
    // Anchored on the INVOCATION form `resumeBuild({…})`, not the bare name: the surrounding comments
    // discuss `resumeBuild()` and `resumeBuild(...)` by name, and counting those would measure prose
    // instead of behaviour. The single permitted call is the one inside attachToBuild.
    const calls = panel.match(/resumeBuild\(\{/g) ?? [];
    expect(calls.length).toBe(1);
    const at = panel.indexOf('const attachToBuild = useCallback');
    expect(panel.indexOf('resumeBuild({')).toBeGreaterThan(at);
  });

  it('the Resume and Connect buttons both go through it', () => {
    const clicks = panel.match(/onClick=\{\(\) => \{ void attachToBuild\(\); \}\}/g) ?? [];
    expect(clicks.length).toBeGreaterThanOrEqual(2);
  });

  it('the auto-resume effect goes through it too', () => {
    expect(panel).toContain('void attachToBuild();');
  });

  it('a finished build is the case that triggers the restore', () => {
    expect(shouldRestoreFinishedBuild('gone-notice')).toBe(true);
    for (const o of ['live', 'gone-silent', 'error', 'aborted'] as const) {
      expect(shouldRestoreFinishedBuild(o), o).toBe(false);
    }
  });
});
