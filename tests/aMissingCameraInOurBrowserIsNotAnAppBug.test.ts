// 📷 OUR CHECKING BROWSER HAS NO CAMERA — A LINE SAYING SO IS NOT AN APP DEFECT (failedbr #2263, 2026-11-20).
//
// A camera app caught `NotFoundError: Requested device not found`, logged it and showed its own "no camera" screen.
// The render check counted the line as "did not run cleanly" (a repair that could never succeed, OUTCOME_PREVIEW_FAILED,
// gate RED), and the click explorer read it as "Try Again did not work". The line is the report's own.
// Reversion: drop the `isAbsentDeviceConsoleLine` skip from filterActionableErrors and the first test fails; drop
// ABSENT_DEVICE_CONSOLE_SRC from CONSOLE_NOISE and the explorer test fails.

import { describe, it, expect } from 'vitest';
import { filterActionableErrors } from '../src/server/AgentV3/AutoFix';
import { CONSOLE_NOISE } from '../src/server/AgentV3/clickExplorer';
import { isAbsentDeviceConsoleLine } from '../src/server/AgentV3/absentDeviceConsole';

const REPORT_LINE = 'Error accessing camera: NotFoundError: Requested device not found';

describe('#2263: a handled missing camera does not fail the app', () => {
  it('the render/console filter drops the logged line', () => {
    expect(filterActionableErrors([{ t: 1, kind: 'console', text: REPORT_LINE }])).toEqual([]);
  });
  it('the click explorer treats it as noise too', () => {
    expect(CONSOLE_NOISE.test(REPORT_LINE)).toBe(true);
  });
  it('microphone and location refusals are the same fact', () => {
    for (const t of ['Mic error: NotAllowedError: Permission denied', 'Geolocation error: User denied Geolocation', 'NotReadableError: Could not start video source']) {
      expect(isAbsentDeviceConsoleLine(t), t).toBe(true);
    }
  });
});

describe('the boundaries: real defects still count', () => {
  it('an UNCAUGHT device error (the app crashed instead of handling it) is kept', () => {
    expect(filterActionableErrors([{ t: 1, kind: 'error', text: `Uncaught (in promise) ${REPORT_LINE}` }])).toHaveLength(1);
  });
  it('a DOM NotFoundError that names no device is kept, in both readers', () => {
    const dom = "NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.";
    expect(filterActionableErrors([{ t: 1, kind: 'console', text: dom }])).toHaveLength(1);
    expect(CONSOLE_NOISE.test(dom)).toBe(false);
  });
  it('an ordinary app error is kept, and the explorer\'s old noise still works', () => {
    expect(filterActionableErrors([{ t: 1, kind: 'console', text: "TypeError: Cannot read properties of undefined (reading 'map')" }])).toHaveLength(1);
    expect(CONSOLE_NOISE.test("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(false);
    expect(CONSOLE_NOISE.test('Warning: Each child in a list should have a unique "key" prop.')).toBe(true);
    expect(CONSOLE_NOISE.test('[vite] connected.')).toBe(true);
  });
});
