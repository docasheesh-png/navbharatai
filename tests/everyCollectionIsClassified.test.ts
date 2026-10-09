/**
 * EVERY FIRESTORE COLLECTION MUST BE CLASSIFIED, OR THIS FAILS.
 *
 * 🔴 THE CLASS THIS EXISTS FOR — a hand-maintained registry that a new store has to be added to by a
 * human, where the omission is invisible from every direction. It produced two real defects, both of
 * them breaking a promise the Privacy Policy had already published:
 *
 *   · `site_analytics` — the policy says visitor counts "are kept for 30 days". Nothing deleted them.
 *     It was in neither `RETENTION_POLICIES` nor `RETAINED_INDEFINITELY`, and it was not in
 *     `GROWING_COLLECTIONS` either — so the Load board's storage warning could not see it. That
 *     inventory's own comment reads "verified by reading each store on 2026-09-07"; the beacon shipped
 *     on 2026-09-10, three days later.
 *   · `user_vault_pin` and `agentv3_mcp_library` — both keyed by the uid, both personal data, both
 *     missing from `USER_SCOPED_COLLECTIONS`, so neither was erased when an account was deleted, while
 *     Section 9 promises erasure within 30 days.
 *
 * ⚠️ A COLLECTION IS GUILTY UNTIL LISTED, which is the point: the table below must name every exported
 * `*_COLLECTION` constant in the server, so a NEW store fails CI until somebody decides what it is.
 * That decision is cheap when the store is being written and nearly impossible to notice later.
 *
 * 🔒 The classification is not a label — each kind carries an obligation this test then enforces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  RETENTION_POLICIES, RETAINED_INDEFINITELY, USER_SCOPED_COLLECTIONS,
} from '../src/server/lib/DataRetentionManager';
import { WORKSPACE_SCOPED_COLLECTIONS } from '../src/server/lib/workspaceDataErase';

const root = resolve(__dirname, '..');

/**
 * What each collection IS, and therefore what must be true of it.
 *
 *  · `user`      — keyed by the uid. MUST be in `USER_SCOPED_COLLECTIONS` (account deletion erases it).
 *  · `workspace` — keyed by a workspaceId. MUST be in `WORKSPACE_SCOPED_COLLECTIONS` (erased with the app).
 *  · `platform`  — ours: a lease, a counter, a bucket, a day rollup. No user owns it.
 *  · `retained`  — grows and is purged on a clock. MUST have a `RETENTION_POLICIES` entry.
 *  · `blocked`   — its obligation is NOT met, and a queue row owns the reason. MUST name a `Q-###`.
 *
 * 🔴 `workspace` CARRIED NO OBLIGATION UNTIL Q-701 (2026-10-08), and that is how twelve stores of the
 * user's own app data sat in no erase path while this file called them classified. A label with nothing
 * behind it reads as coverage; `user` and `retained` always had a consequence, `workspace` did not.
 *
 * 🔒 `blocked` EXISTS SO THAT "UNRESOLVED" CANNOT BE SILENT — the sixth absolute rule as a test. A store
 * whose erasure is undecided, or whose retention window nobody has chosen, is not quietly mislabelled
 * `platform` to make this file pass: it is `blocked`, and the reason must name the row that owns it. A
 * row that is closed while the store is still here will fail the queue's own guards, not this one, which
 * is the right division: this test proves the store is ACCOUNTED FOR, not that the work is done.
 */
type Kind = 'user' | 'workspace' | 'platform' | 'retained' | 'blocked';
/**
 * `user`-kind collections erased by a DEDICATED MODULE rather than by `USER_SCOPED_COLLECTIONS`.
 *
 * Each entry says where the erasure lives, how `DELETE /api/profile` calls it, and why the registry
 * could not hold it. The test above reads those files rather than taking this map's word for it.
 */
const DERIVED_ERASER = 'src/server/lib/derivedIdErase.ts';
const DERIVED_CALL = 'deleteUserDerivedIdData\\(';
const USER_ERASED_BY_MODULE: Record<string, { file: string; calledAs: string; why: string }> = {
  user_workspaces: {
    file: 'src/server/lib/syncWorkspaceErase.ts',
    calledAs: 'eraseSyncedWorkspace\\(',
    why: 'the document whose id is the uid is only a MANIFEST; the payload is in `{uid}__c{i}` chunks, '
      + 'so a `docId` entry would have deleted the index and kept the data (Q-763)',
  },
  /**
   * 🔴 THE THIRD REACHABILITY SHAPE (2026-10-09). Four `blocked` rows here — Q-761, Q-762 (twice) and
   * Q-764 — were ONE root cause: a doc id BUILT from a key rather than equal to one. Neither registry
   * can express that, so each store was correctly judged unreachable and correctly recorded, and the
   * recording was all that ever happened. `derivedIdErase.ts` resolves the key first — from the uid,
   * from the user's `bots`, from `user_build_history` and the workspace id range — and then deletes
   * the exact id, which also means it fixes documents ALREADY written, where adding a uid field to the
   * writer would not have.
   */
  bot_sessions: {
    file: DERIVED_ERASER,
    calledAs: DERIVED_CALL,
    why: 'the id is `${botId}_${chatId}`, so the key is the BOT — resolved from `bots where ownerUid == uid` '
      + 'before the cascade deletes those bots, then swept as an id range (Q-761)',
  },
  build_history: {
    file: DERIVED_ERASER,
    calledAs: DERIVED_CALL,
    why: 'the id is a BARE sessionId, which is the workspace id minus the `agentv3-{uid}-` prefix '
      + '(`buildHistoryAccess.ts`), so it is resolved from `user_build_history` and from that id range, '
      + 'and its `versions` subcollection is swept first (Q-764)',
  },
};

