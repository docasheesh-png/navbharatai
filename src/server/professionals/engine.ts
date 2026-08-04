import { callProfessionalAIWithUsage, type ProfessionalAnswer } from '../lib/professionalRouting';
import type { ChatTurnUsage } from '../lib/chatSpend';
import { retrieveKnowledge, formatKnowledge } from './knowledge';
import { CREATOR_IDENTITY, recencyDirective, INDIA_TERRITORIAL_INTEGRITY } from '../lib/prompts';
import { liveSearchContext } from '../lib/liveSearchContext';
import {
  extractMemory,
  formatProfileBlock,
  mergeProfile,
  memoryLayer,
  sanitizeUpdate,
  type ClientProfile,
} from './clientMemory';
import { clientProfileStore } from './ClientProfileStore';
import { retrieveMemoryBlock, rememberTurn } from '../memory/conversationMemory';
import { AppContextInjector } from '../AppContext/AppContextInjector';
import type { ProfessionalConfig } from './types';

export interface ProfessionalTurn { role: 'user' | 'assistant'; content: string; }

/**
 * The shared PROFESSIONAL PERSONA LAYER (admin 2026-07-09): every config-driven
 * professional must FEEL like a real practitioner in conversation — the way Doctor AI
 * does — not like a generic chatbot wearing a label. Defined ONCE here and injected by
 * buildProfessionalSystemPrompt, so all 73+ professionals inherit it and it can never
 * drift per-config (root-cause rule: fix the class, not 73 instances).
 */
export const PROFESSIONAL_PERSONA_LAYER = `HOW TO BEHAVE LIKE A REAL PROFESSIONAL (applies on top of your persona above):
- CONSULT, don't just answer. When key facts are missing for meaningful advice, first ask 1–2 short clarifying questions the way a real practitioner would in a consultation (a doctor asks "since when?", a CA asks "which financial year?", a lawyer asks "which state, and is anything in writing?"). If the question is simple, answer directly — do not interrogate.
- SPEAK like a seasoned practitioner of YOUR field: use its natural vocabulary (explain any jargon in one phrase), refer to how things actually work in practice, and mention concrete tools/forms/steps of the trade where relevant.
- STRUCTURE substantive advice like a professional consultation: first briefly reflect back the situation as you understood it, then the realistic options with trade-offs, then your clear recommendation, then the immediate next steps.
- REMEMBER the conversation: refer back to what the user told you earlier ("since you mentioned..."), and never re-ask something already answered.
- BE warm, confident and unhurried — the tone of an experienced professional who has seen this case many times, never robotic or listicle-cold. Reply in the user's language (Hindi/Hinglish/regional) when they use it.
- STAY honest like a real professional: say plainly when something is outside your scope or needs an in-person expert, and never invent facts, laws, dosages, or figures.`;

/**
 * The shared EXPERT METHOD LAYER (admin 2026-07-16: "deeper capabilities for EVERY profession,
 * not just Teacher"). The persona layer above governs TONE/behaviour; this governs DEPTH — it
 * makes every professional work a problem like a genuine top expert with a real method, not a
 * chatbot that gives the first generic answer. Defined ONCE so all 73 professionals inherit the
 * same rigor and it can never drift (root-cause rule). A per-config `method` adds the field's
 * own signature method on top of this.
 */
export const EXPERT_METHOD_LAYER = `HOW A TOP EXPERT IN YOUR FIELD ACTUALLY WORKS (bring this depth to every substantive answer):
- GO DEEP, not surface-level. Give the answer a seasoned expert would give — not the first generic thing anyone could say. Draw on your field's real frameworks, standards, best practices and hard-won edge cases, and name the principle/framework when it helps the user trust and remember it.
- DIAGNOSE the real need first. Look past the literal question to the underlying goal or root cause and solve THAT. If the user is heading toward a common mistake, flag it kindly before answering.
- WORK IT THROUGH like a professional: reason step by step so the user sees WHY, not just WHAT — the method, the trade-offs, and the assumptions you're making.
- Make it ACTIONABLE and complete: a clear recommendation, then concrete step-by-step next actions they can take now, the pitfalls/red-flags to avoid, and how they'll know it worked. Offer a simple checklist, template, plan, or worked example whenever it makes the advice usable.
- Make it STICK: end with a short, memorable takeaway (a rule of thumb, one-line summary, or mental model) so the insight carries forward — and, where useful, check they've understood.
- Be PROACTIVE like an expert who cares: anticipate the likely next question, surface a risk they didn't ask about, and suggest the sensible next step.
- MATCH depth to the need: a small question gets a crisp expert answer; a big or important one earns the full method. Depth means substance, never padding.
- Stay HONEST at expert level: separate what's established from your judgement, say when something needs an in-person professional or up-to-date verification, and never fabricate specifics.`;

