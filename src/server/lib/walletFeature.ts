// WHERE A USER'S BALANCE ACTUALLY WENT.
//
// ADMIN 2026-09-13, holding a real account: a user with **0 apps built** whose ₹250 of gifted credit
// had fallen to ₹54.94 — *"kaha khatam hua yeh to dikha hi nahi raha? … user ne 0 app banayi aur 250
// me se 200 ₹ khatam ho gaye aisa kaise ho sakta hai!"*
//
// 🔴 THE ROOT CAUSE, AND IT IS NOT A DISPLAY BUG. Money leaves a wallet down NINE different paths —
// a build, a publish, an APK, a remix purchase, a hosting plan, the daily hosting bill, voice, the
// Professionals/Doctor assistants, an app's own assistant — and every one of them wrote the same
// shapeless thing: a free-text `description` and, for all four assistant surfaces, ONE shared daily
// bucket labelled "NavBharatAI assistants". So the question "which feature spent this?" had no
// answer anywhere in the data. It was never recorded, which is why no screen could show it.
//
// This module is the vocabulary that fixes that. It is deliberately a CLOSED list: a free-text tag
// would drift into "chat", "Chat", "chat-turn" within a month and the totals would silently stop
// adding up — which is the same failure as having no tag at all, only harder to notice.
//
// 🔒 WHITE-LABEL LAW: these labels are USER-FACING (they become wallet-history lines), so every one
// is NavBharatAI's own name for its own feature. No vendor or model name may ever enter this file.

/** Every way money can leave a wallet. Closed on purpose — see the header. */
export const WALLET_FEATURES = [
  { id: 'build', label: 'App building' },
  { id: 'publish', label: 'Publishing an app' },
  { id: 'mobile-build', label: 'Android / iOS build' },
  { id: 'remix', label: 'App Store purchase' },
  { id: 'hosting-plan', label: 'Hosting plan' },
  { id: 'hosting', label: 'App hosting (daily)' },
  { id: 'doctor', label: 'Doctor AI' },
  { id: 'professionals', label: 'Professionals AI' },
  { id: 'tools', label: 'AI tools' },
  { id: 'app-assistant', label: "Your app's own assistant" },
  { id: 'api', label: 'Developer API' },
  { id: 'voice', label: 'Voice chat' },
  // Pro image generation (admin 2026-09-18). Its own row rather than folding into 'tools', because a
  // ₹2 fixed-price image is a different purchase from a metered tool run and a user checking "what
  // did I spend on images?" must be able to see it. Label is NavBharatAI's own name for it — the
  // model behind it may never appear here (white-label law; this file's header says so).
  { id: 'image-pro', label: 'Pro image generation' },
  { id: 'other', label: 'Other' },
] as const;

export type WalletFeature = typeof WALLET_FEATURES[number]['id'];

export function isWalletFeature(v: unknown): v is WalletFeature {
  return typeof v === 'string' && WALLET_FEATURES.some((f) => f.id === v);
}

/** The admin/user-facing name, or '' for anything unknown — never a raw id shown to a human. */
export function featureLabel(v: unknown): string {
  return WALLET_FEATURES.find((f) => f.id === v)?.label ?? '';
}

/**
 * The daily bucket an assistant charge rolls into.
 *
 * ⚠️ THE FEATURE IS PART OF THE KEY, and that one change is what restores attribution without adding
 * a single row to the ledger's real growth rate. The rollup exists because a row per turn would fill
 * a 500-entry ledger in a fortnight and push the user's own PURCHASE history off the end — bucketing
 * by day is what prevents that. Bucketing by day AND feature keeps the same protection (a handful of
 * rows a day at the very most) while making "which feature spent this?" answerable from the ledger
 * itself, rather than from a string somebody has to parse.
 */
export function featureRollupRef(feature: WalletFeature, nowMs: number): string {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : 0);
  return `ai_${d.toISOString().slice(0, 10)}_${feature}`;
}

/** One wallet-ledger row, narrowed to what this reads. Everything on it is untrusted. */
export interface LedgerRow {
  type?: unknown;
  feature?: unknown;
  description?: unknown;
  amountCoinsOrTokens?: unknown;
  moneySpent?: unknown;
  timestamp?: unknown;
  absorbedInr?: unknown;
}