const CLASSIFICATION: Record<string, { kind: Kind; why: string }> = {
  user_vault_pin:      { kind: 'user', why: "the user's App Lock PIN record — doc id IS the uid" },
  agentv3_mcp_library: { kind: 'user', why: "the user's saved MCP servers — doc id IS the uid" },
  supabase_connections: { kind: 'user', why: "the user's Supabase OAuth grant (encrypted tokens) — doc id IS the uid; erased with the account" },
  supabase_pause_notices: { kind: 'user', why: "what an owner was last told about a sleeping Supabase database (supabasePauseWatch.ts) — `userId` field, erased with the account" },
  platform_ratings:    { kind: 'user', why: "the user's 1–5 star rating of NavBharatAI and its note (platformRatingStore.ts) — doc id IS the uid, erased with the account" },

  site_configs:        { kind: 'workspace', why: "per-app config, doc id is the workspaceId" },
  agentv3_mcp_servers: { kind: 'workspace', why: "per-app MCP wiring, doc id is the workspaceId" },
  /**
   * 🔴 CORRECTED 2026-10-09 (Q-701 PR B). This said `workspace`, with the reason "one record per
   * connected domain, not per user" — a sentence that argues against its own label. Its doc id IS the
   * domain (`siteUptimeStore.ts:12`), so the workspace eraser's `agentv3-{uid}-` range could never
   * reach it, and nothing erased it. The body carries `userId` (`siteUptime.ts:81`), so it is reached
   * exactly by the user registry, which is now where it is. Found by the new `workspace`-kind
   * obligation on its first run, together with `site_configs` and `agentv3_mcp_servers`.
   */
  site_uptime:         { kind: 'user', why: "the uptime record of one person's connected domain — doc id is the DOMAIN, reached by its `userId` field" },
  app_engineering_memory_v1: { kind: 'workspace', why: "the app's requirement ledger, issues and change log — doc id is the workspaceId, erased with the workspace (changeEngine)" },
  app_ai_settings:     { kind: 'workspace', why: "the owner's switch for NavBharatAI AI inside their app — doc id is the workspaceId, erased with the workspace" },

  hosted_deploy_leases: { kind: 'platform', why: 'one doc per workspace while a server deploy runs (hostedDeployments.ts), deleted when it ends and stale after the longest possible deploy — a lock, not a record' },
  hosted_deploy_attempts: { kind: 'retained', why: "one doc per server deploy attempt: its states, a failure category and the owner's uid (hostedDeployments.ts); purged at 180 days" },
  job_leases:          { kind: 'platform', why: 'one doc per job id; a lease that expires by its own clock' },
  job_runs:            { kind: 'platform', why: 'one doc per scheduled job id: when it last ran (schedulerTick.ts, Q-159); replaced in place, no person in it' },
  payment_reversal_cursors: { kind: 'platform', why: "one doc per store rail: the newest voided purchase already applied (playVoidedPurchases.ts, Q-690); a timestamp replaced in place, no person in it" },
  domain_autopublish:  { kind: 'platform', why: 'one once-only marker per connected domain: which app was auto-published to it and when (domainAutoPublish.ts, Q-163); no uid, replaced in place' },
  agentv3_build_leases: { kind: 'platform', why: 'one doc per BUILDING workspace, deleted when the build ends and stale after 90 s — holds a uid only while that build runs (workspaceBuildLease.ts)' },
  metrics_timeline:    { kind: 'platform', why: 'one doc per time bucket — see the SCALE-PLAN entry' },
  monitor_alert_state: { kind: 'platform', why: 'a single document holding alert episodes' },
  web_risk_budget:     { kind: 'platform', why: 'one doc per calendar month, replaced in place' },
  agentv3_engine_use:  { kind: 'platform', why: 'one doc per day of engine use' },
  platform_settings:   { kind: 'platform', why: 'admin-set platform knobs (the build discount, buildDiscount.ts); one doc per setting, no person in it' },
  image_free_paid_daily: { kind: 'platform', why: 'one doc per UTC day — the platform-wide count of free-tier images a PAID engine served; no person in it' },
  explorer_repair_weak_daily: { kind: 'platform', why: 'one doc per UTC day — the platform-wide count of free-tier explorer repairs attempted; no person in it' },
  fleet_mistakes_v3:   { kind: 'platform', why: 'cross-fleet learning, keyed by the mistake, not a person' },
  agentv3_free_chains: { kind: 'retained', why: "a free build's unattended-time counter per workspace (Q-130); ignored after 6 h, purged after a day" },
  admin_audit_log:     { kind: 'retained', why: 'every admin action with who, why and the ids touched (admin panel audit PR 3); kept 180 days' },
  /**
   * 🔴 `gift_codes` IS DELIBERATELY NOT USER-SCOPED, for the same shape of reason `takedown_records`
   * is not: the thing it records does not belong solely to the person named in it. A purchased gift
   * code is value sitting in SOMEBODY ELSE's hands — bought with real money and given away — so
   * erasing it because the BUYER closed their account would destroy a stranger's property and take
   * the payment with it. It is also a payment record, which is the first of Privacy Policy §9's four
   * stated exceptions to erasure.
   */
  gift_codes:          { kind: 'platform', why: 'one doc per minted code; the doc id IS the code, and an unredeemed one is value in a third party\'s hands that must outlive the buyer\'s account' },
  promo_codes:         { kind: 'platform', why: "one doc per admin-made promo code (adminPromoStore.ts); the doc id IS the code and it belongs to the campaign, not to any one redeemer — each person's redemption is its own payment_transactions record" },
  gift_code_daily:     { kind: 'user', why: "one doc per buyer per UTC day bounding chargeback exposure; it is that person's own purchase tally and nothing needs it once the account is gone" },

  mobile_build_outcomes: { kind: 'retained', why: 'one doc per UTC day: how many .apk/.aab/.ipa builds finished and of what — counts only, no person in it, purged at 400 days' },
  mobile_build_counted:  { kind: 'retained', why: 'one marker per finished run so a POLLED status endpoint cannot count it twice; the id is a digest and the body names no owner' },
  referral_claim_outcomes: { kind: 'retained', why: 'one doc per UTC day: how many referral claims were tried, paid or refused and why — counts only, no person in it, purged at 400 days' },
  auth_otp_outcomes:       { kind: 'retained', why: 'one doc per UTC day: how many mobile OTPs were sent, verified or failed and the latest scrubbed reason per failure kind — no number, uid or address in it, purged at 90 days' },
  referral_claim_people:   { kind: 'retained', why: 'one marker per (person, day) so the claim tally counts people, not app opens; the id is a digest of (day, uid) and the body a timestamp; purged at 7 days' },
  site_analytics:      { kind: 'retained', why: 'visitor day-counts; the policy promises 30 days' },
  app_mart_reactions:  { kind: 'user', why: "a person's 👍/👎 on App Mart apps — one doc per (app, person), `uid` field" },
  app_mart_comments:   { kind: 'user', why: "a person's App Mart comments and replies — `uid` field; counts are counted from these, so an erase keeps them true" },
  app_mart_blocks:     { kind: 'user', why: "the people whose comments a reader chose not to see — doc id IS the uid" },
  app_mart_notifications: { kind: 'user', why: "a creator's grouped App Mart notifications, filed under `recipientUid`; also purged at 90 days" },
  app_mart_creator_ids: { kind: 'user', why: 'which account a public creator code belongs to, so a profile can open — holds `uid`, never returned to a client' },
  profile_avatars:     { kind: 'user', why: 'an uploaded profile photo, one doc per person under their public creator code — erased with the account' },
  app_mart_follows:    { kind: 'user', why: 'who follows which App Mart creator — one doc per (follower, creator), erased from both ends with either account' },
  app_mart_comment_reports: { kind: 'retained', why: 'what readers reported about App Mart comments — a safety record kept 180 days, like safety_flags' },
  safety_flags:        { kind: 'retained', why: 'flagged messages; the policy promises 180 days' },
  takedown_records:    { kind: 'retained', why: 'removal records; IT Rules 2021 require 180 days' },

  // ══ Q-701 (2026-10-08): the 98 the scan could not see until it was widened ═══════════════════════
  // Every key below was read at its own store. Where a store is `blocked`, the row named in `why` owns
  // it — nothing here is labelled to make the file pass.

  // ── Already erased with the account (registered in Q-760 and Q-701 PR A) ───────────────────────
  users:                   { kind: 'user', why: 'the account record — doc id IS the uid' },
  user_profiles:           { kind: 'user', why: 'name, email, phone, picture — doc id IS the uid' },
  user_sessions:           { kind: 'user', why: 'the saved session and preferences — doc id IS the uid' },
  user_token_wallets:      { kind: 'user', why: 'the wallet and token balance — doc id IS the uid' },
  user_costs:              { kind: 'user', why: "per-build real cost, a `userId` field; also RETAINED_INDEFINITELY as the money trail" },
  user_build_history:      { kind: 'user', why: "the person's own build history, a `userId` field" },
  user_secrets:            { kind: 'user', why: "the person's own API keys and database passwords (Q-760) — a `user_id` field; soft-deleted rows keep their ciphertext, so the query takes those too" },
  api_keys:                { kind: 'user', why: 'a live NavBharatAI API key (Q-760) — `userId` field; findByHash never checked that the owner still existed, so deleting the row IS the auth fix' },
  bots:                    { kind: 'user', why: "a bot's token AND appSecret (Q-760) — an `ownerUid` field; credentials for a third-party messaging platform" },
  webhooks:                { kind: 'user', why: 'the outbound URLs we POST build events to (Q-760) — doc id IS the uid' },
  conversation_memory_v1:  { kind: 'user', why: "the semantic memory of the person's chats — a `userId` field (ConversationMemoryStore.ts:70)" },
  professional_user_memory: { kind: 'user', why: 'what a professional assistant remembered about the person — a `userId` field' },
  sonic_voice_memory:      { kind: 'user', why: "the person's voice-chat turns — a `userId` field" },
  agentv3_conversations:   { kind: 'user', why: 'every build conversation — a `userId` field, AND its `turns`/`timeline` children, declared as `subs` because Firestore does not cascade' },
  user_diagnostics_v3:     { kind: 'user', why: "the person's own latest diagnostics report — doc id IS the uid" },
  user_notification_reads: { kind: 'user', why: 'which admin notices they had read — doc id IS the uid' },
  userPrefs:               { kind: 'user', why: 'their builder preferences — doc id IS the uid' },
  user_brain_v3:           { kind: 'user', why: 'what the engine learned about them — doc id IS the uid' },
  user_mistakes_v3:        { kind: 'user', why: 'their mistakes ledger — doc id IS the uid' },
  terminal_daily_usage:    { kind: 'user', why: 'terminal seconds used today — doc id IS the uid' },
  tool_daily_usage:        { kind: 'user', why: 'tool and image calls today — id is `${uid}__${bucket}`, so it is reached by the `userId` FIELD' },
  professional_passes:     { kind: 'user', why: 'their professional pass — doc id IS the uid' },
  wallet_balance_alerts:   { kind: 'user', why: 'what they were last warned about their balance — doc id IS the uid' },
  agentv3_onboarding_credits: { kind: 'user', why: 'their free-build credit — doc id IS the uid' },
  zip_uploads:             { kind: 'user', why: 'a .zip they uploaded to a build — a `uid` field' },
  agentv3_sheet_files:     { kind: 'user', why: 'a spreadsheet they uploaded — a `uid` field' },
  shares:                  { kind: 'user', why: 'a share link of their app — an `ownerId` field holding the verified uid' },
  custom_domains:          { kind: 'user', why: "NavBharatAI's record of a domain they connected — a `userId` field. Erasing it removes OUR record only; the registrar and host are not ours to touch, and the deletion page says so" },
  pwa_apps:                { kind: 'user', why: 'an instantly-hosted app of theirs — a `userId` field. Unlike an App Mart listing it has no buyer, so it is a plain erase' },
  ai_usage_logs:           { kind: 'user', why: 'their chat AI usage rows — a `userId` field, the same shape as `user_costs`' },
  user_referrals:          { kind: 'user', why: 'their own referral code and claims — doc id IS the uid. A payout recorded under somebody ELSE\'s referral is that person\'s record and stays' },

  // ── The user's app, erased with the workspace (registered in Q-701 PR A) ──────────────────────
  workspace_files_v3:        { kind: 'workspace', why: "the app's source code — doc id is the workspaceId, `files` sub" },
  workspace_assets_v3:       { kind: 'workspace', why: "the app's images and fonts — `assets` sub" },
  workspace_checkpoints_v3:  { kind: 'workspace', why: "the app's checkpoints — `items` sub" },
  workspace_embeddings_v3:   { kind: 'workspace', why: "the app's embeddings — `files` sub" },
  workspace_memory_v3:       { kind: 'workspace', why: "the app's build memory" },
  workspace_diagnostics_v3:  { kind: 'workspace', why: "the app's reports — `history` sub (Q-134 found that sub left behind)" },
  workspace_manual_edits_v3: { kind: 'workspace', why: 'which files the user edited by hand' },
  workspace_user_actions_v1: { kind: 'workspace', why: 'what the engine asked the user to do — `items` sub' },
  code_reviews:              { kind: 'workspace', why: 'review comments on the app — `comments` sub' },
  project_plans_v3:          { kind: 'workspace', why: "the app's plan — doc id is the workspaceId" },
  agentv3_attachment_memory: { kind: 'workspace', why: "the app's attachment memory — doc id is the workspaceId" },
  agentv3_build_outcome:     { kind: 'workspace', why: "whether the app's last build came out green" },
  agentv3_deployments:       { kind: 'workspace', why: "the app's deployment record and URL" },
  agentv3_provider_state:    { kind: 'workspace', why: 'per-provider build state — id is `${workspaceId}__${provider}`, inside the erase range' },
  agentv3_sandboxes:         { kind: 'workspace', why: "the app's sandbox and its last snapshot" },
  buildTraces:               { kind: 'workspace', why: 'every decision the builder took for the app' },
  build_queues_v3:           { kind: 'workspace', why: "the app's pending command queue" },
  incrementalCache:          { kind: 'workspace', why: "file hashes from the app's last build" },
  mega_roadmaps_v3:          { kind: 'workspace', why: "the app's long roadmap" },
  workspace_traceability:    { kind: 'workspace', why: "the app's requirement-to-code matrix" },
  migrationHistory:          { kind: 'workspace', why: "the app's migration runs. Its parameter is called `projectId`, but both callers pass `this.workspaceId`" },
  sboms:                     { kind: 'workspace', why: "the app's software bills of materials — `sboms/{workspaceId}/builds/{buildId}`" },

  // ── Ours: a lease, a counter, a bucket, a day rollup ──────────────────────────────────────────
  agentv3_cost_telemetry: { kind: 'platform', why: 'one doc per date — the engine-wide cost rollup, no person in it' },
  agentv3_live:           { kind: 'platform', why: "one doc per live channel: the build's event buffer, deleted when the channel closes" },
  agentv3_sandbox_starts: { kind: 'platform', why: 'one doc per UTC day — how many sandbox sessions started; counts only' },
  api_key_usage:          { kind: 'platform', why: 'one doc per (key, day) — the key\'s own daily spend, keyed by the key and not by a person' },
  assistant_spend:        { kind: 'platform', why: 'one doc per date — platform-wide assistant spend' },
  feature_spend:          { kind: 'platform', why: 'one doc per (date, feature) — platform-wide spend by feature' },
  platform_config:        { kind: 'platform', why: 'one or two fixed documents: the release gate and its checks' },
  provider_cooldowns:     { kind: 'platform', why: 'one doc per provider — how long it stays benched' },
  rate_limits_v1:         { kind: 'platform', why: 'one doc per rate-limit bucket; expires by its own clock' },
  site_content:           { kind: 'platform', why: 'a single document holding the public About text' },
  own_audience_totals:    { kind: 'platform', why: 'one doc per page: lifetime view counters, no person in it' },
  admin_notifications:    { kind: 'platform', why: 'one doc per notice the ADMIN wrote; who read it is `user_notification_reads` above' },
  teams:                  { kind: 'platform', why: 'a team outlives any one member — doc id is the teamId; a member row lives in its `members` sub (Q-682), and removing a member is a status change, not a delete' },
  teamInvites:            { kind: 'platform', why: 'one doc per invite token, belonging to the team that sent it rather than to either side' },
  payment_transactions:   { kind: 'platform', why: 'one doc per order id — a money record. Privacy §9\'s FIRST stated exception to erasure, and now in RETAINED_INDEFINITELY so this file stops being silent about it' },
  app_builds:             { kind: 'platform', why: 'one doc per (user, repo) GitHub build — already RETAINED_INDEFINITELY as part of the build record' },
  hosting_usage:          { kind: 'platform', why: 'one doc per (user, month) of hosting usage — already RETAINED_INDEFINITELY as a billing input' },

  // ── Purged on a clock ────────────────────────────────────────────────────────────────────────
  build_jobs:        { kind: 'retained', why: 'one doc per queued build job; purged on its own window' },
  build_sessions:    { kind: 'retained', why: 'one doc per build session; purged on its own window' },
  build_failures:    { kind: 'retained', why: 'one doc per failed build, for the failure view; purged on its own window' },
  server_logs:       { kind: 'retained', why: 'server log lines; purged on their own window' },
  metrics_snapshots: { kind: 'retained', why: 'one doc per daily metrics snapshot; purged on its own window' },
  app_ai_usage:      { kind: 'retained', why: "one doc per day of an app's own AI use; purged on its own window" },
  app_ai_visitors:   { kind: 'retained', why: "one doc per (app, visitor, day); purged on its own window" },

  // ── 🟡 Accounted for, obligation NOT met: each names the row that owns it ─────────────────────
  gallery_apps: { kind: 'blocked', why: 'Q-766 — a `uid` field, and it survives deletion today. It is a PUBLIC listing that can have been bought, so erasing it because the AUTHOR left would destroy a stranger\'s purchase (the `gift_codes` reasoning). The admin decides: erase, or unlist and de-identify' },
  nav_store_apps: { kind: 'blocked', why: 'Q-766 — same shape as `gallery_apps`: a `uid` field, a public App Mart listing, purchasable' },
  nav_store_web_apps: { kind: 'blocked', why: 'Q-766 — same as above, plus `files`/`baked`/`screenshots` subcollections that Q-682 owns' },
  adrDecisions: { kind: 'blocked', why: "Q-762 — doc id is `${userId}__${projectId}` and the body has NO uid field, so neither key strategy reaches it. Owned by PR #3611, which makes the writer store the uid" },
  techDebt:     { kind: 'blocked', why: 'Q-762 — the same composite-id shape, the same missing field; same owner' },
  /**
   * ✅ Q-763, 2026-10-09. The document whose id is the uid is only a MANIFEST; the payload is in
   * `{uid}__c{i}`. It is erased by `syncWorkspaceErase.ts` — chunks first, manifest last — and NOT by
   * the registry, which is exact-match only and would have deleted the index and kept the data.
   */
  user_workspaces: { kind: 'user', why: "the person's cross-device workspace: a manifest plus `{uid}__c{i}` chunks, erased by `syncWorkspaceErase.ts`" },
  build_history: { kind: 'user', why: "every build's version metadata for every app — keyed by a BARE sessionId, which `derivedIdErase.ts` resolves from `user_build_history` and the workspace id range, `versions` subcollection first (Q-764)" },
  app_ai_apps:   { kind: 'blocked', why: 'Q-765 — doc id is the APP id, so the workspace range cannot reach it; it holds `userId`, so the user registry is the likely home once the key is decided. Owned by PR #3611' },
  analytics_daily:  { kind: 'blocked', why: 'Q-767 — a day rollup that grows for ever with no retention window chosen' },
  analytics_events: { kind: 'blocked', why: 'Q-767 — an event stream, appended with `.add()`, that grows for ever with no window' },
  build_events:     { kind: 'blocked', why: 'Q-767 — the build event bus, appended with `.add()`, no window' },
  guest_daily_usage: { kind: 'blocked', why: 'Q-767 — ids are `${day}_ip_${hash}` / `${day}_dev_${key}`: a hashed IP is personal data under the DPDP Act and nothing deletes it' },
  abuseLedger:   { kind: 'blocked', why: "Q-767 — doc id IS the uid, but it is an ABUSE record: the `safety_flags` precedent says a record the abuser can erase by deleting their account is not a record. It needs a window, not a user entry" },
  user_reports:  { kind: 'blocked', why: 'Q-767 — support tickets carrying `reporterUid` and `target.ownerUid` plus screenshot subcollections; a support/safety record needing a window, like `app_mart_comment_reports`' },
  admin_apk_reports:   { kind: 'blocked', why: 'Q-767 — one doc per reported APK build, carrying `userId`; no window' },
  admin_build_reports: { kind: 'blocked', why: 'Q-767 — the full build report, carrying `userId` and `workspaceId`; no window' },
  admin_build_triage:  { kind: 'blocked', why: 'Q-767 — one triage doc per build digest; no window' },
  bot_sessions:  { kind: 'user', why: "per-chat state for one of the person's bots — id is `${botId}_${chatId}`, so `derivedIdErase.ts` resolves the bot ids first and sweeps each `${botId}_` range (Q-761)" },
  hosting_billing:      { kind: 'blocked', why: 'Q-767 — one doc per (subject, day) of hosting billing; a money input, so the question is which window the law wants, not whether to erase' },
  hosting_period_usage: { kind: 'blocked', why: 'Q-767 — one doc per (user, period) of hosting usage; same question as `hosting_billing`' },
  promptAudits: { kind: 'blocked', why: "Q-701 — `promptAudits/{uid}/entries` IS erased (a USER_SCOPED_SUBCOLLECTIONS entry), and the parent document is deliberately NOT registered because nothing writes it: an entry would report `deleted: 0` for ever. Listed here so the parent is accounted for rather than invisible" },
};

