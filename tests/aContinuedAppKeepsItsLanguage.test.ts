// failedbr #1180 → #1181 (2026-11-20): a Bengali game ("Fight 1") was continued with the English "Continue from where you
// left off…" chip; the edit line said "match the labels the app already uses", the app had only our English starter, and
// the Bengali user got an English UI.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLanguageInstruction } from '../src/server/AgentV3/LanguageDetect';

const FIRST = '২জন থাকবে এই গেম তাহলো মারাপিট করার গেম ওইখানে ১জন খেলা করে তাহলে আর এক জন কম্পিউটার খেলবে\nএর নাম হবে fight 1';
const CONTINUE = 'Continue from where you left off and finish/fix the build so the app works end-to-end.';

describe('a continued app keeps the language it was asked for in (failedbr #1181)', () => {
  it('the continuation reads the request it continues', () => {
    const line = buildLanguageInstruction({ prompt: CONTINUE, continuedRequest: `${CONTINUE}\n${FIRST}`, isContinuation: true, editingExistingApp: true });
    expect(line).toMatch(/Bengali/);
  });
  it('an ordinary edit still matches the app it changes', () => {
    const line = buildLanguageInstruction({ prompt: 'make the header blue', continuedRequest: `make the header blue\n${FIRST}`, isContinuation: false, editingExistingApp: true });
    expect(line).toMatch(/EXISTING app/);
  });
  it('🔒 both build paths use it', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route.match(/buildLanguageInstruction\(\{ prompt, continuedRequest: checksRequest, isContinuation: isContinuationMessage\(prompt\)/g)?.length).toBe(2);
  });
});
