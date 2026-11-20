// 🔁 failedbr #2478 (Q-3018): with no file changed, update_preview was refused "nothing to refresh — Do NOT call
// update_preview again" at 276 s, the model asked again at 306 s and at 346 s, and the loop guard spoke only on the 3rd
// call — ~70 s of model time on a preview that was already current. The CLASS: a call the platform has already refused as
// redundant is already one warning, so the steer is due on the 2nd unchanged repeat. Other tools keep their threshold.
import { describe, it, expect } from 'vitest';
import { recordAndCheckRepeat, newRepeatProbeState } from '../src/server/AgentV3/RepeatProbeGuard';

describe('a refused refresh is the first warning', () => {
  it('the 2nd unchanged update_preview is steered (the report had to wait for the 3rd)', () => {
    const s = newRepeatProbeState();
    expect(recordAndCheckRepeat(s, 'update_preview', { port: 5173 })).toBeNull();
    expect(recordAndCheckRepeat(s, 'update_preview', { port: 5173 })).toMatch(/\[LOOP GUARD\] The same preview request has repeated 2 times/);
  });

  it('a read probe keeps its threshold of three', () => {
    const s = newRepeatProbeState();
    expect(recordAndCheckRepeat(s, 'read_file', { path: 'src/App.tsx' })).toBeNull();
    expect(recordAndCheckRepeat(s, 'read_file', { path: 'src/App.tsx' })).toBeNull();
    expect(recordAndCheckRepeat(s, 'read_file', { path: 'src/App.tsx' })).not.toBeNull();
  });
});
