// THE REFERRAL REWARD LEDGER — who is owed what, and why it can only ever be paid once.
//
// ── THE PLAN THE ADMIN APPROVED (2026-09-15) ─────────────────────────────────────────────────────
// The welcome gift stops being one lump handed over at sign-up and becomes FOUR earned steps, each
// behind a thing that is genuinely hard to fake:
//
//   B (the new user)  referral code ₹100 · email ₹100 · mobile ₹100 · github ₹100   =  ₹400
//   A (the referrer)  ₹25 for each of B's THREE verifications                       =  ₹75
//   ─────────────────────────────────────────────────────────────────────────────────────
//   One referred user costs                                                            ₹475
//
// Today's flat welcome gift is ₹500 (`giftPlan.ts`), so this is CHEAPER per referred user and
// cheaper still for an organic one (₹300 — no code, so no code step). The point was never to spend
// more on growth; it was to make every rupee land behind a verified person.
//
// ── THE FOUR RULES THAT MAKE IT SAFE, each learned from a specific way it would otherwise leak ───
//
// 🔒 1. THE FULL ₹400 LADDER IS ANDROID-ONLY AND DEVICE-VERIFIED; THE WEBSITE EARNS A CAPPED ₹100.
//    Every rupee of the full ladder requires a genuine Android device (the Play Integrity + device-id
//    check of `Hissa 2`). The original design had NO web path at all, and the reason still holds: a
//    free mailbox and a free GitHub account cost nothing and take three minutes, so ₹200 reachable
//    from a laptop would be an unlimited, scriptable money printer that never touches the device check.
//    ⚠️ REVERSED IN PART 2026-09-26 (admin, verbatim: *"website par github aur mobile verification par
//    100-100 maximum 200"*): the flat welcome gift was retired (`giftPolicy.ts`), which left a
//    website-only user at ₹0 and — with billing on — unable to build even once. So the web now earns
//    EXACTLY TWO steps (mobile ₹100, github ₹100) under a ₹200 ceiling (`giftPolicy.MAX_WEB_GIFT_TOKENS`):
//    the mobile SIM is the genuine anti-farm gate, github rides beside it inside the ₹200 so no tunable
//    can turn either into more than its ₹100, and gmail-login (`email`) and the referral code stay
//    Android-only. 🔒 AND NO WEB TOKEN IS PAID UNTIL THE MOBILE IS VERIFIED (admin: *"no mobile (otp)
//    verify no token"*): a free github link is EARNED but HELD at ₹0 until a real number lands, so it
//    can never pay on its own — the same anchor rule 3 puts under the referrer's money. It is a SUB-cap beneath the ₹400 lifetime self-cap, not a second budget — a user who
//    took ₹200 on the web still earns the remaining ₹200 on a verified device. Half a gate is still no
//    gate, which is exactly why the web's exposure is bounded to ₹200 and the rest stays behind the
//    device check.
//
// 🔒 2. THE REFERRER IS PAID FOR VERIFICATIONS, NEVER FOR A REDEMPTION. A's ₹75 is three payments of
//    ₹25 for B's email, mobile and github — and ₹0 for B merely typing the code. Admin: *"uske refral
//    code use matr se usko kuch na mile."* This is what stops a CHAIN: if a code redemption paid, one
//    "mother" account could farm a fresh throwaway every cycle and the earnings would CONCENTRATE in
//    one usable wallet. Paying only for verifications means every link in the chain needs a real,
//    permanently-burned phone number.
//
// 🔒 3. NOTHING IS RELEASED UNTIL B's MOBILE IS VERIFIED. The email and github rungs are EARNED when
//    they happen and HELD until the mobile lands, then paid together. A device id resets on a factory
//    reset (~18 minutes of work, ₹0 of cash); a phone number does not — TRAI keeps a disconnected
//    number out of circulation for months. So the device bounds how many accounts exist at once and
//    the phone bounds how often the same person can come back. Only the second one makes the
//    factory-reset loop unprofitable, which is why A's money sits behind it and B's does not.
//
// 🔒 4. A LIFETIME CAP OF ₹1,500 ON WHAT ONE REFERRER MAY EVER EARN (admin-mandated, in his own
//    words: *"pata laga kisi user ne isko seriously le liya aur 2 mobile kharid ke 1 ka factory reset
//    kar kar ke mere L laga de"*). Rules 2 and 3 make farming unprofitable; the cap makes it BOUNDED,
//    which is a different guarantee and the one that matters when the reasoning behind 2 and 3 turns
//    out to be wrong about somebody's patience. It counts what was EVER PAID, never what is held — a
//    cap measured against a balance is refunded every time the user spends, which is precisely the
//    mistake `weeklyTopUp.ts` records for the lifetime gift cap.
//
// ── WHAT THIS MODULE IS NOT ──────────────────────────────────────────────────────────────────────
// PURE. No Firestore, no clock, no env reads beyond the tunables below, no I/O. It DECIDES; the
// caller persists.
//
// 🔴 AND THE CALLER'S HALF IS NOT OPTIONAL: every decision here is idempotent ONLY IF the payment and
// the record of the step are written in ONE transaction. Paying first and recording after is a
// double-credit waiting for a retried request — the exact bug the 2026-09-12 money audit found in the
// store-purchase path, where a receipt check sat outside the transaction. `alreadyPaidSteps` must be
// read INSIDE that transaction too, or it is a check against a stale world.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { parseEnvFlag } from './envFlag';
import { capSelfGift, capReferrerPerFriend, capWebGift } from './giftPolicy';