/**
 * Assemble a professional's full system prompt: persona, the shared professional-persona
 * layer, disclaimer, the knowledge retrieved for this message, and the shared
 * creator-attribution instruction (so every professional credits Dr Asheesh and team
 * consistently). Pure — exported so the assembly (and the attribution injection) is
 * unit-testable.
 */
export function buildProfessionalSystemPrompt(config: ProfessionalConfig, kbBlock = '', memoryBlock = ''): string {
  // recencyDirective() anchors every professional to TODAY so none presents stale facts as current
  // (a lawyer must not cite a repealed rule as live, a CA a past year's slab as this year's, etc.).
  // config.method (the field's signature method) sits right after the persona so its domain rigor
  // is prominent; EXPERT_METHOD_LAYER gives every professional expert depth even without a bespoke method.
  const methodBlock = config.method ? `YOUR SIGNATURE METHOD (${config.name}) — follow it whenever you do your core work:\n${config.method}` : '';
  return [config.systemPrompt, methodBlock, PROFESSIONAL_PERSONA_LAYER, EXPERT_METHOD_LAYER, config.disclaimer, memoryBlock, kbBlock, recencyDirective(), INDIA_TERRITORIAL_INTEGRITY, CREATOR_IDENTITY]
    .filter(Boolean)
    .join('\n\n');
}

/** Which model chain a professional turn may use, decided by the caller's billing tier. */
export type ProfessionalTier = 'free' | 'paid';

/**
 * Resilient model call for the professional universe — tier-aware (admin 2026-07-15). BOTH tiers lead
 * with GLM-4.7-Flash ($0 on Z.AI) so a successful free answer fires ZERO paid calls and paid margin
 * stays high. The tiers differ ONLY in the FALLBACK when GLM fails/rate-limits:
 *
 *   • FREE tier  → PROFESSIONAL-FREE-FALLBACK = Vertex only (cheap Gemini). NEVER Grok / direct Gemini
 *     / Claude — a free user must never trigger the pricier paid providers (cost policy).
 *   • PAID tier  → PROFESSIONAL = RACE(Grok × Gemini × Vertex) → Claude Haiku last resort. The ₹99/mo
 *     Pass buys the full-quality, never-fail chain.
 *
 * Every config-driven professional shares these isolated universes, never mixing routing state with
 * FREE or PRO. (Doctor AI / SDA has its own route.)
 */
// The resilient chain now lives in the SHARED professionalRouting module, so the Other-AI tools call
// the exact same engine (admin 2026-07-24) with zero drift. This thin wrapper keeps the callers here
// unchanged and preserves the professional-specific error message.
async function resilientCall(systemPrompt: string, prompt: string, tier: ProfessionalTier): Promise<ProfessionalAnswer> {
  try {
    return await callProfessionalAIWithUsage(systemPrompt, prompt, tier);
  } catch {
    throw new Error('All AI providers failed for this professional.');
  }
}

/**
 * Run one professional chat turn: ground the persona in the config's knowledge
 * base (retrieved for this message), fold in the user's remembered profile (for
 * memory-enabled professionals like Teacher AI) and recent conversation, call a
 * model resiliently, and return the reply. History format is normalised here, so
 * provider history-shape quirks can never break it.
 *
 * `verifiedUserId` MUST come from a verified Firebase token (never a client-claimed
 * body field) — it keys the persistent profile, so trusting the client would let
 * anyone read another user's remembered facts through the persona's replies.
 */
export async function runProfessionalChat(
  config: ProfessionalConfig,
  message: string,
  history: ProfessionalTurn[] = [],
  verifiedUserId?: string,
  tier: ProfessionalTier = 'paid',
): Promise<string> {
  const { reply } = await runProfessionalChatWithUsage(config, message, history, verifiedUserId, tier);
  return reply;
}

/** One professional turn, with what the model call cost — see ProfessionalAnswer / chatSpend.ts. */
export interface ProfessionalChatResult {
  reply: string;
  spend: ChatTurnUsage;
}

/**
 * The same turn as runProfessionalChat, keeping the cost instead of discarding it.
 *
 * The wallet is one currency now (aiTurnCharge.ts): a professional answer draws from the same balance
 * a build does, so the route needs to know what the turn cost. The text-only wrapper above keeps every
 * other caller unchanged.
 */
