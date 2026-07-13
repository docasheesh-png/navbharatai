import { describe, it, expect } from 'vitest';
import { SonicTranscriptGate } from './sonicTranscript';

describe('SonicTranscriptGate — kills the Nova Sonic double-line bug (admin real run 2026-07-14)', () => {
  it('THE bug: a 2-sentence reply arriving A,B,A,B shows each line exactly once', () => {
    const g = new SonicTranscriptGate();
    // No generationStage on any event (the case the old consecutive-only guard failed): the second
    // pass interleaves A,B after the first A,B, so consecutive-dedup let it through — twice each.
    const A = 'हेलो! हाँ, मैं आपकी बात सुन पा रहा हूँ।';
    const B = 'आप कैसे हैं? मैं आपकी कैसे मदद कर सकता हूँ?';
    const seq = [A, B, A, B].map((content) => g.accept({ role: 'ASSISTANT', content }));
    expect(seq).toEqual([true, true, false, false]);
  });

  it('generationStage: SPECULATIVE is dropped, FINAL is shown (the clean primary defense)', () => {
    const g = new SonicTranscriptGate();
    expect(g.accept({ role: 'ASSISTANT', content: 'hi there', stage: 'SPECULATIVE' })).toBe(false);
    expect(g.accept({ role: 'ASSISTANT', content: 'hi there', stage: 'FINAL' })).toBe(true);
  });

  it('fail-OPEN when the stage is unknown — a protocol change never blanks the transcript', () => {
    const g = new SonicTranscriptGate();
    expect(g.accept({ role: 'ASSISTANT', content: 'unstaged line' })).toBe(true);
    expect(g.accept({ role: 'ASSISTANT', content: 'unstaged line 2', stage: 'WEIRD_NEW_STAGE' })).toBe(true);
  });

  it('drops empties and Nova Sonic control-JSON ({"interrupted":true})', () => {
    const g = new SonicTranscriptGate();
    expect(g.accept({ role: 'ASSISTANT', content: '   ' })).toBe(false);
    expect(g.accept({ role: 'ASSISTANT', content: '{"interrupted":true}' })).toBe(false);
  });

  it('a NEW turn may legitimately repeat a line (per-turn dedup resets on endTurn)', () => {
    const g = new SonicTranscriptGate();
    expect(g.accept({ role: 'ASSISTANT', content: 'ok' })).toBe(true);
    expect(g.accept({ role: 'ASSISTANT', content: 'ok' })).toBe(false); // same turn → dropped
    g.endTurn();
    expect(g.accept({ role: 'ASSISTANT', content: 'ok' })).toBe(true);  // next turn → allowed again
  });

  it('the user line and the assistant line are independent (same words, different role, both show)', () => {
    const g = new SonicTranscriptGate();
    expect(g.accept({ role: 'USER', content: 'namaste' })).toBe(true);
    expect(g.accept({ role: 'ASSISTANT', content: 'namaste' })).toBe(true);
  });
});
