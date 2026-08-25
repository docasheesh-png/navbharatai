import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { toolCallTarget, toolCallDetail } from '../src/server/AgentV3/toolCallTarget';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * ⚠️ THE BLIND SPOT THIS CLOSES, measured from the admin's own reports (2026-08-25):
 *
 *     report_b   38 read_file · 12 grep  →  50 of 78 calls (64%) are READING
 *     report2    42 read_file · 26 grep  →  68 of 95 calls (72%) are READING
 *
 * Two thirds to three quarters of a weak build's entire turn budget goes on LOOKING at code rather
 * than writing it — and it gets worse on a complex app, because there is more to look at.
 *
 * And the report recorded `▶ read_file` with NO TARGET. So the one question that would say whether
 * those turns are waste — is it reading the same file over and over? — could not be asked of any build
 * we have ever run. This is not the fix; it is the only honest way to earn one, instead of guessing at
 * a cache nobody has evidence for.
 */
describe('a tool call records what it was aimed at', () => {
  it('names the file a read or an edit touched', () => {
    expect(toolCallTarget({ path: 'src/components/Board.tsx' })).toBe('src/components/Board.tsx');
    expect(toolCallTarget({ filePath: 'src/game.ts', content: 'secret-ish body' })).toBe('src/game.ts');
  });

  it('names the pattern a grep searched for', () => {
    expect(toolCallTarget({ pattern: 'useEffect\\(' })).toBe('useEffect\\(');
  });

  it('returns ONE target, not several — a timeline entry is scanned, not read', () => {
    expect(toolCallTarget({ path: 'a.ts', pattern: 'x', url: 'http://y' })).toBe('a.ts');
  });

  it('clips a very long path rather than flooding the timeline', () => {
    const t = toolCallTarget({ path: `src/${'deep/'.repeat(40)}file.tsx` });
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith('…')).toBe(true);
  });

  it('says nothing when there is nothing worth showing', () => {
    for (const junk of [null, undefined, 42, 'str', [], {}, { content: 'body only' }, { path: '   ' }]) {
      expect(toolCallTarget(junk)).toBe('');
    }
  });
});

/**
 * 🔒 THE SECURITY PROPERTY, and it is a WHITELIST rather than a filter — there is no input shape that
 * can carry a credential into the output, so this needs no redactor and cannot drift out of step with
 * one. A shell line is exactly where a token lives, so only its program name survives.
 */
describe('no secret can reach the report through this', () => {
  it('a bash command keeps only its first token', () => {
    expect(toolCallTarget({ command: 'npm run build' })).toBe('npm');
    expect(toolCallTarget({ command: 'curl -H "Authorization: Bearer sk-live-abc123" https://api.x' })).toBe('curl');
  });

  it('an env-assignment prefix is skipped, and never its VALUE', () => {
    const t = toolCallTarget({ command: 'STRIPE_KEY=sk_live_51H mycmd --go' });
    expect(t).toBe('mycmd');
    expect(t).not.toContain('sk_live');
  });

  it('a command that is ONLY an assignment yields nothing at all', () => {
    // The dangerous edge: falling back to "the first token" here would print the secret itself.
    const t = toolCallTarget({ command: 'API_TOKEN=ghp_realLookingSecret' });
    expect(t).toBe('');
  });

  it('free-form fields are never read — only the whitelist is', () => {
    // `content`, `new_string`, `body`, `prompt` can all hold a user's .env. None is a target field.
    for (const k of ['content', 'new_string', 'old_string', 'body', 'prompt', 'text']) {
      expect(toolCallTarget({ [k]: 'DATABASE_URL=postgres://user:hunter2@host/db' })).toBe('');
    }
  });
});

describe('the detail line, and that it is actually wired', () => {
  it('carries the agent and the target together', () => {
    expect(toolCallDetail('architect', { path: 'src/App.tsx' })).toBe('agent=architect · src/App.tsx');
  });

  it('degrades to whichever half exists', () => {
    expect(toolCallDetail('frontend', {})).toBe('agent=frontend');
    expect(toolCallDetail(undefined, { path: 'a.ts' })).toBe('a.ts');
    expect(toolCallDetail(undefined, {})).toBeUndefined();
  });

  it('a real tool_call event now records its file', () => {
    // End to end through the recorder, because the pure function being right is the half that does not
    // rot — the wiring is the half that does.
    const d = new BuildDiagnostics();
    d.ingestEvent({ type: 'tool_call', agent: 'architect', tool: 'read_file', input: { path: 'src/game.ts' }, callId: 'c1', ts: 1 } as never);
    const entry = d.report().issues.find((i) => i.code === 'TOOL_CALL');
    expect(entry?.detail).toContain('src/game.ts');
  });

  it('the recorder passes the INPUT, not just the agent', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    expect(src).toContain('detail: toolCallDetail(tc.agent, tc.input)');
    expect(src).not.toContain('detail: tc.agent ? `agent=${String(tc.agent)}` : undefined');
  });
});
