// P-DATA.4 — Data Retention + Deletion (DPDP / GDPR right-to-be-forgotten).
//
// Two capabilities, both operating on the platform's OWN user data (not generated apps):
//   1. deleteUserData(uid) — the right-to-be-forgotten cascade: delete every user-scoped record for a
//      single user across all collections in the VERIFIED registry below. Exact-match only (doc-id == uid
//      or a verified `userId` field == uid) — it NEVER runs a broad/prefix query that could over-delete.
//   2. purgeExpired(now) — TTL retention: delete records in RETENTION_POLICIES older than their cutoff.
//
// The Firestore surface is injected (RetentionFirestore) so this is unit-testable without Firebase and
// works directly with the firebase-admin `Firestore` instance in production. Pure helpers (cutoff,
// isExpired) are separated so the policy math is testable without any I/O.
//
// SAFETY: every collection's key strategy in USER_SCOPED_COLLECTIONS was verified against its real
// read/write path before being added — a wrong strategy would either miss data (compliance fail) or
// delete the wrong user's data (catastrophic), so nothing is added on a guess.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

// ── Injected Firestore surface (satisfied by admin.firestore.Firestore and by the test mock) ──────
export interface RetentionDocRef {
  get(): Promise<{ exists: boolean }>;
  delete(): Promise<unknown>;
  /** A subcollection under this document (USER_SCOPED_SUBCOLLECTIONS). Optional so older fakes still fit. */
  collection?(name: string): { limit(n: number): { get(): Promise<{ docs: Array<{ ref: { delete(): Promise<unknown> } }> }> } };
}
/** A document a query returned. `collection` is optional so an older fake without it still fits. */
export interface RetentionQueryDoc {
  ref: {
    delete(): Promise<unknown>;
    /** A subcollection under this matched document (`UserScopedCollection.subs`). */
    collection?(name: string): { limit(n: number): { get(): Promise<{ docs: Array<{ ref: { delete(): Promise<unknown> } }> }> } };
  };
}
export interface RetentionQuery {
  get(): Promise<{ docs: RetentionQueryDoc[] }>;
  /**
   * Bound one purge run. Optional so an existing caller or mock without it still works, but the purge
   * always ASKS — see `maxPerRun`: the first run against a collection with months of backlog would
   * otherwise be an unbounded read-and-delete of everything at once.
   */
  limit?(n: number): RetentionQuery;
}
export interface RetentionCollection {
  doc(id: string): RetentionDocRef;
  where(field: string, op: '==' | '<', value: unknown): RetentionQuery;
}
export interface RetentionFirestore {
  collection(name: string): RetentionCollection;
}

// ── The verified registry of user-scoped collections ─────────────────────────────────────────────
/** How a collection is keyed to a user: the doc-id IS the uid, or a field equals the uid. */
export type KeyStrategy = 'docId' | { field: string };
export interface UserScopedCollection {
  collection: string;
  key: KeyStrategy;
  /**
   * Subcollections under EACH MATCHED document, page-deleted before the document itself.
   *
   * 🔴 WHY THIS EXISTS (Q-701, 2026-10-08). Firestore does not cascade, and that has already produced
   * one real defect: Q-134 found an account erase deleting each workspace's latest diagnostics report
   * and leaving its whole `history` subcollection behind, unreachable and kept. `USER_SCOPED_SUBCOLLECTIONS`
   * below only covers the `parent/{uid}/sub` shape — a document whose own id IS the uid. It cannot
   * express `agentv3_conversations/{conversationId}/turns`, where the document is found by a `userId`
   * FIELD and the messages live one level under it. Registering such a collection without this would
   * delete the conversation's header and orphan every message in it: the fix would LOOK done while the
   * personal data stayed, which is the exact shape of failure this registry exists to prevent.
   */
  subs?: readonly string[];
}

/**
 * Every collection here was verified against its read/write path:
 *  - users / user_profiles / user_sessions / user_token_wallets → doc id IS the uid
 *  - user_costs / user_build_history / chat_sessions            → a `userId` field equals the uid
 *  - user_vault_pin       → `doc(db, VAULT_PIN_COLLECTION, userId)`  (appLockStore.ts:29,45)
 *  - agentv3_mcp_library  → `.doc(userId)` on read and both writes (McpLibraryStore.ts:95,132,148)
 *
 * 🔴 THE LAST TWO WERE MISSING, AND THE POLICY ALREADY PROMISED THEM. Section 9 says personal data is
 * "deleted or irreversibly anonymised within 30 days" of account deletion, with four exceptions
 * (payment/tax records, the 180-day safety and removal records, a live legal matter) — and neither an
 * App Lock PIN record nor a user's saved MCP library is any of them. Both are keyed by the uid, both
 * appeared in NO erase path anywhere in the repo, so both survived account deletion for ever.
 *
 * ⚠️ SAME ROOT CAUSE AS THE `site_analytics` RETENTION GAP FIXED IN THE SAME CHANGE: this is a
 * hand-maintained registry, a new per-user store has to be added to it by a human, and nothing
 * detected the omission. `tests/everyCollectionIsClassified.test.ts` is that detector now — a new
 * `*_COLLECTION` constant fails CI until somebody classifies it.
 */
