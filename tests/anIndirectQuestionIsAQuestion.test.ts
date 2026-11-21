// failedbr #1020 (2026-11-20): the model asked "कृपया मुझे बताइए कि आप कौन सी ऐप बनवाना चाहते हैं" (please tell me which app you
// want) — no question mark — and was nudged into guessing a To-Do app while the user's real answer arrived mid-build.
import { describe, expect, it } from 'vitest';
import { turnAskedTheUser } from '../src/server/AgentV3/nudgeToBuild';

describe('an indirect question is a question (failedbr #1020)', () => {
  it.each(['ऐप का टॉपिक खाली रह गया है। कृपया मुझे बताइए कि आप कौन सी ऐप बनवाना चाहते हैं', 'Please let me know which features you need.', 'Bataiye ki aap kaunsa app chahte ho'])('asked: %s', (m) => {
    expect(turnAskedTheUser(m)).toBe(true);
  });
  it.each(['Let me know when it is ready. I am building it now.', 'I will build a todo app now.'])('not a question: %s', (m) => {
    expect(turnAskedTheUser(m)).toBe(false);
  });
});
