// Autopsy a2b9c802 (2026-09-30) — "JARVIS Mobile Edition", a Telugu prompt on the Weak tier.
//
// The first build spent 240 s on the mega-app roadmap (cut off at its token limit), then 315 s on the
// project planner (timed out) — nine minutes of the platform's own planning. The architect then ran
// `ls`, read four files, updated its plan and started `npm install`, and 38 seconds later the futility
// breaker stopped the build as "0 files, 0 commands, 0 steps". Two defects made that possible, and a
// third made the nine minutes:
//
//   1. the architect's command hook RECORDED a command but never COUNTED it — only sub-agents did;
//   2. the breaker's quiet window opened at request time, so bounded planners filled it;
//   3. two planners ran over the same prompt, one after the other.
//
// And one hardening from the same report: the crawl floor measured characters, which makes an Indic
// answer look 2–4× slower than an English one at the same token rate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { armedFutilityState, initialFutilityState, tickFutility } from '../src/server/AgentV3/futilityBreaker';
import { roadmapStandsDownForProjectMode, detectMegaProject } from '../src/server/AgentV3/ProjectPlan';
import { OpenAiStreamAccumulator, streamIsCrawling, utf8Bytes } from '../src/server/AgentV3/providers/openAiStream';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const jarvisPrompt = readFileSync(join(__dirname, 'fixtures/autopsyA2b9c802.prompt.txt'), 'utf8');

describe('the futility window opens when the BUILD starts, not when the request arrived', () => {
  it('nine minutes of planning cannot count against the build: the window starts at zero when armed', () => {
    // The report's shape: nothing produced during the planners, then the build starts.
    const armed = armedFutilityState({ filesWritten: 0, commandsRun: 0, stepsDone: 0 });
    expect(armed.quietTicks).toBe(0);
    let state = armed;
    for (let minute = 1; minute < 10; minute++) {
      const v = tickFutility(state, { filesWritten: 0, commandsRun: 0, stepsDone: 0 }, 10);
      expect(v.stop).toBe(false);
      state = v.state;
    }
  });

  it('it baselines on what the preparation already produced — a pre-seeded file is not fresh progress', () => {
    const armed = armedFutilityState({ filesWritten: 12, commandsRun: 3, stepsDone: 0 });
    const v = tickFutility(armed, { filesWritten: 12, commandsRun: 3, stepsDone: 0 }, 10);
    expect(v.state.quietTicks).toBe(1);
  });

  it('a malformed snapshot arms at zero rather than throwing', () => {
    expect(armedFutilityState({ filesWritten: NaN, commandsRun: -1, stepsDone: 2.9 } as never).last)
      .toEqual({ filesWritten: 0, commandsRun: 0, stepsDone: 2 });
    expect(initialFutilityState().quietTicks).toBe(0);
  });

  it('the heartbeat ticks only once armed, and the arm sits after every planner and before the build loop', () => {
    expect(route).toContain('if (!futilityFired && futilityArmed)');
    const arm = route.indexOf('futilityArmed = true;');
    expect(arm).toBeGreaterThan(-1);
    expect(route.indexOf("code: 'MEGA_ROADMAP'")).toBeLessThan(arm);
    expect(route.lastIndexOf("code: 'PROJECT_MODE_FAILED'")).toBeLessThan(arm);
    expect(route.indexOf('await runner.run(buildPrompt)')).toBeGreaterThan(arm);
  });
});

