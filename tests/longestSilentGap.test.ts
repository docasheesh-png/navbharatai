/**
 * WHERE DID THE SILENT MINUTES GO?
 *
 * Mitrify report a876b7bb (2026-08-15) printed "330s of preparation" and then listed the CATEGORIES it
 * assumed were responsible — "sandbox setup, project restore, dependency install and secrets loading" —
 * none of them measured. The report's own timestamps held the real answer: 226 of those seconds were
 * ONE unbroken stretch with nothing recorded at all, immediately after
 * "GitHub import via SERVER-SIDE zipball SUCCEEDED". That was `listFiles` enumerating node_modules
 * over the network — a four-minute per-turn tax on every large app. Finding it took diffing
 * timestamps by hand a week later.
 *
 * 🔒 DERIVED FROM EVIDENCE ALREADY RECORDED, NOT FROM NEW TIMERS. Hand-placed timers only measure
 * stretches somebody already suspected, and the entire problem was a stretch nobody suspected. This
 * finds the next one too — on code paths that do not exist yet.
 *
 * 🔒 AND IT NAMES WHEN, NEVER WHY. "The silence began after X" is a fact. "X caused it" would be a
 * guess, and X is usually innocent — it is simply the last thing that spoke.
 */

import { describe, it, expect } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const gap = BuildDiagnostics.longestSilentGap;
const S = 1_000;

describe('🔒 the real report it was built from', () => {
  it('finds the 226s stretch and names what preceded it', () => {
    // Real timestamps from a876b7bb, rebased to 0 for readability.
    const startedAt = 0;
    const entries = [
      { ts: 27, message: 'Setting up your workspace…' },
      { ts: 11_440, message: 'Importing your project from https://github.com/…' },
      { ts: 94_951, message: 'GitHub import via SERVER-SIDE zipball SUCCEEDED …' },
      // ── 226 seconds of nothing (listFiles walking node_modules) ──
      { ts: 321_247, message: '🔐 Loaded 3 of your saved keys …' },
      { ts: 326_806, message: 'grounding: 5 files, ~186 tokens' },
    ];
    const found = gap(entries, startedAt, 337_537);
    expect(found).not.toBeNull();
    expect(found!.seconds).toBe(226);
    expect(found!.after).toContain('zipball SUCCEEDED');
  });
});

describe('what counts as a gap', () => {
  it('the stretch BEFORE the first entry counts — silence from the start is the worst kind', () => {
    const found = gap([{ ts: 200 * S, message: 'first thing' }], 0, 210 * S);
    expect(found!.seconds).toBe(200);
    expect(found!.after).toBe('the build started');
  });

  it('the stretch AFTER the last entry counts too', () => {
    const found = gap([{ ts: 5 * S, message: 'last thing' }], 0, 130 * S);
    expect(found!.seconds).toBe(125);
    expect(found!.after).toBe('last thing');
  });

  it('picks the LARGEST gap, not the first or the last', () => {
    const found = gap([
      { ts: 30 * S, message: 'a' },
      { ts: 120 * S, message: 'b' },   // 90s
      { ts: 400 * S, message: 'c' },   // 280s  ← the one
      { ts: 430 * S, message: 'd' },
    ], 0, 440 * S);
    expect(found!.seconds).toBe(280);
    expect(found!.after).toBe('b');
  });

  it('🔒 a healthy build reports NOTHING — this must not nag', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ ts: i * 2 * S, message: `step ${i}` }));
    expect(gap(entries, 0, 40 * S)).toBeNull();
  });

  it('respects the threshold it is given', () => {
    const entries = [{ ts: 0, message: 'a' }, { ts: 25 * S, message: 'b' }];
    expect(gap(entries, 0, 25 * S, 20)).not.toBeNull();
    expect(gap(entries, 0, 25 * S, 30)).toBeNull();
  });
});

describe('robustness — this runs on every build', () => {
  it('handles entries arriving out of order', () => {
    const found = gap([
      { ts: 400 * S, message: 'late' },
      { ts: 10 * S, message: 'early' },
    ], 0, 410 * S);
    expect(found!.seconds).toBe(390);
    expect(found!.after).toBe('early');
  });

  it('ignores entries outside the window', () => {
    const found = gap([
      { ts: -50 * S, message: 'before the build' },
      { ts: 60 * S, message: 'inside' },
      { ts: 999 * S, message: 'after the first call' },
    ], 0, 100 * S);
    expect(found!.seconds).toBe(60);
    expect(found!.after).toBe('the build started');
  });

  it('survives junk without throwing', () => {
    expect(() => gap(null as never, 0, 100 * S)).not.toThrow();
    // 🔒 NO ENTRIES AT ALL is not "nothing to report" — it means the build said NOTHING for the whole
    // window, which is the loudest version of this signal, not the quietest. So it reports the full
    // span from the start rather than going silent about the silence.
    expect(gap([], 0, 100 * S)).toEqual({ seconds: 100, after: 'the build started' });
    expect(gap(null as never, 0, 100 * S)).toEqual({ seconds: 100, after: 'the build started' });
    // An entry with an unusable timestamp is dropped, never trusted into the arithmetic.
    expect(gap([{ ts: NaN, message: 'x' } as never], 0, 100 * S)?.seconds).toBe(100);
  });

  it('🔒 keeps the label to ONE line and bounded — a report line, not a log dump', () => {
    const long = `${'x'.repeat(500)}\nsecond line`;
    const found = gap([{ ts: 0, message: long }], 0, 200 * S);
    expect(found!.after).not.toContain('\n');
    expect(found!.after.length).toBeLessThanOrEqual(120);
  });
});

describe('🔒 the sentence a human reads', () => {
  it('states when the silence began, and explicitly refuses to blame', () => {
    const d = new BuildDiagnostics({ buildId: 'b', workspaceId: 'w', prompt: 'p' } as never);
    d.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: 'Importing your project…', autoResolved: true });
    // A first model call far enough out that the gap crosses the threshold.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 300_000;
      d.recordLlmCall({ model: 'm', ok: true, latencyMs: 5_000 } as never);
    } finally {
      Date.now = realNow;
    }
    const line = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(line).toBeTruthy();
    expect(line!.message).toContain('longest single stretch');
    expect(line!.message).toContain('not what caused it');
  });
});