export interface FeatureSpendRow {
  feature: WalletFeature;
  label: string;
  /** Rupees this feature took out of the wallet. */
  inr: number;
  tokens: number;
  /** How many ledger rows it came from (a daily bucket counts once — it is one row). */
  entries: number;
}

export interface WalletSpendBreakdown {
  rows: FeatureSpendRow[];
  totalInr: number;
  /**
   * Spend that carries NO feature tag.
   *
   * 🔒 REPORTED SEPARATELY, NEVER FOLDED INTO 'other'. Every row written before this vocabulary
   * existed is untagged, and quietly filing history under a real feature name would put a number on
   * the admin's screen that looks measured and is invented — the one failure this whole change exists
   * to end. "We did not record this" and "this was Doctor AI" must never look alike.
   */
  unattributedInr: number;
  unattributedEntries: number;
  /**
   * What NavBharatAI ATE on this wallet because the overdraft floor stopped the charge.
   *
   * 🔒 Shown to the admin, never to the user and never mixed into their total: it is our loss, not
   * their debt, and folding the two would make the platform's own bleeding invisible on the exact
   * screen built to judge it.
   */
  absorbedInr: number;
}

/**
 * The token↔rupee rate, RE-EXPORTED from the one place that owns it rather than restated here.
 *
 * ⚠️ My first version declared `= 100` locally with a comment saying it mirrored the real one. That
 * is the exact shape this repo has already paid for twice — a constant copied into a second file,
 * drifting one edit later, with nothing failing to show it. A breakdown computed from a stale rate
 * would disagree with the balance beside it on the same screen.
 */
import { TOKENS_PER_RUPEE as RATE } from './payments';
export { TOKENS_PER_RUPEE } from './payments';

/**
 * Add up what each feature took. PURE.
 *
 * Reads the TOKEN column, not `moneySpent`: a usage row records its rupees inside a human sentence
 * and carries `moneySpent: 0` (that field means money PAID IN, not spent), so a reader that trusted
 * it would report every user as having spent nothing — which is precisely what the admin's screen
 * did. Tokens are the unit the balance is actually kept in, so they cannot disagree with it.
 */
export function spendByFeature(ledger: readonly LedgerRow[] | null | undefined): WalletSpendBreakdown {
  const totals = new Map<WalletFeature, { tokens: number; entries: number }>();
  let unattributedTokens = 0;
  let unattributedEntries = 0;
  let absorbedInr = 0;

  for (const row of ledger ?? []) {
    if (!row || typeof row !== 'object') continue;
    const eaten = Number(row.absorbedInr);
    if (Number.isFinite(eaten) && eaten > 0) absorbedInr += eaten;
    // A CREDIT is not spending. Only a debit (negative tokens) is money leaving.
    const raw = Number(row.amountCoinsOrTokens);
    if (!Number.isFinite(raw) || raw >= 0) continue;
    const tokens = Math.abs(raw);
    if (tokens <= 0) continue;

    if (isWalletFeature(row.feature)) {
      const prev = totals.get(row.feature) ?? { tokens: 0, entries: 0 };
      totals.set(row.feature, { tokens: prev.tokens + tokens, entries: prev.entries + 1 });
    } else {
      unattributedTokens += tokens;
      unattributedEntries += 1;
    }
  }

  const inr = (tokens: number) => Math.round((tokens / RATE) * 100) / 100;

  const rows: FeatureSpendRow[] = [...totals.entries()]
    .map(([feature, v]) => ({ feature, label: featureLabel(feature), inr: inr(v.tokens), tokens: v.tokens, entries: v.entries }))
    .sort((a, b) => b.tokens - a.tokens || a.feature.localeCompare(b.feature));

  const attributedTokens = rows.reduce((sum, r) => sum + r.tokens, 0);

  return {
    rows,
    totalInr: inr(attributedTokens + unattributedTokens),
    unattributedInr: inr(unattributedTokens),
    unattributedEntries,
    absorbedInr: Math.round(absorbedInr * 100) / 100,
  };
}
