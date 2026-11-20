/**
 * Q-2746 (autopsy 05eb30ba, all three builds): TIME_TO_FIRST_CALL read "longer than the 0s build timing window".
 * Root: a pre-build check (scope classification) ran BEFORE the build's timer but was recorded after it, and was
 * taken as the build's first call. It is now a plain note, replaced by the build's own first call when one comes.
 */
import { describe, it, expect } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const ttfc = (d: BuildDiagnostics) => d.report().issues.filter((i) => i.code === 'TIME_TO_FIRST_CALL');

describe('a pre-build call is not the build\'s first call', () => {
  it('alone, it gets one readable note — no "0s window", no zero-second claim', () => {
    let t = 1000; const d = new BuildDiagnostics({ now: () => t }); t += 4;
    d.recordLlmCall({ model: 'fixture', promptPreview: 'Build scope admission classification', latencyMs: 2751, ok: true });
    const notes = ttfc(d);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).not.toMatch(/0s build timing window|0s of preparation|took 0s/);
    expect(notes[0].message).toContain('not counted as setup time');
  });

  it('the build\'s own first call replaces the note with the real split, naming the earlier check', () => {
    let t = 1000; const d = new BuildDiagnostics({ now: () => t }); t += 4;
    d.recordLlmCall({ model: 'fixture', promptPreview: 'scope', latencyMs: 2751, ok: true });
    t += 9000;
    d.recordLlmCall({ model: 'fixture', latencyMs: 3000, ok: true });
    const notes = ttfc(d);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('6s of preparation');
    expect(notes[0].message).toContain('An earlier 2.8s pre-build check');
    t += 5000;
    d.recordLlmCall({ model: 'fixture', latencyMs: 1000, ok: true });
    expect(ttfc(d)).toHaveLength(1); // only the first in-window call is timed
  });

  it('two pre-build checks still leave a single note', () => {
    let t = 1000; const d = new BuildDiagnostics({ now: () => t }); t += 4;
    d.recordLlmCall({ model: 'a', latencyMs: 2751, ok: true });
    d.recordLlmCall({ model: 'b', latencyMs: 1900, ok: true });
    expect(ttfc(d)).toHaveLength(1);
  });
});
