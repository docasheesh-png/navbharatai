import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  readsAsQuestion, namesSpecificDeliverable, classifyIntentWithConfidence, classifyIntent,
} from '../src/server/AgentV3/IntentClassifier';

/**
 * AUTOPSY 2026-09-17, build 2c61f648 — "Can I use it. Or how to create apk".
 *
 * A real user typed that about a project they ALREADY had. Both halves classify as `chat` on their
 * own. Joined, the message became a **HIGH-confidence `new_build`** — and HIGH confidence returns
 * from `classifyIntentSmart` before the LLM intention reader is ever asked. The engine then ran a
 * 7.3-minute agentic build on their existing 51-file app, made ~104 provider calls, changed three of
 * their files, and left the project failing `tsc`.
 *
 * 🔴 THE MECHANISM, AND WHY IT IS A SIBLING RATHER THAN A NEW BUG. `WH_OPENERS` is `^`-anchored, so
 * "how" in the SECOND sentence was invisible; `AUX_OPENERS` matched the leading "can", and the old
 * early `return AUX_ASKS_US.test(text)` ("can i" ≠ "can you") handed back FALSE without any later
 * test running. One sentence decided the whole message.
 *
 * `MIDSENTENCE_KYA_QUESTION`'s own comment — written ONE DAY EARLIER, autopsy 2026-09-16 — states the
 * defect in as many words: *"Every other line in `readsAsQuestion` requires the message to OPEN with a
 * question word."* That autopsy unanchored the HINDI pattern and stopped. The English siblings were
 * never hunted. This file is that hunt, made structural: openers are applied per CLAUSE, so no future
 * pattern has to remember to be unanchored.
 */

describe('🔴 the reported message', () => {
  it('"Can I use it. Or how to create apk" is a QUESTION, and is answered rather than built', () => {
    const c = classifyIntentWithConfidence('Can I use it. Or how to create apk');
    expect(c.intent).toBe('chat');
    expect(c.signal).toBe('question-no-deliverable');
    expect(classifyIntent('Can I use it. Or how to create apk')).toBe('chat');
  });

  it('…and BOTH halves already classified as chat alone — only the join broke it', () => {
    expect(classifyIntent('Can I use it')).toBe('chat');
    expect(classifyIntent('how to create apk')).toBe('chat');
  });

  it('🔒 it never regains a HIGH confidence, which is what skips the intention reader', () => {
    // `classifyIntentSmart` returns at `if (confidence === 'high') return intent;` — a hard lock on a
    // sentence whose own grammar contradicts it is the entire class this rule exists to remove.
    expect(classifyIntentWithConfidence('Can I use it. Or how to create apk').confidence).not.toBe('high');
  });
});

describe('readsAsQuestion reads EVERY clause, not just the opening', () => {
  it('a question in the second sentence counts', () => {
    expect(readsAsQuestion('can i use it. or how to create apk')).toBe(true);
    expect(readsAsQuestion('i already built it. how do i publish')).toBe(true);
    expect(readsAsQuestion('thanks. what does this cost')).toBe(true);
  });

  it('a leading connective does not hide the question word behind it', () => {
    // Every opener test is `^`-anchored, so "or" in front of "how" was a perfect disguise.
    for (const lead of ['or', 'and', 'but', 'so', 'then', 'also', 'aur', 'ya', 'phir', 'lekin']) {
      expect(readsAsQuestion(`ok. ${lead} how does this work`), lead).toBe(true);
    }
  });

  it('every clause separator is honoured, including the Devanagari full stop', () => {
    expect(readsAsQuestion('ok. how does it work')).toBe(true);
    expect(readsAsQuestion('ok! how does it work')).toBe(true);
    expect(readsAsQuestion('ok; how does it work')).toBe(true);
    expect(readsAsQuestion('ok\nhow does it work')).toBe(true);
    expect(readsAsQuestion('ठीक है। kya aap bata sakte hai')).toBe(true);
  });

  it('🔴 the AUX branch no longer swallows the Hindi mid-sentence rule', () => {
    // The old line was `if (AUX_OPENERS.test(text)) return AUX_ASKS_US.test(text);` — so ANY message
    // opening "can i …", "should i …", "do i …" returned false before MIDSENTENCE_KYA_QUESTION ran.
    // That made yesterday's Hindi fix unreachable for a whole shape of message.
    expect(readsAsQuestion('can i ask kya aap ek app banaoge')).toBe(true);
    expect(readsAsQuestion('should i wait kya main prompt bhejun')).toBe(true);
  });

  it('a whole message ending in a question mark still short-circuits', () => {
    expect(readsAsQuestion('anything at all?')).toBe(true);
  });

  it('empty and whitespace are not questions', () => {
    expect(readsAsQuestion('')).toBe(false);
    expect(readsAsQuestion('   ')).toBe(false);
    expect(readsAsQuestion('. . .')).toBe(false);
  });
});

describe('🔒 what must NOT have changed — an order is still an order', () => {
  it('plain build orders keep HIGH confidence, so the common path pays nothing', () => {
    for (const p of ['build a notes app', 'create apk', 'make me an apk', 'ek billing app banao']) {
      const c = classifyIntentWithConfidence(p);
      expect(c.intent, p).toBe('new_build');
      expect(c.confidence, p).toBe('high');
    }
  });

  it('🔴 "do it again" is still a retry, not small talk', () => {
    // The auxiliary distinction this file already paid for: reading `do` as interrogative re-opened
    // the "please continue" amnesia the repo had previously fixed.
    expect(readsAsQuestion('do it again')).toBe(false);
    expect(classifyIntent('do it again')).toBe('edit_existing');
    expect(classifyIntent('continue')).toBe('edit_existing');
    expect(classifyIntent('please continue')).toBe('edit_existing');
  });

  it('an order followed by a second order is not a question', () => {
    expect(readsAsQuestion('add dark mode. and make the header sticky')).toBe(false);
    expect(classifyIntentWithConfidence('add dark mode. and make the header sticky').confidence).toBe('high');
  });

  it('a question that DOES name a deliverable keeps its build intent — it only loses the lock', () => {
    const c = classifyIntentWithConfidence('can you build me a todo app?');
    expect(c.intent).toBe('new_build');
    expect(c.confidence).toBe('low'); // → the intention reader is consulted, with project context
    expect(namesSpecificDeliverable('can you build me a todo app?')).toBe(true);
  });

  it('a filename or version number in a sentence does not invent a question', () => {
    expect(readsAsQuestion('build a site with next.js routing')).toBe(false);
    expect(readsAsQuestion('set the rating to 3.5 stars')).toBe(false);
  });
});

describe('🔒 the fix is structural, not another special case', () => {
  const src = readFileSync('src/server/AgentV3/IntentClassifier.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the openers are applied per clause, so no pattern has to remember to be unanchored', () => {
    expect(src).toContain('const CLAUSE_BOUNDARY =');
    expect(src).toContain('for (const clause of text.split(CLAUSE_BOUNDARY))');
    expect(src).toContain('function clauseReadsAsQuestion(');
  });

  it('🔴 the early return that made later tests unreachable is gone', () => {
    // Proven by reversion: restoring this line fails the AUX and second-clause cases above.
    expect(src).not.toContain('if (AUX_OPENERS.test(text)) return AUX_ASKS_US.test(text);');
    expect(src).toContain('if (AUX_OPENERS.test(text) && AUX_ASKS_US.test(text)) return true;');
  });
});