/**
 * ── THE SCAN (widened for Q-701, 2026-10-08) ──────────────────────────────────────────────────────
 *
 * 🔴 IT USED TO READ ONLY `export const *COLLECTION = '…'`, AND THAT IS THE DEFECT, NOT A DETAIL.
 * A store named by a PRIVATE constant or by an inline `db.collection('x')` was invisible to the one
 * guard whose whole job is to make an unclassified store fail CI. The old scan saw 46 collections.
 * There are 144. Three live defects came out of that blind spot:
 *   · `supabase_connections` — a deleted account's Supabase tokens, kept (its registry entry says the
 *     census could not see it "because the collection name was a private constant");
 *   · Q-760 — four stores holding a WORKING CREDENTIAL, kept after the account was deleted;
 *   · Q-701 PR A — 33 more stores of personal and app data, in no erase path at all.
 *
 * It finds three forms, and every one of them was needed by something real in this repo:
 *   1. `const *COLLECTION* = 'x'` — exported or not — but NEVER `*SUBCOLLECTION*`.
 *   2. `collection(db, 'x')` and `doc(db, 'x', …)` — the web-SDK forms; in the second the FIRST
 *      segment is a collection.
 *   3. `<handle>.collection('x')` where the handle is a Firestore ROOT.
 *
 * 🔒 AND IT DECLARES WHAT IT COULD NOT READ, rather than skipping it. A receiver that is not a known
 * root (today only `root`, which is always a `.doc()` ref) lands in `UNREADABLE_RECEIVERS` and must be
 * listed below with its reason — because a scan that silently skips what it does not understand is
 * exactly how this test went blind for 98 collections. A NEW unknown receiver fails the test.
 */
