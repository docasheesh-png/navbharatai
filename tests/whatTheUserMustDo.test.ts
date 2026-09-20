import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  actionKey, actionsFromEvent, approveAction, badgeCount, capActions, closeAction, groupOf,
  mayReopen, mergeUserActions, openActions, questionActions, releaseGate, secretActions,
  shouldAutoOpen, verifyAgainstVault, MAX_ACTIONS, MAX_QUESTIONS_PER_CLARIFY,
  type UserAction,
} from '../src/server/AgentV3/userActions';
import { normalizeUserAction } from '../src/server/AgentV3/UserActionStore';
import { attachUserActionRecorder } from '../src/server/AgentV3/userActionRecorder';
import {
  askPrompt, closedNote, closedRows, groupedOpen, isLiveOnly, mergeLiveActions, traySummary,
  type UserActionView,
} from '../src/components/agentv3/userActionView';
import { badgeCountLabel, visibleBadges, MAX_VISIBLE_BADGES, type HeaderBadge } from '../src/components/agentv3/headerBadges';

/**
 * WHAT THE USER MUST DO — one place, and only when there is something (admin 2026-09-20).
 *
 * *"yeh cheez abhi text chat me hi hai, aur bahut sare navbharatai ke response me kahi dab jati hai!
 * ab isko bahar rakh do!"* — plus the three conditions the admin attached: the badge shows ONLY when
 * something is genuinely needed, every row can be talked to instead of obeyed, and the header holds a
 * STRIP so ⁉️ and ✔️ can join ❓ later without this code being rewritten.
 *
 * The rules that make the badge trustworthy are the ones tested hardest here: a thing asked twice is
 * one row, a key already in the vault closes its own row, and a row the user declined is never asked
 * again. A badge that is usually lit is a badge nobody reads — and the one blocking ask then goes
 * unseen too.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BUILD = 'build-1';
const NEXT_BUILD = 'build-2';
const ask = (name: string, why = 'For payments') => ({ name, why });

describe('one thing, one row — identity is what is needed, never the wording', () => {
  it('the same credential asked twice is ONE row, whatever the message said', () => {
    const first = secretActions('c1', [ask('RAZORPAY_KEY_ID', 'Payments')], BUILD, 1);
    const again = secretActions('c2', [ask('RAZORPAY_KEY_ID', 'To take payments live')], BUILD, 2);
    const merged = mergeUserActions(first, again);
    expect(merged).toHaveLength(1);
    expect(merged[0].createdAt).toBe(1);          // it is the same row, not a replacement
    expect(merged[0].why).toBe('To take payments live'); // refreshed in place
    expect(merged[0].callId).toBe('c2');
  });

  it('a request naming three keys becomes three rows, so each can be finished on its own', () => {
    const rows = secretActions('c1', [ask('A_KEY'), ask('B_KEY'), ask('C_KEY')], BUILD, 1);
    expect(rows.map((r) => r.envName)).toEqual(['A_KEY', 'B_KEY', 'C_KEY']);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('two different questions never collide, even when their first 48 characters match', () => {
    const long = 'Should the attendance register keep a separate row for every single student or ';
    const rows = questionActions([`${long}one row per class`, `${long}one row per teacher`], BUILD, 1);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('a re-worded ask is a NEW row, a repeated one is not', () => {
    expect(actionKey('question', 'Do you want online payments?')).toBe(actionKey('question', 'do you want online payments'));
    expect(actionKey('question', 'Do you want online payments?')).not.toBe(actionKey('question', 'Do you want offline payments?'));
  });
});

describe('🔒 the badge is only ever lit for something real', () => {
  it("NavBharatAI's own credentials can never become a row the user is asked to fill", () => {
    const rows = secretActions('c1', [ask('ANTHROPIC_API_KEY'), ask('E2B_API_KEY'), ask('GLM_API_KEY'), ask('STRIPE_SECRET_KEY')], BUILD, 1);
    expect(rows.map((r) => r.envName)).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('an unusable variable name is dropped rather than shown as a task', () => {
    const rows = secretActions('c1', [ask('9LIVES'), ask('my key'), ask(''), ask('GOOD_KEY')], BUILD, 1);
    expect(rows.map((r) => r.envName)).toEqual(['GOOD_KEY']);
  });

  it('a chatty model cannot flood the tray with assumptions', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Assumption number ${i}`);
    expect(questionActions(many, BUILD, 1)).toHaveLength(MAX_QUESTIONS_PER_CLARIFY);
    expect(questionActions(['', '   ', null, 'Real one'], BUILD, 1).map((r) => r.title)).toEqual(['Real one']);
  });

  it('a gate with no words is not a row', () => {
    expect(approveAction('c1', '   ', BUILD, 1)).toBeNull();
    expect(approveAction('c1', 'Approve this plan to start building', BUILD, 1)?.blocking).toBe(true);
  });

  it('everything closed ⇒ count is zero ⇒ the header renders NOTHING', () => {
    const rows = secretActions('c1', [ask('A_KEY')], BUILD, 1);
    const closed = closeAction(rows, rows[0].id, 'done', 'user', 2);
    expect(badgeCount(closed)).toBe(0);
    const badge: HeaderBadge = { id: 'needs-you', glyph: '❓', label: 'What you need to do', count: 0, tone: 'info', onOpen: () => {} };
    expect(visibleBadges([badge])).toEqual([]);
  });
});

describe('a row closes ITSELF when the thing becomes true', () => {
  it('a key already in the vault closes as VERIFIED, with nobody pressing anything', () => {
    const rows = secretActions('c1', [ask('RAZORPAY_KEY_ID'), ask('MAPS_TOKEN')], BUILD, 1);
    const after = verifyAgainstVault(rows, ['razorpay_key_id'], 9);
    expect(after[0].status).toBe('done');
    expect(after[0].closedBy).toBe('verified');
    expect(after[0].closedAt).toBe(9);
    expect(after[1].status).toBe('open');
    expect(badgeCount(after)).toBe(1);
  });

  it('it never touches a gate or a question — only a credential can be checked this way', () => {
    const rows = [approveAction('c1', 'Approve the plan', BUILD, 1)!, ...questionActions(['Roles?'], BUILD, 1)];
    expect(verifyAgainstVault(rows, ['ANYTHING'], 9).every((r) => r.status === 'open')).toBe(true);
  });
});

describe('🔴 re-asking IS the nagging — when a closed row may come back', () => {
  const opened = () => secretActions('c1', [ask('A_KEY')], BUILD, 1);

  it('the SAME build repeating its ask does not re-open a row the user closed', () => {
    const closed = closeAction(opened(), opened()[0].id, 'done', 'user', 2);
    const merged = mergeUserActions(closed, secretActions('c9', [ask('A_KEY')], BUILD, 3));
    expect(merged[0].status).toBe('done');
  });

  it('a LATER build still needing it DOES re-open an unverified "done" — the user may have missed it', () => {
    const closed = closeAction(opened(), opened()[0].id, 'done', 'user', 2);
    const merged = mergeUserActions(closed, secretActions('c9', [ask('A_KEY')], NEXT_BUILD, 3));
    expect(merged[0].status).toBe('open');
    expect(merged[0].closedAt).toBeUndefined();
    expect(merged[0].closedBy).toBeUndefined();
    expect(merged[0].createdAt).toBe(1);
  });

  it('a VERIFIED close never re-opens — the platform looked, and it was true', () => {
    const closed = closeAction(opened(), opened()[0].id, 'done', 'verified', 2);
    expect(mergeUserActions(closed, secretActions('c9', [ask('A_KEY')], NEXT_BUILD, 3))[0].status).toBe('done');
  });

  it('"my app does not need this" is for ever — no build re-opens it', () => {
    const declined = closeAction(opened(), opened()[0].id, 'not_needed', 'user', 2);
    expect(mergeUserActions(declined, secretActions('c9', [ask('A_KEY')], NEXT_BUILD, 3))[0].status).toBe('not_needed');
    expect(mayReopen(declined[0], secretActions('c9', [ask('A_KEY')], NEXT_BUILD, 3)[0])).toBe(false);
  });
});

describe('the tray opens itself for exactly one thing', () => {
  it('a build that is genuinely stopped opens it; work for later never does', () => {
    const later = [...secretActions('c1', [ask('A_KEY')], BUILD, 1), ...questionActions(['Roles?'], BUILD, 1)];
    expect(shouldAutoOpen(later)).toBe(false);
    expect(shouldAutoOpen([...later, approveAction('c2', 'Approve the plan', BUILD, 1)!])).toBe(true);
  });

  it('a gate nobody answered stops CLAIMING the build is stopped, but stays on the list', () => {
    const gate = [approveAction('c2', 'Approve the plan', BUILD, 1)!];
    const abandoned = releaseGate(gate, 'c2', false, 5);
    expect(abandoned[0].blocking).toBe(false);
    expect(abandoned[0].status).toBe('open');
    expect(shouldAutoOpen(abandoned)).toBe(false);
    const answered = releaseGate(gate, 'c2', true, 5);
    expect(answered[0].status).toBe('done');
    expect(answered[0].closedBy).toBe('user');
  });

  it('a credential never blocks — the build carries on building everything else', () => {
    expect(secretActions('c1', [ask('A_KEY')], BUILD, 1)[0].blocking).toBe(false);
    expect(groupOf(secretActions('c1', [ask('A_KEY')], BUILD, 1)[0])).toBe('needed');
    expect(groupOf(approveAction('c1', 'Approve', BUILD, 1)!)).toBe('blocking');
    expect(groupOf(questionActions(['Roles?'], BUILD, 1)[0])).toBe('later');
  });
});

describe('the list is bounded, and an open row is never the thing that is dropped', () => {
  it('pruning takes the oldest CLOSED rows and keeps every open one', () => {
    const closed: UserAction[] = Array.from({ length: MAX_ACTIONS + 10 }, (_, i) => ({
      id: `closed-${i}`, kind: 'question', title: `q${i}`, why: '', blocking: false, buildId: BUILD,
      status: 'done', createdAt: i, closedAt: i, closedBy: 'user',
    }));
    const open = secretActions('c1', [ask('KEEP_ME')], BUILD, 0);
    const capped = capActions([...closed, ...open]);
    expect(capped.length).toBeLessThanOrEqual(MAX_ACTIONS);
    expect(capped.find((a) => a.envName === 'KEEP_ME')?.status).toBe('open');
    expect(openActions(capped)).toHaveLength(1);
  });
});

describe('only three events ever become a task', () => {
  it('maps the credential ask, the gate and the assumptions — and nothing else', () => {
    expect(actionsFromEvent({ type: 'secret_request', callId: 'c1', secrets: [ask('A_KEY')] }, BUILD, 1)).toHaveLength(1);
    expect(actionsFromEvent({ type: 'permission_request', callId: 'c2', action: 'Approve the plan' }, BUILD, 1)).toHaveLength(1);
    expect(actionsFromEvent({ type: 'clarify', questions: ['Roles?'] }, BUILD, 1)).toHaveLength(1);
    for (const type of ['narration', 'done', 'result', 'suggest', 'tool_call', 'error', 'preview', 'todo_updated']) {
      expect(actionsFromEvent({ type }, BUILD, 1), type).toEqual([]);
    }
  });

  it('a malformed event yields nothing rather than a half-understood task', () => {
    expect(actionsFromEvent({ type: 'secret_request', secrets: 'not-an-array' }, BUILD, 1)).toEqual([]);
    expect(actionsFromEvent({}, BUILD, 1)).toEqual([]);
  });
});

describe('the recorder — one hook, live only, and it can never break a build', () => {
  function fakeStream() {
    const listeners: Array<(e: unknown) => void> = [];
    const replayFlags: Array<boolean | undefined> = [];
    return {
      listeners, replayFlags,
      subscribe(fn: (e: unknown) => void, replay?: boolean) { listeners.push(fn); replayFlags.push(replay); return () => {}; },
      emit(e: unknown) { listeners.forEach((fn) => fn(e)); },
    };
  }

  it('records an ask as it is emitted, and subscribes WITHOUT replay', async () => {
    const stream = fakeStream();
    const saved: UserAction[][] = [];
    attachUserActionRecorder(stream, { workspaceId: 'ws1', buildId: BUILD, save: async (_w, a) => { saved.push([...a]); }, now: () => 7 });
    expect(stream.replayFlags).toEqual([false]);
    stream.emit({ type: 'secret_request', callId: 'c1', secrets: [ask('A_KEY')] });
    stream.emit({ type: 'narration', text: 'building…' });
    expect(saved).toHaveLength(1);
    expect(saved[0][0].envName).toBe('A_KEY');
    expect(saved[0][0].createdAt).toBe(7);
  });

  it('a failing store never reaches the build loop', async () => {
    const stream = fakeStream();
    attachUserActionRecorder(stream, { workspaceId: 'ws1', buildId: BUILD, save: async () => { throw new Error('firestore down'); } });
    expect(() => stream.emit({ type: 'permission_request', callId: 'c2', action: 'Approve' })).not.toThrow();
    await Promise.resolve();
  });

  it('no workspace ⇒ nothing is subscribed at all', () => {
    const stream = fakeStream();
    attachUserActionRecorder(stream, { workspaceId: '', buildId: BUILD, save: async () => {} });
    expect(stream.listeners).toHaveLength(0);
  });
});

describe('a stored row that cannot be read is dropped, never repaired into a plausible task', () => {
  it('keeps a good row and refuses a broken one', () => {
    const good = secretActions('c1', [ask('A_KEY')], BUILD, 1)[0];
    expect(normalizeUserAction(good)?.envName).toBe('A_KEY');
    expect(normalizeUserAction({ ...good, kind: 'nonsense' })).toBeNull();
    expect(normalizeUserAction({ ...good, status: 'maybe' })).toBeNull();
    expect(normalizeUserAction({ ...good, title: '' })).toBeNull();
    expect(normalizeUserAction(null)).toBeNull();
  });

  it('never writes an undefined field back — Firestore rejects those and the catch would hide it', () => {
    const row = questionActions(['Roles?'], BUILD, 1)[0];
    const normalized = normalizeUserAction(row)!;
    for (const [key, value] of Object.entries(normalized)) expect(value, key).not.toBeUndefined();
    expect('envName' in normalized).toBe(false);
  });
});

describe('🔒 the tray still works when nothing was stored — the store is best-effort by design', () => {
  const live = {
    pendingSecrets: { callId: 'c1', secrets: [{ name: 'A_KEY', why: 'Payments' }] },
    pendingPermission: { callId: 'c2', action: 'Approve the plan' },
    pendingClarify: { questions: ['Which roles?'] },
  };

  it('an empty store still shows every live ask, and the gate is still answerable', () => {
    const rows = mergeLiveActions([], live, 1);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.kind === 'approve')?.blocking).toBe(true);
    expect(rows.every(isLiveOnly)).toBe(true);
  });

  it('a live ask whose stored row is already open is NOT shown twice', () => {
    const stored = secretActions('c1', [ask('A_KEY')], BUILD, 1) as unknown as UserActionView[];
    const rows = mergeLiveActions(stored, { pendingSecrets: live.pendingSecrets }, 2);
    expect(rows).toHaveLength(1);
    expect(isLiveOnly(rows[0])).toBe(false);
  });

  it('a live-only row carries no Done button, because there is nowhere to record it', () => {
    const rows = mergeLiveActions([], live, 1);
    expect(rows.every((r) => isLiveOnly(r))).toBe(true);
    const stored = secretActions('c1', [ask('A_KEY')], BUILD, 1) as unknown as UserActionView[];
    expect(isLiveOnly(stored[0])).toBe(false);
  });
});

describe('the tray says WHO closed a row, because the two claims differ', () => {
  const row = (over: Partial<UserActionView>): UserActionView => ({
    id: 'x', kind: 'secret', title: 'A_KEY', why: '', blocking: false, status: 'done', createdAt: 1, ...over,
  });

  it('a measurement and the user\'s word are never printed as the same thing', () => {
    expect(closedNote(row({ closedBy: 'verified' }))).toBe('Checked — this is set.');
    expect(closedNote(row({ closedBy: 'user' }))).toContain('Nothing was checked');
    expect(closedNote(row({ status: 'not_needed' }))).toContain('does not need this');
    expect(closedNote(row({ status: 'superseded' }))).toContain('no longer needs this');
  });

  it('groups only open rows, newest-closed first in the done list, and counts honestly', () => {
    const open = secretActions('c1', [ask('A_KEY')], BUILD, 1) as unknown as UserActionView[];
    const all = [...open, row({ id: 'old', closedAt: 5, closedBy: 'user' }), row({ id: 'new', closedAt: 9, closedBy: 'verified' })];
    expect(groupedOpen(all).map((s) => s.group)).toEqual(['needed']);
    expect(closedRows(all).map((r) => r.id)).toEqual(['new', 'old']);
    expect(traySummary(0)).toBe('Nothing is waiting on you.');
    expect(traySummary(1)).toBe('1 thing needs you');
    expect(traySummary(3)).toBe('3 things need you');
  });
});

describe('no row is a dead end — every one can be talked to instead of obeyed', () => {
  const view = (over: Partial<UserActionView>): UserActionView => ({
    id: 'x', kind: 'secret', title: 'A_KEY', why: '', blocking: false, status: 'open', createdAt: 1, ...over,
  });

  it('a credential offers to be explained, and to be replaced by something needing no key', () => {
    const p = askPrompt(view({ envName: 'RAZORPAY_KEY_ID' }));
    expect(p).toContain('RAZORPAY_KEY_ID');
    expect(p).toContain('without it');
  });

  it('a gate can be asked about before it is answered', () => {
    expect(askPrompt(view({ kind: 'approve', title: 'Approve the plan' }))).toContain('if I say no');
  });

  it('an assumption invites the user to say what they actually wanted', () => {
    expect(askPrompt(view({ kind: 'question', title: 'Which roles?' }))).toContain('what I actually want');
  });
});

describe('the header is a STRIP, so ⁉️ and ✔️ can join ❓ later without touching it', () => {
  const badge = (over: Partial<HeaderBadge>): HeaderBadge => ({ id: 'a', glyph: '❓', label: 'l', count: 1, tone: 'info', onOpen: () => {}, ...over });

  it('urgent sorts before info before done, and registration order breaks a tie', () => {
    const shown = visibleBadges([badge({ id: 'done', tone: 'done' }), badge({ id: 'info', tone: 'info' }), badge({ id: 'urgent', tone: 'urgent' })]);
    expect(shown.map((b) => b.id)).toEqual(['urgent', 'info', 'done']);
  });

  it('never shows more than the strip has room for, and never shows an empty one', () => {
    const many = Array.from({ length: 6 }, (_, i) => badge({ id: `b${i}` }));
    expect(visibleBadges(many)).toHaveLength(MAX_VISIBLE_BADGES);
    expect(visibleBadges([badge({ count: 0 }), badge({ id: 'b', count: 2 })]).map((b) => b.id)).toEqual(['b']);
  });

  it('a big count cannot widen the header', () => {
    expect(badgeCountLabel(4)).toBe('4');
    expect(badgeCountLabel(40)).toBe('9+');
  });
});

describe('wiring — read from the source, so removing a line turns this red', () => {
  const PANEL = stripComments(read('src/components/agentv3/AgentV3Panel.tsx'));
  const ROUTE = stripComments(read('src/server/routes/agentv3.ts'));
  // Read RAW: a `/*` inside one of server.ts's own strings makes a naive block-comment strip swallow
  // hundreds of real lines, which is a false failure rather than a caught regression.
  const SERVER = read('server.ts');
  const ACTIONS_ROUTE = stripComments(read('src/server/routes/userActions.ts'));
  const STORE = stripComments(read('src/server/AgentV3/UserActionStore.ts'));

  it('the build attaches the recorder to its ONE event stream', () => {
    expect(ROUTE).toContain('attachUserActionRecorder(events, { workspaceId, buildId: userActionBuildId });');
  });

  it('the two doors are mounted', () => {
    expect(SERVER).toContain('registerUserActionRoutes(app);');
    expect(ACTIONS_ROUTE).toContain("app.get('/api/agentv3/user-actions'");
    expect(ACTIONS_ROUTE).toContain("app.post('/api/agentv3/user-actions/close'");
  });

  it('🔒 reading the list checks the caller OWNS the workspace — an id is not a password', () => {
    expect(ACTIONS_ROUTE.match(/verifiedWorkspaceReadOk\(uid, workspaceId\)/g)?.length).toBe(2);
    expect(ACTIONS_ROUTE).toContain("res.status(403)");
  });

  it('🔒 the vault check runs on every read, so a key already saved is never counted', () => {
    expect(ACTIONS_ROUTE).toContain('verifyAgainstVault(stored, names, now)');
    expect(ACTIONS_ROUTE).toContain('loadUserSecretNamesFor(userId, workspaceId)');
  });

  it("🔒 a user's close is recorded as their WORD, never as a measurement", () => {
    expect(ACTIONS_ROUTE).toContain("closeUserAction(workspaceId, id, status, 'user')");
  });

  it('🔒 closing a row is an UPDATE — a merge-set would MINT a task nobody ever had', () => {
    expect(STORE).toMatch(/\.doc\(id\)\.update\(\{ status, closedBy: by, closedAt: now, blocking: false \}\)/);
    expect(STORE).not.toMatch(/closeUserAction[\s\S]{0,600}set\([^)]*merge/);
  });

  it('the badge sits beside the build stamp the admin circled, and the tray is mounted', () => {
    const stampAt = PANEL.indexOf("return 'b:' +");
    const badgeAt = PANEL.indexOf('<HeaderBadges');
    expect(stampAt).toBeGreaterThan(-1);
    expect(badgeAt).toBeGreaterThan(stampAt);
    expect(badgeAt - stampAt).toBeLessThan(1500); // the same header row, not somewhere else entirely
    expect(PANEL).toContain('<UserActionTray');
    expect(PANEL).toContain("glyph: '❓'");
  });

  it('🔴 the three cards are OUT of the message stream — that was the whole complaint', () => {
    // The credential form exists exactly once, hoisted for the tray to hold.
    expect(PANEL.match(/<SecretRequestCard/g)?.length).toBe(1);
    expect(PANEL).toContain('const secretCardNode = state.pendingSecrets ? (');
    expect(PANEL).toContain('secretCard={secretCardNode}');
    // The inline approve/reject row and the inline assumptions card are gone.
    expect(PANEL).not.toContain('respond(state.pendingPermission!.callId, true)');
    expect(PANEL).not.toContain('clarifyDismissed');
  });

  it('the tray is the only place a row is closed from, and it can always be talked to', () => {
    expect(PANEL).toContain("onDone={(action) => { void userActions.close(action, 'done'); }}");
    expect(PANEL).toContain("onNotNeeded={(action) => { void userActions.close(action, 'not_needed'); }}");
    expect(PANEL).toContain('onAsk={askAboutAction}');
    expect(PANEL).toContain('setPrompt(askPrompt(action));');
  });
});
