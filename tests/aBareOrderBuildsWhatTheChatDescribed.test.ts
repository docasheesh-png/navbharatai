// AUTOPSY e41fdb21 (2026-11-14) — chat: "mujhe ek 3d realistic city game bana lar do"; next message: "banao".
// The build prompt was the single word "banao" and a Notes app was built, billed and saved as the city game.
// CLASS: two judges answering "does this message point at the conversation?" differently — the ask gate
// (earlier buildable turn exists => do not ask) and the planner (a bare order is no pointer => drop chat turns).
import { describe, it, expect } from 'vitest';
import { refersToConversation } from '../src/server/AgentV3/conversationReference';
import { planningRequest } from '../src/server/AgentV3/planningRequest';
import { shouldAskWhatToBuild } from '../src/server/AgentV3/buildableInput';

const CITY = 'mujhe ek 3d realistic city game bana lar do';

describe('a bare order points at the conversation', () => {
  it.each(['banao', 'Banao', 'bnao', 'app banao', 'make it', 'build'])('%s', (m) => {
    expect(refersToConversation(m), m).toBe(true);
  });
  it('a message that names something is still sized from its own words', () => {
    for (const m of ['ek billing app banao', 'hi', 'build a notes app']) expect(refersToConversation(m), m).toBe(false);
  });
});

describe('the real report: "banao" after the city game request', () => {
  for (const lane of ['chat', 'offer', 'clarify'] as const) {
    it(`🔴 the ${lane}-lane city request reaches the builder`, () => {
      const p = planningRequest({ prompt: 'banao', recentTurns: [{ text: CITY, lane }], userAppExists: false });
      expect(p.text).toContain(CITY);
      expect(p.sizing).toContain(CITY);
      expect(p.sources).toContain('earlier-requests');
    });
  }
  it('the gate that lets it through and the planner now agree', () => {
    const asks = shouldAskWhatToBuild({ namesNothing: true, editIntent: false, workspaceHoldsOnlyOurStarter: true, earlierTurns: [CITY], importing: false, attachments: 0 });
    expect(asks).toBe(false);
    const p = planningRequest({ prompt: 'banao', recentTurns: [{ text: CITY, lane: 'chat' }], userAppExists: false });
    expect(p.text).not.toBe('banao');
  });
  it('a lone "banao" with no earlier turn is unchanged (the gate asks instead)', () => {
    expect(planningRequest({ prompt: 'banao', recentTurns: [], userAppExists: false }).text).toBe('banao');
  });
});