// `store` joined these on 2026-10-09 with `derivedIdErase.ts`, which names its collections as literals
// on a root handle called `store`. Adding it WIDENS the scan — every such literal is now a collection
// the obligations below are checked against — which is the direction this file is allowed to move in.
const DB_HANDLES = new Set(['db', 'd', 'store']);

/**
 * Receivers that are NOT a Firestore root, each with the reason. All three are `.doc()` references,
 * so what follows them is a SUBcollection — Q-682's registry, not this one — and each is already an
 * erase entry's `sub` in `workspaceDataErase.ts`.
 */
const UNREADABLE_RECEIVERS: Record<string, string> = {
  root: 'always a `.doc()` reference (WorkspaceAssetStore / WorkspaceFileStore / DiagnosticsStore), so '
    + "`root.collection('assets' | 'files' | 'history')` is a subcollection, already registered as a `sub`",
};

/** Comments cannot name a store. `serverDb.ts`'s doc comment says `doc(db, 'coll', 'id')`, and an
 *  earlier draft of this scan duly reported a collection called `coll`. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * `*COLLECTION*` but never `*SUBCOLLECTION*` — `FEEDBACK_SUBCOLLECTION = 'feedback'` contains the
 * substring COLLECTION, and reading it as a top-level store is how `feedback`, `history` and `members`
 * first appeared in this scan.
 */
