import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CASE_DOC_KEY,
  CASE_ID_KEY,
  CASE_INDEX_KEY,
  LEGACY_MESSAGES_KEY,
  MAX_LOCAL_CASES,
  caseIdFromDocId,
  isUsableCaseId,
  legacySdaDocId,
  messageKeysFor,
  noteCaseUsed,
  parseCaseIndex,
  perCaseSdaDocId,
  resolveCaseDoc,
  sdaMessagesKey,
  startFreshCase,
  type CaseStorage,
} from '../src/lib/sdaCaseStore';
import { newSdaCaseId } from '../src/lib/sdaCaseId';

/**
 * A Doctor AI case is never overwritten by the next one.
 *
 * THE BUG, verified in code before a line was written: the Firestore document id was the fixed
 * `sda_<userId>` — one row per doctor for ever — and `startNewCase()` called
 * `localStorage.removeItem('sda_messages')`, one shared transcript key. So pressing "New case"
 * destroyed the previous patient's workup locally AND on the server, with nothing to reopen. Closing
 * the tab with ✕ carried its own copy of the same `removeItem`.
 *
 * These cases pin the rules that make that impossible rather than merely discouraged.
 */

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
/** Comments quote the bug they fixed, so a needle could match the explanation instead of the code. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sda = stripComments(read('src/components/sda/SDAChat.tsx'));
const app = stripComments(read('src/App.tsx'));
const sessions = stripComments(read('src/hooks/useSessionManager.ts'));

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage: CaseStorage & { dump: () => Record<string, string> } = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
  return storage;
}

describe('one address per case', () => {
  it('each case has its OWN document — two cases for one doctor never collide', () => {
    const a = perCaseSdaDocId('doc1', 'case-aaaaaaaa');
    const b = perCaseSdaDocId('doc1', 'case-bbbbbbbb');
    expect(a).not.toBe(b);
    expect(a).not.toBe(legacySdaDocId('doc1'));
  });

  it('each case has its OWN transcript key', () => {
    expect(sdaMessagesKey('case-aaaaaaaa')).not.toBe(sdaMessagesKey('case-bbbbbbbb'));
    expect(sdaMessagesKey('case-aaaaaaaa')).not.toBe(LEGACY_MESSAGES_KEY);
  });

  it('a real id from newSdaCaseId is always usable as a path segment', () => {
    for (let i = 0; i < 50; i++) expect(isUsableCaseId(newSdaCaseId())).toBe(true);
  });

  it('a tampered id that would address another collection is refused', () => {
    expect(isUsableCaseId('../../users/admin')).toBe(false);
    expect(isUsableCaseId('a/b')).toBe(false);
    expect(isUsableCaseId('')).toBe(false);
    expect(isUsableCaseId('short')).toBe(false);
    expect(isUsableCaseId(null)).toBe(false);
  });
});

describe('the migration binds, it does not copy', () => {
  it('a doctor mid-case when this shipped CONTINUES in the legacy row — no copy, no duplicate', () => {
    const r = resolveCaseDoc({ userId: 'doc1', caseId: 'case-aaaaaaaa', storedDocId: null, legacyExists: true });
    expect(r.docId).toBe(legacySdaDocId('doc1'));
    expect(r.boundToLegacy).toBe(true);
    expect(r.shouldPersist).toBe(true);
  });

  it('a brand-new account gets a per-case document from its very first case', () => {
    const r = resolveCaseDoc({ userId: 'doc1', caseId: 'case-aaaaaaaa', storedDocId: null, legacyExists: false });
    expect(r.docId).toBe(perCaseSdaDocId('doc1', 'case-aaaaaaaa'));
    expect(r.boundToLegacy).toBe(false);
  });

  it('a decided binding is authoritative and does not drift between reloads', () => {
    const legacy = resolveCaseDoc({ userId: 'doc1', caseId: 'case-aaaaaaaa', storedDocId: legacySdaDocId('doc1'), legacyExists: false });
    expect(legacy.docId).toBe(legacySdaDocId('doc1'));
    expect(legacy.shouldPersist).toBe(false);

    const perCase = perCaseSdaDocId('doc1', 'case-aaaaaaaa');
    const kept = resolveCaseDoc({ userId: 'doc1', caseId: 'case-aaaaaaaa', storedDocId: perCase, legacyExists: true });
    expect(kept.docId).toBe(perCase);
    expect(kept.boundToLegacy).toBe(false);
  });

  it("another user's stored document is discarded, never honoured as a third option", () => {
    const r = resolveCaseDoc({ userId: 'doc1', caseId: 'case-aaaaaaaa', storedDocId: 'sda_SOMEONE_ELSE', legacyExists: false });
    expect(r.docId).toBe(perCaseSdaDocId('doc1', 'case-aaaaaaaa'));
    expect(r.docId).not.toContain('SOMEONE_ELSE');
  });
});

describe('the legacy transcript is offered to exactly one case', () => {
  it('the case bound to the legacy row may fall back to the old shared key', () => {
    expect(messageKeysFor('case-aaaaaaaa', true)).toEqual([sdaMessagesKey('case-aaaaaaaa'), LEGACY_MESSAGES_KEY]);
  });

  it('🔴 a NEW case may NOT — that would open the new patient on the previous patient\'s transcript', () => {
    expect(messageKeysFor('case-bbbbbbbb', false)).toEqual([sdaMessagesKey('case-bbbbbbbb')]);
    expect(messageKeysFor('case-bbbbbbbb', false)).not.toContain(LEGACY_MESSAGES_KEY);
  });
});

describe('starting a new case deletes nothing', () => {
  it('startFreshCase moves the pointers and leaves the previous transcript untouched', () => {
    const prev = 'case-aaaaaaaa';
    const storage = fakeStorage({
      [CASE_ID_KEY]: prev,
      [CASE_DOC_KEY]: perCaseSdaDocId('doc1', prev),
      [sdaMessagesKey(prev)]: '[{"id":"1"},{"id":"2"}]',
      [CASE_INDEX_KEY]: JSON.stringify([prev]),
    });
    startFreshCase(storage, 'case-bbbbbbbb', 'doc1');
    const after = storage.dump();
    expect(after[CASE_ID_KEY]).toBe('case-bbbbbbbb');
    expect(after[CASE_DOC_KEY]).toBe(perCaseSdaDocId('doc1', 'case-bbbbbbbb'));
    // THE POINT OF THE WHOLE CHANGE:
    expect(after[sdaMessagesKey(prev)]).toBe('[{"id":"1"},{"id":"2"}]');
  });

  it('a signed-out doctor gets no stale document binding left behind', () => {
    const storage = fakeStorage({ [CASE_DOC_KEY]: 'sda_doc1_case-aaaaaaaa' });
    startFreshCase(storage, 'case-bbbbbbbb', null);
    expect(storage.dump()[CASE_DOC_KEY]).toBeUndefined();
  });

  it('an unusable id is refused rather than written into a path', () => {
    const storage = fakeStorage({ [CASE_ID_KEY]: 'case-aaaaaaaa' });
    startFreshCase(storage, '../evil', 'doc1');
    expect(storage.dump()[CASE_ID_KEY]).toBe('case-aaaaaaaa');
  });

  it('storage that throws cannot break the screen', () => {
    const throwing: CaseStorage = {
      getItem: () => { throw new Error('private mode'); },
      setItem: () => { throw new Error('private mode'); },
      removeItem: () => { throw new Error('private mode'); },
    };
    expect(() => startFreshCase(throwing, 'case-bbbbbbbb', 'doc1')).not.toThrow();
    expect(() => startFreshCase(null, 'case-bbbbbbbb', 'doc1')).not.toThrow();
  });
});

describe('the device keeps a bounded number of transcripts, the server keeps them all', () => {
  it('the case in use is never the one evicted, even at a cap of one', () => {
    const { index, evictedKeys } = noteCaseUsed(['case-aaaaaaaa', 'case-bbbbbbbb'], 'case-cccccccc', 1);
    expect(index).toEqual(['case-cccccccc']);
    expect(evictedKeys).not.toContain(sdaMessagesKey('case-cccccccc'));
    expect(evictedKeys).toContain(sdaMessagesKey('case-aaaaaaaa'));
  });

  it('re-opening a case moves it to the front instead of duplicating it', () => {
    const { index } = noteCaseUsed(['case-aaaaaaaa', 'case-bbbbbbbb'], 'case-bbbbbbbb');
    expect(index).toEqual(['case-bbbbbbbb', 'case-aaaaaaaa']);
  });

  it('nothing is evicted while under the cap', () => {
    const ids = Array.from({ length: MAX_LOCAL_CASES - 1 }, (_, i) => `case-${String(i).padStart(8, '0')}`);
    expect(noteCaseUsed(ids, 'case-zzzzzzzz').evictedKeys).toEqual([]);
  });

  it('a corrupt index reads as empty rather than throwing', () => {
    expect(parseCaseIndex('not json')).toEqual([]);
    expect(parseCaseIndex(null)).toEqual([]);
    expect(parseCaseIndex('{"a":1}')).toEqual([]);
    expect(parseCaseIndex(JSON.stringify(['case-aaaaaaaa', 'a/b']))).toEqual(['case-aaaaaaaa']);
  });
});

describe('a History row names its case', () => {
  it('a per-case row resolves to that case', () => {
    expect(caseIdFromDocId(perCaseSdaDocId('doc1', 'case-aaaaaaaa'), 'doc1')).toBe('case-aaaaaaaa');
  });

  it('the legacy row honestly reports null rather than guessing a case', () => {
    expect(caseIdFromDocId(legacySdaDocId('doc1'), 'doc1')).toBeNull();
  });

  it("another user's row, a free-chat row and rubbish all resolve to null", () => {
    expect(caseIdFromDocId(perCaseSdaDocId('doc2', 'case-aaaaaaaa'), 'doc1')).toBeNull();
    expect(caseIdFromDocId('v3_something', 'doc1')).toBeNull();
    expect(caseIdFromDocId(null, 'doc1')).toBeNull();
    expect(caseIdFromDocId('sda_doc1_a/b', 'doc1')).toBeNull();
  });
});

describe('the wiring — asserted from source, comments stripped', () => {
  it('SDAChat writes the transcript under the CASE key and never the shared one', () => {
    expect(sda).toContain('localStorage.setItem(sdaMessagesKey(caseIdRef.current)');
    expect(sda).not.toContain("localStorage.setItem('sda_messages'");
    expect(sda).not.toContain("localStorage.removeItem('sda_messages')");
  });

  it('SDAChat addresses the document by the binding, never by the bare userId', () => {
    expect(sda).not.toContain('`sda_${userId}`');
    expect(sda).toContain('caseDocRef.current');
  });

  it('🔴 the two identities stay apart: a rewind rotates the CLINICAL session, never the case', () => {
    // Conflating them would move the patient to a new document on every corrected typo, orphaning the
    // row their case is already in.
    const rewind = sda.slice(sda.indexOf('const rewindCase'), sda.indexOf('const handleSend'));
    expect(rewind).toContain('clinicalSessionRef.current = newSdaCaseId()');
    expect(rewind).not.toContain('caseIdRef.current =');
    expect(rewind).not.toContain('caseDocRef.current =');
  });

  it('the server is sent the clinical session id, not the case id', () => {
    expect(sda).toContain('sessionId: clinicalSessionRef.current');
    expect(sda).not.toContain('sessionId: caseIdRef.current');
  });

  it('starting a new case rotates BOTH identities', () => {
    const start = sda.slice(sda.indexOf('const startNewCase'), sda.indexOf('const startNewCase') + 1800);
    expect(start).toContain('caseIdRef.current = freshId');
    expect(start).toContain('clinicalSessionRef.current = freshId');
  });

  it('🔴 closing the tab no longer deletes the case — the sibling that carried its own removeItem', () => {
    expect(app).not.toContain("localStorage.removeItem('sda_messages')");
    expect(app).toContain('startFreshCase(');
  });

  it('History opens the case that was tapped, and SDAChat accepts it', () => {
    expect(sessions).toContain('setSdaOpenCaseId(caseIdFromDocId(');
    expect(app).toContain('openCaseId={sdaOpenCaseId}');
    expect(sda).toContain('openCaseId');
  });
});