export const USER_SCOPED_COLLECTIONS: readonly UserScopedCollection[] = [
  { collection: 'users', key: 'docId' },
  { collection: 'user_profiles', key: 'docId' },
  { collection: 'user_sessions', key: 'docId' },
  { collection: 'user_token_wallets', key: 'docId' },
  { collection: 'user_costs', key: { field: 'userId' } },
  { collection: 'user_build_history', key: { field: 'userId' } },
  { collection: 'chat_sessions', key: { field: 'userId' } },
  { collection: 'user_vault_pin', key: 'docId' },
  { collection: 'agentv3_mcp_library', key: 'docId' },
  /** The user's rating of NavBharatAI (`platformRatingStore.ts`) — doc id IS the uid. */
  { collection: 'platform_ratings', key: 'docId' },
  /**
   * The per-buyer daily gift-code tally (`giftCodeStore.ts`). Its doc id is `<uid>_<day>`, so it is
   * reached by the `uid` FIELD rather than the id — the same shape `user_costs` uses.
   *
   * ⚠️ `gift_codes` itself is deliberately NOT here, and the reason matters: a code the buyer has
   * already given away is value in somebody else's hands. Deleting the buyer's account must not
   * cancel a gift the recipient has not redeemed yet, and a payment record is the first of §9's
   * four stated exceptions to erasure anyway.
   */
  { collection: 'gift_code_daily', key: { field: 'uid' } },
  /**
   * App Mart social (appMartSocialStore.ts, 2026-09-30). A person's own likes, comments, block list and
   * App Mart notifications, and the record of which public creator code is theirs. Reactions and
   * comments carry a `uid` field; the block list's doc id IS the uid; a notification is filed under
   * its `recipientUid`; the creator-code record holds `uid`.
   *
   * 🔒 Like/dislike and comment COUNTS stay true after an erase because they are counted from these
   * very records (`countsFor`), never kept as a separate tally. The one visible trace: a reply written
   * by someone else under a deleted person's comment loses its thread, and is no longer reachable.
   *
   * ⚠️ `app_mart_comment_reports` is deliberately NOT here — a report about a comment is a safety record
   * with its own 180-day policy below, for the same reason `safety_flags` is kept out.
   */
  { collection: 'app_mart_reactions', key: { field: 'uid' } },
  { collection: 'app_mart_comments', key: { field: 'uid' } },
  { collection: 'app_mart_blocks', key: 'docId' },
  { collection: 'app_mart_notifications', key: { field: 'recipientUid' } },
  { collection: 'app_mart_creator_ids', key: { field: 'uid' } },
  /**
   * App Mart follows (2026-10-01): one doc per (follower, creator). Erased from BOTH ends — the people a
   * deleted account followed, and the follows of everybody who followed it — so a deleted account
   * neither counts toward anyone's follower number nor appears in anyone's Following view.
   */
  { collection: 'app_mart_follows', key: { field: 'followerUid' } },
  { collection: 'app_mart_follows', key: { field: 'creatorUid' } },
  /** An uploaded profile photo (profileAvatar.ts, 2026-10-01): one doc under the public creator code, holding `uid`. */
  { collection: 'profile_avatars', key: { field: 'uid' } },
  /**
   * The user's Supabase grant (supabaseConnectionStore.ts) — doc id IS the uid. 🔴 It was in NO erase path
   * until 2026-10-06: a deleted account left behind encrypted tokens that could still act inside the
   * person's own Supabase account. Found while building the sleeping-database watch; the census could not
   * see it because the collection name was a private constant (now exported).
   */
  { collection: 'supabase_connections', key: 'docId' },
  /** What each owner was last told about a sleeping database (supabasePauseWatch.ts) — `userId` field. */
  { collection: 'supabase_pause_notices', key: { field: 'userId' } },

  /**
   * ── 🔴 CREDENTIALS AND SECRETS, which must die with the account (Q-708, 2026-10-08) ──────────────
   *
   * Four stores held something the account could still be USED with after it was deleted. `supabase_connections`
   * above was the first of this shape to be caught (2026-10-06, "encrypted tokens that could still act inside
   * the person's own Supabase account"); these are its siblings, and they were never hunted — found while
   * widening the collection census for Q-701, because every one of them is named by a PRIVATE constant or an
   * inline literal that `tests/everyCollectionIsClassified.test.ts` cannot see.
   *
   * `DELETE /api/profile` removes the Firebase Auth record, so the person can no longer sign in. It did not
   * remove any of these, so the credential outlived the identity it belonged to:
   *
   *  · `user_secrets`  — the user's own saved third-party keys and database passwords, ENCRYPTED but intact.
   *    Rows are only ever SOFT-deleted elsewhere ("the vault has never destroyed a user's stored key",
   *    supabaseProvisionFlow.ts), so a retired row keeps its ciphertext too — a `user_id` query takes both.
   *    Verified: every write sets `user_id` (routes/secrets.ts:128, supabaseProvisionFlow.ts:105) and every
   *    read queries `where('user_id', '==', userId)` (secrets.ts:227, routes/secrets.ts:62/101/217/323).
   *  · `api_keys`      — a live NavBharatAI API key. `findByHash` (ApiKeyStore.ts:112) resolves ANY
   *    non-revoked key to its owner and never asks whether that owner still exists, so a key issued before
   *    deletion kept authenticating — and the free daily images on that path are drawn at OUR cost.
   *    Deleting the row IS the fix: `findByHash` then finds nothing.
   *    Verified: `userId` field, queried at ApiKeyStore.ts:77.
   *  · `bots`          — a chat bot's `token` AND `appSecret`, which are credentials for a third-party
   *    messaging platform. Verified: `ownerUid` field, queried at BotStore.ts:178.
   *  · `webhooks`      — the outbound URLs NavBharatAI posts the person's build events to. Verified: the
   *    doc id IS the uid (WebhookManager.ts:63 read, :90 and :106 writes).
   *
   * ⚠️ `bot_sessions` is NOT here, and the reason is still true: its doc id is `${botId}_${chatId}`
   * (BotStore.ts:283), which is reachable from the bot, not from the uid, so no key strategy in THIS
   * registry can express it. What has changed (Q-761, 2026-10-09) is that it is no longer merely
   * recorded: `derivedIdErase.ts` resolves the bot ids first and sweeps `bot_sessions/{botId}_` by id
   * range, and it runs BEFORE this cascade precisely because this cascade deletes the `bots` the keys
   * come from.
   */
  { collection: 'user_secrets', key: { field: 'user_id' } },
  { collection: 'api_keys', key: { field: 'userId' } },
  { collection: 'bots', key: { field: 'ownerUid' } },
  { collection: 'webhooks', key: 'docId' },

  /**
   * ── 🔴 THE PERSONAL DATA THE REGISTRY NEVER SAW (Q-701, 2026-10-08) ──────────────────────────────
   * Each of these is keyed to one person and was in NO erase path, for the one reason this whole row
   * exists: the census that is supposed to make an unclassified store fail CI could only see EXPORTED
   * `*_COLLECTION` constants, and every name here is a private constant or an inline literal.
   */
  /** The semantic memory of the person's chats, per scope (`ConversationMemoryStore.ts:70` writes `userId`). */
  { collection: 'conversation_memory_v1', key: { field: 'userId' } },
  /** What a professional assistant remembers about the person (`ClientProfileStore.ts`, ProfileDoc.userId). */
  { collection: 'professional_user_memory', key: { field: 'userId' } },
  /** The person's voice-chat turns (`VoiceMemoryStore.ts`, MemoryDoc.userId). */
  { collection: 'sonic_voice_memory', key: { field: 'userId' } },
  /**
   * Every build conversation (`FirestoreConversationStore.ts:291` lists by `userId`) — AND the messages
   * themselves, which live one level down in `turns` and `timeline` (`:142`, `:146`).
   *
   * 🔴 Without `subs` this entry would have been a FALSE FIX: deleting the conversation header and
   * orphaning every message in it, while the page promises "every build conversation you had with the
   * builder". That is Q-134's defect in a new place, so the cascade now deletes the children first.
   */
  { collection: 'agentv3_conversations', key: { field: 'userId' }, subs: ['turns', 'timeline'] },
  /** The person's own diagnostics report (`DiagnosticsStore.ts:472` — doc id IS the uid). */
  { collection: 'user_diagnostics_v3', key: 'docId' },
  /** Which admin notices they have read (`AdminNotificationStore.ts:159/194` — doc id IS the uid). */
  { collection: 'user_notification_reads', key: 'docId' },
  /** Their builder preferences (`UserPreferenceStore.ts:277/310` — doc id IS the uid). */
  { collection: 'userPrefs', key: 'docId' },
  /** What the engine learned about them (`UserLessonBrain.ts:205` — doc id IS the uid). */
  { collection: 'user_brain_v3', key: 'docId' },
  /** Their recorded mistakes ledger (`MistakeLedger.ts:256/314` — doc id IS the uid). */
  { collection: 'user_mistakes_v3', key: 'docId' },
  /** Terminal seconds used today (`TerminalUsageStore.ts:49/70` — doc id IS the uid). */
  { collection: 'terminal_daily_usage', key: 'docId' },
  /** Tool/image calls used today (`ToolUsageStore.ts` — id is `${uid}__${bucket}`, body carries `userId`). */
  { collection: 'tool_daily_usage', key: { field: 'userId' } },
  /** Their professional pass (`ProfessionalPassStore.ts:70/86` — doc id IS the uid). */
  { collection: 'professional_passes', key: 'docId' },
  /* 🔒 `promptAudits` is DELIBERATELY NOT an entry here, and it looks like it should be.
   *  `promptAudits/{uid}/entries` is already in USER_SCOPED_SUBCOLLECTIONS, and nothing anywhere writes
   *  the PARENT document (`PromptAuditStore.ts:71` writes only the subcollection), so the parent is a
   *  virtual ancestor with no fields. An entry for it would delete nothing and report `deleted: 0` for
   *  ever — a row that reads as coverage while covering nothing. Verified by searching for any write to
   *  the parent path: there is none. */
  /** What they were last warned about their balance (`balanceAlertStore.ts:66/91` — doc id IS the uid). */
  { collection: 'wallet_balance_alerts', key: 'docId' },
  /** Their free-build credit (`OnboardingCreditStore.ts:67/85` — doc id IS the uid). */
  { collection: 'agentv3_onboarding_credits', key: 'docId' },
  /** A .zip they uploaded (`zipUploadStore.ts:78`, SharedUploadRecord.uid). */
  { collection: 'zip_uploads', key: { field: 'uid' } },
  /** A spreadsheet they uploaded (`spreadsheetFileStore.ts:47` writes `uid`). */
  { collection: 'agentv3_sheet_files', key: { field: 'uid' } },
  /** A share link of their app (`ShareStore.ts`, ShareRecord.ownerId). */
  { collection: 'shares', key: { field: 'ownerId' } },
  /** A domain they connected (`firebaseDomainLink.ts:38` writes `userId`, `:63` queries it; the doc id is
   *  the DOMAIN). Note what this does and does not do: it removes NavBharatAI's record of the link —
   *  there is no other delete path in that module, suspension is only a field — and it does NOT unbind
   *  the domain at the registrar or the host, which is not ours to touch. The page says so. */
  { collection: 'custom_domains', key: { field: 'userId' } },
  /** An instantly-hosted PWA of theirs (`routes/pwa.ts:109` writes `userId`). No buyer exists for one
   *  of these, so unlike an App Mart listing it is a plain erase. */
  { collection: 'pwa_apps', key: { field: 'userId' } },
  /** Their chat AI usage rows (`routes/reports.ts:514` queries `userId`). */
  { collection: 'ai_usage_logs', key: { field: 'userId' } },
  /** Their referral record (`routes/referral.ts:94/117` — doc id IS the uid). The `referrerUserId`
   *  written inside OTHER people's rows is not erased: that is somebody else's payout record. */
  { collection: 'user_referrals', key: 'docId' },
  /**
   * The uptime record of a domain they connected (`siteUptimeStore.ts:37/58`). Its doc id is the
   * DOMAIN, so the workspace eraser's `agentv3-{uid}-` range cannot reach it — and it had been
   * classified `workspace` since before Q-701, with a reason that said in its own words "one record
   * per connected domain, not per user". The body carries `userId` (`siteUptime.ts:81`), so the user
   * registry reaches it exactly, which is where a domain-keyed record of one person's domain belongs.
   */
  { collection: 'site_uptime', key: { field: 'userId' } },

  /**
   * ── THE COMPOSITE-ID THREE (Q-762, Q-765 — 2026-10-09) ───────────────────────────────────────────
   *
   * These were `blocked` in the census, not forgotten: each has a document id that NOTHING could
   * search by, so registering them was impossible until the writers stored a field.
   *
   *  · `adrDecisions` / `techDebt` — doc id `${userId}__${projectId}`, and the body carried no uid at
   *    all. Both writers now store `userId` (`adrMemory.ts`, `TechnicalDebtTracker.ts`). A doc-id
   *    prefix range was considered and REFUSED: `workspaceDataErase.ts` documents why — a uid
   *    containing the separator makes `a__b` ambiguous with `a` + `b__…`, and getting that wrong
   *    deletes a different person's data.
   *  · `app_ai_apps` — doc id is the APP id, so the workspace eraser's `agentv3-{uid}-` range can
   *    never reach it; the body has always carried `userId` (`AppAiRegistryStore.ts:91`).
   *
   * ⚠️ WHAT THESE ENTRIES DO NOT REACH, stated rather than implied. A row written BEFORE this change
   * has no `userId`, so this query does not find it. It is not a permanent hole for a live project:
   * both writers rewrite the SAME document on the next build (`adrDecisions` with `merge: false`,
   * `techDebt` with `merge: true`), so an active project's row gains the field the next time it is
   * touched. Only an abandoned project's row stays unreachable, and that residue is recorded in
   * `PROGRESS.md` rather than called fixed.
   *
   * And `app_ai_apps` mints `userId: userId || ''` (`DeploymentStore.ts:626`), so a publish with no
   * signed-in owner stores an empty string. Those rows hold no person either: such an app's
   * workspace is `agentv3-anon-…`, the shared anon bucket `deriveWorkspaceId` falls back to.
   */
  { collection: 'adrDecisions', key: { field: 'userId' } },
  { collection: 'techDebt', key: { field: 'userId' } },
  { collection: 'app_ai_apps', key: { field: 'userId' } },
  /**
   * 🔒 `takedown_records` IS DELIBERATELY ABSENT, and must stay absent.
   *
   * It looks like it belongs here — it carries a uid — and adding it would feel like completing the
   * list. It would also destroy the one record the retention duty exists for: deleting an account
   * must not erase why that account's app was taken down. It has its own 180-day TTL policy below
   * instead, and the exception is disclosed in the Privacy Policy (§6) and on the Grievance page.
   *
   * 🔒 SO IS `safety_flags`, for the sharper version of the same reason: a record of abuse that the
   * abuser can erase by pressing "delete my account" is not a record. It has its own 180-day policy
   * and is disclosed in the same place.
   */
];

