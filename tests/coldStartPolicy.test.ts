import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { showColdStart, sessionHasApp } from '../src/components/agentv3/coldStartPolicy';

/**
 * ADMIN REPORT 2026-08-25 (screenshot): after "Make it yours" on a store app, the v5 chat showed the
 * whole cold-start surface — "describe an app to build", the starter cards, "Screenshot → App" —
 * directly above the green "<app> is yours now" banner.
 *
 * The block was gated on `convo.length === 0`, i.e. "is the chat empty?". After a remix the chat IS
 * empty while the workspace already holds every copied file. These tests pin the corrected question
 * ("does this session already have an app?") and both blind spots it has to cover.
 */

const build = { convoLength: 0, chatMode: 'build' as const, arrivedViaRemix: false, workspaceFileCount: null };

describe('showColdStart — a session with an app is not a blank slate', () => {
  it('THE REPORTED CASE: a remix arrival shows no starters, from the very first render', () => {
    // arrivedViaRemix is known synchronously; workspaceFileCount is still null because the durable
    // fetch has not resolved. This is the exact frame that was screenshotted.
    expect(showColdStart({ ...build, arrivedViaRemix: true })).toBe(false);
  });

  it('and still shows none after a reload, when the handoff is gone but the files are known', () => {
    // The handoff is consumed from sessionStorage once and the arrival message is local UI state,
    // so after a refresh the file list is the ONLY thing that still knows an app is here.
    expect(showColdStart({ ...build, arrivedViaRemix: false, workspaceFileCount: 34 })).toBe(false);
  });

  it('a genuinely new, empty Build session still gets the full cold start', () => {
    expect(showColdStart(build)).toBe(true);
    expect(showColdStart({ ...build, workspaceFileCount: 0 })).toBe(true);
  });

  it('once anything is in the thread, the cold start is over regardless', () => {
    expect(showColdStart({ ...build, convoLength: 1 })).toBe(false);
    expect(showColdStart({ ...build, convoLength: 1, arrivedViaRemix: true })).toBe(false);
  });

  it('Plan and Advise keep their explainer even with an app — blanking it would leave a bare screen', () => {
    // "Describe a goal and I'll plan it with you (aware of your build)" is exactly right after a
    // remix; only Build's blank-slate starters contradict having an app.
    for (const chatMode of ['planner', 'advisor'] as const) {
      expect(showColdStart({ ...build, chatMode, arrivedViaRemix: true })).toBe(true);
      expect(showColdStart({ ...build, chatMode, workspaceFileCount: 34 })).toBe(true);
    }
  });
});

describe('sessionHasApp — either signal is enough, neither is required', () => {
  it('the handoff alone vouches (files not loaded yet)', () => {
    expect(sessionHasApp({ arrivedViaRemix: true, workspaceFileCount: null })).toBe(true);
  });
  it('the file list alone vouches (handoff already consumed)', () => {
    expect(sessionHasApp({ arrivedViaRemix: false, workspaceFileCount: 1 })).toBe(true);
  });
  it('a loaded-but-EMPTY workspace is not an app — a failed copy must not silence the starters', () => {
    expect(sessionHasApp({ arrivedViaRemix: false, workspaceFileCount: 0 })).toBe(false);
  });
  it('nothing known yet is not an app', () => {
    expect(sessionHasApp({ arrivedViaRemix: false, workspaceFileCount: null })).toBe(false);
  });
});

describe('the panel actually uses the rule', () => {
  const panel = readFileSync(join(resolve(__dirname, '..'), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');

  it('gates the cold-start block on the policy, not on convo.length', () => {
    expect(panel).toContain('{coldStartVisible && (');
    // The old question must not come back as the gate for that block.
    expect(panel).not.toContain('{convo.length === 0 && (');
  });

  it('feeds the rule BOTH signals — dropping either one silently reopens a blind spot', () => {
    expect(panel).toContain('arrivedViaRemix: remixHandoffRef.current !== null');
    expect(panel).toContain('workspaceFilesFor === rehydratedWsId');
  });
});
