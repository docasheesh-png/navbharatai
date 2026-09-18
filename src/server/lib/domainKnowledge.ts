// WHAT KIND OF APP IS THIS, AND WHAT DOES THIS KIND OF APP USUALLY NEED?
//
// 🔴 THE ADMIN'S OBJECTION THAT PRODUCED THIS FILE (2026-09-18, verbatim): *"kya ham app ka store bana
// rahe hai… jo aap pre-define karoge wohi NavBharatAI bana payega? hame to app generator banana tha na?"*
//
// They were right about the SMELL, and the honest answer had two halves. NavBharatAI is a real
// generator — a `general` verdict injects nothing and the app builds from the user's own words, which
// is why a calculator, a stopwatch and a photoshop-like image editor all build today. But the
// KNOWLEDGE layer was a hand-written list of sixteen domains, so a hospital app got RBAC, an audit
// trail and EMR privacy while a **mandir donation app**, a **machhli-palan tracker** and a **shaadi
// card designer** got nothing at all. Not a ceiling on what can be BUILT; a very real ceiling on who
// gets HELPED — and one that grew by a code change per domain. That is store-shaped, and the admin
// spotted it one day after I had made the list longer instead of asking why it was a list.
//
// 🔑 THE FIX IS NOT A BIGGER LIST. A model already knows what a temple donation app needs, what a
// fish-farm tracker needs, what a cattle-feed calculator needs. So the knowledge is GENERATED for the
// domains nobody enumerated, and the enumerated ones keep the deterministic answer they already have.
//
// 💸 **THE LIST IS ASKED FIRST AND A MODEL IS ASKED ONLY WHEN IT COMES BACK EMPTY.** This is the whole
// cost design, and it is what makes "kharcha kam se kam" and "har app ko madad" the same change rather
// than opposed ones:
//   • one of the sixteen known domains ⇒ **zero calls, zero cost, byte-identical to today**;
//   • a prompt too thin to HAVE a domain ("a calculator", "ek stopwatch banao") ⇒ **no call either** —
//     asking a model what a calculator needs spends money to be told nothing;
//   • everything else — the long tail this exists for ⇒ ONE call on the FREE chain (glm-flash led, ₹0),
//     raced, bounded, and discarded on any doubt.
//
// 🔒 IT CAN ONLY EVER ADD. A throw, a timeout, an empty reply, an unparseable reply and an explicit
// "nothing special" all resolve to `none`, which injects nothing and leaves the build exactly as it is
// today. There is no branch in which this file can remove or contradict what the deterministic
// analyser already found — the list is never overridden, only extended where it was silent.
//
// ⚠️ AND IT MUST BE ABLE TO SAY "NOTHING SPECIAL", which is not politeness but the main safety
// property. This repo has already paid for the opposite: the domain corpus records a plain to-do app
// being handed moderation and media upload, *"bloat that lengthens the build and helps push the
// generation into the output-token ceiling"*. A model told to produce a feature list will always
// produce one, so the prompt below names the empty answer explicitly and the parser treats a refusal
// as a first-class result rather than a failure.

import { analyzeRequirementGaps, shouldSurfaceRequirementGaps } from './RequirementGapAnalyzer';
import { instructionWords } from '../AgentV3/buildableInput';

/** What the app is, and what apps of that kind usually need. `source` says where it came from. */
export interface DomainKnowledge {
  /** The kind of app, in ordinary words ("temple donation", "fish farm tracking"). '' when unknown. */
  domain: string;
  /** What this kind of app usually needs and the prompt did not mention. Capped. */
  needs: string[];
  /** Short questions worth asking before building. Plan mode uses these; the builder never asks. */
  questions: string[];
  /** `listed` = the deterministic analyser answered · `generated` = a model did · `none` = nothing. */
  source: 'listed' | 'generated' | 'none';
}

const EMPTY: DomainKnowledge = { domain: '', needs: [], questions: [], source: 'none' };

/** Bloat is the failure mode this file has to avoid, so every list is short by construction. */
export const MAX_NEEDS = 6;
export const MAX_QUESTIONS = 3;
const MAX_ITEM_CHARS = 90;