describe('every lane\'s completed command counts — the architect\'s too', () => {
  it('the architect dispatcher and the sub-agents both go through noteCommandCompleted', () => {
    const uses = route.match(/noteCommandCompleted\(\);/g) ?? [];
    expect(uses.length).toBe(2);
    // The architect's hook is the one passed to the ToolDispatcher — it must count, not only record.
    expect(route).toMatch(/\(c\) => \{ noteCommandCompleted\(\); try \{ buildDiag\.recordCommand\(c\); \}/);
    // No second, private counter can drift from the shared one.
    expect((route.match(/commandsRun \+= 1/g) ?? []).length).toBe(1);
  });
});

describe('one planner per build', () => {
  it('project mode owns a mega-project, so the roadmap stands down', () => {
    expect(roadmapStandsDownForProjectMode({ projectModeOn: true, planFirst: false, megaProject: true })).toBe(true);
  });

  it('otherwise the roadmap runs exactly as before', () => {
    expect(roadmapStandsDownForProjectMode({ projectModeOn: false, planFirst: false, megaProject: true })).toBe(false);
    expect(roadmapStandsDownForProjectMode({ projectModeOn: true, planFirst: false, megaProject: false })).toBe(false);
    expect(roadmapStandsDownForProjectMode({ projectModeOn: true, planFirst: true, megaProject: true })).toBe(false);
  });

  it('the JARVIS prompt is not a mega-project any more, so only the roadmap would run for it', () => {
    // Its "Development Order — Step 1 → …" section is an instruction to the builder, not ten features
    // (the counter fix of autopsy 8e124182). Before that fix it counted 15 and BOTH planners ran.
    expect(detectMegaProject(jarvisPrompt)).toBe(false);
  });

  it('the route gates the roadmap on it and says so in the report', () => {
    expect(route).toContain('roadmapStandsDownForProjectMode({');
    expect(route).toMatch(/if \(scope\.decision === 'analyze' && !dispute && !projectModeOwns\)/);
    expect(route).toContain("code: 'MEGA_ROADMAP_STOOD_DOWN'");
    const diag = readFileSync(join(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    expect(diag).toContain("'MEGA_ROADMAP_STOOD_DOWN'");
  });
});

describe('the crawl floor is fair to Indic scripts', () => {
  const telugu = 'మన JARVIS Mobile Edition కోసం నేను ముందుగా Android App Structure';

  it('utf8Bytes matches Buffer for ASCII, Telugu, Devanagari and emoji', () => {
    for (const s of ['hello world', telugu, 'नमस्ते दुनिया', '🎙️ Voice 🔊', '']) {
      expect(utf8Bytes(s)).toBe(Buffer.byteLength(s, 'utf8'));
    }
  });

  it('the accumulator counts bytes as they arrive — text, reasoning and tool arguments', () => {
    const acc = new OpenAiStreamAccumulator();
    acc.push({ choices: [{ delta: { reasoning_content: 'ఆలోచన' } }] } as never);
    acc.push({ choices: [{ delta: { content: telugu } }] } as never);
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'write_file', arguments: '{"p":"ఫైల్"}' } }] } }] } as never);
    const expected = Buffer.byteLength('ఆలోచన') + Buffer.byteLength(telugu) + Buffer.byteLength('write_file') + Buffer.byteLength('{"p":"ఫైల్"}');
    expect(acc.producedBytes()).toBe(expected);
    expect(acc.producedChars()).toBeLessThan(expected);
  });

  it('an English stream is judged exactly as before', () => {
    const english = 'x'.repeat(150); // 150 chars over 30 s = 5/s: below the floor either way
    expect(streamIsCrawling({ producedBytes: utf8Bytes(english), elapsedMs: 30_000 }))
      .toBe(streamIsCrawling({ producedChars: english.length, elapsedMs: 30_000 }));
    expect(streamIsCrawling({ producedBytes: utf8Bytes(english), elapsedMs: 30_000 })).toBe(true);
  });

  it('a Telugu stream at the same work rate is no longer called a crawl', () => {
    const answer = 'మ'.repeat(150); // 150 characters in 30 s: 5 chars/s, but 15 bytes/s
    expect(streamIsCrawling({ producedChars: answer.length, elapsedMs: 30_000 })).toBe(true);
    expect(streamIsCrawling({ producedBytes: utf8Bytes(answer), elapsedMs: 30_000 })).toBe(false);
  });

  it('the runner reads bytes', () => {
    const runner = readFileSync(join(__dirname, '../src/server/AgentV3/providers/OpenAiToolRunner.ts'), 'utf8');
    expect(runner).toContain('streamIsCrawling({ producedBytes: acc.producedBytes(),');
  });
});