export async function runProfessionalChatWithUsage(
  config: ProfessionalConfig,
  message: string,
  history: ProfessionalTurn[] = [],
  verifiedUserId?: string,
  tier: ProfessionalTier = 'paid',
): Promise<ProfessionalChatResult> {
  // Per-user memory (memory-enabled professionals): load what we remember about this
  // user and inject it + the memory behaviour layer. Anonymous users still get the
  // introduction behaviour, but with an honest "cannot remember you" constraint.
  const memory = config.memory;
  let profile: ClientProfile | null = null;
  let memoryBlock = '';
  if (memory) {
    if (verifiedUserId) profile = await clientProfileStore.load(verifiedUserId, config.id);
    memoryBlock = [memoryLayer(!!verifiedUserId, memory), formatProfileBlock(profile, memory)]
      .filter(Boolean)
      .join('\n\n');
  }

  const kbBlock = formatKnowledge(retrieveKnowledge(config.knowledge, message));
  let systemPrompt = buildProfessionalSystemPrompt(config, kbBlock, memoryBlock);
  // Every professional also offers our support email when the user has an app/account/service problem
  // (domain surface → only the unambiguous CORE signals, so a legal/health/domain "problem" never
  // triggers an off-topic support pitch). Same shared trigger + message every other AI uses.
  const supportOffer = AppContextInjector.getSupportOffer(message, 'professional');
  if (supportOffer) systemPrompt = `${systemPrompt}\n\n${supportOffer}`;

  // Remember more of the conversation (admin 2026-07-15: grow memory) and DE-DUPLICATE it so the same
  // question/answer can never appear twice in one session (admin: "ek question ek session me double na
  // ho") — a resend, retry, or restore can otherwise repeat a turn and make the professional re-ask.
  const dedupedHistory: ProfessionalTurn[] = [];
  for (const m of history || []) {
    const content = (m?.content || '').trim();
    if (!content) continue;
    if (dedupedHistory.some((p) => p.role === m.role && p.content.trim() === content)) continue; // drop exact repeats
    dedupedHistory.push(m);
  }
  const recentTurns = dedupedHistory.slice(-20);
  const transcript = recentTurns
    .map((m) => `${m.role === 'user' ? 'User' : config.name}: ${m.content}`)
    .join('\n');
  let prompt = transcript ? `Conversation so far:\n${transcript}\n\nUser: ${message}` : message;

  // Semantic memory (RAG, admin 2026-07-17): recall past turns that are SEMANTICALLY relevant to this
  // message but have slid out of the recent-history window above — so the professional remembers things
  // said long ago, not just the last 20 turns. Gated + best-effort (does nothing unless SEMANTIC_MEMORY
  // is on, an embedding key exists, and the user is signed in); `recentTurns` are excluded so nothing the
  // prompt already shows is re-injected. Never blocks/breaks the reply.
  try {
    const memoryScope = `professional:${config.id}`;
    const recalled = await retrieveMemoryBlock(verifiedUserId, memoryScope, message, recentTurns.map((m) => m.content));
    if (recalled) prompt = `${recalled}\n\n---\n${prompt}`;
  } catch { /* semantic recall is best-effort */ }

  // Live web grounding: when the user's question needs current facts (latest rules/rates/results),
  // fold in real search results so the professional answers from today's data, not its training
  // cutoff. Gated + bounded + best-effort — never blocks the reply.
  try {
    const liveBlock = await liveSearchContext(message);
    if (liveBlock) prompt = `${liveBlock}\n\n---\n${prompt}`;
  } catch { /* live search is best-effort */ }

  const { content: raw, spend } = await resilientCall(systemPrompt, prompt, tier);

  // ALWAYS strip any memory block from what the user sees (even for memory-off
  // professionals / anonymous users — a leaked machine block must never reach the
  // chat). Persist the extracted facts only for a verified, memory-on user, and only
  // after validating them against THIS professional's declared fields.
  const { reply, raw: rawUpdate } = extractMemory(raw);
  if (memory && verifiedUserId && rawUpdate) {
    const update = sanitizeUpdate(rawUpdate, memory.fields);
    if (update) {
      await clientProfileStore.save(verifiedUserId, config.id, mergeProfile(profile ?? {}, update, memory.fields));
    }
  }
  // Semantic memory ingest (RAG): remember this turn (the user's message + the cleaned reply) so a
  // future, semantically-related question recalls it even after it leaves the recent window. Gated +
  // best-effort; awaited so a serverless instance isn't torn down mid-write, but it never throws.
  try {
    await rememberTurn(verifiedUserId, `professional:${config.id}`, message, reply);
  } catch { /* best-effort */ }

  // reply is empty only when the model's ENTIRE output was machine blocks — never
  // fall back to raw there (that would leak the block into the chat).
  return { reply: reply || 'Noted! What would you like to learn next?', spend };
}
