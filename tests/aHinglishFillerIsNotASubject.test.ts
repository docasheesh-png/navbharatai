// 🔴 "AISA" IS NOT A SUBJECT (failedbr #2141, 2026-11-20).
//
// The workspace held a "Free Fire promo hack" app. The user then wrote "Bhai mujhe ek Aisa game Banakar do jismein 3D
// ho aur usmein ham kar chala sake bus" — a new 3D bus game. The unrelated-request net compares SUBJECT words; it
// counted the Hinglish filler "aisa" (and "jism…") as subjects, found it in the earlier "… Aisa hack banana hai", and
// built the game INTO the hack app without asking. Reversion: drop the Hinglish group from STOP and the first test fails.

import { describe, it, expect } from 'vitest';
import { unrelatedToExistingApp, subjectStems } from '../src/server/AgentV3/unrelatedRequest';

const PROMPT = 'Bhai mujhe ek Aisa game Banakar do jismein 3D ho aur usmein ham kar chala sake bus';
const EARLIER = ['Mujhe free fire ka ek promo hack banana hai jismein Hadsa photo map aur location Aana chahie Aisa hack banana hai'];
const PATHS = ['src/App.tsx', 'src/components/MapView.tsx', 'src/components/PhotoUpload.tsx', 'src/main.tsx'];

describe('#2141: a new game order on an unrelated app is asked about', () => {
  it('the report pair asks "add it to this app, or start a new app?"', () => {
    expect(unrelatedToExistingApp({ prompt: PROMPT, paths: PATHS, earlierBuildRequests: EARLIER }, {}).ask).toBe(true);
  });
  it('the fillers are not subjects', () => {
    const stems = subjectStems(PROMPT);
    for (const f of ['aisa', 'bhai', 'jism', 'usme', 'sake', 'chal', 'bana']) expect(stems.has(f), f).toBe(false);
  });
});

describe('the boundaries', () => {
  it('a Hinglish order about the SAME subject is still built into the app (no question)', () => {
    const v = unrelatedToExistingApp({
      prompt: 'Bhai aisa racing game banakar do jismein traffic ho',
      paths: ['src/game/RacingGame.tsx', 'src/App.tsx'],
      earlierBuildRequests: ['Mujhe ek racing game banana hai'],
    }, {});
    expect(v.ask).toBe(false);
  });
});