/**
 * Records that live in a SUBCOLLECTION under a document whose id IS the uid (Q-134 sibling, 2026-10-05).
 *
 * 🔴 FIRESTORE DOES NOT CASCADE. `users` is erased above by deleting `users/{uid}` — and that left
 * `users/{uid}/deviceTokens` (the phone's push token) and `users/{uid}/notifications` (mention texts)
 * fully intact and unreachable. `promptAudits/{uid}/entries` (the head of every build's system prompt)
 * was in no erase path at all. Each entry was read at its own store:
 *  - users/{uid}/deviceTokens   — DeviceTokenStore.ts:50
 *  - users/{uid}/notifications  — MentionNotificationStore.ts:88
 *  - promptAudits/{uid}/entries — PromptAuditStore.ts (one doc per build)
 */
export const USER_SCOPED_SUBCOLLECTIONS: readonly { parent: string; sub: string }[] = [
  { parent: 'users', sub: 'deviceTokens' },
  { parent: 'users', sub: 'notifications' },
  { parent: 'promptAudits', sub: 'entries' },
];

/** Subdocuments erased per page. */
const ERASE_PAGE = 300;
/** Hard stop so a pathological subcollection can never spin forever inside a request. */
const MAX_ERASE_PAGES = 200;

// ── TTL retention policies ────────────────────────────────────────────────────────────────────────

