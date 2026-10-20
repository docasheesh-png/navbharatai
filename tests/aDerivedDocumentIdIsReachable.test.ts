/**
 * Q-761 · Q-764 — ONE class: a Firestore document whose id is DERIVED from a key the eraser holds,
 * rather than equal to it or carried in the body.
 *
 * 🔴 THE FAILURE THESE ENCODE. Account deletion had two ways to find a document: the doc id IS the uid
 * (or a field equals it), or the doc id is a workspace id inside the `agentv3-{uid}-` range. Three
 * stores are neither, so each was read, correctly judged unreachable, and recorded as a queue row —
 * and the recording was all that ever happened. `build_history/{bare sessionId}` and
 * `bot_sessions/{botId}_{chatId}` both survived account deletion for ever.
 *
 * ⚠️ `adrDecisions`/`techDebt` are the same class and are deliberately NOT tested here: PR #3611, from
 * another session and opened first, owns those two and fixes them by making the writers store `userId`.
 * See `derivedIdErase.ts`'s scope note.
 *
 * `tests/everyCollectionIsClassified.test.ts` locks the CLASS — a new store of this shape cannot be
 * labelled `user` without naming the module that erases it. This file locks the KEY RESOLUTION, which
 * is where the class is actually dangerous: a prefix range is the one construct in the eraser that can
 * reach past its owner, so every bound and every refusal is pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  planBotSessionErase,
  buildHistoryKeysFor,
} from '../src/server/lib/derivedIdErase';

/** U+F8FF — the high sentinel that makes [p, p+sentinel] exactly the prefix range. */
const HIGH = String(String.fromCharCode(0xf8ff));
/** A real-shaped Firebase Auth uid: 28 characters of [A-Za-z0-9]. */
const UID = 'aB3dEfGhIjKlMnOpQrStUvWxYz01';

describe('planBotSessionErase — the per-bot range (Q-761)', () => {
  it('is exactly `${botId}_`, matching BotStore`s `${botId}_${chatId}`', () => {
    const botId = 'a1b2c3d4e5f60718293a4b5c'; // 24 hex chars, as routes/bots.ts mints
    const range = planBotSessionErase(botId)!;
    expect(range).toEqual({ startAt: `${botId}_`, endAt: `${botId}_${HIGH}` });
    expect(`${botId}_12345678` >= range.startAt).toBe(true);
    expect(`${botId}_12345678` <= range.endAt).toBe(true);
  });

  it('cannot reach the sessions of a bot whose id merely starts with this one', () => {
    // Same invariant as the uid range, one separator shorter: bot ids are [A-Za-z0-9] only
    // (`crypto.randomBytes(12).toString('hex')`), so a longer id lands strictly outside our bound.
    const { startAt, endAt } = planBotSessionErase('a1b2c3')!;
    for (const id of ['a1b2c39_chat', 'a1b2c3a_chat', 'a1b2c3ff_chat', 'a1b2c30_chat']) {
      expect(id < startAt || id > endAt, id).toBe(true);
    }
    expect('a1b2c3_chat' >= startAt && 'a1b2c3_chat' <= endAt).toBe(true);
  });

  it('refuses a bot id that contains the separator, rather than sweeping an ambiguous range', () => {
    for (const bad of ['', '  ', 'has_underscore', 'has-dash', null, undefined]) {
      expect(planBotSessionErase(bad as string), String(bad)).toBeNull();
    }
  });
});

describe('canonical history keys still require independently verified workspace ownership', () => {
  it.each(['abc', 'abc-d', UID])('does not turn an own session row into proof of bytes at a colliding key for %s', (uid) => {
    expect(buildHistoryKeysFor(uid, ['session1'], [`agentv3-${uid}-session1`])).toEqual([]);
  });

  it('refuses the same physical key derived from different owner/session pairs', () => {
    const sameKey = 'agentv3-abc-d-session1';
    expect(buildHistoryKeysFor('abc', ['d-session1'], [sameKey])).toEqual([]);
    expect(buildHistoryKeysFor('abc-d', ['session1'], [sameKey])).toEqual([]);
  });

  it('does not target global legacy rows, anonymous rows, foreign keys or unsafe paths', () => {
    for (const uid of [UID, '', 'has space', 'anon', 'u'.repeat(65)]) {
      expect(buildHistoryKeysFor(uid, ['../victim', 'nested/path', 'shared123'], [
        'agentv3-other-shared123', 'agentv3-anon-shared123', `agentv3-${uid}-shared123`,
      ])).toEqual([]);
    }
  });
});