/** The four things a new user can do, each worth one payment, ever. */
export type RewardStep = 'referral-code' | 'email' | 'mobile' | 'github';

export const ALL_STEPS: readonly RewardStep[] = ['referral-code', 'email', 'mobile', 'github'];

/**
 * The steps that may be earned on the WEBSITE (admin 2026-09-26: *"website par bas 2 — github link,
 * mobile verification"*). The other two are Android-only by design: `email` is the **Gmail-login**
 * grant (paid the moment a user signs in with Google on the device-checked app), and `referral-code`
 * needs the device check to bound farming. Deriving `stepAllowedOnWeb` from THIS list — rather than
 * hard-coding the two ids at every call site — means a fifth step is Android-only until someone
 * decides otherwise, the same safe-by-default shape `REFERRER_PAYING_STEPS` already uses.
 *
 * ⚠️ Order matters for the checklist UI, not for the money: mobile is listed first because it is the
 * genuine anti-farm gate (a real SIM), and github rides inside the shared ₹200 web ceiling.
 */
export const WEB_ELIGIBLE_STEPS: readonly RewardStep[] = ['mobile', 'github'];

/** Is this step claimable on the website at all? (Android earns the full set; web earns only these.) */
export function stepAllowedOnWeb(step: RewardStep): boolean {
  return (WEB_ELIGIBLE_STEPS as readonly string[]).includes(step);
}

/**
 * May this account still APPLY a referral code? ("refer — only for new user", admin 2026-09-26.)
 *
 * 🔴 WHY THIS IS NOT `paidSteps.length === 0` ANY MORE. That was the old "old ko never" test, and it
 * collides with the Gmail-login grant: `email` is claimed automatically the moment a user signs in on
 * the app, so under the old rule EVERY Android user became "old" before they could type a code, and the
 * referral step could never be reached by anyone. The sign-in grant says nothing about an account being
 * old — it happens on day one by construction — so it alone does not disqualify.
 *
 * Any REAL verification (mobile, github) still does: an account that has already earned those before
 * hearing about a code is exactly the retro-attribution "old ko never" exists to refuse, since the
 * referrer would otherwise be paid for work that happened before the referral. One definition, read by
 * both the redeem route (the decision) and the status endpoint (whether to show the step at all), so the
 * screen can never offer a code box the server would refuse.
 */
export function canStillRedeem(paidSteps: unknown): boolean {
  return readSteps(paidSteps).every((s) => s === 'email');
}

/**
 * The three steps that pay the REFERRER. `referral-code` is deliberately absent — see rule 2. It is
 * derived from ALL_STEPS rather than written out again, so adding a fifth step cannot silently create
 * a referrer payout nobody decided on: a new step pays the referrer only if it is a verification.
 */
export const REFERRER_PAYING_STEPS: readonly RewardStep[] = ALL_STEPS.filter((s) => s !== 'referral-code');

function isStep(v: unknown): v is RewardStep {
  return typeof v === 'string' && (ALL_STEPS as readonly string[]).includes(v);
}

/** Whatever the store hands back, as a clean, de-duplicated set of steps. Never throws. */
export function readSteps(raw: unknown): RewardStep[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter(isStep)));
}