/**
 * How a collection's timestamp is actually STORED. Required on every policy, deliberately.
 *
 * 🔴 THIS IS THE DEFECT THAT MADE THE FIELD REQUIRED (ROADMAP §12 #3). The purge used to build its
 * bound as `new Date(cutoffMs)` unconditionally, which is correct ONLY for a field stored as a Date.
 * Firestore orders values BY TYPE FIRST — every number sorts before every timestamp — so a policy on a
 * numeric `Date.now()` field would match **nothing, forever**, while reporting itself configured and
 * deleting zero documents with no error. That is the "built but not really working" state the second
 * absolute rule forbids, and it would have been invisible: a purge that deletes nothing looks exactly
 * like a purge with nothing to delete.
 *
 * An OPTIONAL field with a default would reintroduce it — the wrong guess would ship silently. So every
 * policy states the type, and every type below was read off the collection's real write path.
 */
export type TimestampKind =
  /** `new Date()` / a Firestore Timestamp. */
  | 'date'
  /** `Date.now()` — epoch milliseconds as a plain number. */
  | 'epochMs'
  /** `new Date().toISOString()` — sorts lexicographically in time order, so `<` is correct. */
  | 'iso';

export interface RetentionPolicy {
  collection: string;
  ttlDays: number;
  timestampField: string;
  /** How the field is stored. See TimestampKind — a wrong value silently deletes nothing. */
  timestampKind: TimestampKind;
  /** Documents deleted per run. Defaults to DEFAULT_MAX_PER_RUN; the purge is never unbounded. */
  maxPerRun?: number;
}

/**
 * How many documents one policy may delete in a single run.
 *
 * The purge had no bound at all. On the first run against a collection carrying months of backlog that
 * is one query returning everything and then a delete per document — a spike of reads, writes and
 * memory on a schedule. Bounded, a backlog drains over successive runs instead, which is slower and
 * cannot hurt anything.
 */
export const DEFAULT_MAX_PER_RUN = 500;

/**
 * The bound to compare against, in the type the field is actually stored in. PURE.
 */
export function retentionBound(cutoffMs: number, kind: TimestampKind): Date | number | string {
  if (kind === 'epochMs') return cutoffMs;
  if (kind === 'iso') return new Date(cutoffMs).toISOString();
  return new Date(cutoffMs);
}

