import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assessBuildInput,
  namesNoObject,
  isBareActionWord,
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

  for (const prompt of [
    'app banao',
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
  const block = source.slice(source.indexOf('const askWhatToBuild ='), source.indexOf('const askWhatToBuild =') + 900);

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
