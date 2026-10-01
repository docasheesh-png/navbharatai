import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appLanguageInstruction, EDIT_LANGUAGE_LINE, LATIN_REQUEST_LANGUAGE_LINE } from '../src/server/AgentV3/LanguageDetect';

/**
 * 🔴 Autopsy 4d538ca3: a Bengali assistant app ("💬 চ্যাট", "🧠 মেমরি") was continued with an English
 * message, and the builder was told to write ALL user-facing text in the language of that message, in
 * Latin letters, and never to "translate the app into a language they did not write in". For an edit that
 * reads as: put English labels into a Bengali app.
 */
const CONTINUE = 'Continue the existing project from its current working state. Implement only the requested missing feature.';

describe('an edit keeps the language the app already uses', () => {
  it('🔴 an English follow-up on an existing app gets the edit line, not the Latin-script line', () => {
    const line = appLanguageInstruction(CONTINUE, { editingExistingApp: true });
    expect(line).toBe(EDIT_LANGUAGE_LINE);
    expect(line).toMatch(/language and script the app ALREADY uses/);
    expect(line).toMatch(/Reply to the user in the language they wrote/);
  });

  it('🔒 a new build is unchanged (the 466c260a rule still holds)', () => {
    expect(appLanguageInstruction('build a notes app')).toBe(LATIN_REQUEST_LANGUAGE_LINE);
    expect(appLanguageInstruction('build a notes app', { editingExistingApp: false })).toBe(LATIN_REQUEST_LANGUAGE_LINE);
  });

  it('🔒 an edit that NAMES a language follows the request', () => {
    expect(appLanguageInstruction('translate the app to Hindi', { editingExistingApp: true })).not.toBe(EDIT_LANGUAGE_LINE);
  });

  it('both the architect and every sub-agent are told it is an edit', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route.match(/appLanguageInstruction\(prompt, \{ editingExistingApp: intent === 'edit_existing' \}\)/g)?.length).toBe(2);
    expect(route).not.toMatch(/appLanguageInstruction\(prompt\)/);
  });
});
