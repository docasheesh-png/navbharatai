// failedbr #1200, #1188, #1179 (2026-11-20): a 15–16 s roadmap-planner call was the first call recorded, so TIME_TO_FIRST_CALL
// printed "0s of preparation" — and the user had already waited 15 s.
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const line = (d: BuildDiagnostics) => d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')?.message ?? '';

describe('a planner call is not the build\'s first call (failedbr #1200)', () => {
  it('the preparation window runs to the first BUILDER call and names the planner inside it', () => {
    let now = 0;
    const d = new BuildDiagnostics({ now: () => now });
    now = 15_300;
    d.recordLlmCall({ planner: true, model: 'haiku', provider: 'CLAUDE_HAIKU', latencyMs: 15_300, ok: true } as never);
    expect(line(d)).toBe('');
    now = 25_000;
    d.recordLlmCall({ model: 'kimi-k2.7-code', provider: 'KIMI', latencyMs: 4_000, ok: true } as never);
    expect(line(d)).toMatch(/^21s of preparation before the build's first model call began — 15s of it was the planner's own model call/);
  });
  it('a build with no planner reads as before', () => {
    let now = 0;
    const d = new BuildDiagnostics({ now: () => now });
    now = 10_000;
    d.recordLlmCall({ model: 'kimi-k2.7-code', provider: 'KIMI', latencyMs: 4_000, ok: true } as never);
    expect(line(d)).toMatch(/^6s of preparation before the build's first model call began — sandbox setup/);
  });
});
