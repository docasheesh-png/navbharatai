import { AIRouterManager } from '../AI/AIRouterManager';
import { retrieveKnowledge, formatKnowledge } from './knowledge';
import { CREATOR_IDENTITY, recencyDirective } from '../lib/prompts';
import { liveSearchContext } from '../lib/liveSearchContext';
import {
  extractStudentMemory,
  formatStudentProfileBlock,
  mergeStudentProfile,
  studentMemoryLayer,
  type StudentProfile,
} from './studentProfile';
import { studentProfileStore } from './StudentProfileStore';
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
 * Assemble a professional's full system prompt: persona, the shared professional-persona
 * layer, disclaimer, the knowledge retrieved for this message, and the shared
 * creator-attribution instruction (so every professional credits Dr Asheesh and team
 * consistently). Pure — exported so the assembly (and the attribution injection) is
 * unit-testable.
 */
export function buildProfessionalSystemPrompt(config: ProfessionalConfig, kbBlock = '', memoryBlock = ''): string {
  // recencyDirective() anchors every professional to TODAY so none presents stale facts as current
  // (a lawyer must not cite a repealed rule as live, a CA a past year's slab as this year's, etc.).
  return [config.systemPrompt, PROFESSIONAL_PERSONA_LAYER, config.disclaimer, memoryBlock, kbBlock, recencyDirective(), CREATOR_IDENTITY]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Resilient model call for the professional universe — a two-tier ladder (admin 2026-07-09):
 *
 *   1. PROFESSIONAL-FREE first — the isolated single-provider universe holding only
 *      GLM-4.7-Flash ($0 in/out on Z.AI). A successful free answer fires ZERO paid
 *      provider calls. Inert when GLM_API_KEY is unset (healthCheck false), so behaviour
 *      then degrades to exactly the paid path below.
 *   2. PROFESSIONAL (paid) fallback — today's path, byte-for-byte unchanged: routeRaced
 *      fires Grok × Gemini × Vertex concurrently and uses Claude Haiku ONLY if all fail.
 *
 * Every config-driven professional — Teacher, Lawyer, CA, Astrologer, Kisan, … — shares
 * these isolated universes, never mixing routing state with FREE or PRO. (Doctor AI / SDA
 * has its own route and stays directly on the paid universe.)
 */
async function resilientCall(systemPrompt: string, prompt: string): Promise<string> {
  // Tier 1 — free (GLM-flash). Any failure/rate-limit/empty reply falls through silently.
  try {
    const freeRouter = AIRouterManager.getRouter('professional-free');
    const { response, telemetry } = await freeRouter.routeRaced(prompt, systemPrompt);
    if (telemetry.success && response.content?.trim()) return response.content;
  } catch { /* fall through to the paid universe */ }

  // Tier 2 — paid (unchanged): RACE(Grok × Gemini × Vertex) → Claude Haiku last resort.
  const router = AIRouterManager.getRouter('professional');
  const { response, telemetry } = await router.routeRaced(prompt, systemPrompt);
  if (telemetry.success && response.content?.trim()) return response.content;
  throw new Error('All AI providers failed for this professional.');
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
): Promise<string> {
  // Student-profile memory (Teacher AI): load what we remember about this user and
  // inject it + the memory behaviour layer. Anonymous users still get the day-one
  // introduction behaviour, but with an honest "cannot remember you" constraint.
  const memoryOn = config.memory === 'student_profile';
  let profile: StudentProfile | null = null;
  let memoryBlock = '';
  if (memoryOn) {
    if (verifiedUserId) profile = await studentProfileStore.load(verifiedUserId, config.id);
    memoryBlock = [studentMemoryLayer(!!verifiedUserId), formatStudentProfileBlock(profile)]
      .filter(Boolean)
      .join('\n\n');
  }

  const kbBlock = formatKnowledge(retrieveKnowledge(config.knowledge, message));
  const systemPrompt = buildProfessionalSystemPrompt(config, kbBlock, memoryBlock);

  const transcript = (history || [])
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'User' : config.name}: ${m.content}`)
    .join('\n');
  let prompt = transcript ? `Conversation so far:\n${transcript}\n\nUser: ${message}` : message;

  // Live web grounding: when the user's question needs current facts (latest rules/rates/results),
  // fold in real search results so the professional answers from today's data, not its training
  // cutoff. Gated + bounded + best-effort — never blocks the reply.
  try {
    const liveBlock = await liveSearchContext(message);
    if (liveBlock) prompt = `${liveBlock}\n\n---\n${prompt}`;
  } catch { /* live search is best-effort */ }

  const raw = await resilientCall(systemPrompt, prompt);

  // ALWAYS strip any <student_memory> block from what the user sees (even for
  // memory-off professionals / anonymous users — a leaked machine block must never
  // reach the chat). Persist the extracted facts only for a verified, memory-on user.
  const { reply, update } = extractStudentMemory(raw);
  if (memoryOn && verifiedUserId && update) {
    await studentProfileStore.save(verifiedUserId, config.id, mergeStudentProfile(profile ?? {}, update));
  }
  // reply is empty only when the model's ENTIRE output was machine blocks — never
  // fall back to raw there (that would leak the block into the chat).
  return reply || 'Noted! What would you like to learn next?';
}
