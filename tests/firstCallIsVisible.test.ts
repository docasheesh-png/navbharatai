// THE FIRST CALL THE USER SITS THROUGH — autopsy 2b0a3ed5's two remaining halves, built 2026-09-17.
//
// THE RUN. A calculator build, 66 seconds, stopped by the user. Its ONE model call took 55.7 seconds
// and returned 27 output tokens — 0.48 tok/s against the ~33/s our own budget arithmetic assumes — and
// of the 66 seconds, **63 showed the user nothing at all**.
//
// Two fixes, and they are separate on purpose:
//
//   1. THE THROUGHPUT FLOOR stops the waiting. A stream that is neither healthy nor silent is a THIRD
//      state nothing could see: the timeout bench needs a throw, the 429 bench a 429, the idle bound
//      60 s of TOTAL silence, the hard cap 300 s, and the post-call slow bench three calls.
//   2. THE ELAPSED CLOCK makes the waiting legible. It is a MEASUREMENT, never an estimate — which is
//      exactly why it may be shown when the ETA (a prompt-word heuristic) rightly was not.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OpenAiStreamAccumulator, streamIsCrawling, streamMinCharsPerSec, streamThroughputGraceMs,
  STREAM_MIN_CHARS_PER_SEC, STREAM_THROUGHPUT_GRACE_MS,
} from '../src/server/AgentV3/providers/openAiStream';
import { isSlowStreamAbandon, SLOW_STREAM_MESSAGE } from '../src/server/AgentV3/turnDeadline';
import {
  formatElapsed, workingLine, isTransientStatusLine, startWorkingHeartbeat,
  WORKING_FIRST_MS, WORKING_INTERVAL_MS, WORKING_MARKER,
} from '../src/server/AgentV3/workingHeartbeat';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; vi.useRealTimers(); });