/**
 * The fewest real instruction words before a prompt can plausibly HAVE a domain.
 *
 * Four, not two: "a calculator" and "ek stopwatch banao" must not spend a call to be told that a
 * calculator needs nothing in particular. It is a COST gate, not a quality gate — a prompt below it
 * simply keeps today's behaviour.
 */
export const MIN_WORDS_FOR_DOMAIN = 4;

/** `off` disables generation entirely; the deterministic list keeps working exactly as before. PURE. */
export function domainLearningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env['AGENTV3_DOMAIN_LEARN'] ?? '').trim().toLowerCase() !== 'off';
}

/** Is it worth spending one free call asking what kind of app this is? PURE. */
export function worthAsking(prompt: string): boolean {
  return instructionWords(prompt).length >= MIN_WORDS_FOR_DOMAIN;
}

/** The question. Deliberately allows — and names — the empty answer. PURE. */
export function domainKnowledgePrompt(prompt: string): string {
  return [
    'Read this app request and answer TWO things about the KIND of app it is.',
    '',
    'Reply as JSON, and nothing else:',
    '{"domain":"<the kind of app, 1-4 plain words>",',
    ` "needs":["<something apps of this kind almost always need, that this request did NOT mention>"],`,
    ` "questions":["<a short question whose answer would change what gets built>"]}`,
    '',
    `At most ${MAX_NEEDS} needs and ${MAX_QUESTIONS} questions, each one short and concrete.`,
    'Write them in plain words a non-technical person would use — never file names or frameworks.',
    '',
    // The safety property, stated to the model in its own terms. See the header: a model told to
    // produce a list will produce one, and an invented feature reaches a real user's build prompt.
    'If this is an ordinary small app with nothing special that it typically needs — a calculator, a',
    'timer, a drawing toy, a simple game — reply exactly {"domain":"","needs":[],"questions":[]}.',
    'Do not invent requirements to seem helpful. An empty answer is a correct and useful answer.',
    '',
    `Request: "${String(prompt ?? '').slice(0, 600)}"`,
  ].join('\n');
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, MAX_ITEM_CHARS) : '');

const cleanList = (v: unknown, cap: number): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = clean(item);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
};

/**
 * Read the model's reply, strictly. Anything unparseable is `null` — never a guess.
 *
 * Tolerates a fenced block and surrounding prose, because a chat model adds both; does NOT tolerate a
 * shape it cannot read, because the alternative is putting invented text into a build prompt.
 */
export function parseDomainKnowledge(raw: string | null | undefined): Omit<DomainKnowledge, 'source'> | null {
  const text = String(raw ?? '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  return {
    domain: clean(o['domain']),
    needs: cleanList(o['needs'], MAX_NEEDS),
    questions: cleanList(o['questions'], MAX_QUESTIONS),
  };
}

/**
 * The deterministic answer, when there is one. PURE — no I/O, no model, no cost.
 *
 * This is asked FIRST on every path, so the sixteen enumerated domains keep exactly the behaviour they
 * have today and generation never gets a chance to contradict them.
 */
export function knowledgeFromList(prompt: string): DomainKnowledge | null {
  const gaps = analyzeRequirementGaps(prompt);
  if (!shouldSurfaceRequirementGaps(gaps)) return null;
  return {
    domain: gaps.domain,
    needs: gaps.likelyMissing.slice(0, MAX_NEEDS),
    questions: gaps.clarifyingQuestions.slice(0, MAX_QUESTIONS),
    source: 'listed',
  };
}

/**
 * The whole decision: list first, model only where the list was silent, nothing on any doubt.
 *
 * `llmCall` is injected so this module has no provider dependency and is testable without one; the
 * callers pass the FREE chat router, the same ₹0 door the intent doubt-reader already uses.
 */
export async function resolveDomainKnowledge(
  prompt: string,
  llmCall?: (p: string) => Promise<string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DomainKnowledge> {
  const listed = knowledgeFromList(prompt);
  if (listed) return listed;
  if (!llmCall || !domainLearningEnabled(env) || !worthAsking(prompt)) return EMPTY;
  try {
    const parsed = parseDomainKnowledge(await llmCall(domainKnowledgePrompt(prompt)));
    // A domain with nothing to add is the same as no domain — do not inject a bare label.
    if (!parsed || !parsed.domain || parsed.needs.length === 0) return EMPTY;
    return { ...parsed, source: 'generated' };
  } catch {
    return EMPTY;
  }
}