function tokensFromEnv(raw: string | undefined, fallbackRupees: number): number {
  // 🔴 THE BLANK CHECK IS LOAD-BEARING, and leaving it out is a JavaScript footgun that a test
  // caught here before it could ship: `Number('')` and `Number('   ')` are both **0**, not NaN. So
  // without this line, a key PRESENT-BUT-EMPTY in Cloud Run — a cleared field, a variable set from
  // an unset shell var, a copy-paste that dropped the value — would have read as a deliberate zero.
  // On the lifetime cap that means every referrer earns nothing, for ever, with the console showing
  // the key as configured and nothing failing anywhere. Blank means UNSET, which means the default.
  const text = String(raw ?? '').trim();
  if (!text) return fallbackRupees * TOKENS_PER_RUPEE;
  const n = Number(text);
  // A NEGATIVE or non-finite override takes the default; an explicit `0` is honoured, because
  // switching one rung off is a real thing an admin may want and — unlike a blank — it is
  // unambiguous: nobody types a zero by accident.
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallbackRupees * TOKENS_PER_RUPEE;
}

/**
 * Master switch. Default OFF — while off every decision here pays ZERO and the existing giftPlan
 * behaviour is untouched, byte for byte. The two plans must never both pay: together they would hand
 * one person ₹500 + ₹400.
 */
export function referralRewardsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag((env.REFERRAL_REWARDS || '').trim().toLowerCase()) === true;
}

/** What ONE step is worth to the new user. ₹100. */
export function stepRewardTokens(env: NodeJS.ProcessEnv = process.env): number {
  return tokensFromEnv(env.REFERRAL_STEP_TOKENS, 100);
}

/** What ONE of B's verifications is worth to A. ₹25. */
export function referrerStepTokens(env: NodeJS.ProcessEnv = process.env): number {
  return tokensFromEnv(env.REFERRER_STEP_TOKENS, 25);
}

/**
 * The most one referrer may EVER earn. ₹1,500 — roughly twenty referred friends.
 *
 * ⚠️ There is no "unlimited" value on purpose. `0` means zero, and anything unreadable takes the
 * ₹1,500 default rather than becoming no cap at all — the reasoning `parseRolloutPercent` already
 * uses for AGENTV3_FEATURE_HEAL_PCT, where a malformed value silently meant "everyone". A cap that
 * can be removed by a typo is not a cap.
 */
export function referrerLifetimeCapTokens(env: NodeJS.ProcessEnv = process.env): number {
  return tokensFromEnv(env.REFERRER_LIFETIME_CAP_TOKENS, 1500);
}

// ── B's own reward ───────────────────────────────────────────────────────────────────────────────

export type SelfRewardReason =
  | 'granted'
  | 'already-paid'        // this step has been paid before; a step pays once, ever
  | 'cap-reached'         // the account is at its ₹400 lifetime gift ceiling (giftPolicy.ts)
  | 'not-android'         // iOS and unrecognised platforms earn nothing here
  | 'web-not-eligible'    // this step is Android-only (email / referral-code); web cannot earn it
  | 'web-held-until-mobile' // earned on the web but not payable until a real mobile (OTP) is verified
  | 'web-cap-reached'     // the account is at its ₹200 website ceiling (giftPolicy.ts)
  | 'device-unverified'   // no genuine-device proof ⇒ no money, never a silent skip
  | 'disabled';           // the master flag is off

export interface SelfReward {
  tokens: number;
  reason: SelfRewardReason;
  /** The step to record as paid, in the SAME transaction as the credit. Null when nothing is paid. */
  recordStep: RewardStep | null;
  /**
   * True when this grant was earned on the WEBSITE, so the caller also advances `webGiftedTokens` in
   * the same transaction. Android grants leave it false — they are bounded by the device check and the
   * ₹400 self cap, never by the web sub-ceiling.
   */
  web?: boolean;
}

const NOTHING = { tokens: 0, recordStep: null } as const;

/**
 * What the NEW USER is owed for completing one step.
 *
 * `deviceVerified` is the caller's own verdict from the Play Integrity + device-id check, and it is
 * required rather than defaulted: a caller that has not asked the question has not proved anything,
 * and the safe reading of silence is "no".
 */