describe('🔴 1 · the throughput floor — the third state nothing could see', () => {
  it('the REPORTED call is crawling', () => {
    // 27 output tokens over 55.7 s. Even generously at 4 characters a token that is ~108 chars,
    // i.e. under 2 chars/second against a floor of 6.
    expect(streamIsCrawling({ producedChars: 108, elapsedMs: 55_723 })).toBe(true);
  });

  it('🔒 a FORCED-REASONING turn is never crawling — this is what makes the floor safe', () => {
    // GLM 5.3+ always reasons and emits its thinking BEFORE any content. A floor that watched only
    // answer text would abandon a perfectly healthy turn on exactly the tier that reasons most.
    const acc = new OpenAiStreamAccumulator();
    for (let i = 0; i < 40; i++) {
      acc.push({ choices: [{ delta: { reasoning_content: 'thinking hard about the calculator layout ' } }] });
    }
    expect(acc.textSoFar()).toBe('');             // not a single answer character yet…
    expect(acc.producedChars()).toBeGreaterThan(1000); // …and unmistakably busy
    expect(streamIsCrawling({ producedChars: acc.producedChars(), elapsedMs: 20_000 })).toBe(false);
  });

  it('tool-call arguments count as production too — a turn writing a big file is not idle', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"src/App.tsx","content":"' } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'x'.repeat(5000) } }] } }] });
    expect(acc.producedChars()).toBeGreaterThan(5000);
    expect(streamIsCrawling({ producedChars: acc.producedChars(), elapsedMs: 20_000 })).toBe(false);
  });

  it('🔒 the GRACE PERIOD — a brand-new stream is never judged', () => {
    // A provider legitimately spends its first seconds ingesting the prompt and returns nothing; the
    // reported call carried 26,569 input tokens. Judging inside that window abandons healthy calls
    // for being new, which is the difference between a measurement and a race.
    expect(streamIsCrawling({ producedChars: 0, elapsedMs: 1_000 })).toBe(false);
    expect(streamIsCrawling({ producedChars: 0, elapsedMs: STREAM_THROUGHPUT_GRACE_MS - 1 })).toBe(false);
    expect(streamIsCrawling({ producedChars: 0, elapsedMs: STREAM_THROUGHPUT_GRACE_MS })).toBe(true);
  });

  it('a healthy stream is never crawling', () => {
    expect(streamIsCrawling({ producedChars: 20_000, elapsedMs: 30_000 })).toBe(false);
    // Exactly at the floor is not below it.
    expect(streamIsCrawling({ producedChars: STREAM_MIN_CHARS_PER_SEC * 20, elapsedMs: 20_000 })).toBe(false);
  });

  it('an explicit 0 disables the floor; junk and BLANK fall back to the default', () => {
    // `Number('')` is 0, not NaN — a blank key must never read as "disabled".
    expect(streamIsCrawling({ producedChars: 0, elapsedMs: 30_000 }, { AGENTV3_STREAM_MIN_CHARS_PER_SEC: '0' } as never)).toBe(false);
    expect(streamMinCharsPerSec({ AGENTV3_STREAM_MIN_CHARS_PER_SEC: '' } as never)).toBe(STREAM_MIN_CHARS_PER_SEC);
    expect(streamMinCharsPerSec({ AGENTV3_STREAM_MIN_CHARS_PER_SEC: 'slow' } as never)).toBe(STREAM_MIN_CHARS_PER_SEC);
    expect(streamMinCharsPerSec({} as never)).toBe(STREAM_MIN_CHARS_PER_SEC);
    expect(streamThroughputGraceMs({ AGENTV3_STREAM_THROUGHPUT_GRACE_MS: '' } as never)).toBe(STREAM_THROUGHPUT_GRACE_MS);
    // A grace below 5s would make the floor a race rather than a reading.
    expect(streamThroughputGraceMs({ AGENTV3_STREAM_THROUGHPUT_GRACE_MS: '100' } as never)).toBe(STREAM_THROUGHPUT_GRACE_MS);
  });

  it('never throws on junk input', () => {
    expect(streamIsCrawling({ producedChars: NaN, elapsedMs: NaN })).toBe(false);
    expect(streamIsCrawling(null as never)).toBe(false);
  });

  it('an abandon reads as a timeout AND is tellable from one', () => {
    const err = new Error(`${SLOW_STREAM_MESSAGE} after 18000ms`);
    // It must bench like a hung rung…
    expect(/timed out/i.test(err.message)).toBe(true);
    // …and still be recognisable, because it is the one ending where the rung would probably have
    // answered eventually, so the family is benched at once rather than after a second slow turn.
    expect(isSlowStreamAbandon(err)).toBe(true);
    expect(isSlowStreamAbandon(new Error('OpenAI-compatible call (GLM/Kimi) timed out after 60000ms'))).toBe(false);
    expect(isSlowStreamAbandon(new Error('build budget reached while this call was still running'))).toBe(false);
    expect(isSlowStreamAbandon(null)).toBe(false);
  });

  it('🔒 the abandon message never reaches a user — it names the engines', () => {
    expect(SLOW_STREAM_MESSAGE).toMatch(/GLM|Kimi/);
  });
});

