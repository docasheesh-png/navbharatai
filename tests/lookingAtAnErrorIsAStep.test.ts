// LOOKING AT AN ERROR IS A STEP, NOT A WARNING (autopsy 61279465, 2026-11-04).
//
// The report's one warning was the model's own sentence "I see that 'glass' is a valid MaterialKind. Let me check
// the specific error in the TrainModel:" — filed AGENT_NOTE / warning because it contained "error", on a build
// whose typecheck rows had already recorded that error. Fixing intent was exempt since PaisaTrack; its sibling,
// INVESTIGATING intent, was not.
import { describe, it, expect } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import type { AgentEvent } from '../src/server/AgentV3/types';

// The row the reported build had on file when the model said it: the platform's own typecheck.
const TYPECHECK_OPEN = "$ typecheck (tsc --noEmit, run by NavBharatAI) → 2 type errors (read from the output; the pipe hides tsc's own exit code) (2s)";
function noteOf(text: string, filed: string | null = TYPECHECK_OPEN) {
  const d = new BuildDiagnostics({ now: () => 1 });
  if (filed) d.record({ phase: 'build', severity: 'info', code: 'SANDBOX_CMD', message: filed, autoResolved: true });
  d.ingestEvent({ type: 'narration', agent: 'architect', text, ts: 1 } as AgentEvent);
  return d.report().issues.find((i) => i.code === 'AGENT_NOTE' || i.code === 'AGENT_STEP');
}

describe('narration about LOOKING at an error', () => {
  it('THE REPORTED LINE is a step', () => {
    expect(noteOf("I see that 'glass' is a valid MaterialKind. Let me check the specific error in the TrainModel:")?.code).toBe('AGENT_STEP');
  });
  it.each(["Let me look at the error in App.tsx:", "I'll inspect the type errors first.", "Now I'll investigate the error output."])('%s → step', (t) => {
    expect(noteOf(t)?.code).toBe('AGENT_STEP');
  });
  it('a real failure is still a problem, whatever the model says it will do next', () => {
    const n = noteOf('The dev server failed to start — let me check the error.');
    expect(n?.code).toBe('AGENT_NOTE');
    expect(n?.severity).toBe('error');
  });
  it('an error nothing filed stays a finding — and so does looking at one once the typecheck is clean', () => {
    expect(noteOf('Let me check the current app structure and identify the network error:', null)?.code).toBe('AGENT_NOTE');
    expect(noteOf('Let me check the specific error in the TrainModel:', "$ typecheck (tsc --noEmit, run by NavBharatAI) → clean (read from the output) (2s)")?.code).toBe('AGENT_NOTE');
  });
});