/**
 * ⚠️ ONLY OPERATIONAL DATA IS ON A CLOCK. Every policy here was verified against its write path for
 * BOTH the field name and the stored type, and every one of these collections is data NavBharatAI
 * generated about itself — logs, metrics, transient session scratch — never a user's own property.
 * See RETAINED_INDEFINITELY below for the collections that must never be on a timer, and why.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  /**
   * Removal records — the OTHER half of the 180-day duty (IT Rules, 2021 Rule 3(1)(g)).
   *
   * The duty is two-sided and only one side gets remembered: the record must SURVIVE 180 days, and
   * it must not be kept for ever. `takedownLedger.ts` keeps it out of USER_SCOPED_COLLECTIONS so an
   * account deletion cannot erase it early; this policy is what stops it becoming a permanent file
   * on somebody long after the law stopped asking for it.
   *
   * `removedAt: Date.now()` — a plain number, so `epochMs`. A wrong kind here would silently delete
   * nothing for ever, which is exactly the defect that made this field required.
   */
  { collection: 'takedown_records', ttlDays: 180, timestampField: 'removedAt', timestampKind: 'epochMs' },
  /**
   * One record per server deploy attempt (hostedDeployments.ts, 2026-10-06): its states and a failure
   * category, no secret and no provider text. Useful while a deploy is recent; history older than 180 days
   * answers no question anyone asks. `createdAt: Date.now()` — epochMs.
   */
  { collection: 'hosted_deploy_attempts', ttlDays: 180, timestampField: 'createdAt', timestampKind: 'epochMs' },
  /**
   * A free build's unattended chain (freeChainStore.ts, Q-130). The engine ignores a record untouched for
   * six hours, so a day-old one is dead weight — one per workspace that ever paused, never read again.
   * `touchedAt: Date.now()` ⇒ `epochMs`.
   */
  { collection: 'agentv3_free_chains', ttlDays: 1, timestampField: 'touchedAt', timestampKind: 'epochMs' },
  /**
   * The admin audit log (adminAuditLog.ts, admin panel audit PR 3): every admin action, with the admin's
   * name, reason and the ids it touched. 180 days, the same span as the removal records it sits beside —
   * long enough to answer "who banned this and why" about anything a user can still raise, and not a
   * permanent file on the people those ids name. `ts: Date.parse(…)` is a plain number ⇒ `epochMs`.
   */
  { collection: 'admin_audit_log', ttlDays: 180, timestampField: 'ts', timestampKind: 'epochMs' },
  /**
   * Flagged messages — the same 180-day story as the removal records above, and for the same reason:
   * an abuse record must outlive the account (see the exclusion note in USER_SCOPED_COLLECTIONS) and
   * must not become a permanent file. `at: Date.now()` ⇒ `epochMs`.
   */
  { collection: 'safety_flags', ttlDays: 180, timestampField: 'at', timestampKind: 'epochMs' },
  // `updatedAt: new Date()` — BuildJobManager. The original policy; its type is now stated rather
  // than assumed by the purge.
  { collection: 'build_jobs', ttlDays: 90, timestampField: 'updatedAt', timestampKind: 'date' },
  // `ts: Date.now()` — logStore. Server logs, the fastest-growing operational collection.
  { collection: 'server_logs', ttlDays: 30, timestampField: 'ts', timestampKind: 'epochMs' },
  // `updatedAt: Date.now()` — metricsStore. ONE document per calendar day, so a long window is cheap
  // and keeps year-over-year comparison possible.
  { collection: 'metrics_snapshots', ttlDays: 400, timestampField: 'updatedAt', timestampKind: 'epochMs' },
  // `savedAt: Date.now()` — ProBuildSession. A finished build's transient session result.
  { collection: 'build_sessions', ttlDays: 90, timestampField: 'savedAt', timestampKind: 'epochMs' },
  // `updatedAt: new Date().toISOString()` — ErrorPatternStore. Per-session hints, regenerated freely.
  { collection: 'session_error_hints', ttlDays: 30, timestampField: 'updatedAt', timestampKind: 'iso' },
  // The "why do builds fail?" ledger — ONE document per calendar day, so a long window is cheap and
  // year-over-year comparison stays possible. `date` is the doc id AND a field ('YYYY-MM-DD'), which
  // sorts lexicographically, so it is its own timestamp.
  { collection: 'build_failures', ttlDays: 400, timestampField: 'date', timestampKind: 'iso' },
  // `updatedAt: Date.now()` — AppAiUsageStore. The published-app AI gateway's daily spend counters.
  // They exist to enforce THAT DAY's cap and are never read again afterwards, so 90 days is already
  // generous; the per-visitor collection is the one that actually grows with an app's audience.
  { collection: 'app_ai_usage', ttlDays: 90, timestampField: 'updatedAt', timestampKind: 'epochMs' },
  { collection: 'app_ai_visitors', ttlDays: 30, timestampField: 'updatedAt', timestampKind: 'epochMs' },
  // `updatedAt: Date.now()` — imageFreePaidBudget. ONE document per UTC day: the platform-wide count of
  // images the FREE tier got from a PAID engine. It enforces that day's cap and is read afterwards
  // only to judge whether the cap is right, which 90 days of history answers.
  { collection: 'image_free_paid_daily', ttlDays: 90, timestampField: 'updatedAt', timestampKind: 'epochMs' },
  /**
   * Why a user's phone build failed — ONE document per UTC day (`day` is the doc id AND a field, and an
   * ISO date sorts lexicographically, so it is its own timestamp, exactly like `build_failures` above).
   * A long window is cheap at one document a day and is what lets "is the repair loop getting better?"
   * be answered by comparison rather than by impression.
   */
  { collection: 'mobile_build_outcomes', ttlDays: 400, timestampField: 'day', timestampKind: 'iso' },
  /**
   * The per-run marker behind that counter — the ONE collection in this pair that really grows, at one
   * small document per finished build.
   *
   * It exists solely so a POLLED status endpoint cannot count the same run twice, so it is needed only
   * while a client could still be asking about that run — minutes, not weeks. 30 days is far past any
   * real poll and is the window rather than the shorter honest one because the cost of being wrong is
   * asymmetric: purge too early and a run still being watched is counted a second time, which would
   * inflate the exact rate this whole feature was built to measure. `countedAt: Date.now()` ⇒ `epochMs`.
   */
  { collection: 'mobile_build_counted', ttlDays: 30, timestampField: 'countedAt', timestampKind: 'epochMs' },

  /**
   * The referral claim tally (`referralClaimOutcomes.ts`): one document per UTC day of COUNTS — no
   * person in it. Kept as long as the build tally beside it, for the same reason: a trend is read over
   * months.
   */
  { collection: 'referral_claim_outcomes', ttlDays: 400, timestampField: 'day', timestampKind: 'iso' },
  /**
   * One marker per (person, UTC day) that made a claim, so the tally counts PEOPLE and not app opens.
   * A marker is only ever consulted on its own day; seven days is margin, not need. The id is a digest
   * and the body a timestamp.
   */
  { collection: 'referral_claim_people', ttlDays: 7, timestampField: 'countedAt', timestampKind: 'epochMs' },

  /**
   * The mobile-OTP tally (`otpOutcomes.ts`): one document per UTC day of counts plus the latest
   * scrubbed failure reason per category — no phone number, uid or address in it. 90 days: it exists
   * to diagnose a broken sign-in path, which is read in days, not months.
   */
  { collection: 'auth_otp_outcomes', ttlDays: 90, timestampField: 'day', timestampKind: 'iso' },

  /**
   * Visitor counts for published apps — the ONE window this registry promised in PUBLIC and did not keep.
   *
   * 🔴 The Privacy Policy says, in those words: *"These counts … are kept for 30 days."* Nothing deleted
   * them. `site_analytics` was in neither this list nor `RETAINED_INDEFINITELY`, and no purge, TTL or
   * sweep anywhere in the repo touched it — so the counts accumulated for ever while the published
   * policy stated a 30-day limit as fact. That is the 2026-09-02 shape (the policy said we never share
   * data with advertisers while the pixel was being built), and it produced no failure of any kind.
   *
   * ⚠️ WHY IT WAS MISSED rather than decided: `GROWING_COLLECTIONS` in `routes/admin.ts` — the inventory
   * the Load board's storage warning is computed from — carries the comment "verified by reading each
   * store on 2026-09-07", and the beacon shipped on 2026-09-10. A hand-maintained inventory cannot warn
   * about the collection nobody added to it, so the omission was invisible from both directions.
   *
   * 🔒 SAFE BY CONSTRUCTION, checked rather than assumed: every document here is one app-day-shard
   * (`hitDocId`) carrying `updatedAt: Date.now()`, the owner's dashboard reads a DAY WINDOW by id and
   * the widest window any caller asks for is exactly `days = 30`, and the all-time total is a SEPARATE
   * running counter (`ownAudience.lifetimeViews`, its own collection) — so deleting a day-document past
   * 30 days cannot change a number anybody is shown.
   */
  { collection: 'site_analytics', ttlDays: 30, timestampField: 'updatedAt', timestampKind: 'epochMs' },

  /**
   * App Mart creator notifications (appMartSocialStore.ts). One GROUPED document per (person, kind, app,
   * day), so this grows with activity. 90 days: a notification is read within days, and the inbox shows
   * the newest 30 anyway. `updatedAt: Date.now()` ⇒ `epochMs`.
   */
  { collection: 'app_mart_notifications', ttlDays: 90, timestampField: 'updatedAt', timestampKind: 'epochMs' },
  /**
   * What readers reported about App Mart comments — the same 180-day story as `safety_flags`: it must
   * outlive the reporter's and the author's accounts, and must not become a permanent file.
   * `at: Date.now()` ⇒ `epochMs`.
   */
  { collection: 'app_mart_comment_reports', ttlDays: 180, timestampField: 'at', timestampKind: 'epochMs' },
];

