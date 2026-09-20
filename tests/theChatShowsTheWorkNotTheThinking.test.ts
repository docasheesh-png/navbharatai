// "light/gray reply — bakwaas, yeh nahi chahiye!" (admin, 2026-09-20, with two screenshots of a phone
// filled top to bottom with the architect's private working notes).
//
// Three things are locked here, and the third is the one behavioural tests alone would miss.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { streamThinkingToChat } from '../src/server/AgentV3/thinkingStream';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Strip line and block comments so a rule is proven against CODE, never against prose about code. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('streamThinkingToChat', () => {
  it('is OFF when the key is unset — the default the admin asked for', () => {
    expect(streamThinkingToChat({})).toBe(false);
  });

  it('is ON only when the admin says so, so the old behaviour returns with no deploy', () => {
    for (const on of ['on', 'true', '1', 'yes', 'ON', ' on ']) {
      expect(streamThinkingToChat({ AGENTV3_STREAM_THINKING: on })).toBe(true);
    }
  });

  it('treats every NO spelling as off', () => {
    for (const off of ['off', 'false', '0', 'no', 'disabled']) {
      expect(streamThinkingToChat({ AGENTV3_STREAM_THINKING: off })).toBe(false);
    }
  });

  it('🔒 an UNREADABLE value means off, never on', () => {
    // Somebody who wanted it on would type `on`. A value that is present and unparseable can never
    // have meant "show the user more" — the same reasoning parseRolloutPercent uses for a bad PCT.
    for (const junk of ['ture', 'yess', '??', '  ']) {
      expect(streamThinkingToChat({ AGENTV3_STREAM_THINKING: junk })).toBe(false);
    }
  });
});

describe('every reasoning emit is gated — the reversion guard', () => {
  // WHY A SOURCE-LEVEL TEST: deleting one guard restores the wall for every user and breaks no
  // behavioural test in this repo, because the emit sites live inside a 20k-line streaming route
  // that no unit test drives. This is the same shape as ladderClaimsMatchTheTable.test.ts — it is
  // proven by reversion, not merely written.
  const SITES = ['src/server/AgentV3/AgentRunner.ts', 'src/server/routes/agentv3.ts'];

  it("no kind: 'thinking' delta is emitted outside a streamThinkingToChat() guard", () => {
    for (const rel of SITES) {
      const src = withoutComments(read(rel));
      const emits = [...src.matchAll(/kind:\s*'thinking'/g)];
      expect(emits.length, `${rel} should still emit the reasoning channel when switched on`).toBeGreaterThan(0);

      for (const m of emits) {
        // The guard opens shortly before the emit in both lanes; 600 chars is generous enough to
        // survive reformatting and far too short to reach an unrelated guard elsewhere in the file.
        const before = src.slice(Math.max(0, m.index - 600), m.index);
        expect(
          before.includes('streamThinkingToChat()'),
          `${rel}: a kind:'thinking' emit at index ${m.index} is not behind streamThinkingToChat()`,
        ).toBe(true);
      }
    }
  });

  it('the client refuses to render a reasoning delta as a chat line, whatever the server sends', () => {
    // The second net, and it is not redundant: the Android app is BUNDLED, so an installed shell can
    // be an old client talking to a new server, or a new client talking to an older revision.
    const src = withoutComments(read('src/components/agentv3/agentV3Reducer.ts'));
    expect(/if\s*\(\s*kind\s*===\s*'thinking'\s*\)/.test(src)).toBe(true);
  });
});
