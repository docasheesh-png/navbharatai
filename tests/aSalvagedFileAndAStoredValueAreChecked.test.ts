// 🔴 Q-2924 / Q-2925 (failedbr #2466, a360bc2c, 2026-11-19).
//  · Q-2924: a generic useLocalStorage put JSON.parse output straight into state, in a file the fast lane salvaged — and
//    the salvage hand-off carried compiler errors but never the write-time quality notes every other write gets.
//  · Q-2925: the fast lane's contract froze a callback prop as `() => void`; a form handed it `(e: FormEvent) => void` →
//    TS2322 → the lane failed verification. The contract was the defect.
// Reversion: drop salvageQualityNotes from the hand-off, PERSISTED_STATE_RULE from any lane, or CALLBACK_PROP_EVENT_RULE
// from the contract prompt, and the matching block fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { salvageQualityNotes } from '../src/server/AgentV3/writeTimeQualityCheck';
import { PERSISTED_STATE_RULE } from '../src/server/AgentV3/noEvalRule';
import { CALLBACK_PROP_EVENT_RULE, contractSystemPrompt, fileSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { oneShotSystemPrompt } from '../src/server/AgentV3/OneShotBuilder';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** The #2466 shape: a generic hook that parses storage straight into state. */
const UNGUARDED_HOOK = `import { useState } from 'react';
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const item = window.localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : initial;
  });
  return [value, setValue] as const;
}
`;

describe('Q-2924 — a salvaged file gets the write-time quality notes', () => {
  it('the unguarded hook from #2466 is named in the hand-off text', () => {
    const notes = salvageQualityNotes({ 'src/hooks/useLocalStorage.ts': UNGUARDED_HOOK, 'src/main.tsx': 'export {}' }, ['src/hooks/useLocalStorage.ts', 'src/main.tsx']);
    expect(notes).toMatch(/src\/hooks\/useLocalStorage\.ts/);
    expect(notes).toMatch(/runtime shape guard/);
    expect(notes).not.toMatch(/src\/main\.tsx/);
  });
  it('nothing flagged, or the check switched off ⇒ nothing added', () => {
    expect(salvageQualityNotes({ 'src/a.ts': 'export const a = 1;' }, ['src/a.ts'])).toBe('');
    expect(salvageQualityNotes({ 'src/hooks/useLocalStorage.ts': UNGUARDED_HOOK }, ['src/hooks/useLocalStorage.ts'], { AGENTV3_WRITE_QUALITY: 'off' } as NodeJS.ProcessEnv)).toBe('');
  });
  it('the route carries it in the salvage hand-off', () => {
    expect(read('src/server/routes/agentv3.ts')).toMatch(/salvageErrors \+\s*\n(?:\s*\/\/[^\n]*\n)*\s*salvageQualityNotes\(Object\.fromEntries\(writtenFiles\), sb\.salvagedPaths\)/);
  });
});

describe('Q-2924 — the storage rule is in every lane that writes app code', () => {
  it('architect, fast lane, one-shot, specialist', () => {
    expect(architectSystemPrompt('vite-react')).toContain(PERSISTED_STATE_RULE);
    expect(fileSystemPrompt('vite-react')).toContain(PERSISTED_STATE_RULE);
    expect(oneShotSystemPrompt('vite-react')).toContain(PERSISTED_STATE_RULE);
    expect(read('src/server/AgentV3/SubAgent.ts')).toContain('${LIGHT_THEME_BY_DEFAULT_RULE}\\n${PERSISTED_STATE_RULE}');
  });
});

describe('Q-2925 — a callback prop accepts the event its caller passes', () => {
  it('the contract prompt carries the rule', () => {
    expect(contractSystemPrompt('vite-react')).toContain(CALLBACK_PROP_EVENT_RULE);
  });

  it("the rule's own example really compiles under strict, and the frozen `() => void` really fails", () => {
    const src = `interface Ev { preventDefault(): void }
type Frozen = { onSubmit: () => void };
type Rule = { onSubmit: (e: Ev) => void };
const handler = (e: Ev) => { e.preventDefault(); };
const noArg = () => {};
export const a: Rule = { onSubmit: handler };
export const b: Rule = { onSubmit: noArg };
export const c: Frozen = { onSubmit: handler };
`;
    const file = 'probe.ts';
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const host = ts.createCompilerHost({});
    const orig = host.getSourceFile.bind(host);
    host.getSourceFile = (n, l, ...rest) => (n === file ? sf : orig(n, l, ...rest));
    const program = ts.createProgram([file], { strict: true, noEmit: true, types: [] }, host);
    const errs = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === file);
    // Exactly one error, on the frozen `() => void` line — the #2466 TS2322.
    expect(errs.map((d) => d.code)).toEqual([2322]);
    expect(sf.getLineAndCharacterOfPosition(errs[0].start ?? 0).line).toBe(7);
    // And the rule says the parameter is the event itself, never optional.
    expect(CALLBACK_PROP_EVENT_RULE).toMatch(/onSubmit: \(e: React\.FormEvent\) => void/);
    expect(CALLBACK_PROP_EVENT_RULE).not.toMatch(/\(e\?:/);
  });
});