export function decideSelfReward(input: {
  step: RewardStep;
  alreadyPaidSteps: unknown;
  deviceVerified: boolean;
  platform: 'android' | 'ios' | 'web' | string;
  /**
   * What this account has ALREADY been gifted, lifetime (`freeGiftedTokens`). Optional so existing
   * callers keep working — but a caller that omits it gets NO ceiling beyond the step list, which is
   * why `referral.ts` passes it and a test asserts that it does.
   */
  alreadyGiftedTokens?: unknown;
  /**
   * What this account has already been paid THROUGH THE WEB (`webGiftedTokens`). Only read on a web
   * claim, where it enforces the ₹200 website sub-ceiling. Omitted (or on Android) it is treated as 0.
   */
  alreadyWebGiftedTokens?: unknown;
  /**
   * Has this account verified a real mobile (OTP)? Required for ANY web payout (admin 2026-09-26:
   * *"no mobile (otp) verify no token"*). On Android it is not read — the device check is the gate.
   * The caller derives it from the account record (`stepIsProven('mobile')`), never the request body.
   */
  mobileVerified?: boolean;
  env?: NodeJS.ProcessEnv;
}): SelfReward {
  const env = input.env ?? process.env;
  if (!referralRewardsEnabled(env)) return { ...NOTHING, reason: 'disabled' };

  const alreadyPaid = readSteps(input.alreadyPaidSteps).includes(input.step);
  const want = stepRewardTokens(env);
  // 🔒 THE ₹400 LIFETIME SELF-CAP APPLIES ON EVERY PLATFORM, so it is computed once here. "Four steps
  // × ₹100 = ₹400" holds only while REFERRAL_STEP_TOKENS is 100; `capSelfGift` clamps against what the
  // account has actually received, so the ceiling survives any tunable. A caller that omits the total
  // (a legacy call) keeps its old unclamped-by-lifetime behaviour, which a test still asserts.
  const afterSelfCap = input.alreadyGiftedTokens === undefined ? want : capSelfGift(want, input.alreadyGiftedTokens);

  if (input.platform === 'android') {
    if (!input.deviceVerified) return { ...NOTHING, reason: 'device-unverified' };
    if (alreadyPaid) return { ...NOTHING, reason: 'already-paid' };
    // Reported as its own reason rather than folded into 'already-paid': the two are different facts
    // about a real person, and an admin reading "already paid" for someone who was never paid this
    // step would be reading a wrong answer to the question they asked.
    if (afterSelfCap <= 0) return { ...NOTHING, reason: 'cap-reached' };
    return { tokens: afterSelfCap, reason: 'granted', recordStep: input.step };
  }

  if (input.platform === 'web') {
    // 🔒 WEB IS DELIBERATELY DIFFERENT, AND SMALLER. Only two steps are earnable here (mobile, github),
    // there is NO device check (the web has none — the mobile SIM is the real gate, and github rides
    // inside the ₹200 web ceiling), and the total is clamped by BOTH the ₹400 lifetime self-cap above
    // AND the ₹200 website sub-cap. See giftPolicy.MAX_WEB_GIFT_TOKENS for why the web is capped at all.
    if (!stepAllowedOnWeb(input.step)) return { ...NOTHING, reason: 'web-not-eligible' };
    if (alreadyPaid) return { ...NOTHING, reason: 'already-paid' };
    // 🔒 NO MOBILE (OTP) VERIFY → NO TOKEN ON THE WEB (admin 2026-09-26). A github link is free and
    // scriptable, so on the web it is EARNED when it happens but HELD, paid ₹0 and recorded as nothing,
    // until a real number is verified — the same anchor rule 3 puts under the referrer's money. The
    // `mobile` step carries that proof by definition (you cannot claim it without verifying), so it is
    // never itself held; claiming it is what later releases a waiting github. Recording nothing here is
    // load-bearing: a held step must stay claimable, so it is never written to `paidSteps`.
    if (!input.mobileVerified) return { ...NOTHING, reason: 'web-held-until-mobile' };
    const tokens = capWebGift(afterSelfCap, input.alreadyWebGiftedTokens);
    // Distinguish "the web's own ₹100 is spent" from "the whole ₹400 is spent": both pay ₹0, but they
    // are different facts, and the second is answered by `cap-reached` when the self-cap already bit.
    if (tokens <= 0) return { ...NOTHING, reason: afterSelfCap <= 0 ? 'cap-reached' : 'web-cap-reached' };
    return { tokens, reason: 'granted', recordStep: input.step, web: true };
  }

  // iOS and any unrecognised platform earn nothing here.
  return { ...NOTHING, reason: 'not-android' };
}

