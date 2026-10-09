/**
 * Q-761 · Q-762 · Q-764 — ONE class: a Firestore document whose id is DERIVED from a key the eraser
 * holds, rather than equal to it or carried in the body.
 *
 * 🔴 THE FAILURE THESE ENCODE. Account deletion had two ways to find a document: the doc id IS the uid
 * (or a field equals it), or the doc id is a workspace id inside the `agentv3-{uid}-` range. Three
 * stores are neither, so each was read, correctly judged unreachable, and recorded as a queue row —
 * and the recording was all that ever happened. `adrDecisions`/`techDebt` (`${uid}__{projectId}`,
 * body `{records|items, updatedAt}`), `build_history/{bare sessionId}` and
 * `bot_sessions/{botId}_{chatId}` all survived account deletion for ever.
 *
 * `tests/everyCollectionIsClassified.test.ts` locks the CLASS — a new store of this shape cannot be
 * labelled `user` without naming the module that erases it. This file locks the KEY RESOLUTION, which
 * is where the class is actually dangerous: a prefix range is the one construct in the eraser that can
 * reach past its owner, so every bound and every refusal is pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  planUidPrefixErase,
  planBotSessionErase,
  buildHistoryKeysFor,
  UID_PREFIXED_COLLECTIONS,
  UID_COMPOSITE_SEPARATOR,
} from '../src/server/lib/derivedIdErase';

/** U+F8FF — the high sentinel that makes [p, p+sentinel] exactly the prefix range. */
const HIGH = String(String.fromCharCode(0xf8ff));
/** A real-shaped Firebase Auth uid: 28 characters of [A-Za-z0-9]. */
const UID = 'aB3dEfGhIjKlMnOpQrStUvWxYz01';

describe('planUidPrefixErase — the composite-id range (Q-762)', () => {
  it('is exactly the `${uid}__` prefix, and nothing wider', () => {
    const plan = planUidPrefixErase(UID);
    expect(plan.refusal).toBeUndefined();
    expect(plan.range).toEqual({ startAt: `${UID}__`, endAt: `${UID}__${HIGH}` });
  });

  it('cannot reach the document of a uid that merely STARTS with this one', () => {
    // THE WHOLE DANGER OF A PREFIX RANGE, and the invariant that removes it: the separator `_` is not
    // in [A-Za-z0-9], so a LONGER uid differs from ours exactly where ours has `_` — and its character
    // is either below `_` (a digit) or above it (a letter), never equal. Either way its document id
    // falls strictly OUTSIDE our bound. Both sides are asserted, because a one-sided check would have
    // passed while the other side was reachable.
    const { startAt, endAt } = planUidPrefixErase(UID).range!;
    for (const longer of [`${UID}2`, `${UID}9`, `${UID}a`, `${UID}Z`, `${UID}xy`]) {
      const id = `${longer}__project`;
      expect(id < startAt || id > endAt, id).toBe(true);
    }
    // …while OUR own documents are inside the bound, whatever the project id.
    for (const projectId of ['a', 'zzz', 'project-with-dashes', '9', 'A']) {
      const id = `${UID}__${projectId}`;
      expect(id >= startAt && id <= endAt, id).toBe(true);
    }
  });

  it("does not reach the uid's OWN plain-keyed document, which another eraser owns", () => {
    // `users/{uid}` and friends are the user registry's; this range starts after the separator.
    const plan = planUidPrefixErase(UID);
    expect(UID < plan.range!.startAt).toBe(true);
  });

  it('REFUSES a uid that could make the separator ambiguous, rather than guessing a bound', () => {
    // `a__b` + project `c` and `a` + project `b__c` produce the same document id, so a uid containing
    // the separator makes the prefix meaningless. A uid ending in `_` makes the bound overlap a
    // shorter uid's. Both are refused — a real answer, not a failure.
    for (const bad of ['a__b', 'abc_', '_abc', 'has space', 'has-dash', 'has.dot', 'has/slash']) {
      const plan = planUidPrefixErase(bad);
      expect(plan.range, bad).toBeNull();
      expect(plan.refusal, bad).toBe('ambiguous-uid');
    }
  });

  it('refuses an absent uid as unusable, never as an empty prefix', () => {
    // An empty prefix would be the range [`__`, `__`] — every user's records at once.
    for (const bad of ['', '   ', null, undefined]) {
      const plan = planUidPrefixErase(bad as string);
      expect(plan.range).toBeNull();
      expect(plan.refusal).toBe('unusable-uid');
    }
  });

  it('registers both stores of this shape, and only stores with no subcollection', () => {
    const names = UID_PREFIXED_COLLECTIONS.map((c) => c.collection);
    expect(names).toContain('adrDecisions');
    expect(names).toContain('techDebt');
    // Neither writer creates a subcollection — checked at the store, because Q-134 was exactly the bug
    // where a parent was deleted and its children were left behind, unreachable and kept.
    for (const entry of UID_PREFIXED_COLLECTIONS) expect(entry.sub).toBeUndefined();
    expect(UID_COMPOSITE_SEPARATOR).toBe('__');
  });
});

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

describe('buildHistoryKeysFor — resolving a BARE sessionId (Q-764)', () => {
  it('takes the union of both exact sources, deduplicated', () => {
    const keys = buildHistoryKeysFor(UID, ['pro-111'], [`agentv3-${UID}-pro-222`, `agentv3-${UID}-pro-111`]);
    expect(keys).toEqual(['pro-111', 'pro-222']);
  });

  it('strips exactly the prefix `buildHistoryAccess` describes, never a character more', () => {
    // "the workspace is `agentv3-{uid}-{sessionId}`, and `restorePointKey` strips the prefix back off,
    // so the history document id is the bare `pro-<ts>`".
    expect(buildHistoryKeysFor(UID, [], [`agentv3-${UID}-pro-1757000000000`])).toEqual(['pro-1757000000000']);
  });

  it('DROPS a workspace id that is not this user`s, instead of using it bare', () => {
    // Using it bare would delete `build_history/{someoneElsesSessionId}` — a stranger's version history.
    const keys = buildHistoryKeysFor(UID, [], [
      'agentv3-someoneelse000000000000000-pro-9',
      'agentv3-anon-pro-9',
      'pro-9',
      '',
    ]);
    expect(keys).toEqual([]);
  });

  it('keeps a session id from the uid-indexed source as given, since it is already this user`s', () => {
    // `user_build_history` is queried `where userId == uid`, so its rows need no further proof.
    expect(buildHistoryKeysFor(UID, ['  pro-7  ', ''], [])).toEqual(['pro-7']);
  });

  it('resolves nothing at all for a uid the workspace eraser itself refuses', () => {
    // A hyphenated uid makes `agentv3-{uid}-` ambiguous (planWorkspaceErase refuses it for that
    // reason), so no workspace id may be split on it here either.
    expect(buildHistoryKeysFor('abc-d', [], ['agentv3-abc-d-pro-1'])).toEqual([]);
  });
});
