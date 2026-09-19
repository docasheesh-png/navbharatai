/**
 * Where ONE Doctor AI (SDA) case lives — its Firestore document and its on-device transcript.
 *
 * 🔴 THE BUG THIS EXISTS TO KILL, and it was live in production, not hypothetical.
 *
 * The Firestore document id was the fixed `sda_<userId>` — ONE row per doctor, for ever. So every new
 * case overwrote the previous patient's workup in place, and `startNewCase()` compounded it on the
 * device by calling `localStorage.removeItem('sda_messages')`. A doctor who pressed "New case" lost the
 * case before it. Nothing warned them, and there was nothing to reopen.
 *
 * It was never a missing History screen. `HistoryView` already reads `chat_sessions` and already has an
 * SDA filter; SDAChat already writes there with `tab: 'sda_chat'`. The one defect was the KEY — one
 * address for an unbounded number of cases.
 *
 * 🔑 And the per-case id already existed. `newSdaCaseId()` mints one per case so the SERVER's clinical
 * store cannot bleed Patient A's red flags into Patient B's workup. It was correct, and it was simply
 * never used to address the document. This module is that id, applied.
 *
 * WHAT MAKES THE FIX SAFE BY CONSTRUCTION RATHER THAN BY CARE: once each case owns its own address,
 * there is no shared row left to overwrite. `startNewCase` does not have to "archive" anything first —
 * it rotates the id, the next write lands somewhere new, and the old case simply stays where it is.
 * A step nobody has to remember is a step nobody can forget.
 */

/** The single document every case used to share. Still read — see `resolveCaseDoc`. */
export const legacySdaDocId = (userId: string): string => `sda_${userId}`;

/** The on-device transcript key every case used to share. Still read — see `sdaMessagesKey`. */
export const LEGACY_MESSAGES_KEY = 'sda_messages';

/** Which case is open right now. */
export const CASE_ID_KEY = 'sda_case_id';

/**
 * The document THIS case is bound to. Stored rather than recomputed, because for a doctor who was
 * mid-case when this shipped the answer is the LEGACY document — a fact that cannot be derived from
 * the case id alone, and that must survive a reload.
 */
export const CASE_DOC_KEY = 'sda_case_doc';

/** Most-recent-first list of the cases whose transcripts this device is holding. */
export const CASE_INDEX_KEY = 'sda_case_index';

/**
 * How many cases' transcripts a device keeps. A phone is not a server: the Firestore row is the
 * durable copy and is never pruned, so evicting a local transcript costs a fetch, never the case.
 */
export const MAX_LOCAL_CASES = 8;

/**
 * A case id is about to become a Firestore path SEGMENT, so it is validated rather than trusted.
 * `newSdaCaseId()` only ever produces a UUID or `case_<base36>_<base36>`, both of which pass — but the
 * value is read back out of localStorage, and a `/` in a path segment would silently address a
 * different collection instead of failing. Anything unrecognised is refused, and the caller mints a
 * fresh id, which costs one case's server-side context and never writes to the wrong place.
 */
const SAFE_CASE_ID = /^[A-Za-z0-9_-]{8,128}$/;
export const isUsableCaseId = (id: string | null | undefined): boolean =>
  typeof id === 'string' && SAFE_CASE_ID.test(id);

/** This case's own document. One address per case — the whole point of the module. */
export const perCaseSdaDocId = (userId: string, caseId: string): string => `sda_${userId}_${caseId}`;

/** This case's own on-device transcript. */
export const sdaMessagesKey = (caseId: string): string => `${LEGACY_MESSAGES_KEY}_${caseId}`;

export type CaseDocResolution = {
  /** The document to read from and write to for this case. */
  docId: string;
  /** True when this case continues in the pre-migration document. */
  boundToLegacy: boolean;
  /** True when the caller must persist `docId` under CASE_DOC_KEY (it was just decided). */
  shouldPersist: boolean;
};

/**
 * Which document does this case live in?
 *
 * 🔒 THE MIGRATION IS A BINDING, NOT A COPY, and that is the decision worth defending. The obvious
 * migration — read the legacy row, write it forward under a per-case id — would leave the doctor with
 * TWO History rows showing one conversation, and the only way to avoid that is to delete the original.
 * Deleting a patient's case notes to tidy up a key format is not a trade worth taking.
 *
 * So the legacy document simply BECOMES the current case's document. Nothing is copied, nothing is
 * duplicated, nothing is deleted, and the row the doctor already knows keeps its place and its history.
 * Only the NEXT case gets a new address. Every later case is per-case from birth.
 *
 * A stored binding always wins, so the answer cannot drift between reloads — including for the one
 * case whose address is not derivable from its id.
 */
