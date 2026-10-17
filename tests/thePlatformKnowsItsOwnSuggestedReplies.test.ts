// Q-1037 — THE PLATFORM MUST RECOGNISE THE WORDS IT PUT IN THE USER'S MOUTH.
//
// The defect, its class and its four siblings are written up in `platformSuggestedReplies.ts`. This file
// holds the behaviour, the precision, and a CENSUS that fails when a new `reply "…"` phrase is written
// into a user-facing string without being registered — so the class cannot come back one notice at a time.
//
// The measured "before", recorded so a reversion can be judged rather than guessed at:
//   "add it"            new_build/low   confirmed=FALSE (names-nothing-to-build)  → answered, not added
//   "add them"          new_build/low   confirmed=FALSE (names-nothing-to-build)  → answered, not added
//   "add it to this app" new_build/low  confirmed only because "app" is a PRODUCT_NOUN
//   "make it real"      new_build/HIGH  certain, and the wrong intent
//   "असली बनाओ" … and 9 more non-English forms of the same phrase: no signal at all in most scripts
//   "keep my changes"   chat/low        → a plain chat turn that RETURNS before GreenGuard's restore
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLATFORM_SUGGESTED_REPLIES,
  platformSuggestedReply,
  suggestedReplyKey,
  ADD_MISSING_FEATURE_REPLY_ONE,
  ADD_MISSING_FEATURE_REPLY_MANY,
  ADD_TO_THIS_APP_REPLY,
  MAKE_IT_REAL_REPLY,
} from '../src/server/AgentV3/platformSuggestedReplies';
import { classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';
import { buildConfirmation } from '../src/server/AgentV3/buildConfirmation';
import { missingFeatureNotice, CONFIRMED_MISSING_PREFIX } from '../src/server/AgentV3/missingFeatureNotice';
import { unrelatedRequestFallback, unrelatedRequestSteer } from '../src/server/AgentV3/unrelatedRequest';
import { fakeFeatureTails } from '../src/server/AgentV3/fakeFeatureScan';
import { KEEP_CHANGES_PHRASE } from '../src/server/AgentV3/GreenGuard';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const ENGINE_DIR = join(process.cwd(), 'src/server/AgentV3');

describe('every reply the platform asks for is read with certainty, never guessed at', () => {
  it('each registered phrase is an EDIT of the app that is here, at HIGH confidence', () => {
    expect(PLATFORM_SUGGESTED_REPLIES.length).toBeGreaterThanOrEqual(14);
    for (const { phrase, intent } of PLATFORM_SUGGESTED_REPLIES) {
      const verdict = classifyIntentWithConfidence(phrase);
      expect(verdict.intent, phrase).toBe(intent);
      expect(verdict.confidence, `${phrase} — LOW is what sends a turn to the LLM reader, which may answer it as chat`)
        .toBe('high');
      expect(verdict.signal, phrase).toBe('platform-suggested-reply');
    }
  });

  it('and a build is CONFIRMED by it — this is the half that was actually broken', () => {
    // `buildConfirmation` answering false is what made the route set intent='chat', so the feature the
    // notice promised to add was never added. Asserted for every phrase, not just the reported one.
    for (const { phrase } of PLATFORM_SUGGESTED_REPLIES) {
      expect(buildConfirmation(phrase).confirmed, phrase).toBe(true);
    }
  });

  it('GreenGuard\'s restore phrase is reachable, and through GreenGuard\'s own list', () => {
    // The restore decision was always exact-phrase. REACHING it was not: a bare "keep my changes" is
    // chat/low, which makes a plain chat turn that returns long before the restore code.
    for (const typed of [KEEP_CHANGES_PHRASE, 'keep my changes and add a login', 'mere changes rakho', 'restore my changes']) {
      const verdict = classifyIntentWithConfidence(typed);
      expect(verdict.intent, typed).toBe('edit_existing');
      expect(verdict.confidence, typed).toBe('high');
    }
    // Not re-listed here or in the registry: GreenGuard owns those phrasings.
    const registry = readFileSync(join(ENGINE_DIR, 'platformSuggestedReplies.ts'), 'utf8');
    expect(registry, 'the restore phrasings stay in GreenGuard, consulted not copied').not.toContain('mere changes rakho');
  });

  it('politeness and the quotation marks a user copies are set aside', () => {
    for (const typed of ['add it', 'Add it', 'add it please', 'please add it', '"add it"', 'add it.', 'Add it, please!', 'add it karo', 'ok add it', '“add them”']) {
      expect(platformSuggestedReply(typed)?.phrase, typed).toBeTruthy();
      expect(classifyIntentWithConfidence(typed).intent, typed).toBe('edit_existing');
    }
  });

  it('but it is the WHOLE message, never a substring — HIGH confidence skips the reader', () => {
    // autopsy 5abad374: a keyword winning an argument the sentence's grammar had lost cost 29 minutes.
    for (const typed of [
      'add it and also build a new login page',
      'can you add it?',
      'why did you not add it',
      'make it real time with websockets',
      'add a dashboard',
    ]) {
      expect(platformSuggestedReply(typed), typed).toBeNull();
    }
  });

  it('a bare politeness word, or nothing, matches nothing', () => {
    for (const typed of ['', '   ', 'please', 'karo', 'ok', 'thanks', 'hi']) {
      expect(platformSuggestedReply(typed), JSON.stringify(typed)).toBeNull();
    }
    expect(suggestedReplyKey('please!!')).toBe('');
  });

  it('the twelve-language phrase is EXTRACTED from fakeFeatureScan, not retyped', () => {
    const tails = fakeFeatureTails();
    expect(tails.length).toBeGreaterThanOrEqual(11);
    // Every tail must yield exactly one quoted phrase, and that phrase must be registered. A twelfth
    // language added to that module with no quoted phrase — or a phrase the registry misses — fails here.
    const registered = new Set(PLATFORM_SUGGESTED_REPLIES.map((r) => suggestedReplyKey(r.phrase)));
    for (const tail of tails) {
      const quoted = [...tail.matchAll(/[“"„]([^“”"„‟]{2,40})[”"‟]/g)].map((m) => m[1].trim());
      expect(quoted.length, `this tail does not name exactly one phrase to type: ${tail.slice(0, 60)}`).toBe(1);
      expect(registered.has(suggestedReplyKey(quoted[0])), `unregistered: ${quoted[0]}`).toBe(true);
    }
    expect(registered.has(suggestedReplyKey(MAKE_IT_REAL_REPLY)), 'the English constant drifted from the tail it documents').toBe(true);
    // The registry must not carry a translation as a literal of its own.
    const registry = readFileSync(join(ENGINE_DIR, 'platformSuggestedReplies.ts'), 'utf8');
    for (const { phrase } of PLATFORM_SUGGESTED_REPLIES) {
      if (/^[\x20-\x7e]+$/.test(phrase)) continue; // the three English constants live here by design
      expect(registry, `${phrase} is retyped in the registry instead of read from its module`).not.toContain(`'${phrase}'`);
    }
  });

  it('a Hindi phrase we wrote ourselves is not capped to LOW — the cap is for guesses', () => {
    const hindi = PLATFORM_SUGGESTED_REPLIES.map((r) => r.phrase).find((p) => /[ऀ-ॿ]/.test(p));
    expect(hindi, 'fakeFeatureScan writes a Devanagari phrase; this test needs it').toBeTruthy();
    expect(classifyIntentWithConfidence(hindi!).confidence).toBe('high');
    // And the cap still works on everything else — asserted in the SCRIPT, which is what the cap reads.
    // (My first version of this line used romanised "ek todo app banao" and passed at HIGH for the honest
    // reason that it carries no Devanagari at all, proving nothing about the cap.)
    expect(classifyIntentWithConfidence('एक टोडो ऐप बनाओ').confidence).toBe('low');
  });

  it('the phrase in a model-written reply is ordered to stay verbatim', () => {
    // `unrelatedRequestSteer` asks the model to answer in the user's language. Without this instruction
    // the model translates the phrase it tells them to type, and a translation is registered nowhere.
    const steer = unrelatedRequestSteer('calculator.tsx', false);
    expect(steer).toContain(ADD_TO_THIS_APP_REPLY);
    expect(steer).toMatch(/EXACTLY as it is, in English/);
  });

  it('the notices keep the phrase as a LITERAL, pinned equal to the constant', () => {
    // ⚠️ MY FIRST ATTEMPT INTERPOLATED THE CONSTANT INTO THESE SENTENCES, AND IT BROKE THE STRONGER
    // GUARD. `tests/aPromiseToTheUserHasAHandler.test.ts` reads every SHIPPED STRING and demands that
    // each `reply "X"` it finds has a proven handler. An imported constant is opaque to it: the census
    // saw `Reply "${…}"` and three of its tests went red because the promise had vanished from the one
    // place that checks promises are kept. Fixing A by creating X is forbidden, so the literal stays and
    // this pin stops the drift instead.
    const notice = missingFeatureNotice([`${CONFIRMED_MISSING_PREFIX} search`]);
    expect(notice).toContain(`Reply "${ADD_MISSING_FEATURE_REPLY_ONE}"`);
    expect(missingFeatureNotice([`${CONFIRMED_MISSING_PREFIX} search`, `${CONFIRMED_MISSING_PREFIX} cart`]))
      .toContain(`Reply "${ADD_MISSING_FEATURE_REPLY_MANY}"`);
    expect(unrelatedRequestFallback('calculator.tsx')).toContain(`reply "${ADD_TO_THIS_APP_REPLY}"`);
    expect(fakeFeatureTails()[0]).toContain(`reply "${MAKE_IT_REAL_REPLY}"`);
  });

  it('the CENSUS lives in aPromiseToTheUserHasAHandler.test.ts — not duplicated here', () => {
    // 🔴 I BUILT ONE ANYWAY, AND THIS IS SAFEGUARD #6'S VOCABULARY FAILURE, VERBATIM. I searched
    // "*suggest*reply*", "quickReplies", "PLATFORM_SUGGESTED" — found nothing — and wrote my own census
    // over `reply "…"`. The existing one is called `aPromiseToTheUserHasAHandler`, it was written for
    // Q-997 (the row Q-1037 was itself found while fixing), and it is strictly better: it walks the AST
    // of all of `src/` plus `server.ts`, expands template literals, and demands an EXECUTABLE proof per
    // phrase. Mine was a regex over one directory. It is deleted; what my work added there instead is
    // the ten non-English promise verbs it was silently blind to, and the strict `buildConfirmation`
    // proof for "add it" / "add them".
    const census = readFileSync(join(process.cwd(), 'tests/aPromiseToTheUserHasAHandler.test.ts'), 'utf8');
    expect(census, 'the census must still run the registry this module exports').toContain('PLATFORM_SUGGESTED_REPLIES');
    expect(census, 'and it must see a non-English promise, whose verb follows the quote').toContain('PROMISE_SUFFIX_VERB');
  });
});
