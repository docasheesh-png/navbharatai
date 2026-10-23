/**
 * NavBharatAI Chat — Final Master Plan (owner, 2026-10-24). Pure helpers + two tiny stores used by
 * runtime.ts. Every feature here is default ON with an env kill switch (see FreeChainFeatures).
 * Never logs prompts, keys or user text.
 */
import { LANGUAGE_RULE } from '../../AgentV3/systemPrompt';
import { CREATOR_IDENTITY, INDIA_TERRITORIAL_INTEGRITY, LINK_POLICY } from '../../lib/prompts';
import { freeChatModeGuide } from '../../lib/freeChatModeGuide';
import { FREE_ANSWER_ALL_RULES } from '../../lib/freeChatReplies';
import type { Firestore } from '../../lib/serverDb';
import { isPaidRung, type FreeChainConfig, type ProviderId } from './config';
import { normalizedCachePrompt } from './cache';
import { PAID_BUDGET_TIME_ZONE } from './spendCap';

// ── 1. Per-rung concurrency (in-process, per Cloud Run instance) ────────────────────────────────
const inFlight = new Map<ProviderId, number>();
/** True when a slot was taken; the caller MUST call releaseRungSlot exactly once afterwards. */
export function tryAcquireRungSlot(cfg: FreeChainConfig, id: ProviderId): boolean {
  if (!cfg.features.concurrency) return true;
  const limit = cfg.concurrency[id] ?? 0;
  if (!(limit > 0)) return true;
  const used = inFlight.get(id) ?? 0;
  if (used >= limit) return false;
  inFlight.set(id, used + 1); return true;
}
export function releaseRungSlot(cfg: FreeChainConfig, id: ProviderId): void {
  if (!cfg.features.concurrency || !((cfg.concurrency[id] ?? 0) > 0)) return;
  const used = inFlight.get(id) ?? 0;
  if (used <= 1) inFlight.delete(id); else inFlight.set(id, used - 1);
}
export function rungInFlight(id: ProviderId): number { return inFlight.get(id) ?? 0; }
export function resetRungSlotsForTests(): void { inFlight.clear(); }