const CONST_FORM = /(?:export\s+)?const\s+(?!.*SUBCOLLECTION)[A-Z0-9_]*COLLECTION[A-Z0-9_]*\s*=\s*'([a-zA-Z0-9_]+)'/g;
const WEB_COLLECTION_FORM = /\bcollection\(\s*(?:db|d)\b[^,]*,\s*'([a-zA-Z0-9_]+)'\s*\)/g;
const WEB_DOC_FORM = /\bdoc\(\s*(?:db|d)\b[^,]*,\s*'([a-zA-Z0-9_]+)'\s*,/g;
const ADMIN_FORM = /\b([a-zA-Z_][a-zA-Z0-9_]*)\.collection\('([a-zA-Z0-9_]+)'\)/g;

interface ScanResult {
  collections: { name: string; file: string }[];
  /** `receiver` → the files it appeared in. Must be covered by UNREADABLE_RECEIVERS. */
  unreadable: Map<string, Set<string>>;
}

function scanServer(): ScanResult {
  const collections: { name: string; file: string }[] = [];
  const unreadable = new Map<string, Set<string>>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.ts$/.test(p) || /\.test\.ts$/.test(p)) continue;
      const rel = p.replace(root + '/', '');
      const src = stripComments(readFileSync(p, 'utf8'));
      for (const re of [CONST_FORM, WEB_COLLECTION_FORM, WEB_DOC_FORM]) {
        re.lastIndex = 0;
        for (const m of src.matchAll(re)) collections.push({ name: m[1], file: rel });
      }
      ADMIN_FORM.lastIndex = 0;
      for (const m of src.matchAll(ADMIN_FORM)) {
        if (DB_HANDLES.has(m[1])) { collections.push({ name: m[2], file: rel }); continue; }
        if (!unreadable.has(m[1])) unreadable.set(m[1], new Set());
        unreadable.get(m[1])!.add(rel);
      }
    }
  };
  walk(join(root, 'src/server'));
  return { collections, unreadable };
}

