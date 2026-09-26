import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessBuildInput, namesNoObject } from '../src/server/AgentV3/buildableInput';

/**
 * Admin report 820be124 (2026-09-12): the whole prompt was "Mujhe aik aip banana hai" — "I want to
 * make an app". It names no more than "app banao", which already gets "what should I build?", but the
 * pronoun and the auxiliary made it look like an instruction. The engine invented an app and spent
 * four minutes on it until the user pressed Stop.
 */
const asks = (p: string) => {
  const v = assessBuildInput(p);
  return !v.buildable && v.reason === 'no-object';
};

describe('"I want to make an app" names no app', () => {
  it('🔴 the exact prompt from the report asks what to make', () => {
    expect(asks('Mujhe aik aip banana hai')).toBe(true);
  });

  it('the same order in its other everyday phrasings and scripts', () => {
    for (const p of [
      'mujhe ek app banana hai',
      'Mujhe ek website banana hai',
      'I want to make an app',
      'can you make an app for me',
      'मुझे एक ऐप बनाना है',
      'hume ek naya app chahiye banana',
    ]) expect(asks(p), p).toBe(true);
  });

  it('🔒 ONE real word about the product and it builds, exactly as before', () => {
    for (const p of [
      'mujhe ek todo app banana hai',
      'mujhe app banana hai jo hisab rakhe',
      'shop billing app banao',
      'I want to make a calculator',
      'मुझे एक दुकान का हिसाब ऐप बनाना है',
      'calculator chahiye',
    ]) expect(assessBuildInput(p).buildable, p).toBe(true);
  });

  it('a sentence of pure grammar is not an order, and is left alone', () => {
    expect(namesNoObject('mujhe chahiye')).toBe(false);
    expect(namesNoObject('I want')).toBe(false);
  });

  it('the grammar words stay neutral ONLY in the no-object check — the word count is untouched', () => {
    // If they had been added to FILLER, "calculator chahiye" would drop to one word and be refused
    // as 'too-short'. The source guard keeps that choice from being "simplified" later.
    const src = readFileSync(resolve(__dirname, '../src/server/AgentV3/buildableInput.ts'), 'utf8');
    const filler = src.slice(src.indexOf('const FILLER'), src.indexOf(']);', src.indexOf('const FILLER')));
    for (const w of ["'mujhe'", "'hai'", "'chahiye'", "'want'"]) expect(filler).not.toContain(w);
  });
});