// ── 2. Rule-based router (₹0, no AI classifier) ─────────────────────────────────────────────────
export type TurnRoute = 'fast' | 'quality' | 'normal';
export type RouteReason = 'short' | 'teaching' | 'medical' | 'long' | 'code-math' | 'repeat' | 'default' | 'throttled' | 'off';
const SHORT_RE = /^(hi+|hello|hey|hii+|ok+|okay|k|thanks?|thank you|thx|ty|dhanyavad|dhanyawad|shukriya|ji|haan|han|ha|nahi|no|yes|bye|good (morning|night|evening)|namaste|नमस्ते|धन्यवाद|शुक्रिया|हाँ|हां|ठीक है|ओके)[\s!.?।🙏👍]*$/iu;
const TEACHING_RE = /\b(exam|exams|syllabus|neet|jee|upsc|ssc|cbse|icse|board exam|mock test|question paper|homework|chapter|class \d+|padhai|padhna|samjhao|explain|teacher|tutor|notes)\b|परीक्षा|पढ़ाई|पढ़ाओ|समझाओ|अध्याय|सिलेबस|कक्षा/iu;
const MEDICAL_RE = /\b(dawa|dawai|davai|bimari|beemari|bukhar|dose|dosage|symptoms?|doctor|medicine|tablet|injection|disease|fever|treatment|ilaj|ilaaj)\b|दवा|दवाई|बीमारी|बुखार|डॉक्टर|इलाज|लक्षण|खुराक/iu;
const CODE_MATH_RE = /```|\b(function|class|const|def|import|SELECT|regex|algorithm|equation|integral|derivative|solve|calculate|prove)\b|[=+\-*/^]\s*\d|\d\s*[=+*/^]\s*\d|गणित|हल करो/iu;
function userTurns(history: unknown[]): string[] {
  return (history ?? []).filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter(m => m.sender === 'user' || m.role === 'user')
    .map(m => String(m.text ?? m.content ?? ''));
}
export interface RouteInput { message: string; history: unknown[]; teachingMode?: boolean; throttled?: boolean }
export function routeTurn(cfg: FreeChainConfig, input: RouteInput): { route: TurnRoute; reason: RouteReason } {
  if (!cfg.features.router) return { route: 'normal', reason: 'off' };
  const text = input.message.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const norm = normalizedCachePrompt(text);
  const repeated = !!norm && userTurns(input.history).slice(-3).some(t => normalizedCachePrompt(t) === norm);
  // Priority topics keep DeepSeek even under throttle (owner: Teacher/medical first).
  if (input.teachingMode || TEACHING_RE.test(text)) return { route: 'quality', reason: 'teaching' };
  if (MEDICAL_RE.test(text)) return { route: 'quality', reason: 'medical' };
  const wantsQuality: RouteReason | null = repeated ? 'repeat' : estimateTokensRough(text) > 300 ? 'long' : CODE_MATH_RE.test(text) ? 'code-math' : null;
  if (wantsQuality) return input.throttled ? { route: 'normal', reason: 'throttled' } : { route: 'quality', reason: wantsQuality };
  if (words > 0 && words < 5 && SHORT_RE.test(text)) return { route: 'fast', reason: 'short' };
  return { route: 'normal', reason: 'default' };
}
function estimateTokensRough(text: string): number { return Math.ceil(Buffer.byteLength(text, 'utf8') / 4); }
/** The quality model is the DeepInfra DeepSeek-V4-Flash rung (then the paid backups). */
export const QUALITY_RUNG: ProviderId = 'dsv4flash';
/**
 * Re-orders the per-user order for a route. Quality puts DeepSeek first and skips free + 8B; fast
 * drops the DeepSeek rungs. The caller falls back to the plain order when no rung in the routed order
 * is usable (e.g. keys not yet in Cloud Run), so routing can never turn a reply into an error.
 */
export function orderForRoute(order: ProviderId[], route: TurnRoute): ProviderId[] {
  if (route === 'quality') {
    if (!order.includes(QUALITY_RUNG)) return order;
    return [QUALITY_RUNG, ...order.filter(id => isPaidRung(id) && id !== QUALITY_RUNG && id !== 'llama8b')];
  }
  if (route === 'fast') return order.filter(id => id !== QUALITY_RUNG && id !== 'deepseek');
  return order;
}
/** Reasoning models spend hidden tokens; a 250-token cap would empty them, so they keep their own cap. */
const REASONING_RUNGS: ReadonlySet<ProviderId> = new Set<ProviderId>(['groq', 'gpt5nano', 'openrouter']);
export function effectiveMaxOutput(cfg: FreeChainConfig, id: ProviderId, rungMax: number, route: TurnRoute): number {
  if (!cfg.features.outputCap || REASONING_RUNGS.has(id)) return rungMax;
  return Math.min(rungMax, route === 'fast' ? cfg.features.fastMaxTokens : cfg.features.replyMaxTokens);
}

// ── 3. History trimming ─────────────────────────────────────────────────────────────────────────
export function trimHistory(cfg: FreeChainConfig, history: unknown[]): unknown[] {
  if (!cfg.features.historyTrim || !Array.isArray(history)) return history;
  const turns = cfg.features.historyTurns;
  return turns <= 0 ? [] : history.slice(-turns);
}

// ── 4. Stable prefix (prompt caching) + compact prompt ──────────────────────────────────────────
const CORE_START = "You are NavBharatAI — India's own friendly AI companion";
const CORE_END = 'Safety rule: never infer religion, caste, political views, or social identity from any greeting';
const PROFILE_RE = /\nUSER PROFILE \(use naturally[^\n]*\n(?:[^\n]+\n)*/u;
const SESSION_RE = /ONCE-PER-SESSION GREETING RULE \(ABSOLUTE\):\n[^\n]*/u;
const RECENCY_RE = /CURRENT DATE & RECENCY \(MANDATORY\):[\s\S]*?(?=\n\n|$)/u;
/**
 * ~1k-token core used instead of the ~3k free core. Keeps every safety/limit rule: language mirror,
 * no code in free chat, no identity inference, Pro for app requests, no rival builders, no memory talk.
 */
export function compactCore(answerAll: boolean): string {
  return `You are NavBharatAI — India's own friendly AI companion (by NavBharat team).
${LANGUAGE_RULE}

STYLE: warm, respectful, culturally aware Indian friend; crisp and accurate; match the user's mood. Use जी/ज़रूर naturally and sparingly. Never repeat the same opener. Never mention memory or profile.
GREETINGS: if the user greets, reply once with the SAME greeting style (राम-राम → राम-राम!, नमस्ते → नमस्ते!, Salam → वअलैकुम अस्सलाम!, Sat Sri Akal → सत श्री अकाल जी!, Hi → Hi!). A direct question gets NO greeting — just the answer.
${answerAll ? FREE_ANSWER_ALL_RULES : `APP REQUESTS: you do not build apps here. For an app/website request, warmly recommend **NavBharatAI Pro** first (describe the app in any language; it plans, builds, previews and ships it), then add brief tips. Never recommend rival app builders or "hire a developer".`}