/** Everything B has earned so far, for the progress checklist. PURE — a view, never a payment. */
export function selfProgress(paidSteps: unknown, env: NodeJS.ProcessEnv = process.env): {
  step: RewardStep; claimed: boolean; tokens: number;
}[] {
  const paid = readSteps(paidSteps);
  const each = stepRewardTokens(env);
  return ALL_STEPS.map((step) => ({ step, claimed: paid.includes(step), tokens: each }));
}

// ── A's reward ───────────────────────────────────────────────────────────────────────────────────

export type ReferrerRewardReason =
  | 'granted'
  | 'held-until-mobile'   // earned, not yet payable — B has not verified a real number (rule 3)
  | 'nothing-owed'        // every eligible step of this friend has already been paid
  | 'cap-reached'         // this referrer has had their ₹1,500 lifetime
  | 'disabled';

export interface ReferrerReward {
  tokens: number;
  reason: ReferrerRewardReason;
  /** The friend's steps to record as PAID-TO-REFERRER, written with the credit in one transaction. */
  recordSteps: RewardStep[];
  /** What was owed before the lifetime cap trimmed it. Equal to `tokens` unless the cap bit. */
  owedBeforeCap: number;
}

/**
 * What the REFERRER is owed right now for one friend.
 *
 * Deliberately a RECONCILIATION over the friend's whole state rather than a per-event payment: it
 * asks "which of this friend's verifications has A not been paid for yet, and is the mobile in?" So
 * it is safe to call after ANY of B's steps, in any order, any number of times — the held email and
 * github rungs are released by the same call that pays for the mobile, and a repeat call pays zero.
 * An event-shaped API would have needed a separate release path, which is one more thing to forget.
 */
export function decideReferrerReward(input: {
  /** The friend's steps that were genuinely PAID to them — i.e. device-verified, not merely claimed. */
  friendPaidSteps: unknown;
  /** Which of this friend's steps the referrer has already been paid for. */
  alreadyPaidToReferrer: unknown;
  /** Tokens this referrer has EVER earned from referrals, across every friend. */
  referrerEarnedTokens: unknown;
  env?: NodeJS.ProcessEnv;
}): ReferrerReward {
  const env = input.env ?? process.env;
  // A FUNCTION, not a shared constant: every caller gets its own array. A single frozen literal
  // would have to be `readonly`, and a readonly array cannot satisfy `recordSteps` — but the real
  // reason is that a shared mutable array handed to several callers is a bug waiting to be written.
  const none = (reason: ReferrerRewardReason, owedBeforeCap = 0): ReferrerReward =>
    ({ tokens: 0, reason, recordSteps: [], owedBeforeCap });
  if (!referralRewardsEnabled(env)) return none('disabled');

  const friendPaid = readSteps(input.friendPaidSteps);
  const alreadyPaid = readSteps(input.alreadyPaidToReferrer);
  const pending = REFERRER_PAYING_STEPS.filter((s) => friendPaid.includes(s) && !alreadyPaid.includes(s));
  if (pending.length === 0) return none('nothing-owed');

  // RULE 3. The mobile is the gate for the whole friend, not just for its own ₹25 — so an account
  // that never verifies a number earns its referrer exactly nothing, however many other boxes it ticks.
  if (!friendPaid.includes('mobile')) return none('held-until-mobile');

  const per = referrerStepTokens(env);
  const owed = pending.length * per;

  const earnedRaw = Number(input.referrerEarnedTokens);
  const earned = Number.isFinite(earnedRaw) && earnedRaw > 0 ? Math.floor(earnedRaw) : 0;
  const room = referrerLifetimeCapTokens(env) - earned;
  if (room <= 0) return none('cap-reached', owed);

  // A PARTIAL payment still records EVERY step it was computed from. Otherwise the unpaid remainder
  // stays pending for ever and every later call re-offers it — a referrer parked at the cap would be
  // re-evaluated on every one of their friends' events, for nothing.
  // Two ceilings, answering different questions: `room` is this referrer's ₹1,500 LIFETIME cap across
  // everybody; `capReferrerPerFriend` is the ₹75 this ONE friend can ever be worth. Without the second,
  // raising REFERRER_STEP_TOKENS would raise the cost of acquiring one user past the admin's ₹475.
  //
  // ⚠️ The steps already paid for this friend are valued at TODAY's rate — the only figure this pure
  // function is given. So a rate that was RAISED since makes this OVER-state what was paid and pay
  // less; a rate that was lowered makes it under-state and pay slightly more, bounded by ₹75 either
  // way. Under-paying a referrer is a support message; passing the ₹475 ceiling is the thing the
  // admin said must not happen, so the error is left leaning that way deliberately.
  const paidForThisFriend = alreadyPaid.length * per;
  const tokens = capReferrerPerFriend(Math.min(owed, room), paidForThisFriend);
  if (tokens <= 0) return none('cap-reached', owed);
  return { tokens, reason: 'granted', recordSteps: pending, owedBeforeCap: owed };
}

