// THE ❗️ LIST ACTUALLY DOES WHAT ITS BUTTONS SAY (admin 2026-11-21: "❗️ button me abhi bhi ek popup ata game ban jane
// ke baad 'bug fix' karne ke liye — us par click karo, bug fix to hota nahi hai, kuch bhi nahi hota hai, navbharatai
// pro builder chalta hi nahi hai").
//
// 🔑 THE ROOT CAUSE. The build offers the optional deep bug hunt as a gate and waits 30 seconds for the answer, then
// carries on. `releaseGate` keeps the row OPEN in the ❗️ list (rightly: the user was asked), but the row still offered
// "Find and fix bugs" — which answered a gate nobody was waiting on any more. The tap did nothing, and the row was then
// marked done. 🧬 THE CLASS: an approve row whose gate has expired offering an answer button. Every such row now either
// does the real thing (the bug hunt starts a NEW turn with the yes given up front) or offers no answer at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserActionTray } from '../src/components/agentv3/UserActionTray';
import {
  gateExpired, isExpiredBugHunt, BUG_HUNT_APPROVE_LABEL, BUG_HUNT_TURN_PROMPT, type UserActionView,
} from '../src/components/agentv3/userActionView';
import { bugHuntOfferCopy, offerBugHunt, bugHuntCouldNotRunLine } from '../src/server/AgentV3/optionalBugHunt';
import { actionsFromEvent, releaseGate } from '../src/server/AgentV3/userActions';
import { classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** The bug-hunt row exactly as the server stores it, then releases it after the 30-second wait. */
function expiredBugHuntRow(): UserActionView {
  const copy = bugHuntOfferCopy();
  const [row] = actionsFromEvent({ type: 'permission_request', callId: 'c-1', action: copy.title, ...copy }, 'build-1', 1);
  const [released] = releaseGate([row], 'c-1', false, 2);
  return released as unknown as UserActionView;
}

const tray = (actions: UserActionView[], extra: object = {}) => renderToStaticMarkup(createElement(UserActionTray, {
  actions, busyId: null, onClose: () => undefined, onDone: () => undefined, onNotNeeded: () => undefined,
  onAsk: () => undefined, onAnswerGate: () => undefined, onRunBugHunt: () => undefined, ...extra,
}));

describe('❗️ an expired gate never offers a dead answer', () => {
  it('the screen knows the bug hunt by the same label the server uses', () => {
    expect(BUG_HUNT_APPROVE_LABEL).toBe(bugHuntOfferCopy().approveLabel);
  });

  it('a released gate has expired; the one the running build holds has not; a live-only row has not', () => {
    const row = expiredBugHuntRow();
    expect(row.status).toBe('open');
    expect(gateExpired(row)).toBe(true);
    expect(isExpiredBugHunt(row)).toBe(true);
    expect(gateExpired({ ...row, blocking: true })).toBe(true);                       // build gone, release write lost
    expect(gateExpired({ ...row, blocking: true }, 'c-1')).toBe(false);               // the build is waiting on it now
    expect(gateExpired({ ...row, id: 'live:approve:c-1' })).toBe(false);
  });

  it('the expired bug-hunt row offers "Find and fix bugs" wired to a NEW turn, never to the dead gate', () => {
    const row = expiredBugHuntRow();
    const html = tray([row]);
    expect(html).toMatch(/Find and fix bugs/);
    expect(html).toMatch(/Not now/);
    const src = read('src/components/agentv3/UserActionTray.tsx');
    expect(src).toMatch(/isExpiredBugHunt\(action, liveGateCallId\) \? \([\s\S]{0,400}onClick=\{\(\) => onRunBugHunt\?\.\(action\)\}/);
  });

  it('any other expired gate shows no Approve at all — it says the build moved on', () => {
    const [row] = actionsFromEvent({ type: 'permission_request', callId: 'c-2', action: 'Install the payments package?' }, 'b', 1);
    const [released] = releaseGate([row], 'c-2', false, 2);
    const html = tray([released as unknown as UserActionView]);
    expect(html).not.toMatch(/Approve/);
    expect(html).toMatch(/The build carried on without this answer/);
  });

  it('a gate the running build is waiting on keeps its real Approve', () => {
    const [row] = actionsFromEvent({ type: 'permission_request', callId: 'c-3', action: 'Install the payments package?' }, 'b', 1);
    expect(tray([row as unknown as UserActionView], { liveGateCallId: 'c-3' })).toMatch(/Approve &amp; build/);
  });
});

describe('❗️ "Find and fix bugs" really runs the bug hunt', () => {
  it('the panel starts a real turn with the hunt approved up front (after the gate is gone)', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toMatch(/onRunBugHunt=\{\(action\) => \{[\s\S]{0,500}bugHuntRequestedRef\.current = true;\s*void send\(\{ text: BUG_HUNT_TURN_PROMPT, importUrl: '' \}\);/);
    expect(panel).toMatch(/const bugHunt = bugHuntRequestedRef\.current;\s*bugHuntRequestedRef\.current = false;/);
    expect(panel).toMatch(/bugHunt: bugHunt \|\| undefined,/);
    expect(panel).toMatch(/liveGateCallId=\{state\.pendingPermission\?\.callId \?\? null\}/);
    const hook = read('src/hooks/useAgentV3Build.ts');
    expect(hook).toMatch(/bugHunt: opts\?\.bugHunt === true \? true : undefined,/);
  });

  it('the route reads the flag and hands it to the offer', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/const bugHuntAskedByUser = req\.body\?\.bugHunt === true;/);
    expect(route).toMatch(/offerBugHunt\(\{[\s\S]{0,1600}preApproved: bugHuntAskedByUser,/);
  });

  it('the turn\'s message is read as work on the existing app, not as chat', () => {
    expect(classifyIntentWithConfidence(BUG_HUNT_TURN_PROMPT).intent).not.toBe('chat');
  });

  it('pre-approved: the hunt runs without asking again; on an app that did not finish, it says why and does not run', async () => {
    const asked: unknown[] = []; const said: string[] = [];
    const base = { hasUser: true, newCallId: () => 'x', ask: (g: unknown) => { asked.push(g); }, wait: async () => 'approved' as const, say: (t: string) => { said.push(t); }, record: () => undefined, env: {} as NodeJS.ProcessEnv };
    expect(await offerBugHunt({ ...base, eligible: true, preApproved: true })).toEqual({ runReview: true, answer: 'approved' });
    expect(asked).toEqual([]);
    expect(await offerBugHunt({ ...base, eligible: false, preApproved: true })).toEqual({ runReview: false, answer: 'approved' });
    expect(said).toEqual([bugHuntCouldNotRunLine()]);
    expect(asked).toEqual([]);
    // Not pre-approved: unchanged — it asks.
    await offerBugHunt({ ...base, eligible: true });
    expect(asked).toHaveLength(1);
  });
});
