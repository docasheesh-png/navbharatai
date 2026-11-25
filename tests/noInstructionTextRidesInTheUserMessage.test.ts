// Free chat answered with "[Follow-up. No greeting needed. Respond in same language as user.]" in the reply
// (admin 2026-10-17). Cause: the client pasted bracketed instruction tags in front of the user's message, and a
// model quotes text it finds in the user turn. CLASS: instruction text inside the user message. This guard fails
// when a NEW bracketed directive is concatenated onto the message the chat hook sends.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/hooks/useChatEngine.ts', 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('the chat hook sends the message exactly as typed', () => {
  it('has no instruction tag wrapped around the message', () => {
    expect(src).not.toMatch(/Follow-up\. No greeting/);
    for (const tag of ['FOLLOW-UP', 'FIX MODE', 'ADD MODE', 'EDIT MODE', 'CREATE MODE', 'COMPONENT FOCUS', 'ERROR DETECTED', 'SESSION MEMORY']) {
      expect(src, tag).not.toContain(`[${tag}`);
    }
  });
  it('sends the message itself and carries memory as its own field', () => {
    // The one send path posts what the person typed, under its own key, and the session summary
    // travels as its own field. (This read the deleted blocking helper's call site; the helper is
    // gone with the slow path — admin 2026-11-25 — and the property asserted is unchanged.)
    expect(src).toMatch(/message: messageToSend,/);
    expect(src).toMatch(/memorySummary: memorySummary \|\| undefined,/);
  });
});
