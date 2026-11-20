// BR1995 autopsy: the user pressed "Fix with AI" under our own reconnect refusal, so the next build's
// request was our infrastructure sentence wrapped as an app fix. Synthetic fixtures only.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  errorCanBeFixedByEditingTheApp,
  fixErrorAndContinuePrompt,
  isPlatformFixRequest,
} from '../src/lib/platformFixRequest';
import {
  isSandboxRecoveryRefusalMessage,
  SANDBOX_RECOVERY_FIRST_MESSAGE as LIB_FIRST,
  SANDBOX_RECOVERY_REPEAT_MESSAGE as LIB_REPEAT,
} from '../src/lib/sandboxRecoveryMessages';
import {
  SandboxRecoveryUnavailableError,
  SANDBOX_RECOVERY_FIRST_MESSAGE,
  SANDBOX_RECOVERY_REPEAT_MESSAGE,
  latestSettledAttemptWasSandboxRecoveryUnavailable,
} from '../src/server/AgentV3/SandboxRecoveryError';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

/** Mirrors SubAgent's `Object.create(deps.events)`: the child sees the parent's set, not a copy. */
function CHILD_EVENTS_INHERIT_PROBE(): boolean {
  const parent = new AgentEventStream(50, 1_000);
  const child = Object.create(parent) as AgentEventStream;
  parent.budgetStagesSaid.add('final');
  return child.budgetStagesSaid === parent.budgetStagesSaid && child.budgetStagesSaid.has('final');
}

describe('F1 — no "Fix with AI" under our own reconnect refusal', () => {
  it('🔴 the first-refusal sentence (the report\'s shape) offers no button', () => {
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: SANDBOX_RECOVERY_FIRST_MESSAGE })).toBe(false);
  });

  it('the repeat-refusal sentence offers no button either', () => {
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: SANDBOX_RECOVERY_REPEAT_MESSAGE })).toBe(false);
  });

  it('surrounding whitespace is still the exact sentence', () => {
    expect(errorCanBeFixedByEditingTheApp({ message: `\n  ${SANDBOX_RECOVERY_FIRST_MESSAGE}  \n` })).toBe(false);
  });

  it('neighbours keep today\'s button (fail-safe: only the exact sentence stands down)', () => {
    for (const message of [
      "SyntaxError: Unexpected token '<' in src/App.tsx",
      'Your workspace could not be safely reconnected.',
      SANDBOX_RECOVERY_FIRST_MESSAGE.toLowerCase(),
      `${SANDBOX_RECOVERY_FIRST_MESSAGE} Details: Cannot find module './Header'`,
      `Error in my app: ${SANDBOX_RECOVERY_FIRST_MESSAGE}`,
      'मेरा ऐप नहीं खुल रहा — workspace could not be reconnected?',
      'The build sandbox could not be set up — the build cannot create files.',
    ]) {
      expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message }), message).toBe(true);
    }
  });

  it('main\'s existing answers are unchanged', () => {
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: true, message: 'anything' })).toBe(false);
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: '' })).toBe(false);
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: null })).toBe(false);
  });

  it('the predicate itself is exact and type-safe', () => {
    expect(isSandboxRecoveryRefusalMessage(LIB_FIRST)).toBe(true);
    expect(isSandboxRecoveryRefusalMessage(LIB_REPEAT)).toBe(true);
    expect(isSandboxRecoveryRefusalMessage(undefined)).toBe(false);
    expect(isSandboxRecoveryRefusalMessage(null)).toBe(false);
    expect(isSandboxRecoveryRefusalMessage(42 as unknown as string)).toBe(false);
    expect(isSandboxRecoveryRefusalMessage('')).toBe(false);
  });

  it('🔒 the moved sentences are byte-identical to main and still what the server raises', () => {
    expect(SANDBOX_RECOVERY_FIRST_MESSAGE).toBe('Your workspace could not be safely reconnected. Please retry shortly.');
    expect(SANDBOX_RECOVERY_REPEAT_MESSAGE).toBe(
      'Your workspace could not be safely reconnected again. Retrying immediately is unlikely to help. Please try again in a few minutes.',
    );
    expect(SANDBOX_RECOVERY_FIRST_MESSAGE).toBe(LIB_FIRST);
    expect(SANDBOX_RECOVERY_REPEAT_MESSAGE).toBe(LIB_REPEAT);
    expect(new SandboxRecoveryUnavailableError('connect-unknown').message).toBe(SANDBOX_RECOVERY_FIRST_MESSAGE);
    const repeat = new SandboxRecoveryUnavailableError(undefined, { repeated: true });
    expect(repeat.message).toBe(SANDBOX_RECOVERY_REPEAT_MESSAGE);
    expect(repeat.retryable).toBe(false);
  });

  it('the admin-only reason never reaches the sentence the client matches', () => {
    const e = new SandboxRecoveryUnavailableError('winner-reconnect');
    expect(e.message).not.toContain('winner');
    expect(isSandboxRecoveryRefusalMessage(e.message)).toBe(true);
  });

  it('an old client that still sends the wrapped sentence is recognised server-side as platform-composed', () => {
    expect(isPlatformFixRequest(fixErrorAndContinuePrompt(SANDBOX_RECOVERY_FIRST_MESSAGE))).toBe(true);
  });

  it('🔒 the panel still gates the button on the predicate', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(panel).toContain('errorCanBeFixedByEditingTheApp({ beforeBuildStarted: errorBeforeBuildStarted, message: error || state.error })');
  });

  it('🔒 the client-side module imports nothing from the server', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/sandboxRecoveryMessages.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"][^'"]*server/);
  });
});