/**
 * 🔒 COLLECTIONS THAT MUST NEVER BE PURGED ON A CLOCK, with the reason recorded next to each.
 *
 * This exists because "every growing collection needs retention" is wrong, and acting on it would
 * delete users' work. A collection grows for two very different reasons: because the platform keeps
 * writing about itself (bounded by a clock, above), or because USERS keep creating things — and the
 * second is not garbage to be swept, it is the product. The right mechanism for these is deletion on
 * ACCOUNT deletion (`deleteUserData`, which already covers the user-scoped ones) or a per-user cap —
 * never age.
 *
 * It is also what stops the Load board warning forever about collections that are correct as they are:
 * a warning nobody can ever clear is a warning nobody reads.
 */
export const RETAINED_INDEFINITELY: readonly { collection: string; reason: string }[] = [
  { collection: 'workspace_files_v3', reason: "the user's actual app source code" },
  { collection: 'workspace_assets_v3', reason: "the user's uploaded images and files" },
  { collection: 'workspace_checkpoints_v3', reason: 'the restore points a user rolls back to' },
  { collection: 'workspace_memory_v3', reason: "what the engine has learned about the user's app" },
  { collection: 'workspace_manual_edits_v3', reason: "the user's own hand edits, which must not be overwritten" },
  { collection: 'workspace_embeddings_v3', reason: "a derived index of the user's code — deleting it degrades their builds" },
  // ⚠️ CORRECTED 2026-10-05 (Q-134): this said the collection "does not grow with time". The latest-report
  // doc is replaced in place, but every settled build also writes `{workspace}/history/{startedAt}`, and
  // that subcollection grew for ever. It is on SUBCOLLECTION_RETENTION_POLICIES (180 days) now.
  { collection: 'workspace_diagnostics_v3', reason: "the latest report per workspace, replaced in place. Its `history` subcollection is on a 180-day clock (SUBCOLLECTION_RETENTION_POLICIES)" },
  { collection: 'project_plans_v3', reason: "the plan the user's app is being built against" },
  { collection: 'app_engineering_memory_v1', reason: "the app's requirement ledger, open issues and change log — bounded per app, erased with the workspace" },
  { collection: 'app_builds', reason: "the user's own build record" },
  { collection: 'user_build_history', reason: "the user's own history; removed with their account, not with age" },
  { collection: 'user_costs', reason: 'money. A billing record deleted on a timer cannot be reconciled or disputed' },
  /**
   * Money. Privacy §9's FIRST stated exception to erasure, and Indian tax and accounting law requires
   * keeping records of money received. It was in NO registry at all until Q-701, which did not make
   * it less safe — nothing deletes it — but it did make the census silent about the one collection
   * whose retention is a legal duty rather than a choice. Saying so out loud is the point.
   */
  { collection: 'payment_transactions', reason: 'a record of money received; tax and accounting law requires it, and Privacy §9 names it as an exception to erasure' },
  { collection: 'hosting_usage', reason: 'per-user metering that the bill is derived from' },
];

