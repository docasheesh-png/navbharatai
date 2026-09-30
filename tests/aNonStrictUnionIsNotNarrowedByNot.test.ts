// A GUARD THAT NARROWS UNDER `strict` AND NOT WITHOUT IT (autopsy d8ed307a, 2026-09-30).
//
// The Bengali AI-assistant build wrote `if (!result.ok) setError(result.message)` over an
// `{ ok: true } | { ok: false; message }` union. Our scaffold compiles with `"strict": false`, where
// TypeScript does not narrow by that guard, so tsc said TS2339 on correct-looking code. The frontend
// agent spent ~2.5 minutes and fifteen `node -e` experiments proving the code right. `result.ok === false`
// clears it; nothing in the message said so.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tscErrorCauses } from '../src/server/AgentV3/tscErrorCause';

const ERR = { file: 'src/components/Chat.tsx', line: 89, col: 23, code: 'TS2339',
  message: "Property 'message' does not exist on type 'SendMessageResult | SendMessageError'." };
const SRC = 'const result = await send();\nif (!result.ok) {\n  setError(result.message);\n}\n';

describe('the compiler error on a non-narrowed union is explained, once', () => {
  it('with the file in hand and a negated flag guard, it names the exact rewrite', () => {
    const c = tscErrorCauses([ERR as any], { 'src/components/Chat.tsx': SRC });
    expect(c.map((x) => x.id)).toEqual(['union-not-narrowed-nonstrict']);
    expect(c[0].advice).toContain('if (result.ok === false)');
    expect(c[0].advice).toMatch(/Do NOT change tsconfig/);
  });

  it('with no source in hand it still states the likely cause', () => {
    expect(tscErrorCauses([ERR as any]).map((x) => x.id)).toEqual(['union-not-narrowed-nonstrict']);
  });

  it('stays silent when the file has no negated guard — then the member is genuinely missing', () => {
    const c = tscErrorCauses([ERR as any], { 'src/components/Chat.tsx': 'const r = send();\nr.message;\n' });
    expect(c).toEqual([]);
  });

  it('never steals a React class-member error', () => {
    const e = { ...ERR, message: "Property 'state' does not exist on type 'A | B'." };
    expect(tscErrorCauses([e as any], {}).map((x) => x.id)).not.toContain('union-not-narrowed-nonstrict');
  });

  it('the builder is told up front, so the error is never written', () => {
    expect(readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8')).toMatch(/if \(result\.ok === false\)/);
  });
});