describe('🔴 2 · the elapsed clock — a measurement, never an estimate', () => {
  it('reads as time that has PASSED, and promises nothing about what is left', () => {
    expect(workingLine(34_000)).toBe('⏳ Still working — 34s so far');
    expect(workingLine(95_000)).toContain('1m 35s');
    // No prediction of any kind: that is the line between this and the ETA that was rightly withheld.
    expect(workingLine(34_000)).not.toMatch(/remaining|left|almost|soon|ETA|about \d/i);
  });

  it('formats without flattering us', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(59_999)).toBe('59s'); // floored, never rounded up to "1m"
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(725_000)).toBe('12m 05s');
    expect(formatElapsed(-5)).toBe('0s');
    expect(formatElapsed(NaN)).toBe('0s');
  });

  it('the marker is what both readers recognise it by', () => {
    expect(isTransientStatusLine(workingLine(1000))).toBe(true);
    expect(isTransientStatusLine(`  ${WORKING_MARKER} padded`)).toBe(true);
    expect(isTransientStatusLine('Setting up your workspace…')).toBe(false);
    expect(isTransientStatusLine('⏱ Planning your app…')).toBe(false); // the ETA line is a different one
    expect(isTransientStatusLine(null)).toBe(false);
  });

  it('⚠️ stays silent through an ordinary turn, then ticks', () => {
    // Most turns answer well inside the first delay; a line that appeared at once would flicker on
    // every call and teach the user to ignore it.
    vi.useFakeTimers();
    const seen: number[] = [];
    const stop = startWorkingHeartbeat((ms) => seen.push(ms));
    vi.advanceTimersByTime(WORKING_FIRST_MS - 1);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen.length).toBe(1);
    vi.advanceTimersByTime(WORKING_INTERVAL_MS * 2);
    expect(seen.length).toBe(3);
    stop();
    vi.advanceTimersByTime(WORKING_INTERVAL_MS * 5);
    expect(seen.length).toBe(3); // stopped means stopped
  });

  it('a throwing listener can never break a build', () => {
    vi.useFakeTimers();
    const stop = startWorkingHeartbeat(() => { throw new Error('surface blew up'); });
    expect(() => vi.advanceTimersByTime(WORKING_FIRST_MS + WORKING_INTERVAL_MS)).not.toThrow();
    stop();
  });

  it('🔒 the report records the clock ONCE, however long the build runs', () => {
    // A line that updates every 15 seconds would otherwise file itself a hundred times and bury the
    // timeline it exists to sit beside.
    const diag = new BuildDiagnostics();
    for (let i = 1; i <= 20; i++) {
      diag.ingestEvent({ type: 'narration', agent: 'architect', text: workingLine(i * 15_000), ts: i } as never);
    }
    const rows = diag.report().issues.filter((x) => isTransientStatusLine(x.message));
    expect(rows.length).toBe(1);
  });

  it('…and real build progress is still recorded every time', () => {
    const diag = new BuildDiagnostics();
    diag.ingestEvent({ type: 'narration', agent: 'architect', text: 'Setting up your workspace…', ts: 1 } as never);
    diag.ingestEvent({ type: 'narration', agent: 'architect', text: 'Writing src/App.tsx', ts: 2 } as never);
    expect(diag.report().issues.filter((x) => x.code === 'AGENT_STEP').length).toBe(2);
  });
});

describe('the wiring — each half reaches the place that was blank', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const runner = read('src/server/AgentV3/providers/OpenAiToolRunner.ts');
  const agentRunner = read('src/server/AgentV3/AgentRunner.ts');
  const multi = read('src/server/AgentV3/providers/MultiProviderTurnRunner.ts');

  it('the read loop judges throughput, and only when the caller allows it', () => {
    expect(runner).toContain('opts.canAbandon?.() && streamIsCrawling(');
    expect(runner).toContain("return 'slow';");
  });

  it('🔒 only the LADDER may allow it, and at most once per build', () => {
    // readStream cannot see the chain, so left to itself it could abandon the LAST engine and turn a
    // slow success into a failure. Once per build caps the total cost at one abandoned call.
    // The once-per-build flag lives on the build's shared bench registry since 2026-09-25.
    expect(multi).toContain('const canAbandonSlowStream = () => !bench.abandonedSlowRung && i + 1 < chain.length;');
    expect(multi).toContain('abandonedSlowRung = true;');
  });

  it('an abandoned rung is benched at once, or the guard defeats itself', () => {
    // We walk away before the call completes, so it reports no usage and the POST-CALL slow bench
    // never sees a sample — the next turn would go straight back to the same crawling rung.
    expect(multi).toContain('if (isSlowStreamAbandon(err)) {');
    expect(multi).toContain('canBenchAnother(slowBenched.size, distinctSlowRungs)');
  });

  it('a crawling provider is abandoned WHOLE — no half turn is kept', () => {
    expect(runner).toContain("if (stop === 'slow') {");
    expect(runner).toContain('SLOW_STREAM_MESSAGE');
  });

  it('the provider\'s own thinking finally reaches the screen', () => {
    // The accumulator has collected reasoning_content since streaming shipped and the event that
    // carries it — stream_delta kind:'thinking' — has existed since Claude got extended thinking.
    // Nothing joined them.
    expect(runner).toContain('onReasoning: params.onThinking');
    expect(runner).toContain('opts.onReasoning(delta)');
  });

  it('the clock runs around the model call and is always stopped', () => {
    expect(agentRunner).toContain('const stopWorkingHeartbeat = startWorkingHeartbeat(');
    expect(agentRunner).toContain('stopWorkingHeartbeat();');
    // In a `finally`, so a thrown turn can never leave a timer emitting into a dead build.
    expect(agentRunner).toMatch(/\}\s*finally\s*\{\s*\n\s*stopWorkingHeartbeat\(\);/);
    expect(agentRunner).toContain("id: 'working'");
  });
});
