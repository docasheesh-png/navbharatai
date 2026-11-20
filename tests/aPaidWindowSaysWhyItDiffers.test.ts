/**
 * Q-2750 (autopsy 05eb30ba; BR2003 vs BR1999/2001/2002): FREE_BUILD_TIME_CAP said "a paid build would get 58 min"
 * in one build and "29 min" in builds of the same hour. Both were true — a deep build's window is doubled — but the
 * line never said why, so two true numbers read as a contradiction. It now names the size when the window is scaled.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { freeBuildWindow, freeWindowLine } from '../src/server/AgentV3/freeBuildTimeCap';
import { scaleBuildSeconds } from '../src/server/AgentV3/PipelineDepth';

const env = { AGENTV3_FREE_BUILD_SECONDS: '1500' } as NodeJS.ProcessEnv;
const STANDARD = 29 * 60;

describe('the paid window says why it differs between builds', () => {
  it('the reported pair: a deep build names its size and the standard window; a standard build reads as before', () => {
    const deep = freeBuildWindow(scaleBuildSeconds(STANDARD, 'deep'), true, env);
    const standard = freeBuildWindow(scaleBuildSeconds(STANDARD, 'standard'), true, env);
    expect(freeWindowLine(deep, STANDARD, 'deep')).toBe('Free build window: 25 min (a paid build of this size (deep) would get 58 min; the standard window is 29 min).');
    expect(freeWindowLine(standard, STANDARD, 'standard')).toBe('Free build window: 25 min (a paid build would get 29 min).');
  });

  it('the route writes the line through the function, with the standard window and the depth', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("code: 'FREE_BUILD_TIME_CAP', message: freeWindowLine(freeWindow, maxBuildSeconds(), buildDepth)");
    expect(route).not.toContain('(a paid build would get ${Math.round(freeWindow.paidSeconds / 60)} min)');
  });
});
