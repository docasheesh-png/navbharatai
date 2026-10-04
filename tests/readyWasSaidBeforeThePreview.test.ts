// Autopsy 8f797751 (2026-10-01) — "Can you make app for solving maths problems". At 4.6 min the model
// ended its turn with "Your Math Solver app is ready … Open the Preview tab", the platform handed the turn
// back to style 41 unstyled classes (correctly) and told only the admin report. No preview existed; the
// user pressed Stop at 6.4 min, six seconds after the dev server came up. The fast lane's planned handoff
// was also labelled "could not produce the app" / BUILD_FAILED beside LLM_CALL_HANDED_OFF.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handBackNotice } from '../src/server/AgentV3/handBackNotice';

const read = (p: string) => readFileSync(p, 'utf8');

describe('a hand-back after "ready" is corrected in the chat', () => {
  it('both hand-backs say "not finished yet" when the user was told something', () => {
    expect(handBackNotice('style', 'Your app is ready. Open the Preview tab.')).toMatch(/Not finished yet/);
    expect(handBackNotice('unfinished', 'Done!')).toMatch(/Not finished yet/);
  });
  it('a silent turn needs no correction', () => {
    expect(handBackNotice('style', '')).toBeNull();
    expect(handBackNotice('unfinished', '   ')).toBeNull();
  });
  it('the runner emits it to the user at both hand-backs, not only to the report', () => {
    const src = read('src/server/AgentV3/AgentRunner.ts');
    expect(src).toContain("const styleNotice = handBackNotice('style', turn.text);");
    expect(src).toContain("if (styleNotice) events.emit({ type: 'narration', agent: agentRole, text: styleNotice, ts: Date.now() });");
    expect(src).toContain("const unfinishedNotice = handBackNotice('unfinished', turn.text);");
    expect(src).toContain("if (unfinishedNotice) events.emit({ type: 'narration', agent: agentRole, text: unfinishedNotice, ts: Date.now() });");
  });
});

describe('a planned handoff is not a failure in the report', () => {
  it('the lane marks it and the outcome line says so', () => {
    const lane = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(lane).toContain('const handedOff = isReasoningRungHandoff(e) || /reasons before every answer/i.test(reason);');
    expect(lane).toContain('a planned handoff, not a failure.');
    expect(read('src/server/routes/agentv3.ts')).toContain("sb.handedOff ? 'Fast-lane outcome: handed its plan to the full builder before a reasoning engine — not a failure.'");
  });
});