// ── Subcollection retention (Q-134, admin-approved 2026-10-05) ───────────────────────────────────────

/**
 * A TTL on a subcollection that lives under every document of a parent collection.
 *
 * Purged PARENT BY PARENT, never with a collection-group query. A group query on a generic name like
 * `history` would also sweep any future store's subcollection of that name, and it needs a
 * collection-group index this project does not deploy. A query on ONE parent's subcollection uses the
 * single-field index Firestore keeps automatically.
 */
export interface SubcollectionRetentionPolicy {
  parent: string;
  subcollection: string;
  ttlDays: number;
  timestampField: string;
  timestampKind: TimestampKind;
  /** Documents deleted per run across all parents. Defaults to DEFAULT_MAX_PER_RUN. */
  maxPerRun?: number;
}

export const SUBCOLLECTION_RETENTION_POLICIES: readonly SubcollectionRetentionPolicy[] = [
  /**
   * Past build reports (`DiagnosticsStore.saveDiagnosticsHistory`): one document per settled build, per
   * workspace, and nothing deleted them except erasing the workspace (Q-134). They are the evidence every
   * autopsy is built from, so the window is long: 180 days, the span of the removal and safety records.
   * The LATEST report of each workspace is the parent document itself and is not on this clock.
   * `savedAt: Date.now()` ⇒ `epochMs`.
   */
  { parent: 'workspace_diagnostics_v3', subcollection: 'history', ttlDays: 180, timestampField: 'savedAt', timestampKind: 'epochMs' },
  /**
   * The prompt audit trail (`PromptAuditStore.ts`): one document per build, per user, appended for ever
   * — the same growth as the build-report history and found in the same hunt. Read only as the newest
   * 200, so 180 days (the build reports' window, which it explains) loses nothing anyone reads.
   * `ts: Date.now()` ⇒ `epochMs`.
   */
  { parent: 'promptAudits', subcollection: 'entries', ttlDays: 180, timestampField: 'ts', timestampKind: 'epochMs' },
];

/** The two operations a subcollection purge needs. Satisfied by `adminSubcollectionSource` and by test fakes. */
export interface SubcollectionSource {
  /** Up to `pageSize` parent document ids after `afterId` (exclusive), in id order. */
  parentIds(parent: string, afterId: string | null, pageSize: number): Promise<string[]>;
  /** Delete up to `max` documents of `parent/{id}/{sub}` whose `field` is below `bound`. Returns how many. */
  deleteExpiredUnder(parent: string, id: string, sub: string, field: string, bound: Date | number | string, max: number): Promise<number>;
}

/** How many parent documents one run may look under. A backlog beyond it drains over later runs. */
export const MAX_PARENTS_PER_RUN = 20000;
const PARENT_PAGE = 300;

/**
 * Delete subcollection records older than each policy's TTL, parent by parent, bounded per run. Uses a
 * `< cutoff` bound, so it can only remove OLD records. Best-effort per policy; never throws.
 */
