// A free build holds the sandbox for less than a paid one (admin 2026-09-30).
//
// A free build used to get the paid window (30 min, 60 on a deep prompt) and, at the end of each window,
// a resumable pause the client auto-continues for up to 8 windows while files keep growing — four hours
// of a machine NavBharatAI pays for, with nobody pressing anything. The window is now shorter, and the
// unattended chain stops at an allowance; after that each window needs the user to say "continue".

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  freeBuildWindow, freeBuildWindowSeconds, freeBuildAutoSeconds, noteFreeBuildStart, decideFreePause,
  freePauseMessage, resetFreeBuildChainsForTests,
  FREE_BUILD_SECONDS_DEFAULT, FREE_BUILD_AUTO_SECONDS_DEFAULT, FREE_BUILD_SECONDS_MIN,
} from '../src/server/AgentV3/freeBuildTimeCap';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const MIN = 60_000;

beforeEach(() => resetFreeBuildChainsForTests());

describe('the free window', () => {
  it('a free build gets 25 minutes where a paid one gets 30, and 60 on a deep prompt', () => {
    expect(freeBuildWindow(1800, true, {})).toEqual({ seconds: FREE_BUILD_SECONDS_DEFAULT, capped: true, paidSeconds: 1800 });
    expect(freeBuildWindow(3600, true, {}).seconds).toBe(FREE_BUILD_SECONDS_DEFAULT);
  });

  it('a paid build is untouched', () => {
    expect(freeBuildWindow(1800, false, {})).toEqual({ seconds: 1800, capped: false, paidSeconds: 1800 });
  });

  it('never ABOVE the paid cap, so the orphan reaper (paid cap + 10 min) can never reach a free build', () => {
    expect(freeBuildWindow(900, true, {})).toEqual({ seconds: 900, capped: false, paidSeconds: 900 });
    expect(freeBuildWindow(1800, true, { AGENTV3_FREE_BUILD_SECONDS: '5000' }).seconds).toBe(1800);
  });

  it('a disabled watchdog (0) stays disabled — this module does not reintroduce one', () => {
    expect(freeBuildWindow(0, true, {}).seconds).toBe(0);
  });

  it('`off` means the paid behaviour; blank or unreadable means the default, never "no limit"', () => {
    expect(freeBuildWindowSeconds({ AGENTV3_FREE_BUILD_SECONDS: 'off' })).toBeNull();
    expect(freeBuildWindow(1800, true, { AGENTV3_FREE_BUILD_SECONDS: 'OFF' }).capped).toBe(false);
    for (const bad of ['', '   ', 'twenty', '-5', '0', 'NaN']) {
      expect(freeBuildWindowSeconds({ AGENTV3_FREE_BUILD_SECONDS: bad })).toBe(FREE_BUILD_SECONDS_DEFAULT);
    }
    expect(freeBuildWindowSeconds({ AGENTV3_FREE_BUILD_SECONDS: '1200s' })).toBe(1200);
    expect(freeBuildWindowSeconds({ AGENTV3_FREE_BUILD_SECONDS: '10' })).toBe(FREE_BUILD_SECONDS_MIN);
    expect(freeBuildAutoSeconds({ AGENTV3_FREE_BUILD_AUTO_SECONDS: 'x' })).toBe(FREE_BUILD_AUTO_SECONDS_DEFAULT);
  });
});

describe('the unattended chain', () => {
  it('the first window auto-continues, the second waits for the user', () => {
    noteFreeBuildStart('ws', 'build a school ERP');
    expect(decideFreePause('ws', 25 * MIN, {}).resumable).toBe(true);
    noteFreeBuildStart('ws', 'continue'); // the client's own auto-continue prompt
    const second = decideFreePause('ws', 25 * MIN, {});
    expect(second).toEqual({ resumable: false, spentSeconds: 3000, allowanceSeconds: FREE_BUILD_AUTO_SECONDS_DEFAULT });
  });

  it('after that, every "continue" buys exactly one window', () => {
    noteFreeBuildStart('ws', 'build an app');
    decideFreePause('ws', 25 * MIN, {});
    decideFreePause('ws', 25 * MIN, {});
    noteFreeBuildStart('ws', 'continue');
    expect(decideFreePause('ws', 25 * MIN, {}).resumable).toBe(false);
  });

  it('a real new request starts a new chain', () => {
    noteFreeBuildStart('ws', 'build an app');
    decideFreePause('ws', 25 * MIN, {});
    decideFreePause('ws', 25 * MIN, {});
    noteFreeBuildStart('ws', 'add a dark mode toggle');
    expect(decideFreePause('ws', 25 * MIN, {}).resumable).toBe(true);
  });

  it('chains are per workspace', () => {
    noteFreeBuildStart('a', 'x app'); decideFreePause('a', 25 * MIN, {}); decideFreePause('a', 25 * MIN, {});
    noteFreeBuildStart('b', 'y app');
    expect(decideFreePause('b', 25 * MIN, {}).resumable).toBe(true);
  });

  it('an unknown chain (another instance) fails toward the OLD behaviour — auto-continue', () => {
    expect(decideFreePause('never-seen', 25 * MIN, {}).resumable).toBe(true);
  });

  it('`off` leaves the chain to the client alone, as before', () => {
    const env = { AGENTV3_FREE_BUILD_AUTO_SECONDS: 'off' };
    for (let i = 0; i < 6; i++) expect(decideFreePause('ws', 25 * MIN, env).resumable).toBe(true);
  });

  it('a chain nobody touched for six hours is forgotten', () => {
    const t0 = 1_000_000;
    decideFreePause('ws', 25 * MIN, {}, t0);
    decideFreePause('ws', 25 * MIN, {}, t0 + 1);
    expect(decideFreePause('ws', 25 * MIN, {}, t0 + 7 * 60 * MIN).resumable).toBe(true);
  });
});

describe('the words', () => {
  it('say the work is saved and how to continue, with no vendor and no upsell', () => {
    const m = freePauseMessage(12);
    expect(m.summary).toContain('12 files are saved');
    expect(m.summary).toContain('"continue"');
    expect(freePauseMessage(0).summary).toContain('nothing was lost');
    expect(m.summary).not.toMatch(/credit|upgrade|paid|GLM|Kimi|Claude|Gemini/i);
  });
});

describe('the wiring (source guards)', () => {
  it('the free window is applied to effectiveBuildSeconds, the one number every budget reads', () => {
    expect(route).toContain('const freeWindow = freeBuildWindow(scaleBuildSeconds(maxBuildSeconds(), buildDepth), freeTierBuildActive);');
    expect(route).toContain('const effectiveBuildSeconds = freeWindow.seconds;');
    expect(route).toContain('if (freeTierBuildActive) noteFreeBuildStart(workspaceId, prompt);');
  });

  it('the watchdog pause is resumable only while the chain allows it, and only a free unfinished build is asked', () => {
    expect(route).toContain('const freePause = !ok && freeTierBuildActive ? decideFreePause(workspaceId, deadlineMs) : null;');
    expect(route).toContain("emit({ type: 'result', ok: false, resumable: pauseResumable,");
    expect(route).not.toContain("emit({ type: 'result', ok: false, resumable: true, summary: pauseMsg.summary");
  });
});
