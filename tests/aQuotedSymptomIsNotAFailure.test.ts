// failedbr #1334 (2026-11-20): the request was "Fix this error and continue building the app: Failed to fetch GTA V". The
// model's two investigation notes quoted that symptom and were filed as AGENT_NOTE at ERROR severity — the only failure
// verb was inside the user's own quoted error message.
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics, withoutQuotedSpans } from '../src/server/AgentV3/BuildDiagnostics';

const severities = (text: string) => {
  const d = new BuildDiagnostics();
  d.ingestEvent({ type: 'narration', agent: 'architect', text, ts: 1 } as never);
  return d.report().issues.filter((i) => i.code === 'AGENT_NOTE' || i.code === 'AGENT_STEP').map((i) => [i.code, i.severity]);
};

describe('a quoted symptom is named, not reported (failedbr #1334)', () => {
  it('the two reported notes are not errors', () => {
    for (const t of [
      'I\'ll start by looking at the current state of the app to find where this "Failed to fetch" error comes from.',
      'The app\'s type errors are in App.tsx (types imported from the wrong module) — that\'s what breaks the build, and a red build/preview is exactly what shows as "Failed to fetch" in the preview.',
    ]) {
      expect(severities(t).some(([, s]) => s === 'error'), t).toBe(false);
    }
  });
  it('an unquoted failure is still an error', () => {
    expect(severities('⚠️ The preview could not be started.')).toEqual([['AGENT_NOTE', 'error']]);
  });
  it('only quoted spans are removed', () => {
    expect(withoutQuotedSpans('the "Failed to fetch" error and `cannot read x` here')).toBe('the   error and   here');
    expect(withoutQuotedSpans("it's a server that failed")).toBe("it's a server that failed");
  });
});