describe('E1 — already closed on main: the second refusal on the same workspace (BR1984, #4254)', () => {
  it('a settled prior refusal makes the next one a repeat (non-retryable wording)', () => {
    const history = [
      { ok: false, endedAt: 2_000, issues: [{ code: 'SANDBOX_RECOVERY_UNAVAILABLE' }], summary: SANDBOX_RECOVERY_FIRST_MESSAGE },
    ];
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable(history)).toBe(true);
  });

  it('an in-progress row is skipped; a later success is not a repeat', () => {
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([
      { ok: false },
      { ok: false, endedAt: 2_000, issues: [{ code: 'SANDBOX_RECOVERY_UNAVAILABLE' }] },
    ])).toBe(true);
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([
      { ok: true, endedAt: 3_000 },
      { ok: false, endedAt: 2_000, issues: [{ code: 'SANDBOX_RECOVERY_UNAVAILABLE' }] },
    ])).toBe(false);
  });
});

describe('E2 — already closed on main: a backfilled pre-build admission call is not "0s of preparation" (BR1958)', () => {
  it('a 2.5 s admission call recorded 5 ms into the timer gives the window-mismatch line', () => {
    let now = 1_000_000;
    const d = new BuildDiagnostics({ now: () => now } as never);
    now += 5;
    d.recordLlmCall({ model: 'x', finishReason: 'end_turn', toolCalls: 0, inputTokens: 1, outputTokens: 1, latencyMs: 2_461, ok: true } as never);
    const line = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    // Q-2746: the pre-build call is now named in plain words (started before the build's timer, not counted).
    expect(line?.message).toContain("started before this build's timer");
    expect(line?.message).not.toMatch(/^0s of preparation/);
    expect(line?.message).not.toMatch(/first call itself then took 0s/);
  });
});

describe('BR1994 doc correction — a specialist reads the parent\'s build-wide stage set', () => {
  it('Object.create(parent) inherits budgetStagesSaid, so "final" said by the build is seen by the child', () => {
    expect(CHILD_EVENTS_INHERIT_PROBE()).toBe(true);
  });

  it('🔒 SubAgent still builds childEvents with Object.create(deps.events)', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/SubAgent.ts'), 'utf8');
    expect(src).toContain('const childEvents = Object.create(deps.events) as AgentEventStream;');
  });
});