export async function purgeExpiredSubcollections(
  src: SubcollectionSource,
  nowMs: number,
  policies: readonly SubcollectionRetentionPolicy[] = SUBCOLLECTION_RETENTION_POLICIES,
): Promise<PurgeReport> {
  const collections: PurgeResult[] = [];
  for (const policy of policies) {
    const cutoffMs = retentionCutoffMs(nowMs, policy.ttlDays);
    const bound = retentionBound(cutoffMs, policy.timestampKind);
    const cap = Math.max(1, Math.floor(policy.maxPerRun ?? DEFAULT_MAX_PER_RUN));
    const name = `${policy.parent}/*/${policy.subcollection}`;
    let deleted = 0;
    try {
      let after: string | null = null;
      let scanned = 0;
      while (deleted < cap && scanned < MAX_PARENTS_PER_RUN) {
        const ids = await src.parentIds(policy.parent, after, PARENT_PAGE);
        if (ids.length === 0) break;
        for (const id of ids) {
          if (deleted >= cap) break;
          deleted += await src.deleteExpiredUnder(policy.parent, id, policy.subcollection, policy.timestampField, bound, cap - deleted);
        }
        scanned += ids.length;
        after = ids[ids.length - 1];
        if (ids.length < PARENT_PAGE) break;
      }
      collections.push({ collection: name, deleted, cutoffMs });
    } catch (e) {
      collections.push({ collection: name, deleted, cutoffMs, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { collections, totalDeleted: collections.reduce((s, r) => s + r.deleted, 0) };
}

/** The production SubcollectionSource over the admin SDK. Reads parent REFERENCES only (`select()`). */
export function adminSubcollectionSource(db: admin.firestore.Firestore): SubcollectionSource {
  return {
    async parentIds(parent, afterId, pageSize) {
      let q = db.collection(parent).orderBy(admin.firestore.FieldPath.documentId()).select().limit(pageSize);
      if (afterId) q = q.startAfter(afterId);
      const snap = await q.get();
      return snap.docs.map((d) => d.id);
    },
    async deleteExpiredUnder(parent, id, sub, field, bound, max) {
      const snap = await db.collection(parent).doc(id).collection(sub).where(field, '<', bound).limit(max).get();
      if (snap.empty) return 0;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return snap.size;
    },
  };
}

/** Is this collection deliberately kept forever, rather than merely missing a policy? PURE. */
export function isRetainedIndefinitely(collection: string): boolean {
  return RETAINED_INDEFINITELY.some((r) => r.collection === collection);
}

/**
 * Collections that GROW and have neither a policy nor a documented reason to keep forever — i.e. the
 * ones a human still has to decide about. This is the number the Load board should show. PURE.
 */
export function collectionsNeedingRetention(
  growing: readonly string[],
  policies: readonly RetentionPolicy[] = RETENTION_POLICIES,
): string[] {
  return (growing || []).filter(
    (c) => !policies.some((p) => p.collection === c) && !isRetainedIndefinitely(c),
  );
}

// ── Pure policy math (no I/O) ──────────────────────────────────────────────────────────────────────
export function retentionCutoffMs(nowMs: number, ttlDays: number): number {
  return nowMs - ttlDays * 24 * 60 * 60 * 1000;
}
export function isExpired(docTimestampMs: number, cutoffMs: number): boolean {
  return Number.isFinite(docTimestampMs) && docTimestampMs < cutoffMs;
}

// ── Right-to-be-forgotten cascade ──────────────────────────────────────────────────────────────────
export interface CollectionResult { collection: string; deleted: number; error?: string; }
export interface DeletionReport { uid: string; collections: CollectionResult[]; totalDeleted: number; }

/**
 * Delete EVERY user-scoped record for `uid` across the verified registry. Exact-match only. Best-effort
 * per collection: a failure on one collection is recorded and the cascade continues (so a single flaky
 * collection can't leave the rest of the user's data behind). Throws only on an empty uid — deleting
 * with an empty key would be catastrophic, so it is refused outright.
 */
export async function deleteUserData(db: RetentionFirestore, uid: string): Promise<DeletionReport> {
  if (!uid || typeof uid !== 'string') {
    throw new Error('deleteUserData: a non-empty uid is required (refusing to delete with an empty key).');
  }
  const collections: CollectionResult[] = [];
  for (const entry of USER_SCOPED_COLLECTIONS) {
    let deleted = 0;
    try {
      if (entry.key === 'docId') {
        const ref = db.collection(entry.collection).doc(uid);
        const snap = await ref.get();
        if (snap.exists) { await ref.delete(); deleted = 1; }
      } else {
        const q = await db.collection(entry.collection).where(entry.key.field, '==', uid).get();
        for (const d of q.docs) {
          // SUBCOLLECTIONS FIRST, then the document — Firestore does not cascade, so deleting the
          // parent first would leave the children unreachable (Q-134's exact defect). A handle that
          // cannot reach subcollections is a REAL failure for an entry that declares them, not a
          // thing to shrug at: it would report a deletion that did not happen.
          for (const sub of entry.subs ?? []) {
            if (typeof d.ref.collection !== 'function') {
              throw new Error(`${entry.collection}: this database handle cannot reach the '${sub}' subcollection`);
            }
            for (let page = 0; page < MAX_ERASE_PAGES; page++) {
              const snap = await d.ref.collection(sub).limit(ERASE_PAGE).get();
              if (snap.docs.length === 0) break;
              for (const sd of snap.docs) { await sd.ref.delete(); deleted++; }
              if (snap.docs.length < ERASE_PAGE) break;
            }
          }
          await d.ref.delete();
          deleted++;
        }
      }
      collections.push({ collection: entry.collection, deleted });
    } catch (e) {
      collections.push({ collection: entry.collection, deleted, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const entry of USER_SCOPED_SUBCOLLECTIONS) {
    const name = `${entry.parent}/{uid}/${entry.sub}`;
    let deleted = 0;
    try {
      const parent = db.collection(entry.parent).doc(uid);
      if (typeof parent.collection !== 'function') throw new Error('this database handle cannot reach subcollections');
      for (let page = 0; page < MAX_ERASE_PAGES; page++) {
        const snap = await parent.collection(entry.sub).limit(ERASE_PAGE).get();
        if (snap.docs.length === 0) break;
        for (const d of snap.docs) { await d.ref.delete(); deleted++; }
        if (snap.docs.length < ERASE_PAGE) break;
      }
      collections.push({ collection: name, deleted });
    } catch (e) {
      collections.push({ collection: name, deleted, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { uid, collections, totalDeleted: collections.reduce((s, r) => s + r.deleted, 0) };
}

// ── TTL purge ───────────────────────────────────────────────────────────────────────────────────────
export interface PurgeResult { collection: string; deleted: number; cutoffMs: number; error?: string; }
export interface PurgeReport { collections: PurgeResult[]; totalDeleted: number; }

/**
 * Delete records older than each policy's TTL. Uses a `< cutoff` bound so it can only ever remove OLD
 * data (never recent). Best-effort per policy. `policies` is injectable for tests.
 */
export async function purgeExpired(
  db: RetentionFirestore,
  nowMs: number,
  policies: readonly RetentionPolicy[] = RETENTION_POLICIES,
): Promise<PurgeReport> {
  const collections: PurgeResult[] = [];
  for (const policy of policies) {
    const cutoffMs = retentionCutoffMs(nowMs, policy.ttlDays);
    let deleted = 0;
    try {
      // The bound is built in the type the field is STORED in — see TimestampKind. A Date bound against
      // a numeric field matches nothing in Firestore, silently.
      let q = db.collection(policy.collection)
        .where(policy.timestampField, '<', retentionBound(cutoffMs, policy.timestampKind));
      const cap = Math.max(1, Math.floor(policy.maxPerRun ?? DEFAULT_MAX_PER_RUN));
      if (typeof q.limit === 'function') q = q.limit(cap);
      const snap = await q.get();
      for (const d of snap.docs) { await d.ref.delete(); deleted++; }
      collections.push({ collection: policy.collection, deleted, cutoffMs });
    } catch (e) {
      collections.push({ collection: policy.collection, deleted, cutoffMs, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { collections, totalDeleted: collections.reduce((s, r) => s + r.deleted, 0) };
}

// ── Production admin Firestore accessor (VITEST-skip, mirrors UserProfileStore) ──────────────────────
let cachedDb: admin.firestore.Firestore | null = null;
/** The subcollection purge's source in production, or null under test / without a database. */
export function getSubcollectionRetentionSource(): SubcollectionSource | null {
  const db = getRetentionDb();
  return db ? adminSubcollectionSource(db as unknown as admin.firestore.Firestore) : null;
}

export function getRetentionDb(): RetentionFirestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!cachedDb) {
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      cachedDb = getServerDb();
    }
    return cachedDb as unknown as RetentionFirestore;
  } catch {
    return null;
  }
}