export function resolveCaseDoc(input: {
  userId: string;
  caseId: string;
  /** What CASE_DOC_KEY holds, if anything. */
  storedDocId?: string | null;
  /** Whether a pre-migration `sda_<userId>` document was found to hold a real conversation. */
  legacyExists: boolean;
}): CaseDocResolution {
  const { userId, caseId, storedDocId, legacyExists } = input;
  const legacy = legacySdaDocId(userId);
  const perCase = perCaseSdaDocId(userId, caseId);

  // An already-decided binding is authoritative. Re-deciding on every mount would move a case out of
  // the legacy row the moment that row stopped being the newest thing in the account.
  if (storedDocId === legacy) return { docId: legacy, boundToLegacy: true, shouldPersist: false };
  if (storedDocId === perCase) return { docId: perCase, boundToLegacy: false, shouldPersist: false };

  // A stored value that matches NEITHER belongs to a different user or a different case — it is stale,
  // never a third option, so it is discarded rather than honoured.
  if (legacyExists) return { docId: legacy, boundToLegacy: true, shouldPersist: true };
  return { docId: perCase, boundToLegacy: false, shouldPersist: true };
}

/**
 * Which on-device key holds this case's transcript, and which one to fall back to.
 *
 * The fallback is the pre-migration key, and it applies ONLY to a case bound to the legacy document —
 * i.e. the one case that was open when this shipped. Letting a brand-new case fall back to it would
 * open the new patient on the previous patient's transcript, which is the clinical-safety failure
 * `newSdaCaseId` was written to prevent, reintroduced through the back door.
 */
export function messageKeysFor(caseId: string, boundToLegacy: boolean): string[] {
  return boundToLegacy ? [sdaMessagesKey(caseId), LEGACY_MESSAGES_KEY] : [sdaMessagesKey(caseId)];
}

export type CaseIndexUpdate = {
  /** Most-recent-first, capped at MAX_LOCAL_CASES. */
  index: string[];
  /** Transcript keys the caller should delete — cases that fell off the end. */
  evictedKeys: string[];
};

/**
 * Record that `caseId` is the case in use, and say which transcripts may now be dropped.
 *
 * Pure, so the eviction rule is testable without touching storage. The current case can never be
 * evicted: it is moved to the front before the cap is applied, so a cap of 1 keeps exactly the case
 * being written to.
 */
export function noteCaseUsed(existing: readonly string[], caseId: string, max = MAX_LOCAL_CASES): CaseIndexUpdate {
  const cap = Math.max(1, Math.floor(max));
  const deduped = [caseId, ...existing.filter((id) => id !== caseId && isUsableCaseId(id))];
  const index = deduped.slice(0, cap);
  const evictedKeys = deduped.slice(cap).map(sdaMessagesKey);
  return { index, evictedKeys };
}

/** Read the index defensively — a corrupt value is an empty index, never a throw. */
export function parseCaseIndex(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUsableCaseId) : [];
  } catch {
    return [];
  }
}

/**
 * The case a History row points at, or null when the id is not an SDA document.
 *
 * ⚠️ The legacy document has NO case id in it, and that is reported honestly as `null` rather than as
 * a guess: opening it means "continue whatever case is bound to that row", which is exactly what the
 * binding above already resolves.
 */
export function caseIdFromDocId(docId: string | null | undefined, userId: string): string | null {
  if (!docId || !userId) return null;
  const prefix = `sda_${userId}_`;
  if (!docId.startsWith(prefix)) return null;
  const rest = docId.slice(prefix.length);
  return isUsableCaseId(rest) ? rest : null;
}

/** The bit of `localStorage` this module needs — narrowed so the rule below is testable without a DOM. */
export type CaseStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Begin a new case, in ONE place.
 *
 * 🔎 THREE DOORS LED TO THE SAME LOSS, and only one of them was the button named for it: the "New
 * case" button in SDAChat, closing the Doctor AI tab with ✕ in App.tsx, and (had it shipped) picking
 * Doctor AI in the Mode list. The first two each carried their own `removeItem('sda_messages')`, which
 * is how one bug came to have two copies — so this is the centralisation, not a third copy.
 *
 * It DELETES NOTHING. Starting a new case means pointing the device at a new address; the case before
 * it keeps its transcript, keeps its Firestore row, and keeps its place in History.
 */
export function startFreshCase(storage: CaseStorage | null, freshCaseId: string, userId?: string | null): void {
  if (!storage || !isUsableCaseId(freshCaseId)) return;
  try {
    storage.setItem(CASE_ID_KEY, freshCaseId);
    if (userId) storage.setItem(CASE_DOC_KEY, perCaseSdaDocId(userId, freshCaseId));
    else storage.removeItem(CASE_DOC_KEY);
    const { index, evictedKeys } = noteCaseUsed(parseCaseIndex(storage.getItem(CASE_INDEX_KEY)), freshCaseId);
    storage.setItem(CASE_INDEX_KEY, JSON.stringify(index));
    for (const key of evictedKeys) storage.removeItem(key);
  } catch {
    /* private mode or quota — the caller's screen is still correct for this session */
  }
}