describe('every declared collection is classified', () => {
  const scan = scanServer();
  const declared = scan.collections;

  it('the scan really finds the constants — an empty scan would pass vacuously', () => {
    expect(declared.length).toBeGreaterThan(10);
    expect(declared.map((d) => d.name)).toContain('site_analytics');
    expect(declared.map((d) => d.name)).toContain('user_vault_pin');
  });

  /**
   * 🔴 THE TEST THAT WAS MISSING, AND ITS ABSENCE IS WHY THE BLIND SPOT SURVIVED SO LONG.
   *
   * Every obligation below is checked against what the scan FOUND — so narrowing the scan makes them
   * all pass on a smaller world. Proven while building this PR: reverting the scan to
   * `export const *COLLECTION` only left all ten tests green on 46 collections instead of 144. A
   * guard whose coverage its own tests cannot see is a guard that can be switched off by accident.
   *
   * So each FORM gets a named witness that only that form can find, plus a floor on the total.
   */
  it('🔒 the scan finds each FORM, not just the one the old version handled', () => {
    const names = new Set(declared.map((d) => d.name));

    // A PRIVATE constant — `const COLLECTION = 'conversation_memory_v1'` (ConversationMemoryStore.ts:16).
    expect(names, 'private `const …COLLECTION` is not being read').toContain('conversation_memory_v1');
    // An inline admin call — `db.collection('api_keys')` (ApiKeyStore.ts:65), no constant at all.
    expect(names, "inline `db.collection('x')` is not being read").toContain('api_keys');
    // A web-SDK doc path whose FIRST segment is the collection — `doc(db, 'user_workspaces', …)` (sync.ts:36).
    expect(names, "`doc(db, 'x', …)` is not being read").toContain('user_workspaces');
    // A web-SDK collection call — `collection(db, 'user_secrets')` (secrets.ts:146).
    expect(names, "`collection(db, 'x')` is not being read").toContain('user_secrets');

    // And a floor, so a refactor cannot quietly shrink the world the obligations are checked against.
    // 144 at the time of writing; the floor is deliberately below that so adding a store is not a
    // failure, while losing a tenth of them is.
    expect(declared.length, 'the scan has lost a large share of the collections it used to see')
      .toBeGreaterThan(130);
  });

  it('🔒 a comment cannot name a store, and a SUBcollection constant is not a store', () => {
    const names = new Set(declared.map((d) => d.name));
    // `serverDb.ts`'s doc comment says `doc(db, 'coll', 'id')`. An earlier draft of this scan duly
    // reported a collection called `coll`.
    expect(names, "'coll' comes from a doc comment in serverDb.ts — comments must be stripped")
      .not.toContain('coll');
    // `FEEDBACK_SUBCOLLECTION = 'feedback'`, `HISTORY_SUBCOLLECTION = 'history'` and
    // `MEMBERS_SUBCOLLECTION = 'members'` all contain the substring COLLECTION. They are Q-682's
    // registry, not this one, and reading them as top-level stores is how they first appeared here.
    for (const sub of ['feedback', 'history', 'members', 'turns', 'timeline', 'entries', 'items', 'versions']) {
      expect(names, `'${sub}' is a SUBcollection and must not be counted as a top-level store`)
        .not.toContain(sub);
    }
  });

  it('🔒 no collection is unclassified — a NEW store fails here until someone decides what it is', () => {
    const unknown = declared.filter((d) => !CLASSIFICATION[d.name]).map((d) => `${d.name} (${d.file})`);
    expect(unknown, 'add each of these to CLASSIFICATION with what it is and why:\n' + unknown.join('\n'))
      .toEqual([]);
  });

  it('🔒 every `user`-kind collection is erased on account deletion', () => {
    // Section 9 of the Privacy Policy: personal data is deleted or anonymised within 30 days, with four
    // exceptions — none of which is a PIN record or a saved server list.
    //
    // 🔒 THE OBLIGATION IS "ERASED", NOT "IN THAT ONE REGISTRY" (widened 2026-10-09, Q-763). The
    // registry is exact-match only by design — `docId` or a field — and some layouts are not that
    // shape. `user_workspaces` is the case that forced the distinction: its document id IS the uid, so
    // it looks like the most obvious `'docId'` entry in the repo, but that document is only a MANIFEST
    // and the payload lives in `{uid}__c{i}`. Registering it would have deleted the index and kept the
    // data. So a `user` collection may instead be erased by a NAMED module below, and the test checks
    // the duty rather than the mechanism. What it will not accept is a `user` collection erased by
    // nothing at all.
    const erased = new Set(USER_SCOPED_COLLECTIONS.map((c) => c.collection));
    const missing = Object.entries(CLASSIFICATION)
      .filter(([, v]) => v.kind === 'user')
      .map(([name]) => name)
      .filter((name) => !erased.has(name) && !USER_ERASED_BY_MODULE[name]);
    expect(missing, `user-keyed but never erased: ${missing.join(', ')}`).toEqual([]);
  });

  it('🔒 a collection erased by a module really is erased there — the file is read, not trusted', () => {
    // Otherwise this map is just a second way to say "classified" with nothing behind it, which is the
    // exact failure the `workspace` kind had before Q-701 gave it an obligation.
    for (const [name, where] of Object.entries(USER_ERASED_BY_MODULE)) {
      const src = readFileSync(join(root, where.file), 'utf8');
      expect(src, `${where.file} does not mention ${name}, so it cannot be erasing it`).toContain(name);
      const route = readFileSync(join(root, 'src/server/routes/profile.ts'), 'utf8');
      expect(route, `${where.file}'s eraser is never called from DELETE /api/profile`)
        .toMatch(new RegExp(where.calledAs));
    }
  });

  it('🔒 the scan declares every receiver it could not read — a silent skip is how it went blind', () => {
    // A `<thing>.collection('x')` whose receiver is not a known Firestore root is NOT a top-level
    // collection this registry owns — but it is also not something to drop on the floor. Each one must
    // be listed in UNREADABLE_RECEIVERS with its reason, so a NEW handle name (a refactor renaming `db`,
    // a new helper) fails here instead of quietly removing stores from the census again.
    const undeclared = [...scan.unreadable.entries()]
      .filter(([name]) => !UNREADABLE_RECEIVERS[name])
      .map(([name, files]) => `${name}.collection(…) in ${[...files].join(', ')}`);
    expect(
      undeclared,
      'the scan met a receiver it does not understand. If it is a Firestore ROOT, add it to DB_HANDLES '
      + 'so its collections are counted. If it is a `.doc()` reference, add it to UNREADABLE_RECEIVERS '
      + 'with that reason:\n' + undeclared.join('\n'),
    ).toEqual([]);
  });

  it('🔒 every `workspace`-kind collection is erased with the app', () => {
    /**
     * 🔴 THIS OBLIGATION DID NOT EXIST UNTIL Q-701, and twelve stores of the user's own app data sat
     * in no erase path while this file called them `workspace` and therefore classified. `user` and
     * `retained` always had a consequence; `workspace` was a label with nothing behind it, which reads
     * as coverage from every direction.
     */
    const erased = new Set(WORKSPACE_SCOPED_COLLECTIONS.map((c) => c.collection));
    const missing = Object.entries(CLASSIFICATION)
      .filter(([, v]) => v.kind === 'workspace')
      .map(([name]) => name)
      .filter((name) => !erased.has(name));
    expect(missing, `called workspace-scoped but never erased with the workspace: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('🔒 every `blocked`-kind collection names the queue row that owns it', () => {
    // The sixth absolute rule as a test: a store whose obligation is unmet may not be quietly
    // mislabelled to make this file pass, and it may not sit here with nobody accountable either.
    const unowned = Object.entries(CLASSIFICATION)
      .filter(([, v]) => v.kind === 'blocked' && !/\bQ-\d{3}\b/.test(v.why))
      .map(([name]) => name);
    expect(unowned, `blocked with no Q-### row to own it: ${unowned.join(', ')}`).toEqual([]);
  });

  it('a `blocked` collection is NOT also claimed as erased or policied — that would be a false claim', () => {
    const erasedUser = new Set(USER_SCOPED_COLLECTIONS.map((c) => c.collection));
    const erasedWs = new Set(WORKSPACE_SCOPED_COLLECTIONS.map((c) => c.collection));
    const policied = new Set(RETENTION_POLICIES.map((p) => p.collection));
    for (const [name, v] of Object.entries(CLASSIFICATION)) {
      if (v.kind !== 'blocked') continue;
      const claimed = erasedUser.has(name) || erasedWs.has(name) || policied.has(name);
      expect(claimed, `${name} is marked blocked but is already covered — classify it properly`).toBe(false);
    }
  });

  it('🔒 every `retained`-kind collection has a real retention policy', () => {
    const policied = new Set(RETENTION_POLICIES.map((p) => p.collection));
    const missing = Object.entries(CLASSIFICATION)
      .filter(([, v]) => v.kind === 'retained')
      .map(([name]) => name)
      .filter((name) => !policied.has(name));
    expect(missing, `promised a retention window but nothing deletes them: ${missing.join(', ')}`).toEqual([]);
  });

  it('a classification is a reason, not a label — every entry says why', () => {
    for (const [name, v] of Object.entries(CLASSIFICATION)) {
      expect(v.why.length, `${name} has no reason recorded`).toBeGreaterThan(20);
    }
  });

  it('the three registries do not contradict each other', () => {
    // A collection cannot be both purged on a clock and kept for ever — that would make the report of
    // what we do with somebody's data depend on which list a reader happened to open.
    const policied = RETENTION_POLICIES.map((p) => p.collection);
    const forever = RETAINED_INDEFINITELY.map((r) => r.collection);
    expect(policied.filter((c) => forever.includes(c))).toEqual([]);
  });
});
