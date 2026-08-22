import { describe, it, expect } from 'vitest';
import { agentV3Reducer } from './agentV3Reducer';
import type { AgentV3ClientState } from './agentV3Types';

/**
 * ROOT CAUSE (both Mitrify "preview nahi chala" reports, 2026-08-21).
 *
 * The server corrects the framework in two places — an import reads the real app's package.json, and
 * the drift check reads an existing workspace — but the correction only ever reached the DURABLE
 * record and the build report. A REOPENED session therefore started with the right answer, while the
 * session that DID the correcting kept its `vite-react` default for its whole life: the exact session
 * where it matters most. That stale label chose the wrong in-browser preview lane AND the wrong
 * dev-server port to wait on, so the preview never came up. The client was guessing about a fact the
 * server already knew.
 */
const blank = (): AgentV3ClientState => ({
  narration: [], files: [], diffs: [], terminal: [], history: [], todos: [],
  checkpoints: [], activity: [], agents: {}, pendingBash: {}, done: false,
} as unknown as AgentV3ClientState);

describe('framework correction reaches the LIVE client', () => {
  it('adopts the framework the server actually detected', () => {
    const s = agentV3Reducer(blank(), { type: 'framework', framework: 'node-express', reason: 'imported', ts: 1 });
    expect(s.framework).toBe('node-express');
  });

  it('a later correction wins — the newest measurement is the true one', () => {
    let s = agentV3Reducer(blank(), { type: 'framework', framework: 'node-express', reason: 'imported', ts: 1 });
    s = agentV3Reducer(s, { type: 'framework', framework: 'nextjs', reason: 'detected', ts: 2 });
    expect(s.framework).toBe('nextjs');
  });

  it('touches NOTHING else — it is a label, not a build event', () => {
    // It must not clear files, end the build, or move the preview: a correction arriving mid-build
    // that reset any of those would be a far worse bug than the one it fixes.
    const before = agentV3Reducer(blank(), { type: 'preview', url: 'https://x.e2b.app', ts: 1 });
    const after = agentV3Reducer(before, { type: 'framework', framework: 'nuxt', reason: 'detected', ts: 2 });
    expect(after.previewUrl).toBe(before.previewUrl);
    expect(after.files).toBe(before.files);
    expect(after.done).toBe(false);
  });

  it('a state with no correction leaves `framework` absent, so the client keeps its own choice', () => {
    // The event is emitted ONLY on a real change. Absence must therefore mean "nothing was corrected",
    // never "reset to the default" — that would undo a user's deliberate pick on every build.
    expect(blank().framework).toBeUndefined();
  });
});

/**
 * THE CLOSING ASK SURVIVES THE BUILD ENDING (admin 2026-08-22: "AI ka last message 'app complete'
 * nahi — 'yeh keys chahiye, yahan fill karo'").
 *
 * The deterministic post-build `secret_request` is emitted immediately BEFORE the terminal event. A
 * successful build terminates with `result` — which must keep `pendingSecrets`, or the card would
 * flash and vanish and the admin's exact complaint would return. `done` (the failure path) clears it,
 * correctly: a failed build has no "one last step".
 */
describe('the post-build key ask survives the terminal event', () => {
  const ask = { type: 'secret_request' as const, agent: 'architect' as const, callId: 'postbuild-1', prompt: 'Your app is built. One last step…', secrets: [{ name: 'RAZORPAY_KEY_ID', why: 'Payments' }], ts: 1 };

  it('result (the SUCCESS terminal) keeps the card standing', () => {
    let s = agentV3Reducer(blank(), ask);
    s = agentV3Reducer(s, { type: 'result', ok: true, summary: 'Built.', steps: 1, billedUsd: 0, billedInr: 0, ts: 2 } as never);
    expect(s.pendingSecrets?.callId).toBe('postbuild-1');
    expect(s.done).toBe(true);
  });

  it('done (the FAILURE terminal) clears it — a failed build has no "one last step"', () => {
    let s = agentV3Reducer(blank(), ask);
    s = agentV3Reducer(s, { type: 'done', ok: false, summary: 'failed', ts: 2 });
    expect(s.pendingSecrets).toBeUndefined();
  });
});
