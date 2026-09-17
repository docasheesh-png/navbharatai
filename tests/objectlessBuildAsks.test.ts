import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assessBuildInput,
  namesNoObject,
  isBareActionWord,
  isPlaceholderNoun,
  MIN_INSTRUCTION_WORDS,
} from '../src/server/AgentV3/buildableInput';
import { classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';

/**
 * AN ORDER WITH NO OBJECT IS NOT A BUILD ORDER — admin build report d6d664e6, 2026-09-17.
 *
 * The entire prompt was one word, "Bnao". The engine built for 29 minutes, delivered nothing, and
 * named the app it invented after the instruction word. The admin's ruling: if it is not clear what
 * to make, ASK — "mai samjha nahi, puri baat batao".
 *
 * These tests encode the exact reported failure, the boundary cases that must NOT change, and a
 * reversion guard so the fix cannot be quietly removed.
 */
describe('the reported failure', () => {
  it('"Bnao" — the exact prompt from report d6d664e6 — names nothing to build', () => {
    const v = assessBuildInput('Bnao');
    expect(v.buildable).toBe(false);
    expect((v as { reason: string }).reason).toBe('no-object');
  });

  it('the reply names the gap and asks, rather than asking blind', () => {
    const v = assessBuildInput('Bnao') as { message: string };
    expect(v.message).toMatch(/did not understand what to make/i);
    expect(v.message).toMatch(/tell me/i);
    // It shows what a good answer looks like — an ask with no example is how a user gets stuck.
    expect(v.message).toMatch(/for example/i);
  });

  it('names no vendor or model — the White-Label Law reaches user-facing copy too', () => {
    const v = assessBuildInput('Bnao') as { message: string };
    expect(v.message).not.toMatch(/glm|kimi|claude|gemini|grok|sonnet|opus|openai|anthropic/i);
  });

  it('the keyword classifier was NOT the culprit — it had no build signal to go on', () => {
    // Recorded because the autopsy first blamed this file. "bnao" is a misspelling, so it matches
    // none of the signal arrays and lands on the one-word rule at LOW confidence. The LLM reader,
    // offered only chat/build/edit, is what answered "build" — which is why the fix is here and
    // not a keyword added over there.
    const r = classifyIntentWithConfidence('Bnao');
    expect(r.confidence).toBe('low');
    expect(r.signal).toBe('short');
  });
});

describe('bare action words', () => {
  for (const word of ['bnao', 'banao', 'banaao', 'bana', 'banado', 'bnado', 'banwao', 'build', 'make', 'create', 'likho']) {
    it(`"${word}" is an instruction with no object`, () => {
      expect(isBareActionWord(word)).toBe(true);
    });
  }

  for (const word of ['calculator', 'app', 'ban', 'banner', 'billing', 'dashboard', 'todo']) {
    it(`"${word}" is a thing, not an instruction`, () => {
      expect(isBareActionWord(word)).toBe(false);
    });
  }
});

describe('what must keep building — an app builder that argues is not an app builder', () => {
  it('"calculator" — one word, but it names the deliverable', () => {
    const v = assessBuildInput('calculator');
    // Still not `no-object`: it is a noun. (It remains `too-short`, which the route deliberately
    // does NOT divert — that distinction is the whole reason this reason code exists.)
    expect((v as { reason?: string }).reason).not.toBe('no-object');
    expect(namesNoObject('calculator')).toBe(false);
  });

  // ⚠️ "app banao" USED TO BE IN THIS LIST, and that assertion was wrong — see the category-word
  // block at the end of this file. It encoded my own incomplete reading of the report, not anything
  // a user needs; the admin caught it the same day by asking which app it would build.
  for (const prompt of [
    'ek billing app banao',
    'todo app',
    'build a todo app with due dates',
    'make me a shop billing app with GST',
    'banao ek calculator',
  ]) {
    it(`"${prompt}" builds exactly as before`, () => {
      expect(assessBuildInput(prompt).buildable).toBe(true);
      expect(namesNoObject(prompt)).toBe(false);
    });
  }

  it('an empty prompt keeps its own reason, not this one', () => {
    expect((assessBuildInput('   ') as { reason: string }).reason).toBe('empty');
  });

  it('a pasted link keeps the better link-only message', () => {
    // "banao" beside a link must still explain that the link could not be read — that message names
    // what went wrong, and a bare "what should I build?" reads as though the link were never seen.
    const v = assessBuildInput('https://drive.google.com/file/d/abc/view banao');
    expect((v as { reason: string }).reason).toBe('link-only');
  });

  it('filler around a verb does not become an object', () => {
    // "yeh banao" is still objectless: 'yeh' carries no instruction (it is already FILLER).
    expect(namesNoObject('yeh banao')).toBe(true);
    expect(namesNoObject('please bana do')).toBe(true);
  });

  it('an edit order is not this class — it is protected by intent, not by vocabulary', () => {
    // "fix karo" reaches EDIT_SIGNALS, and the route's divert excludes edit_existing so a short
    // order inside a live project still means "carry on".
    expect(classifyIntentWithConfidence('fix karo').intent).toBe('edit_existing');
  });

  it('"continue" is a continuation, never a clarify', () => {
    expect(namesNoObject('continue')).toBe(false);
    expect(classifyIntentWithConfidence('continue').intent).toBe('edit_existing');
  });

  it('MIN_INSTRUCTION_WORDS is untouched — this fix adds a reason, it does not retune the old one', () => {
    expect(MIN_INSTRUCTION_WORDS).toBe(2);
  });
});

describe('the route only asks when NOTHING else can say what to build', () => {
  const source = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  // The window starts at `namesNothingToBuild` because the reader's fourth answer (2026-09-17) is
  // OR-ed in there, above `askWhatToBuild` — both sources must still pass the same four conditions.
  const block = source.slice(source.indexOf('const namesNothingToBuild ='), source.indexOf('const namesNothingToBuild =') + 1200);

  // REVERSION GUARD. Each of these four narrows the divert, and dropping any one of them turns a
  // fix into the thing it was written to prevent: asking a user who really did describe an app.
  // They are asserted out of the source because no unit test of a pure function can see them.
  for (const guard of ['!projectExists', 'recentRequests.length === 0', "intent !== 'edit_existing'", 'rawAttachments.length === 0']) {
    it(`still requires ${guard}`, () => {
      expect(block).toContain(guard);
    });
  }

  it('is driven by the no-object reason, not by the blunt too-short one', () => {
    expect(block).toContain("inputCheck.reason === 'no-object'");
  });

  it('a clarify turn is never served from — or stored in — the prompt-keyed reply cache', () => {
    // The steer depends on the workspace, so the same word must be able to get two different
    // answers. Asserted from the source because the cache decision is inside the request handler.
    expect(source).toContain('!clarifyWhatToBuild && chatCacheEnabled()');
  });
});

/**
 * "APP BANAO" NAMES NO MORE THAN "BANAO" DOES — admin, 2026-09-17, on reading the fix above:
 * *"agar koi user send karega 'app banao' to navbharatai kon sa app banayega?"* The honest answer
 * was: one it invents. A category word is not a deliverable.
 */
describe('a category word is not a deliverable', () => {
  for (const prompt of [
    'app banao',
    'ek app banao',
    'website banao',
    'kuch banao',
    'koi bhi app banao',
    'page banao',
    'make an app',
    'build a website',
    'make me something',
  ]) {
    it(`"${prompt}" still says nothing about what to build`, () => {
      expect(namesNoObject(prompt)).toBe(true);
      expect((assessBuildInput(prompt) as { reason?: string }).reason).toBe('no-object');
    });
  }

  for (const word of ['app', 'website', 'page', 'kuch', 'ek', 'something']) {
    it(`"${word}" is a category`, () => expect(isPlaceholderNoun(word)).toBe(true));
  }

  for (const word of ['todo', 'calculator', 'billing', 'shop', 'bakery', 'invoice', 'mobile']) {
    it(`"${word}" says what the thing IS`, () => expect(isPlaceholderNoun(word)).toBe(false));
  }

  // THE LINE. One real noun anywhere and the build starts instantly, exactly as before — this is
  // what keeps the fix from becoming an app builder that argues with you.
  for (const prompt of [
    'todo app banao',
    'calculator banao',
    'shop app banao',
    'ek billing app banao',
    'website for my bakery',
    'mobile app banao',
    'build a todo app with due dates',
  ]) {
    it(`"${prompt}" builds, untouched`, () => {
      expect(namesNoObject(prompt)).toBe(false);
      expect(assessBuildInput(prompt).buildable).toBe(true);
    });
  }
});

/**
 * THE READER'S FOURTH ANSWER — the half a word list can never reach (admin, 2026-09-17: "user ka har
 * woh message jo ek limit se chota hai ya unclear hai, hamesha LLM call karo — woh bata dega").
 */
describe('the intention reader can finally say "I do not know what they want"', () => {
  const source = readFileSync(resolve(__dirname, '../src/server/AgentV3/IntentClassifier.ts'), 'utf8');

  it('offers the reader "unclear" as an answer — no longer only three', () => {
    // Pinned by the WORD rather than the whole list: #3046 added "help" the same day, so the menu is
    // now five, and a test that spelled out the four would fail on a sibling that removed nothing.
    expect(source).toMatch(/Reply with ONLY one word: [a-z, ]*\bunclear\b/);
    expect(source).toContain("  unclear — they DO want something made, but have not said WHAT to make");
    expect(source).not.toContain('Reply with ONLY one word: chat, build, or edit.');
  });

  it('the route reads the flag and ORs it with the deterministic half', () => {
    const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('|| readerSaysUnclear');
  });
});
