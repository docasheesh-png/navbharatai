// EVERY MESSAGE IS CHECKED — AND ALMOST EVERY MESSAGE LEAVES NO TRACE.
//
// ADMIN 2026-09-12: "Prompt par turant jaanch, chat padhe bina. BLOCK — saaf illegal, mana karo,
// record karo. FLAG — shak hai, chalne do, par record rakho. ALLOW — 99.9% cases, kuch bhi store
// nahi hota." Phase 6, the last of the agreed safety plan.
//
// ── WHY THIS SHAPE, AND NOT A CHAT BROWSER ───────────────────────────────────────────────────────
// The admin's worry was real — a platform can be shut down for what its users do on it — but the
// instinctive answer ("let me read the chats") is the weakest available tool: nobody can read
// thousands of conversations, by the time you read one the app is published, and our own Privacy
// Policy tells every user that team access is limited to what running the service requires.
//
// So the check happens at the MOMENT a message arrives, automatically, with no human reading
// anything — and the ONLY messages that leave a trace are the ones the check itself objected to. A
// clean conversation costs one regex pass and stores not a single byte. That is both the stronger
// safety posture and the smaller privacy footprint, which is unusual and worth stating plainly.
//
// ── 🔒 THE CATEGORIES ARE NOT DUPLICATED ─────────────────────────────────────────────────────────
// The subjects come from `ILLEGAL_RULES` — the same list the PUBLISH scanner uses (Phase 5). A
// second copy of "what counts as a weapon" would drift, and the drifting one would be the one that
// missed something. What differs is the CONTEXT: a published page IS the shop ("discreet shipping"),
// while a prompt ASKS for one ("build me an app that sells…"). So this pairs the shared subjects
// with request-intent, and also honours each rule's own context for a prompt that simply pastes the
// page it wants.
//
// ── 🔒 AND THE VERDICT IS NEVER A GUESS ──────────────────────────────────────────────────────────
// `allow` is the default and the answer to anything unclear. A checker that blocks when unsure
// would, on this platform, mean refusing to build somebody's school app because it mentions
// children — which is how a safety feature becomes the thing everyone wants switched off.
//
// PURE + deterministic + bounded. No model call, so the 99.9% path costs nothing at all.

import { ILLEGAL_RULES, type PublishContentClass } from '../AgentV3/illegalContentRules';
import { redactSecrets, redactPII } from '../AgentV3/SecretRedactor';

export type SafetyVerdict = 'allow' | 'flag' | 'block';

export interface PromptTriage {
  verdict: SafetyVerdict;
  /** The rule that fired, e.g. `CSAM_SIGNAL`. '' when allowed. */
  ruleId: string;
  /** Which class the rule belongs to. 'general' when allowed. */
  contentClass: PublishContentClass;
  /** What an admin reads. '' when allowed. */
  description: string;
}

export const ALLOWED: PromptTriage = { verdict: 'allow', ruleId: '', contentClass: 'general', description: '' };

/** How much of a message is examined. A prompt is short; a pasted document is not. */
export const PROMPT_SCAN_CAP = 100_000;


/**
 * Triage one message. PURE.
 *
 * BLOCK needs the subject AND the rule's own context — the prompt describing the offending thing
 * itself. FLAG is the subject AND a request to build it: real enough to record, ambiguous enough
 * that refusing would sometimes be wrong, so the turn proceeds and a human decides later.
 */
export function triagePrompt(text: string | null | undefined): PromptTriage {
  const body = String(text ?? '').slice(0, PROMPT_SCAN_CAP);
  if (!body.trim()) return ALLOWED;

  let flagged: PromptTriage | null = null;

  for (const rule of ILLEGAL_RULES) {
    if (!rule.subject.test(body)) continue;

    // The prompt carries the offending thing itself — the same pairing the publish scanner blocks on.
    if (rule.context.test(body)) {
      if (rule.contentClass === 'illegal') {
        return { verdict: 'block', ruleId: rule.id, contentClass: 'illegal', description: rule.description };
      }
      // Lawful adult content asked for in a message is not a refusal — the +18 setting governs where
      // it may go, and that decision is made at PUBLISH, not here.
      flagged ??= { verdict: 'flag', ruleId: rule.id, contentClass: 'adult', description: rule.description };
      continue;
    }

    /**
     * Subject + the rule's own ILLICIT-PURPOSE signal — worth recording, not worth refusing on.
     *
     * 🔴 This used to be "subject + any request verb", which on an APP BUILDER means every message,
     * and so was a single-signal rule wearing a pair's clothes. It flagged a school attendance app,
     * a pharmacy listing, a de-addiction helpline and a chemistry lesson. See `intent` in
     * illegalContentRules.ts; a rule with no honest purpose signal (CSAM) has none and never reaches
     * this tier at all — for that one, subject + context is already the whole test.
     */
    if (rule.contentClass === 'illegal' && rule.intent?.test(body)) {
      flagged ??= { verdict: 'flag', ruleId: rule.id, contentClass: 'illegal', description: rule.description };
    }
  }

  return flagged ?? ALLOWED;
}

/** Where the message came from, so a reviewer knows what they are looking at. */
export type SafetySurface = 'build' | 'chat' | 'assistant';

/** How much of a flagged message is kept. Enough to judge, far too little to be a transcript. */
export const EXCERPT_MAX = 300;

/**
 * The excerpt stored on a flagged message.
 *
 * 🔒 SECRETS AND PERSONAL IDENTIFIERS ARE STRIPPED FIRST. A flagged prompt is still somebody's
 * message, and it may contain an API key they pasted or a phone number — none of which is the reason
 * it was flagged, and all of which would then sit in a Firestore document for 180 days. The same
 * redaction the logs and the learning system already pass through.
 *
 * Bounded HARD, because "enough context to judge" and "a copy of the conversation" are different
 * things and only the first one is defensible.
 */
export function safetyExcerpt(text: string | null | undefined): string {
  const raw = String(text ?? '').slice(0, EXCERPT_MAX * 4);
  if (!raw.trim()) return '';
  try {
    return redactPII(redactSecrets(raw)).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX);
  } catch {
    // If redaction itself fails, store NOTHING rather than an unredacted excerpt. The rule id and
    // the verdict still reach the admin; the message does not.
    return '';
  }
}

/** What the blocked user reads. Names no rule and no pattern — that is a tuning guide for the next try. */
export function blockMessage(): string {
  return 'NavBharatAI cannot help with this request. It falls under the Acceptable Use rules in our '
    + 'Terms of Service. If you believe this is a mistake, our Grievance Redressal page has the address '
    + 'to write to and the time we must answer within.';
}
