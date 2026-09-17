import { describe, it, expect } from 'vitest';
import {
  classifyIntentSmart,
  classifyIntentSmartDetailed,
  classifyIntentWithConfidence,
} from '../src/server/AgentV3/IntentClassifier';

/**
 * THE MISSING FOURTH ANSWER — admin build report d6d664e6, and the admin's own generalisation of it.
 *
 * The reader was offered three choices (chat / build / edit) for "Bnao" and answered `build`. It was
 * not wrong — "make it" IS an order to build. The true answer, "they have not told me WHAT", was not
 * on the menu. These tests hold the fourth answer open, and hold every existing behaviour still.
 */
const say = (word: string) => async () => word;
const down = async () => { throw new Error('provider down'); };

describe('the fourth answer exists and is offered', () => {
  it('"unclear" is a verdict the reader can return', async () => {
    const r = await classifyIntentSmartDetailed('Bnao', say('unclear'));
    expect(r.unclear).toBe(true);
  });

  it('an unclear verdict does NOT invent an intent — the keyword result stands', async () => {
    // This is the whole safety argument: the flag ADDS an option, it removes none. A caller that
    // ignores `unclear` must behave exactly as it did before this answer existed.
    const keyword = classifyIntentWithConfidence('Bnao');
    const r = await classifyIntentSmartDetailed('Bnao', say('unclear'));
    expect(r.intent).toBe(keyword.intent);
  });

  it('the three-way wrapper is unchanged for every caller that does not read the flag', async () => {
    const keyword = classifyIntentWithConfidence('Bnao');
    expect(await classifyIntentSmart('Bnao', say('unclear'))).toBe(keyword.intent);
  });
});

describe('nothing else moved', () => {
  it('"build" still means build', async () => {
    expect((await classifyIntentSmartDetailed('bnao', say('build'))).intent).toBe('new_build');
    expect((await classifyIntentSmartDetailed('bnao', say('build'))).unclear).toBe(false);
  });

  it('"edit" still means edit, and "chat" still means chat', async () => {
    expect((await classifyIntentSmartDetailed('kuch', say('edit'))).intent).toBe('edit_existing');
    expect((await classifyIntentSmartDetailed('kuch', say('chat'))).intent).toBe('chat');
  });

  it('a HIGH-confidence message never reaches the reader at all — no new cost on the common path', async () => {
    let called = false;
    const spy = async () => { called = true; return 'unclear'; };
    const verdict = await classifyIntentSmartDetailed('build a todo app with due dates', spy);
    expect(called).toBe(false);
    expect(verdict.intent).toBe('new_build');
    expect(verdict.unclear).toBe(false);
  });

  it('a provider that is DOWN leaves the keyword answer standing and never claims unclear', async () => {
    const r = await classifyIntentSmartDetailed('Bnao', down);
    expect(r.unclear).toBe(false);
    expect(r.intent).toBe(classifyIntentWithConfidence('Bnao').intent);
  });

  it('an unrecognised reply is not an unclear verdict', async () => {
    // "I think they want an app" must never be read as a fourth answer — only the exact word counts.
    const r = await classifyIntentSmartDetailed('Bnao', say('maybe'));
    expect(r.unclear).toBe(false);
  });

  it('the reader is still told what the project and the conversation look like', async () => {
    let seen = '';
    await classifyIntentSmartDetailed('Bnao', async (p) => { seen = p; return 'unclear'; }, {
      projectExists: false,
      recentRequests: ['ek billing app chahiye'],
    });
    expect(seen).toContain('ek billing app chahiye');
    expect(seen).toContain('NO project yet');
    expect(seen).toContain('unclear');
  });
});