// ── Attribution ──────────────────────────────────────────────────────────────────────────────────

export type AttributionReason =
  | 'attributed'
  | 'unknown-code'
  | 'self-referral'        // the same account, or the same DEVICE, on both sides
  | 'already-referred'     // attribution is one-time and immutable
  | 'not-new-user'         // admin: "agar b new user hai to, old ko never"
  | 'device-used'          // this handset has already been somebody's referred friend
  | 'not-android'
  | 'disabled';

export interface Attribution {
  ok: boolean;
  reason: AttributionReason;
}

/**
 * May this code be attributed to this new user?
 *
 * ⚠️ SELF-REFERRAL IS CHECKED ON THE DEVICE AS WELL AS THE ACCOUNT, and the account check alone is
 * the obvious version that does not work: accounts are free, so "my own second account on my own
 * phone" defeats it in thirty seconds. The device is the thing there is only one of.
 */
export function decideAttribution(input: {
  codeOwnerUserId: string | null | undefined;
  newUserId: string;
  /** The device asking now. */
  deviceId: string | null | undefined;
  /** Devices the CODE OWNER has been seen on. */
  referrerDeviceIds: unknown;
  /** True when this user already has a referrer. */
  alreadyReferred: boolean;
  /** True when this device has already been attributed to someone, on any account. */
  deviceAlreadyReferred: boolean;
  /** False for an account that existed before this device/app — "old ko never". */
  isNewUser: boolean;
  platform: 'android' | 'ios' | 'web' | string;
  env?: NodeJS.ProcessEnv;
}): Attribution {
  const env = input.env ?? process.env;
  if (!referralRewardsEnabled(env)) return { ok: false, reason: 'disabled' };
  if (input.platform !== 'android') return { ok: false, reason: 'not-android' };

  const owner = String(input.codeOwnerUserId ?? '').trim();
  if (!owner) return { ok: false, reason: 'unknown-code' };

  const newUser = String(input.newUserId ?? '').trim();
  if (owner === newUser) return { ok: false, reason: 'self-referral' };

  const device = String(input.deviceId ?? '').trim();
  const ownerDevices = (Array.isArray(input.referrerDeviceIds) ? input.referrerDeviceIds : [])
    .map((d) => String(d ?? '').trim())
    .filter(Boolean);
  if (device && ownerDevices.includes(device)) return { ok: false, reason: 'self-referral' };

  if (input.alreadyReferred) return { ok: false, reason: 'already-referred' };
  if (input.deviceAlreadyReferred) return { ok: false, reason: 'device-used' };
  if (!input.isNewUser) return { ok: false, reason: 'not-new-user' };

  return { ok: true, reason: 'attributed' };
}

/**
 * The line a user is shown when their code was not accepted.
 *
 * It reaches REAL people — a shared family handset, someone reinstalling, a friend who signed up
 * last week and only now got the code — so it never accuses anyone of anything and never implies the
 * account is in trouble, the discipline `claimRefusalMessage` already sets in `giftPlan.ts`.
 *
 * ⚠️ 'self-referral' and 'device-used' deliberately say the SAME thing. Distinguishing them would
 * tell someone probing the system exactly which marker caught them, which is the one piece of
 * information an abuser actually needs and an honest user never does.
 */