HARD LIMITS:
• Do NOT generate code or HTML/CSS/JS in this free chat.
• Answer quality is always the top priority — personalization must never reduce quality
• Safety rule: never infer religion, caste, political views, or social identity from any greeting`;
}
/**
 * Moves per-user/per-day parts (profile, session greeting, date) AFTER the static instructions so the
 * provider's automatic prompt cache sees an identical prefix on every turn. Unknown prompt shapes are
 * returned unchanged (safe no-op).
 */
export function preparedSystemPrompt(cfg: FreeChainConfig, system: string): string {
  const { stablePrefix, compactPrompt } = cfg.features;
  if (!stablePrefix && !compactPrompt) return system;
  const start = system.indexOf(CORE_START); const endAt = system.indexOf(CORE_END);
  if (start !== 0 || endAt < 0) return system;
  const coreEnd = endAt + CORE_END.length;
  let core = system.slice(0, coreEnd); let rest = system.slice(coreEnd);
  const dynamic: string[] = [];
  const take = (re: RegExp, from: 'core' | 'rest') => {
    const src = from === 'core' ? core : rest; const m = re.exec(src); if (!m) return;
    dynamic.push(m[0].trim());
    if (from === 'core') core = src.replace(m[0], '\n'); else rest = src.replace(m[0], '');
  };
  if (stablePrefix || compactPrompt) { take(PROFILE_RE, 'core'); take(SESSION_RE, 'core'); }
  if (compactPrompt) core = compactCore(core.includes('ANSWER EVERY MESSAGE (MANDATORY)'));
  if (!stablePrefix) return [core, rest.trim(), ...dynamic].filter(Boolean).join('\n\n');
  take(RECENCY_RE, 'rest');
  const statics: string[] = [];
  for (const s of [freeChatModeGuide(), CREATOR_IDENTITY, INDIA_TERRITORIAL_INTEGRITY, LINK_POLICY]) {
    if (s && rest.includes(s)) { rest = rest.replace(s, ''); statics.push(s); }
  }
  const middle = rest.replace(/\n{3,}/g, '\n\n').trim();
  return [core.replace(/\n{3,}/g, '\n\n'), ...statics, middle, ...dynamic].filter(Boolean).join('\n\n');
}

// ── 5. FAQ response cache eligibility (no personal data) ────────────────────────────────────────
const PII_RE = /[\w.+-]+@[\w-]+\.[\w.]+|\d{5,}|\b(my name|mera naam|meri|mera|mere|mujhe|main|i am|i'm|my|me)\b|मेरा|मेरी|मेरे|मुझे|मैं|password|otp|aadhaar|aadhar|pan card|account|address|pata|phone|mobile/iu;
const TIME_SENSITIVE_RE = /\b(today|aaj|abhi|now|latest|current|news|price|rate|score|weather|mausam|live|kal|yesterday|tomorrow|202\d)\b|आज|अभी|ताज़ा|खबर|मौसम|कीमत|भाव/iu;
/** Exact normalized match only; history-free, public-style questions without personal or dated content. */
export function faqCacheable(message: string): boolean {
  const norm = normalizedCachePrompt(message);
  return norm.length >= 3 && norm.length <= 200 && !PII_RE.test(norm) && !TIME_SENSITIVE_RE.test(norm);
}

// ── 6. Monthly paid cap (IST calendar month) ────────────────────────────────────────────────────
export function monthKey(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: PAID_BUDGET_TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(new Date(now));
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}
function monthRef(db: Firestore, month: string) { return db.collection('free_chat_chain').doc('state').collection('paid_month').doc(month); }
/** Holds `amount` against the month; false when it would cross the cap or storage is unavailable (fail closed). */
export async function reserveMonthly(db: Firestore, capNanoUsd: number, amount: number, now = Date.now()): Promise<string | null> {
  const month = monthKey(now);
  try {
    const ref = monthRef(db, month);
    return await db.runTransaction(async tx => {
      const d = (await tx.get(ref)).data() ?? {};
      const held = Number.isSafeInteger(d.heldNanoUsd) ? d.heldNanoUsd : 0; const spent = Number.isSafeInteger(d.spentNanoUsd) ? d.spentNanoUsd : 0;
      if (held + spent + amount > capNanoUsd) return null;
      tx.set(ref, { heldNanoUsd: held + amount, spentNanoUsd: spent, updatedAt: now }, { merge: true });
      return month;
    });
  } catch { return null; }
}
/** Converts a hold into actual spend. Unknown actual cost keeps the full hold as spend (conservative). */
export async function settleMonthly(db: Firestore, month: string, held: number, actual: number | null, now = Date.now()): Promise<void> {
  try { const ref = monthRef(db, month);
  await db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() ?? {};
    const h = Number.isSafeInteger(d.heldNanoUsd) ? d.heldNanoUsd : 0; const s = Number.isSafeInteger(d.spentNanoUsd) ? d.spentNanoUsd : 0;
    tx.set(ref, { heldNanoUsd: Math.max(0, h - held), spentNanoUsd: s + (actual ?? held), updatedAt: now }, { merge: true });
  }); } catch { /* best-effort; the daily cap remains the hard stop */ }
}
export async function monthlySnapshot(db: Firestore, now = Date.now()): Promise<{ month: string; heldNanoUsd: number; spentNanoUsd: number } | null> {
  const month = monthKey(now);
  try { const d = (await monthRef(db, month).get()).data() ?? {}; return { month, heldNanoUsd: Number(d.heldNanoUsd) || 0, spentNanoUsd: Number(d.spentNanoUsd) || 0 }; } catch { return null; }
}
