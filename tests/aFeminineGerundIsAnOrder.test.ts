// failedbr #1352 (2026-11-20): "Muje ek game banani hai" — the gerund in its feminine form — read as chat at low
// confidence; in a workspace that already held an app it fell through to an EDIT of that app instead of a new game.
import { describe, expect, it } from 'vitest';
import { classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';

describe('the gerund inflects (failedbr #1352)', () => {
  it.each(['Muje ek game banani hai', 'Muje ek game banani hai\nTo me thodi der tak ext ho sakta hu', 'ek website banani hai', 'mujhe app banane hai', 'ek dukan ki app banaani chahiye'])('an order: %s', (m) => {
    expect(classifyIntentWithConfidence(m)).toMatchObject({ intent: 'new_build', confidence: 'high' });
  });
  it.each(['app banane mein madad karo', 'app banane ka tarika kya hai', 'banana shake recipe'])('not a high-confidence order: %s', (m) => {
    expect(classifyIntentWithConfidence(m).confidence).not.toBe('high');
  });
});