export function attributionRefusalMessage(reason: AttributionReason): string {
  switch (reason) {
    case 'unknown-code':
      return 'That referral code was not recognised. Check the spelling and try again.';
    case 'already-referred':
      return 'A referral code has already been applied to this account. It can only be used once.';
    case 'self-referral':
    case 'device-used':
      return 'This device has already used a referral code. The bonus is one per device.';
    case 'not-new-user':
      return 'Referral codes are for new accounts. Your account still earns every other bonus.';
    case 'not-android':
      return 'Referral codes are applied in the NavBharatAI Android app.';
    default:
      return 'Referral codes are not available right now.';
  }
}

// ── Is the step actually DONE? ───────────────────────────────────────────────────────────────────
//
// 🔴 THIS SECTION EXISTS BECAUSE THE FIRST VERSION OF THE CLAIM ROUTE DID NOT HAVE IT, and the gap
// was a ₹400 hole. `/claim` proved WHO was asking (the device) and WHETHER anything was owed (the
// paid-steps list) — and never asked whether the step had been completed at all. So any caller on a
// genuine Android phone could POST `step: "email"`, `step: "github"` and `step: "mobile"` without
// verifying a single one of them and collect the full ₹400 per device.
//
// The lesson, written down because it is the same one the store-purchase audit produced: **a claim
// is a request, not a fact.** The client is asking to be paid for something; only the server's own
// record of that something can settle it. Every proof below is read from FIREBASE's account record
// or from our own store — never from the request body, which is why none of these take one.

/** What the server independently knows about an account. Every field is a fact it looked up. */
export interface StepProof {
  /** Firebase says this mailbox is verified (a Google or GitHub sign-in implies it). */
  emailVerified: boolean;
  /** Firebase holds a verified phone number for this account. */
  phoneVerified: boolean;
  /** `github.com` is among the account's linked sign-in providers. */
  githubLinked: boolean;
  /** Our own store says a referral code was applied to this account. */
  hasReferrer: boolean;
}

/**
 * May this step be paid for at all?
 *
 * PURE, and deliberately total over the four steps rather than defaulting: a step with no proof rule
 * would otherwise be payable the moment somebody adds a fifth one, which is exactly how the original
 * hole would come back.
 */
export function stepIsProven(step: RewardStep, proof: StepProof): boolean {
  switch (step) {
    case 'email': return proof.emailVerified === true;
    case 'mobile': return proof.phoneVerified === true;
    case 'github': return proof.githubLinked === true;
    case 'referral-code': return proof.hasReferrer === true;
    default: return false;
  }
}

/** What the user is told when a step is not yet done. Actionable, never an accusation. */
export function stepNotDoneMessage(step: RewardStep): string {
  switch (step) {
    case 'email': return 'Verify your email address first, then claim this bonus.';
    case 'mobile': return 'Verify your mobile number first, then claim this bonus.';
    case 'github': return 'Connect your GitHub account first, then claim this bonus.';
    case 'referral-code': return 'Apply a friend’s referral code first, then claim this bonus.';
    default: return 'Complete this step first, then claim the bonus.';
  }
}

/** Is `github.com` linked? Kept here so the provider string is written down exactly once. */
export function githubIsLinked(providers: unknown): boolean {
  return Array.isArray(providers)
    && providers.some((p) => String(p ?? '').trim().toLowerCase() === 'github.com');
}

// ── The Earning screen: how far each referred friend has got ───────────────────────────────────────

/** One referred friend's progress on the three steps that pay THEIR referrer. */
export interface FriendStepStatus {
  mobile: boolean;
  email: boolean;
  github: boolean;
  /** 0–3. What the admin's "Earning" list actually shows next to each friend's name. */
  completedCount: number;
}

/**
 * How far a referred friend has got, for the referrer's own "who used my code" list.
 *
 * Deliberately reads the friend's own PAID steps — the exact signal `decideReferrerReward` pays
 * from — rather than asking Firebase again for a second opinion. A step only ever reaches
 * `paidSteps` after `stepIsProven` has confirmed it against the friend's real account, so "2 of 3
 * complete" here can never disagree with the ₹ the referrer has actually been paid for that friend.
 * PURE, like everything else in this module.
 */
export function friendVerificationStatus(paidSteps: unknown): FriendStepStatus {
  const paid = readSteps(paidSteps);
  const mobile = paid.includes('mobile');
  const email = paid.includes('email');
  const github = paid.includes('github');
  return { mobile, email, github, completedCount: [mobile, email, github].filter(Boolean).length };
}
